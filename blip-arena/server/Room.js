'use strict';
/**
 * 방 하나 = 게임 한 판의 "진짜" 상태를 가진 곳 (서버 권위)
 *
 * 매 틱(초당 30회) 처리 순서:
 *   1) 입력 처리  : 플레이어마다 쌓인 입력을 순서대로 적용 (이동, 조준, 공격, 필살기)
 *                   처리한 입력 번호를 lastSeq에 기록 → 스냅샷의 ack로 클라이언트에 알려줌
 *   2) 넉백       : 필살기로 밀려난 플레이어 이동
 *   3) 투사체     : 총알(직선) 이동/충돌, 폭탄(포물선) 비행/폭발. 부서지는 벽에 피해
 *   4) 상태 갱신  : 탄약 충전, 체력 회복, 부활(데스매치만), 수풀 위치
 *   5) 모드 규칙  : 데스매치 = 시간 종료 / 배틀로얄 = 독가스, 파워 큐브 줍기, 생존자 1명이면 종료
 *   6) 스냅샷 전송: 받는 사람마다 "그 사람에게 보이는 플레이어만" 담아서 전송 (수풀 숨김)
 *
 * [수풀 숨김을 서버에서 하는 이유]
 * 클라이언트가 숨은 적의 좌표를 받은 뒤 "안 그리기"만 하면, 개발자 도구로 좌표를 꺼내 보는
 * 치트가 가능합니다. 그래서 서버가 받는 사람별로 보이는지 판정하고, 안 보이는 적은
 * 스냅샷의 players 목록에서 아예 빼고 보냅니다. (킬 순위표는 위치 없는 scores 목록으로 따로 보냄)
 * 배틀로얄 관전자는 "관전 대상의 눈"으로 판정합니다 → 관전자가 숨은 적 위치를 친구에게 알려줄 수 없음.
 * 기지전에서 같은 팀은 수풀 속이어도 항상 서로 보입니다.
 *
 * [기지전] 기지는 world의 부서지는 벽(kind 'base')이라 이동/총알을 막고 체력이 스냅샷 walls로 갑니다.
 * 같은 팀의 총알/폭발/충격파는 아군과 아군 기지에 피해를 주지 않습니다 (isAlly).
 *
 * 클라이언트가 보내는 건 "입력"뿐이라서, 위치나 체력을 조작한 값을 보내도 서버는 믿지 않습니다.
 */
const CONFIG = require('../shared/config');
const Physics = require('../shared/physics');
const World = require('../shared/world');
const MAPS = require('./maps');
const { characters: CHARACTERS } = require('../shared/characters.json');

const TICK_MS = 1000 / CONFIG.net.tickRate;
const TICK_DT = 1 / CONFIG.net.tickRate;
// 입력 하나는 클라이언트의 고정 스텝 1개(1/60초) 분량. 서버도 같은 dt로 적용해야 예측과 일치함.
const INPUT_DT = 1 / CONFIG.net.inputRate;
const DEG = Math.PI / 180;
const BR = CONFIG.battleRoyale;
const TEAMS = CONFIG.teams;
const DEFAULT_MAP = MAPS[CONFIG.defaultMap] ? CONFIG.defaultMap : Object.keys(MAPS)[0];

const round2 = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const toNum = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.players = new Map(); // id → player
    this.hostId = null;
    this.state = 'lobby'; // 'lobby' | 'playing'
    this.mode = CONFIG.defaultMode; // 'deathmatch' | 'battleroyale' | 'teams'
    this.mapId = DEFAULT_MAP;
    this.world = World.buildWorld(MAPS[this.mapId]); // 경기 시작 때마다 새로 만듦 (부서진 벽 복구)
    this.boxes = []; // 배틀로얄 파워 큐브 상자 위치 (경기 시작 때 정함)
    this.bases = []; // 기지전 기지 위치 (경기 시작 때 정함)
    this.turrets = []; // 기지전 포탑 상태 {team, wall, x, y, aim, lastFireAt}
    this.destroyedBaseTeam = null; // 기지가 부서진 팀 (기지전 종료 판정)
    this.matchId = 0; // 경기마다 증가. 이전 경기의 늦게 도착한 입력을 걸러내는 데 씀
    this.bullets = []; // 직선으로 날아가는 탄 (산탄, 저격, 레일)
    this.bombs = []; // 포물선으로 날아가는 폭탄 (벽을 넘어감)
    this.cubes = []; // 바닥에 떨어진 파워 큐브 (배틀로얄)
    this.fx = []; // 이번 틱에 생긴 이펙트 → 스냅샷에 실어 보냄
    this.nextProjectileId = 1;
    this.nextCubeId = 1;
    this.eliminated = []; // 배틀로얄 탈락 순서 (먼저 죽은 사람이 앞)
    this.startedWith = 0; // 배틀로얄 시작 인원
    this.matchStartAt = 0;
    this.matchEndsAt = 0;
    this.nextGasPulseAt = 0;
    this.loop = null;
    this.now = Date.now();
  }

  get isBR() {
    return this.mode === 'battleroyale';
  }

  // ───────────────────────── 방 인원 관리 ─────────────────────────

  addPlayer(client, name, character) {
    const p = {
      id: client.id,
      name: this.uniqueName(name),
      send: client.send,
      color: this.pickColor(),
      character: has(CHARACTERS, character) ? character : CONFIG.defaultCharacter,
      x: 0,
      y: 0,
      aim: 0,
      aimDist: 0,
      bush: -1, // 들어가 있는 수풀 group (-1 = 수풀 밖)
      participant: false, // 이번 경기에 처음부터 참가했는지 (배틀로얄 중간 참가자는 관전만)
      team: this.smallerTeam(), // 기지전 팀 (0 또는 1). 새로 오면 인원이 적은 팀으로
      kills: 0,
      deaths: 0,
      lastChatAt: 0,
    };
    this.resetCombatState(p);
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;

    if (this.state === 'playing') {
      if (this.isBR) {
        // 배틀로얄은 부활이 없으므로 중간 참가자는 관전자로
        this.broadcast('chat', { system: true, text: `${p.name} 님이 관전자로 들어왔습니다.` }, p.id);
      } else {
        p.participant = true;
        this.spawn(p);
        this.broadcast('chat', { system: true, text: `${p.name} 님이 경기에 참가했습니다.` }, p.id);
      }
    }
    this.broadcastRoom();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.bullets = this.bullets.filter((b) => b.owner !== id);
    this.bombs = this.bombs.filter((b) => b.owner !== id);
    this.eliminated = this.eliminated.filter((e) => e !== id);

    if (this.players.size === 0) {
      this.stopLoop();
      this.onEmpty();
      return;
    }
    if (this.hostId === id) this.hostId = this.players.keys().next().value; // 방장 위임
    this.broadcast('playerLeft', { id, name: p.name });
    this.broadcastRoom();
  }

  // 로비에서 캐릭터 변경 (경기 중에는 불가)
  selectCharacter(id, character) {
    const p = this.players.get(id);
    if (!p || !has(CHARACTERS, character)) return { ok: false, error: '없는 캐릭터입니다.' };
    if (this.state === 'playing') return { ok: false, error: '경기 중에는 캐릭터를 바꿀 수 없습니다.' };
    p.character = character;
    this.broadcastRoom();
    return { ok: true };
  }

  // 로비에서 맵 변경 (방장만, 경기 중에는 불가)
  selectMap(byId, mapId) {
    if (byId !== this.hostId) return { ok: false, error: '방장만 맵을 바꿀 수 있습니다.' };
    if (!has(MAPS, mapId)) return { ok: false, error: '없는 맵입니다.' };
    if (this.state === 'playing') return { ok: false, error: '경기 중에는 맵을 바꿀 수 없습니다.' };
    this.mapId = mapId;
    this.broadcastRoom();
    return { ok: true };
  }

  // 로비에서 모드 변경 (방장만, 경기 중에는 불가)
  selectMode(byId, mode) {
    if (byId !== this.hostId) return { ok: false, error: '방장만 모드를 바꿀 수 있습니다.' };
    if (!has(CONFIG.modes, mode)) return { ok: false, error: '없는 모드입니다.' };
    if (this.state === 'playing') return { ok: false, error: '경기 중에는 모드를 바꿀 수 없습니다.' };
    this.mode = mode;
    this.broadcastRoom();
    return { ok: true };
  }

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      if (!taken.has(`${name}${n}`)) return `${name}${n}`;
    }
  }

  pickColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return CONFIG.colors.find((c) => !used.has(c)) ?? CONFIG.colors[0];
  }

  stats(p) {
    return CHARACTERS[p.character];
  }

  // 파워 큐브 반영 최대 체력 / 공격력 배율
  maxHp(p) {
    return Math.round(this.stats(p).maxHp * (1 + p.cubes * BR.cubeHpBonus));
  }

  damageMul(p) {
    return 1 + p.cubes * BR.cubeDamageBonus;
  }

  // 전투 관련 값 초기화 (경기 시작 / 중간 참가 시)
  resetCombatState(p) {
    const c = this.stats(p);
    p.cubes = 0; // 먹은 파워 큐브 수
    p.hp = c.maxHp;
    p.alive = false;
    p.ammo = c.attack.maxAmmo;
    p.superCharge = 0; // 필살기 게이지 0~1
    p.knockX = 0; // 넉백 속도 (px/초)
    p.knockY = 0;
    p.lastFireAt = 0;
    p.lastDamagedAt = 0;
    p.respawnAt = Infinity; // 데스매치에서 죽으면 부활 시각이 정해짐
    p.revealedUntil = 0; // 이 시각까지는 수풀 안이어도 모두에게 보임
    p.killedBy = null; // 배틀로얄: 나를 죽인 사람 (관전 대상 기본값)
    p.spectating = null; // 배틀로얄: 관전 중인 플레이어 id
    p.inputQueue = [];
    // 입력 토큰(token bucket): 실제 시간에 비례해 초당 inputRate개씩 채워지고, 입력 1개 처리에 1개 소모.
    // 조작된 클라이언트가 입력을 4배로 보내도(스피드핵) 평균 속도는 정상과 같게 제한됨
    p.inputTokens = CONFIG.net.inputRate * CONFIG.net.inputBurstSec;
    p.lastQueuedSeq = 0; // 큐에 넣은 마지막 입력 번호 (중복/역순 차단)
    p.lastSeq = 0; // 실제로 "처리 완료"한 마지막 입력 번호 → 스냅샷의 ack
  }

  // ───────────────────────── 메시지 전송 ─────────────────────────

  broadcast(event, data, exceptId) {
    for (const p of this.players.values()) {
      if (p.id !== exceptId) p.send(event, data);
    }
  }

  info() {
    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      mode: this.mode,
      mapId: this.mapId,
      maxPlayers: CONFIG.match.maxPlayers,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        character: p.character,
        team: p.team,
      })),
    };
  }

  broadcastRoom() {
    this.broadcast('roomUpdate', this.info());
  }

  // 경기 시작 정보: 맵 원본 JSON + 상자 위치를 보내서 클라이언트가 같은 world를 만들게 함
  startPayload() {
    return {
      matchId: this.matchId,
      mode: this.mode,
      durationMs: CONFIG.match.durationMs,
      mapId: this.mapId,
      map: MAPS[this.mapId],
      boxes: this.boxes,
      bases: this.bases,
      // 경기 중 참가자용: 이미 부서진 벽 상태
      walls: this.world.breakables.map((b) => Math.ceil(b.hp)),
    };
  }

  // ───────────────────────── 경기 흐름 ─────────────────────────

  start(byId) {
    if (byId !== this.hostId) return { ok: false, error: '방장만 시작할 수 있습니다.' };
    if (this.state === 'playing') return { ok: false, error: '이미 경기 중입니다.' };
    if (this.players.size < CONFIG.match.minPlayersToStart) {
      return { ok: false, error: `최소 ${CONFIG.match.minPlayersToStart}명이 필요합니다.` };
    }
    if (this.isTeams) {
      const [a, b] = this.teamCounts();
      if (a === 0 || b === 0) return { ok: false, error: '기지전은 두 팀 모두 1명 이상 있어야 합니다.' };
      if (a !== b) return { ok: false, error: `두 팀 인원이 같아야 시작할 수 있습니다. (현재 ${a} vs ${b})` };
    }

    this.state = 'playing';
    this.matchId++;
    const map = MAPS[this.mapId];
    this.boxes = this.isBR ? this.placeBoxes(map) : [];
    this.bases = this.isTeams ? this.placeBases(map) : [];
    this.world = World.buildWorld(map, { boxes: this.boxes, bases: this.bases }); // 부서진 벽 모두 복구
    // 포탑 = 기지(world의 부서지는 벽 kind 'base')에 붙은 자동 공격 장치
    this.turrets = this.world.breakables
      .filter((b) => b.kind === 'base')
      .map((b) => ({ team: b.team, wall: b, x: b.x + b.w / 2, y: b.y + b.h / 2, aim: b.team === 0 ? Math.PI / 2 : -Math.PI / 2, lastFireAt: 0 }));
    this.destroyedBaseTeam = null;
    this.bullets = [];
    this.bombs = [];
    this.cubes = [];
    this.fx = [];
    this.eliminated = [];
    this.now = Date.now();
    this.matchStartAt = this.now;
    this.matchEndsAt =
      this.now + (this.isBR ? BR.maxDurationMs : this.isTeams ? TEAMS.durationMs : CONFIG.match.durationMs);
    this.nextGasPulseAt = this.now + BR.gasStartMs + 1000;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.participant = true;
      this.resetCombatState(p);
      this.spawn(p);
    }
    this.startedWith = this.players.size;

    this.broadcast('gameStart', this.startPayload());
    this.broadcastRoom();
    this.stopLoop();
    this.loop = setInterval(() => this.tick(), TICK_MS);
    return { ok: true };
  }

  // 배틀로얄 파워 큐브 상자 배치: 맵의 powerBoxes, 없으면 벽과 안 겹치는 무작위 위치
  placeBoxes(map) {
    const size = BR.boxSize;
    const toRect = (pt) => ({ x: pt.x - size / 2, y: pt.y - size / 2, w: size, h: size, hp: BR.boxHp });
    if (Array.isArray(map.powerBoxes) && map.powerBoxes.length) return map.powerBoxes.map(toRect);

    const base = World.buildWorld(map);
    const boxes = [];
    for (let tries = 0; boxes.length < BR.boxCount && tries < 500; tries++) {
      const pt = { x: 60 + Math.random() * (map.width - 120), y: 60 + Math.random() * (map.height - 120) };
      if (Physics.circleHitsAnyWall(base, pt.x, pt.y, size)) continue;
      if (boxes.some((b) => Math.hypot(b.x + size / 2 - pt.x, b.y + size / 2 - pt.y) < size * 3)) continue;
      boxes.push(toRect(pt));
    }
    return boxes;
  }

  // 기지전 기지 배치: 맵의 bases, 없으면 맵 왼쪽/오른쪽 가운데
  placeBases(map) {
    const size = TEAMS.baseSize;
    const centers = Array.isArray(map.bases) && map.bases.length === 2
      ? map.bases
      : [{ x: size, y: map.height / 2 }, { x: map.width - size, y: map.height / 2 }];
    return centers.map((c, team) => ({ x: c.x - size / 2, y: c.y - size / 2, w: size, h: size, hp: TEAMS.baseHp, team }));
  }

  /**
   * 경기 종료 → 순위 계산
   * - 데스매치: 킬 많은 순 (같으면 데스 적은 순)
   * - 배틀로얄: 마지막 생존자 1위, 나머지는 늦게 탈락한 순. 중간 참가 관전자는 순위 없음
   * - 기지전: 이긴 팀 전원 1위, 진 팀 2위 (무승부면 모두 1위). 팀 안에서는 킬 순
   */
  endMatch() {
    this.stopLoop();
    this.state = 'lobby';
    this.bullets = [];
    this.bombs = [];
    this.cubes = [];

    const all = [...this.players.values()];
    let ordered;
    let teamResult = null;
    if (this.isTeams) {
      teamResult = this.teamResult();
      const w = teamResult.winner;
      ordered = all.sort((a, b) => (w !== null ? (b.team === w) - (a.team === w) : a.team - b.team) || b.kills - a.kills);
      for (const p of ordered) p.place = w === null || p.team === w ? 1 : 2;
    } else if (this.isBR) {
      const survivors = all
        .filter((p) => p.participant && p.alive)
        .sort((a, b) => b.hp - a.hp || b.kills - a.kills); // 시간 초과로 끝났을 때 대비
      const fallen = [...this.eliminated].reverse().map((id) => this.players.get(id)).filter(Boolean);
      ordered = survivors.concat(fallen);
      for (const p of all) if (!ordered.includes(p)) ordered.push(p); // 관전자
    } else {
      ordered = all.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    }
    const ranking = ordered.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      character: p.character,
      kills: p.kills,
      deaths: p.deaths,
      team: p.team,
      place: !p.participant ? null : this.isTeams ? p.place : i + 1,
    }));

    for (const p of all) {
      p.alive = false;
      p.participant = false;
    }
    this.broadcast('matchEnd', { mode: this.mode, ranking, teamResult });
    this.broadcastRoom();
  }

  // 기지전 승패: 기지가 부서진 팀이 패배. 시간 종료면 기지 체력 비율이 높은 팀 승리 (같으면 무승부)
  teamResult() {
    if (this.destroyedBaseTeam !== null) {
      return { winner: 1 - this.destroyedBaseTeam, reason: 'base' };
    }
    const ratio = (team) => {
      const t = this.turrets.find((x) => x.team === team);
      return t ? t.wall.hp / t.wall.maxHp : 0;
    };
    const [r0, r1] = [ratio(0), ratio(1)];
    return { winner: r0 === r1 ? null : r0 > r1 ? 0 : 1, reason: 'time' };
  }

  // ───────────────────────── 팀 ─────────────────────────

  get isTeams() {
    return this.mode === 'teams';
  }

  // 같은 팀인지 (기지전에서만 의미 있음. 다른 모드는 모두 적)
  isAlly(teamA, teamB) {
    return this.isTeams && teamA !== undefined && teamA === teamB;
  }

  teamCounts() {
    const counts = [0, 0];
    for (const p of this.players.values()) counts[p.team]++;
    return counts;
  }

  smallerTeam() {
    const [a, b] = this.teamCounts();
    return a <= b ? 0 : 1;
  }

  // 방장이 플레이어의 팀을 바꿈 (로비에서만)
  setTeam(byId, playerId, team) {
    if (byId !== this.hostId) return { ok: false, error: '방장만 팀을 나눌 수 있습니다.' };
    if (this.state === 'playing') return { ok: false, error: '경기 중에는 팀을 바꿀 수 없습니다.' };
    const p = this.players.get(playerId);
    if (!p || (team !== 0 && team !== 1)) return { ok: false, error: '잘못된 요청입니다.' };
    p.team = team;
    this.broadcastRoom();
    return { ok: true };
  }

  // 방장이 "자동 나누기": 무작위로 섞어 번갈아 배정
  autoTeams(byId) {
    if (byId !== this.hostId) return { ok: false, error: '방장만 팀을 나눌 수 있습니다.' };
    if (this.state === 'playing') return { ok: false, error: '경기 중에는 팀을 바꿀 수 없습니다.' };
    const list = [...this.players.values()].sort(() => Math.random() - 0.5);
    list.forEach((p, i) => (p.team = i % 2));
    this.broadcastRoom();
    return { ok: true };
  }

  // 포탑: 사거리 안의 가장 가까운 적을 자동 공격 (수풀에 숨은 적은 못 봄)
  updateTurrets() {
    for (const t of this.turrets) {
      if (t.wall.hp <= 0) continue;
      const eye = { alive: true, bush: -1, x: t.x, y: t.y, team: t.team };
      let target = null;
      let best = TEAMS.turretRange;
      for (const p of this.players.values()) {
        if (!p.alive || p.team === t.team || !this.canSee(eye, p)) continue;
        const d = Math.hypot(p.x - t.x, p.y - t.y);
        if (d <= best) {
          best = d;
          target = p;
        }
      }
      if (!target) continue;
      t.aim = Math.atan2(target.y - t.y, target.x - t.x);
      if (this.now - t.lastFireAt < TEAMS.turretCooldownMs) continue;
      t.lastFireAt = this.now;
      const muzzle = TEAMS.baseSize * 0.75; // 기지 사각형 바깥에서 발사 (자기 기지에 막히지 않게)
      this.bullets.push({
        id: this.nextProjectileId++,
        owner: `base:${t.team}`,
        team: t.team,
        x: t.x + Math.cos(t.aim) * muzzle,
        y: t.y + Math.sin(t.aim) * muzzle,
        vx: Math.cos(t.aim) * TEAMS.turretBulletSpeed,
        vy: Math.sin(t.aim) * TEAMS.turretBulletSpeed,
        traveled: 0,
        range: TEAMS.turretRange + 60,
        radius: 8,
        damage: TEAMS.turretDamage,
        charge: 0,
        pierceWalls: false,
        piercePlayers: false,
        isSuper: false,
        hitIds: new Set(),
        hitWalls: new Set(),
      });
    }
  }

  // 공격자 정보 (플레이어 또는 포탑 'base:0'), 킬 로그용
  attackerInfo(attackerId) {
    const p = attackerId ? this.players.get(attackerId) : null;
    if (p) return { player: p, name: p.name, color: p.color };
    if (typeof attackerId === 'string' && attackerId.startsWith('base:')) {
      const team = Number(attackerId.slice(5));
      return { player: null, name: `${TEAMS.names[team]} 포탑`, color: TEAMS.lobbyColors[team] };
    }
    return { player: null, name: '독가스', color: 0x8ce99a };
  }

  stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  // 벽과 겹치지 않고, 다른 플레이어와 최대한 먼 위치를 골라 (부활)
  // 맵에 spawnPoints가 있으면 그 중에서, 없으면 무작위 위치 중에서 고름
  // (필살기 게이지는 죽어도 유지)
  spawn(p) {
    const c = this.stats(p);
    const r = c.radius;
    const w = this.world;
    // 멀리 떨어질 대상: 기지전은 적만, 나머지 모드는 다른 모든 플레이어
    const others = [...this.players.values()].filter((o) => o !== p && o.alive && !this.isAlly(o.team, p.team));
    const myBase = this.isTeams && this.turrets.find((t) => t.team === p.team);
    const candidates = myBase
      ? // 기지전: 내 기지 주변 고리 모양 안에서
        Array.from({ length: 30 }, () => {
          const ang = Math.random() * Math.PI * 2;
          const dist = TEAMS.baseSize + 30 + Math.random() * 150;
          return {
            x: Physics.clamp(myBase.x + Math.cos(ang) * dist, r + 4, w.width - r - 4),
            y: Physics.clamp(myBase.y + Math.sin(ang) * dist, r + 4, w.height - r - 4),
          };
        })
      : w.spawnPoints
      ? w.spawnPoints
      : Array.from({ length: 30 }, () => ({
          x: r + 10 + Math.random() * (w.width - 2 * (r + 10)),
          y: r + 10 + Math.random() * (w.height - 2 * (r + 10)),
        }));

    let best = null;
    let bestScore = -1;
    for (const pt of candidates) {
      if (Physics.circleHitsAnyWall(w, pt.x, pt.y, r + 6)) continue;
      const score = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - pt.x, o.y - pt.y))) : Math.random();
      if (score > bestScore) {
        best = pt;
        bestScore = score;
      }
    }
    if (!best) best = { x: r + 20, y: r + 20 }; // 사실상 안 일어나지만 안전장치
    p.x = best.x;
    p.y = best.y;
    p.hp = this.maxHp(p);
    p.ammo = c.attack.maxAmmo;
    p.alive = true;
    p.knockX = 0;
    p.knockY = 0;
    p.lastDamagedAt = 0;
    p.bush = World.bushAt(w, p.x, p.y);
  }

  // ───────────────────────── 입력 수신 ─────────────────────────

  /**
   * 클라이언트가 보낸 입력 묶음을 검증해서 큐에 쌓음 (실제 적용은 tick에서)
   * input = { m: matchId, seq, dx, dy, aim, aimDist, fire, super }
   *   aimDist: 내 캐릭터에서 마우스까지 거리 (투척 캐릭터가 폭탄 떨어질 지점을 정하는 데 씀)
   */
  handleInput(id, inputs) {
    if (this.state !== 'playing' || !Array.isArray(inputs)) return;
    const p = this.players.get(id);
    if (!p) return;

    for (const raw of inputs.slice(0, 64)) {
      if (!raw || raw.m !== this.matchId) continue; // 이전 경기의 입력은 버림
      const seq = raw.seq;
      if (!Number.isInteger(seq) || seq <= p.lastQueuedSeq) continue;
      p.lastQueuedSeq = seq;
      p.inputQueue.push({
        seq,
        dx: Physics.clamp(toNum(raw.dx), -1, 1),
        dy: Physics.clamp(toNum(raw.dy), -1, 1),
        aim: toNum(raw.aim, p.aim),
        aimDist: Physics.clamp(toNum(raw.aimDist), 0, 3000),
        fire: raw.fire === true,
        super: raw.super === true,
      });
    }
    // 너무 많이 밀리면 오래된 입력부터 버림 (클라이언트는 보정으로 따라옴)
    const overflow = p.inputQueue.length - CONFIG.net.maxQueuedInputs;
    if (overflow > 0) p.inputQueue.splice(0, overflow);
  }

  // 배틀로얄 관전 대상 바꾸기 (dir: +1 다음 사람, -1 이전 사람)
  cycleSpectate(id, dir) {
    const p = this.players.get(id);
    if (!p || p.alive || !this.isBR || this.state !== 'playing') return;
    const alive = [...this.players.values()].filter((o) => o.alive);
    if (!alive.length) return;
    const idx = alive.findIndex((o) => o.id === p.spectating);
    const step = dir < 0 ? -1 : 1;
    p.spectating = alive[(idx + step + alive.length) % alive.length].id;
  }

  /**
   * 채팅. teamOnly면 기지전에서 같은 팀에게만 보냄 (다른 팀 소켓으로는 아예 전송하지 않음)
   */
  chat(id, text, teamOnly) {
    const p = this.players.get(id);
    if (!p) return;
    const msg = String(text ?? '').trim().slice(0, 100);
    const now = Date.now();
    if (!msg || now - p.lastChatAt < 300) return; // 도배 방지
    p.lastChatAt = now;
    if (teamOnly && this.isTeams) {
      const data = { name: p.name, color: p.color, text: msg, team: true };
      for (const o of this.players.values()) if (o.team === p.team) o.send('chat', data);
      return;
    }
    this.broadcast('chat', { name: p.name, color: p.color, text: msg });
  }

  // ───────────────────────── 게임 루프 ─────────────────────────

  tick() {
    if (this.state !== 'playing') return; // 경기 종료 직후 남은 틱이 또 종료 처리하지 않도록
    const prevTick = this.now;
    this.now = Date.now();
    this.fx = [];

    // 입력 토큰 충전 (실제 경과 시간 기준이라 서버 틱이 조금 늦어져도 정상 클라이언트는 손해 없음)
    const elapsedSec = Math.min(0.25, Math.max(0, (this.now - prevTick) / 1000));
    const tokenCap = CONFIG.net.inputRate * CONFIG.net.inputBurstSec;
    for (const p of this.players.values()) {
      p.inputTokens = Math.min(tokenCap, p.inputTokens + CONFIG.net.inputRate * elapsedSec);
    }

    // 1) 입력 처리
    for (const p of this.players.values()) this.processInputs(p);

    // 2) 넉백 이동 (클라이언트 예측은 이걸 모르므로, 맞은 본인 화면에서는 서버 보정으로 부드럽게 반영됨)
    const knockDecay = Math.exp(-CONFIG.player.knockbackDecay * TICK_DT);
    for (const p of this.players.values()) {
      if (!p.alive || (p.knockX === 0 && p.knockY === 0)) continue;
      Physics.moveBy(this.world, p, p.knockX * TICK_DT, p.knockY * TICK_DT, this.stats(p).radius);
      p.knockX *= knockDecay;
      p.knockY *= knockDecay;
      if (Math.hypot(p.knockX, p.knockY) < 20) p.knockX = p.knockY = 0;
    }

    // 3) 투사체
    this.updateBullets();
    this.updateBombs();

    // 4) 탄약 충전 / 체력 회복 / 부활 / 수풀 위치
    for (const p of this.players.values()) {
      const c = this.stats(p);
      if (!p.alive) {
        if (!this.isBR && this.now >= p.respawnAt) this.spawn(p); // 배틀로얄은 부활 없음
        continue;
      }
      p.ammo = Math.min(c.attack.maxAmmo, p.ammo + TICK_MS / c.attack.reloadMs);
      const max = this.maxHp(p);
      if (p.hp < max && this.now - p.lastDamagedAt >= CONFIG.player.regenDelayMs) {
        p.hp = Math.min(max, p.hp + max * CONFIG.player.regenPercentPerSec * TICK_DT);
      }
      p.bush = World.bushAt(this.world, p.x, p.y);
    }

    // 5) 모드 규칙
    if (this.isBR) {
      this.updateGas();
      this.pickupCubes();
      if (this.checkBattleRoyaleEnd()) return;
    }
    if (this.isTeams) {
      this.updateTurrets();
      if (this.destroyedBaseTeam !== null) {
        this.endMatch();
        return;
      }
    }
    if (this.now >= this.matchEndsAt) {
      this.endMatch();
      return;
    }

    // 6) 스냅샷 전송 (받는 사람마다 다름)
    this.sendSnapshots();
  }

  processInputs(p) {
    const c = this.stats(p);
    const count = Math.min(p.inputQueue.length, CONFIG.net.maxInputsPerTick, Math.floor(p.inputTokens));
    p.inputTokens -= count;
    for (let i = 0; i < count; i++) {
      const input = p.inputQueue.shift();
      p.lastSeq = input.seq; // 죽어 있어도 "처리함"으로 기록해야 클라이언트 대기열이 비워짐
      p.aim = input.aim;
      p.aimDist = input.aimDist;
      if (!p.alive) continue;
      // 클라이언트 예측과 똑같은 함수 + 똑같은 dt + 똑같은 캐릭터 수치 + 똑같은 맵 상태
      Physics.movePlayer(this.world, p, input, INPUT_DT, c);
      if (input.fire) this.tryAttack(p, c);
      if (input.super && p.alive) this.trySuper(p, c);
    }
  }

  // ───────────────────────── 배틀로얄 ─────────────────────────

  /**
   * 독가스 안전 구역: 맵 전체 사각형 → gasCenter 쪽으로 선형으로 좁아짐
   * active=false이면 아직 독가스가 시작 전 (startsIn ms 후 시작)
   */
  gasState() {
    const w = this.world;
    const map = MAPS[this.mapId];
    const elapsed = this.now - this.matchStartAt;
    const t = Physics.clamp((elapsed - BR.gasStartMs) / BR.gasShrinkMs, 0, 1);
    const cx = map.gasCenter ? map.gasCenter.x : w.width / 2;
    const cy = map.gasCenter ? map.gasCenter.y : w.height / 2;
    const fw = w.width * BR.gasCloseRatio;
    const fh = w.height * BR.gasCloseRatio;
    return {
      active: elapsed >= BR.gasStartMs,
      closed: t >= 1,
      startsIn: Math.max(0, BR.gasStartMs - elapsed),
      x: lerp(0, cx - fw / 2, t),
      y: lerp(0, cy - fh / 2, t),
      w: lerp(w.width, fw, t),
      h: lerp(w.height, fh, t),
    };
  }

  // 1초마다 안전 구역 밖에 있는 플레이어에게 피해 (계속 깜빡이지 않게 펄스로)
  updateGas() {
    this.gas = this.gasState();
    if (!this.gas.active || this.now < this.nextGasPulseAt) return;
    this.nextGasPulseAt += 1000;
    const g = this.gas;
    const dmg = g.closed ? BR.gasDpsAfterClose : BR.gasDps;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const inside = p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h;
      if (!inside) this.applyDamage(p, null, dmg, 0, { reveal: false });
    }
  }

  pickupCubes() {
    if (!this.cubes.length) return;
    this.cubes = this.cubes.filter((cube) => {
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - cube.x, p.y - cube.y) > this.stats(p).radius + BR.cubePickupRange) continue;
        const before = this.maxHp(p);
        p.cubes++;
        p.hp += this.maxHp(p) - before; // 늘어난 최대 체력만큼 회복
        this.fx.push({ type: 'cubePickup', x: round2(cube.x), y: round2(cube.y), r: 20, owner: p.id });
        return false;
      }
      return true;
    });
  }

  dropCube(x, y) {
    // 벽 안에 떨어지지 않도록 살짝 보정
    const pos = { x: Physics.clamp(x, 10, this.world.width - 10), y: Physics.clamp(y, 10, this.world.height - 10) };
    if (Physics.circleHitsAnyWall(this.world, pos.x, pos.y, 10)) return;
    this.cubes.push({ id: this.nextCubeId++, x: pos.x, y: pos.y });
  }

  // 생존자가 1명 이하가 되면 종료 (혼자 시작한 테스트 경기는 0명일 때)
  checkBattleRoyaleEnd() {
    const alive = [...this.players.values()].filter((p) => p.participant && p.alive);
    const needed = this.startedWith >= 2 ? 1 : 0;
    if (alive.length > needed) return false;
    this.endMatch();
    return true;
  }

  // ───────────────────────── 일반 공격 ─────────────────────────

  tryAttack(p, c) {
    const a = c.attack;
    if (p.ammo < 1 || this.now - p.lastFireAt < a.fireCooldownMs) return;
    p.ammo -= 1;
    p.lastFireAt = this.now;
    p.revealedUntil = this.now + CONFIG.bush.revealAfterAttackMs; // 수풀 속에서 쏘면 들킴

    switch (a.type) {
      case 'spread': {
        // 부채꼴: pellets개를 spreadDeg 각도 안에 고르게 배치
        const n = Math.max(1, a.pellets);
        for (let i = 0; i < n; i++) {
          const offset = n === 1 ? 0 : (i / (n - 1) - 0.5) * a.spreadDeg * DEG;
          this.spawnBullet(p, c, p.aim + offset, { ...a, charge: a.superChargePerHit });
        }
        break;
      }
      case 'bullet':
        this.spawnBullet(p, c, p.aim, { ...a, charge: a.superChargePerHit });
        break;
      case 'lob': {
        const t = this.lobTarget(p, a.maxRange);
        this.spawnBomb(p, t.x, t.y, { ...a, charge: a.superChargePerHit });
        break;
      }
    }
  }

  // ───────────────────────── 필살기 ─────────────────────────

  trySuper(p, c) {
    if (p.superCharge < 1) return;
    p.superCharge = 0;
    p.revealedUntil = this.now + CONFIG.bush.revealAfterAttackMs;
    const s = c.super;

    switch (s.type) {
      case 'shockwave': {
        // 내 주변 원 안의 적에게 피해 + 바깥 방향으로 넉백. 부서지는 벽도 부숨
        const dmg = s.damage * this.damageMul(p);
        this.fx.push({ type: 'shockwave', x: round2(p.x), y: round2(p.y), r: s.radius, color: p.color, owner: p.id });
        this.damageWallsInCircle(p.x, p.y, s.radius, dmg, p.team);
        for (const o of this.players.values()) {
          if (o === p || !o.alive || this.isAlly(o.team, p.team)) continue; // 아군은 피해/넉백 없음
          const dx = o.x - p.x;
          const dy = o.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d > s.radius + this.stats(o).radius) continue;
          this.applyDamage(o, p.id, dmg, 0); // 필살기 피해로는 게이지가 차지 않음
          if (!o.alive) continue;
          const ang = d > 0 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
          o.knockX = Math.cos(ang) * s.knockbackSpeed;
          o.knockY = Math.sin(ang) * s.knockbackSpeed;
        }
        break;
      }
      case 'rail':
        // 벽과 플레이어를 관통하는 탄 (같은 적/벽은 한 번만 맞음, 부서지는 벽에는 피해)
        this.spawnBullet(p, c, p.aim, {
          damage: s.damage,
          range: s.range,
          bulletSpeed: s.bulletSpeed,
          bulletRadius: s.bulletRadius,
          charge: 0,
          pierceWalls: true,
          piercePlayers: true,
          isSuper: true,
        });
        break;
      case 'barrage': {
        // 목표 지점 중앙 1개 + 주변 원형으로 나머지
        const center = this.lobTarget(p, s.maxRange);
        const n = Math.max(1, s.bombs);
        for (let i = 0; i < n; i++) {
          let x = center.x;
          let y = center.y;
          if (i > 0) {
            const ang = ((i - 1) / (n - 1)) * Math.PI * 2;
            x += Math.cos(ang) * s.spreadRadius;
            y += Math.sin(ang) * s.spreadRadius;
          }
          this.spawnBomb(p, Physics.clamp(x, 0, this.world.width), Physics.clamp(y, 0, this.world.height), {
            ...s,
            flightMs: s.flightMs + i * 60, // 살짝 시차를 둬서 연쇄 폭발처럼
            charge: 0,
            isSuper: true,
          });
        }
        break;
      }
    }
  }

  // ───────────────────────── 투사체 ─────────────────────────

  // 마우스 지점(사거리로 제한)을 투척 목표로
  lobTarget(p, maxRange) {
    const d = Physics.clamp(p.aimDist, 0, maxRange);
    return {
      x: Physics.clamp(p.x + Math.cos(p.aim) * d, 0, this.world.width),
      y: Physics.clamp(p.y + Math.sin(p.aim) * d, 0, this.world.height),
    };
  }

  spawnBullet(p, c, angle, spec) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    this.bullets.push({
      id: this.nextProjectileId++,
      owner: p.id,
      team: p.team, // 아군 판정용 (쏜 사람이 나가도 유지)
      x: p.x + dirX * c.radius,
      y: p.y + dirY * c.radius,
      vx: dirX * spec.bulletSpeed,
      vy: dirY * spec.bulletSpeed,
      traveled: 0,
      range: spec.range,
      radius: spec.bulletRadius,
      damage: spec.damage * this.damageMul(p), // 파워 큐브 공격력 보너스
      charge: spec.charge || 0,
      pierceWalls: !!spec.pierceWalls,
      piercePlayers: !!spec.piercePlayers,
      isSuper: !!spec.isSuper,
      hitIds: new Set(), // 관통탄이 이미 맞힌 플레이어
      hitWalls: new Set(), // 관통탄이 이미 피해를 준 부서지는 벽
    });
  }

  spawnBomb(p, tx, ty, spec) {
    this.bombs.push({
      id: this.nextProjectileId++,
      owner: p.id,
      team: p.team,
      sx: p.x,
      sy: p.y,
      tx,
      ty,
      elapsed: 0,
      flightMs: spec.flightMs,
      blastRadius: spec.blastRadius,
      damage: spec.damage * this.damageMul(p), // 파워 큐브 공격력 보너스
      charge: spec.charge || 0,
      isSuper: !!spec.isSuper,
    });
  }

  updateBullets() {
    const world = this.world;
    this.bullets = this.bullets.filter((b) => {
      // 한 틱 이동량을 8px 이하로 잘게 나눠 검사 → 벽이나 플레이어를 뚫고 지나가지 않게
      const travel = Math.hypot(b.vx, b.vy) * TICK_DT;
      const steps = Math.max(1, Math.ceil(travel / 8));
      for (let s = 0; s < steps; s++) {
        b.x += (b.vx * TICK_DT) / steps;
        b.y += (b.vy * TICK_DT) / steps;
        b.traveled += travel / steps;

        if (b.traveled >= b.range) return false;
        if (Physics.isOutOfBounds(world, b.x, b.y)) return false;

        if (b.pierceWalls) {
          // 관통탄: 지나가는 부서지는 벽마다 한 번씩 피해
          for (const w of world.breakables) {
            if (w.hp > 0 && !b.hitWalls.has(w.id) && Physics.circleHitsRect(b.x, b.y, b.radius, w)) {
              b.hitWalls.add(w.id);
              this.damageWall(w, b.damage, b.team);
            }
          }
        } else {
          const hit = Physics.findSolidHit(world, b.x, b.y, b.radius);
          if (hit) {
            if (hit.maxHp !== undefined) this.damageWall(hit, b.damage, b.team); // 부서지는 벽/기지면 피해
            return false;
          }
        }

        for (const o of this.players.values()) {
          // 아군은 그냥 통과 (기지전)
          if (!o.alive || o.id === b.owner || b.hitIds.has(o.id) || this.isAlly(o.team, b.team)) continue;
          if (Math.hypot(o.x - b.x, o.y - b.y) < this.stats(o).radius + b.radius) {
            this.applyDamage(o, b.owner, b.damage, b.charge);
            if (!b.piercePlayers) return false;
            b.hitIds.add(o.id);
          }
        }
      }
      return true;
    });
  }

  // 폭탄은 벽을 무시하고 날아가서, 비행 시간이 끝나면 착지 지점에서 폭발
  updateBombs() {
    this.bombs = this.bombs.filter((b) => {
      b.elapsed += TICK_MS;
      if (b.elapsed < b.flightMs) return true;

      this.fx.push({ type: 'explosion', x: round2(b.tx), y: round2(b.ty), r: b.blastRadius, big: b.isSuper });
      this.damageWallsInCircle(b.tx, b.ty, b.blastRadius, b.damage, b.team);
      for (const o of this.players.values()) {
        if (!o.alive || o.id === b.owner || this.isAlly(o.team, b.team)) continue;
        if (Math.hypot(o.x - b.tx, o.y - b.ty) < b.blastRadius + this.stats(o).radius) {
          this.applyDamage(o, b.owner, b.damage, b.charge);
        }
      }
      return false;
    });
  }

  // ───────────────────────── 부서지는 벽 ─────────────────────────

  /**
   * @param attackerTeam 공격한 쪽 팀. 기지전에서 자기 팀 기지는 막히기만 하고 피해는 없음
   */
  damageWall(wall, amount, attackerTeam) {
    if (wall.hp <= 0) return;
    if (wall.kind === 'base' && this.isAlly(wall.team, attackerTeam)) return;
    wall.hp -= amount;
    if (wall.hp > 0) return;
    wall.hp = 0;
    World.refreshSolids(this.world); // 이제 이동/총알을 막지 않음
    this.fx.push({ type: 'wallBreak', x: wall.x, y: wall.y, w: wall.w, h: wall.h, kind: wall.kind });
    // 파워 큐브 상자는 부서지면 큐브를 떨어뜨림
    if (wall.kind === 'box') this.dropCube(wall.x + wall.w / 2, wall.y + wall.h / 2);
    // 기지가 부서지면 이번 틱 끝에 경기 종료
    if (wall.kind === 'base') this.destroyedBaseTeam = wall.team;
  }

  damageWallsInCircle(x, y, radius, amount, attackerTeam) {
    for (const w of this.world.breakables) {
      if (w.hp > 0 && Physics.circleHitsRect(x, y, radius, w)) this.damageWall(w, amount, attackerTeam);
    }
  }

  /**
   * 피해 처리
   * @param attackerId 공격한 플레이어 id (독가스는 null)
   * @param charge     맞힌 사람의 필살기 게이지 충전량 (필살기 피해는 0)
   * @param opts.reveal 수풀 속에서 맞으면 드러나게 할지 (독가스는 false)
   */
  applyDamage(victim, attackerId, amount, charge, opts = {}) {
    if (!victim.alive) return;
    victim.hp -= amount;
    victim.lastDamagedAt = this.now; // 회복 타이머 리셋
    if (opts.reveal !== false) victim.revealedUntil = this.now + CONFIG.bush.revealAfterHitMs;

    const info = this.attackerInfo(attackerId); // 플레이어 / 포탑 / 독가스
    const attacker = info.player;
    if (attacker && charge > 0) attacker.superCharge = Math.min(1, attacker.superCharge + charge);
    if (victim.hp > 0) return;

    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.knockX = victim.knockY = 0;
    // 킬 연출: 쓰러진 자리에서 파편이 터지는 이펙트 (클라이언트 보간 시각에 맞춰 재생됨)
    this.fx.push({ type: 'death', x: round2(victim.x), y: round2(victim.y), r: 40, color: victim.color, id: victim.id });
    if (attacker) attacker.kills++;

    if (this.isBR) {
      // 부활 없음: 탈락 기록, 먹었던 큐브는 주변에 떨어뜨림, 나를 죽인 사람을 관전
      this.eliminated.push(victim.id);
      for (let i = 0; i < victim.cubes; i++) {
        const ang = (i / victim.cubes) * Math.PI * 2;
        this.dropCube(victim.x + Math.cos(ang) * 30, victim.y + Math.sin(ang) * 30);
      }
      victim.killedBy = attacker && attacker.alive ? attacker.id : null;
      victim.spectating = victim.killedBy;
    } else {
      victim.respawnAt = this.now + (this.isTeams ? TEAMS.respawnDelayMs : CONFIG.player.respawnDelayMs);
    }

    this.broadcast('kill', {
      killerId: attackerId,
      killerName: info.name,
      killerColor: info.color,
      victimId: victim.id,
      victimName: victim.name,
      victimColor: victim.color,
    });
  }

  // ───────────────────────── 시야 (수풀) ─────────────────────────

  /**
   * eye(보는 사람)에게 target이 보이는지
   * - 수풀 밖이면 항상 보임
   * - 수풀 안이라도: 같은 팀(기지전) / 최근에 공격했거나 맞았으면 / 같은 수풀에 있으면 / 아주 가까우면 보임
   */
  canSee(eye, target) {
    if (eye === target || !target.alive) return true;
    if (target.bush < 0) return true;
    if (this.isAlly(eye.team, target.team)) return true;
    if (this.now < target.revealedUntil) return true;
    if (!eye.alive) return false;
    if (eye.bush === target.bush) return true;
    return Math.hypot(eye.x - target.x, eye.y - target.y) <= CONFIG.bush.revealDistance;
  }

  // 배틀로얄에서 죽은 사람이 관전할 대상 (없거나 죽었으면 다른 생존자로 자동 변경)
  spectateTarget(viewer) {
    if (!this.isBR || viewer.alive) return null;
    let target = viewer.spectating && this.players.get(viewer.spectating);
    if (!target || !target.alive) {
      target = [...this.players.values()].find((o) => o.alive) || null;
      viewer.spectating = target ? target.id : null;
    }
    return target;
  }

  /**
   * 스냅샷: 이 틱의 "정답" 상태 (받는 사람마다 players와 spec이 다름)
   *  t        : 서버 시각 (클라이언트 보간의 기준 시간축)
   *  players  : 이 사람(관전 중이면 관전 대상)에게 "보이는" 플레이어만. ack = 입력 처리 번호
   *  scores   : 모든 플레이어의 킬/데스/생존 여부 (위치 없음 → 순위표용)
   *  walls    : 부서지는 벽들의 남은 내구도 (world.breakables 순서)
   *  bombs.p  : 비행 진행도 0~1 (클라이언트가 포물선 높이를 그리는 데 씀)
   *  fx       : 이번 틱에 생긴 이펙트. 클라이언트는 보간 시각이 t에 도달할 때 재생
   *  배틀로얄 : aliveCount, gas(안전 구역), cubes(바닥의 파워 큐브), spec(내가 관전 중인 사람)
   *  기지전   : players.tm(팀), turrets(포탑 조준 방향). 기지 체력은 walls에 포함
   */
  sendSnapshots() {
    const players = [...this.players.values()];
    const serialized = new Map(
      players.map((p) => [
        p.id,
        {
          id: p.id,
          ch: p.character,
          tm: p.team,
          x: round2(p.x),
          y: round2(p.y),
          aim: round2(p.aim),
          hp: Math.round(p.hp),
          mhp: this.maxHp(p),
          alive: p.alive,
          ammo: round2(p.ammo),
          sup: round2(p.superCharge),
          cubes: p.cubes,
          ack: p.lastSeq,
          respawnIn: p.alive || this.isBR ? 0 : Math.max(0, p.respawnAt - this.now),
        },
      ])
    );

    const shared = {
      t: this.now,
      mode: this.mode,
      timeLeftMs: Math.max(0, this.matchEndsAt - this.now),
      scores: players.map((p) => ({ id: p.id, kills: p.kills, deaths: p.deaths, alive: p.alive })),
      walls: this.world.breakables.map((b) => Math.ceil(b.hp)),
      bullets: this.bullets.map((b) => ({
        id: b.id,
        owner: b.owner,
        x: round2(b.x),
        y: round2(b.y),
        r: b.radius,
        sup: b.isSuper,
      })),
      bombs: this.bombs.map((b) => {
        const k = Math.min(1, b.elapsed / b.flightMs);
        return {
          id: b.id,
          owner: b.owner,
          x: round2(b.sx + (b.tx - b.sx) * k),
          y: round2(b.sy + (b.ty - b.sy) * k),
          p: round2(k),
          tx: round2(b.tx),
          ty: round2(b.ty),
          r: b.blastRadius,
          sup: b.isSuper,
        };
      }),
      fx: this.fx,
    };
    if (this.isBR) {
      const g = this.gas || this.gasState();
      shared.aliveCount = players.filter((p) => p.participant && p.alive).length;
      shared.gas = { active: g.active, startsIn: g.startsIn, x: round2(g.x), y: round2(g.y), w: round2(g.w), h: round2(g.h) };
      shared.cubes = this.cubes.map((c) => ({ id: c.id, x: round2(c.x), y: round2(c.y) }));
    }
    if (this.isTeams) {
      shared.turrets = this.turrets.map((t) => ({ team: t.team, aim: round2(t.aim) }));
    }

    for (const viewer of players) {
      const spec = this.spectateTarget(viewer);
      const eye = spec || viewer; // 관전 중이면 관전 대상의 시야로 판정
      const visible = players.filter((t) => t === viewer || this.canSee(eye, t)).map((t) => serialized.get(t.id));
      viewer.send('snapshot', { ...shared, players: visible, spec: spec ? spec.id : null });
    }
  }
}

module.exports = Room;
