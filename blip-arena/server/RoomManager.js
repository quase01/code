'use strict';
/**
 * 방 관리자
 * - 4자리 숫자 방 코드 생성
 * - 방 만들기 / 참가 / 나가기
 * - "이 소켓은 어느 방에 있나" 매핑
 */
const CONFIG = require('../shared/config');
const Room = require('./Room');

function sanitizeName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code → Room
    this.playerRoom = new Map(); // socketId → Room
  }

  create(client, name, character) {
    const nick = sanitizeName(name);
    if (!nick) return { ok: false, error: '닉네임을 입력해 주세요.' };

    this.leave(client.id); // 다른 방에 있었다면 먼저 나감
    const code = this.generateCode();
    if (!code) return { ok: false, error: '지금은 방을 더 만들 수 없습니다.' };

    const room = new Room(code, () => this.rooms.delete(code));
    this.rooms.set(code, room);
    return this.enter(room, client, nick, character);
  }

  join(client, name, code, character) {
    const nick = sanitizeName(name);
    if (!nick) return { ok: false, error: '닉네임을 입력해 주세요.' };

    this.leave(client.id);
    const room = this.rooms.get(String(code ?? '').trim());
    if (!room) return { ok: false, error: '방을 찾을 수 없습니다. 코드를 확인해 주세요.' };
    if (room.players.size >= CONFIG.match.maxPlayers) {
      return { ok: false, error: `방이 가득 찼습니다. (최대 ${CONFIG.match.maxPlayers}명)` };
    }
    return this.enter(room, client, nick, character);
  }

  enter(room, client, nick, character) {
    room.addPlayer(client, nick, character);
    this.playerRoom.set(client.id, room);
    return {
      ok: true,
      myId: client.id,
      room: room.info(),
      // 경기 진행 중인 방에 들어오면 바로 게임 화면으로 들어가도록 시작 정보도 같이 줌
      game: room.state === 'playing' ? room.startPayload() : null,
    };
  }

  leave(socketId) {
    const room = this.playerRoom.get(socketId);
    if (!room) return;
    this.playerRoom.delete(socketId);
    room.removePlayer(socketId); // 마지막 사람이면 Room이 onEmpty로 스스로 삭제됨
  }

  roomOf(socketId) {
    return this.playerRoom.get(socketId) || null;
  }

  generateCode() {
    if (this.rooms.size >= 9000) return null;
    for (;;) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!this.rooms.has(code)) return code;
    }
  }
}

module.exports = RoomManager;
