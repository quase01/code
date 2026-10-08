'use strict';
/**
 * Blip Arena 서버 진입점
 *
 * 한 프로세스가 두 가지를 모두 담당합니다.
 *  1) Express: public/(게임 클라이언트)와 shared/(공용 코드)를 정적 파일로 서빙
 *  2) Socket.IO: 로비/게임 통신
 *
 * ┌──────────── 네트워크 구조 요약 (서버 권위 방식) ────────────┐
 * │ 클라이언트 → 서버 : 입력만 보냄 {seq, dx, dy, aim, fire}    │
 * │ 서버 (30틱)       : 입력 적용 → 총알/충돌/데미지/사망 판정  │
 * │ 서버 → 클라이언트 : 매 틱 스냅샷(모든 플레이어/총알 상태 +   │
 * │                     각자 "마지막으로 처리한 입력 번호(ack)") │
 * │ 클라이언트        : 내 캐릭터는 예측 + 보정, 남은 보간       │
 * └──────────────────────────────────────────────────────────────┘
 * 자세한 클라이언트 쪽 설명은 public/js/GameScene.js 상단 주석을 보세요.
 *
 * 실행 옵션 (인자 또는 환경변수):
 *   --port=3000     / PORT
 *   --lag=150       / LAG_MS     서버가 주고받는 모든 패킷에 지연(ms, 단방향)
 *   --jitter=50     / JITTER_MS  지연에 더해질 무작위 흔들림(ms)
 */
const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const { createDelayer } = require('../shared/lag');
const RoomManager = require('./RoomManager');

function readOption(name, envName, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  const raw = arg ? arg.slice(prefix.length) : process.env[envName];
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) ? n : fallback;
}

const PORT = readOption('port', 'PORT', 3000);
const LAG_MS = readOption('lag', 'LAG_MS', 0);
const JITTER_MS = readOption('jitter', 'JITTER_MS', 0);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// 로비의 맵 선택 목록 (서버가 시작할 때 shared/maps/*.json에서 읽은 맵 전부)
const MAPS = require('./maps');
app.get('/api/maps', (_req, res) => res.json(MAPS));

const server = http.createServer(app);
const io = new Server(server);
const rooms = new RoomManager();

io.on('connection', (socket) => {
  // 소켓마다 받는 쪽/보내는 쪽 지연기를 따로 둠 (랙 옵션이 0이면 즉시 실행)
  const inDelay = createDelayer(LAG_MS, JITTER_MS);
  const outDelay = createDelayer(LAG_MS, JITTER_MS);

  // Room은 socket을 직접 만지지 않고 이 client 객체로만 메시지를 보냄 → 지연이 자동 적용됨
  const client = {
    id: socket.id,
    send: (event, data) => outDelay(() => socket.emit(event, data)),
  };

  // 받는 메시지에도 지연 적용. 지연 도중 연결이 끊겼으면 무시.
  const on = (event, handler) =>
    socket.on(event, (...args) =>
      inDelay(() => {
        if (socket.connected) handler(...args);
      })
    );
  const reply = (ack, result) => {
    if (typeof ack === 'function') outDelay(() => ack(result));
  };

  on('createRoom', (data, ack) => reply(ack, rooms.create(client, data && data.name, data && data.character)));
  on('joinRoom', (data, ack) =>
    reply(ack, rooms.join(client, data && data.name, data && data.code, data && data.character))
  );
  on('leaveRoom', () => rooms.leave(socket.id));

  // 로비에서 캐릭터 변경
  on('selectCharacter', (data, ack) => {
    const room = rooms.roomOf(socket.id);
    reply(ack, room ? room.selectCharacter(socket.id, data && data.character) : { ok: false, error: '방에 들어가 있지 않습니다.' });
  });

  // 로비에서 맵 변경 (방장만)
  on('selectMap', (data, ack) => {
    const room = rooms.roomOf(socket.id);
    reply(ack, room ? room.selectMap(socket.id, data && data.mapId) : { ok: false, error: '방에 들어가 있지 않습니다.' });
  });

  on('startGame', (_data, ack) => {
    const room = rooms.roomOf(socket.id);
    reply(ack, room ? room.start(socket.id) : { ok: false, error: '방에 들어가 있지 않습니다.' });
  });

  // 로비에서 게임 모드 변경 (방장만)
  on('selectMode', (data, ack) => {
    const room = rooms.roomOf(socket.id);
    reply(ack, room ? room.selectMode(socket.id, data && data.mode) : { ok: false, error: '방에 들어가 있지 않습니다.' });
  });

  // 기지전 팀 나누기 (방장만): 한 명 옮기기 / 자동 나누기
  on('setTeam', (data, ack) => {
    const room = rooms.roomOf(socket.id);
    reply(ack, room ? room.setTeam(socket.id, data && data.playerId, data && data.team) : { ok: false, error: '방에 들어가 있지 않습니다.' });
  });
  on('autoTeams', (_data, ack) => {
    const room = rooms.roomOf(socket.id);
    reply(ack, room ? room.autoTeams(socket.id) : { ok: false, error: '방에 들어가 있지 않습니다.' });
  });

  // 배틀로얄 관전 대상 변경 (dir: 1 = 다음, -1 = 이전)
  on('spectate', (data) => {
    const room = rooms.roomOf(socket.id);
    if (room) room.cycleSpectate(socket.id, data && data.dir);
  });

  on('input', (inputs) => {
    const room = rooms.roomOf(socket.id);
    if (room) room.handleInput(socket.id, inputs);
  });

  on('chat', (data) => {
    const room = rooms.roomOf(socket.id);
    if (room) room.chat(socket.id, data && data.text, !!(data && data.team)); // team: true면 팀 채팅
  });

  // 핑 측정: 받은 값을 그대로 돌려줌 (왕복 모두 지연 적용)
  on('pingCheck', (t) => client.send('pongCheck', t));

  // 연결 종료는 지연 없이 즉시 처리 → 방에서 깔끔하게 제거
  socket.on('disconnect', () => rooms.leave(socket.id));
});

server.listen(PORT, () => {
  console.log(`\n  Blip Arena 서버 실행 중`);
  console.log(`  - 이 컴퓨터:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  - 같은 와이파이: http://${net.address}:${PORT}`);
    }
  }
  if (LAG_MS || JITTER_MS) {
    console.log(`  ※ 인위적 지연 켜짐: 단방향 ${LAG_MS}ms + 지터 0~${JITTER_MS}ms (왕복 약 ${LAG_MS * 2}ms 이상)`);
  }
  console.log('');
});

// 테스트 스크립트에서 서버 상태를 들여다볼 수 있도록 내보냄 (게임 동작과는 무관)
module.exports = { server, rooms };
