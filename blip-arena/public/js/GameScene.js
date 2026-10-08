/**
 * 메인 게임 씬
 *
 * ════════════════════════ 네트워크 동기화 설명 ════════════════════════
 *
 * 서버가 "정답"을 가지고 있고(서버 권위), 클라이언트는 입력만 보냅니다.
 * 그런데 서버 응답만 기다렸다가 움직이면 핑만큼 조작이 굼떠지므로, 아래 기법들을 씁니다.
 *
 * ① 내 캐릭터: 클라이언트 예측 (client-side prediction) + 서버 보정 (reconciliation)
 *    1. 초당 60번(고정 스텝) 키 입력을 읽어 {seq 번호, dx, dy, aim, aimDist, fire, super}로 만든다.
 *    2. 서버 응답을 기다리지 않고, 서버와 같은 함수(shared/physics.js)와 같은 캐릭터 수치로 내 위치를 바로 움직인다.
 *    3. 보낸 입력은 pending(확인 대기 목록)에 보관한다.
 *    4. 스냅샷이 오면 "서버는 입력 N번까지 처리했고 그 결과 위치는 (x, y)"를 알 수 있다.
 *       → pending에서 N번 이하는 버리고
 *       → 서버 위치에서 시작해 N번 이후 입력을 다시 적용 = 새 예측 위치
 *    5. 평소엔 서버도 같은 계산을 하므로 결과가 같아 보정이 사실상 0이다.
 *       다른 결과가 나오면(넉백을 맞음, 패킷 손실 등) 그 차이를 correction에 넣고
 *       몇 프레임에 걸쳐 0으로 줄여서 순간이동 대신 부드럽게 따라붙는다.
 *
 * ② 다른 플레이어/총알/폭탄: 보간 (interpolation)
 *    스냅샷은 초당 30번, 그것도 네트워크 상태에 따라 불규칙하게 온다.
 *    그래서 받은 스냅샷을 버퍼에 쌓아 두고 "지금보다 100ms 과거의 서버 시각"을 그린다.
 *    그 시각을 감싸는 두 스냅샷 사이를 선형 보간하면 항상 부드럽게 움직인다.
 *    (대가로 다른 플레이어는 100ms + 핑/2 만큼 과거 모습으로 보인다. 일반적인 방식이다.)
 *
 * ③ 이펙트(폭발, 충격파)도 스냅샷에 서버 시각과 함께 실려 오고,
 *    보간 시각이 그 시각에 도달할 때 재생한다 → 화면 속 폭탄이 땅에 닿는 순간 터진다.
 *
 * ④ 판정(체력, 탄약, 필살기 게이지, 킬, 사망, 부활)은 전부 서버 값을 그대로 표시만 한다.
 *
 * ⑤ 수풀 숨김: 서버가 "나에게 안 보이는 적"은 스냅샷에서 아예 빼고 보낸다.
 *    그래서 이 클라이언트는 숨은 적의 위치를 알 방법이 없다(치트 방지). 스냅샷에서 사라진 적은 화면에서 지운다.
 *    순위표는 위치 없는 scores 목록으로 따로 온다.
 *
 * ⑥ 부서지는 벽: 스냅샷의 walls(남은 내구도)로 world.solids를 갱신한다.
 *    예측 이동도 같은 world를 쓰므로, 벽이 부서지면 그 자리로 바로 걸어 들어갈 수 있다.
 *
 * ⑦ 배틀로얄: 독가스 구역(gas), 파워 큐브(cubes), 생존 인원은 스냅샷으로 받아 표시만 한다.
 *    탈락하면 서버가 관전 대상(spec)을 정해 주고, 그 사람의 시야 기준 스냅샷이 온다. 카메라는 그 사람을 따라간다.
 *
 * ⑧ 기지전: 기지는 world의 부서지는 벽(kind 'base')이라 체력이 walls로 온다. 포탑 조준 방향은 turrets로 온다.
 *    아군/적 구분(체력바 파랑/빨강)은 표시용일 뿐, 아군 오사 방지 같은 판정은 전부 서버가 한다.
 *
 * ⑨ 입력 계층: PC(키보드+마우스)와 모바일(TouchControls 가상 조이스틱)은 readMove/readAim과
 *    fireQueued/superQueued만 다르게 채우고, 그 뒤의 예측·전송 코드는 완전히 같다.
 *    서버는 어떤 기기에서 온 입력인지 모른다.
 * ═══════════════════════════════════════════════════════════════════════
 */

const GAME_INPUT_DT = 1 / BlipConfig.net.inputRate;

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  init(data) {
    this.myId = data.myId;
    this.matchId = data.matchId;
    this.hud = data.hud;
    this.lookup = data.lookup; // (id) → {name, color}

    this.mode = data.mode; // 'deathmatch' | 'battleroyale'
    this.isBR = data.mode === 'battleroyale';
    this.isTeams = data.mode === 'teams';
    this.myTeam = data.myTeam; // 기지전 내 팀 (0/1). 스냅샷의 tm으로도 갱신됨

    // --- 맵 상태 (서버와 같은 함수 + 같은 상자/기지 위치로 만듦 → 벽 순서가 서버와 일치) ---
    this.world = BlipWorld.buildWorld(data.map, { boxes: data.boxes, bases: data.bases });
    this.wallHpKey = '';
    if (data.walls) this.applyWallHp(data.walls); // 경기 중 참가: 이미 부서진 벽 반영

    // --- 예측/보정 상태 ---
    this.serverMe = null; // 서버가 알려준 내 최신 상태
    this.pred = null; // 예측한 내 위치 {x, y}
    this.pending = []; // 서버가 아직 처리 안 한 내 입력들
    this.seq = 0; // 입력 번호
    this.accumulator = 0; // 고정 스텝용 시간 누적
    this.correction = { x: 0, y: 0 }; // 화면에만 더해지는 보정 오차 (점점 0으로)
    this.fireQueued = false;
    this.superQueued = false;

    // --- 입력 장치: PC(키보드+마우스) 또는 모바일(TouchControls) ---
    this.touch = data.touch || null; // 터치 기기일 때만 TouchControls 인스턴스
    this.lastAim = { angle: -Math.PI / 2, dist: 0 }; // 마지막 조준 (모바일은 조준 안 할 때 이 방향을 봄)
    this.aimOverride = null; // 모바일에서 손을 뗀 순간의 조준 → 그 발사 입력에 사용

    // --- 연출 상태 ---
    this.streak = 0; // 죽지 않고 연속 처치한 수
    this.prevSup = 0; // 필살기 준비 효과음용
    this.lastShotSound = new Map(); // 플레이어별 마지막 발사음 시각 (산탄 5발이 5번 울리지 않게)

    // --- 보간 상태 ---
    this.snapshots = []; // 받은 스냅샷 버퍼 (시간순)
    this.fxQueue = []; // 아직 재생 안 한 이펙트 (서버 시각 순)
    this.clockOffset = null; // 서버 시각 - 내 시각 (추정값)

    this.views = new Map(); // playerId → PlayerView
    this.specId = null; // 배틀로얄 관전 대상 (서버가 정해 줌)
    this.followId = null; // 카메라가 따라가는 플레이어
    this.gasKey = '';
    this.unsubs = [];
    this.rtt = 0;
    this.debug = false;
  }

  // 내 캐릭터 수치 (characters.json)
  get myStats() {
    return this.serverMe ? BlipCharacters[this.serverMe.ch] : null;
  }

  preload() {
    PlayerView.preload(this); // 캐릭터 스프라이트 시트
  }

  create() {
    PlayerView.createAnims(this);
    this.drawMap();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.world.width, this.world.height);
    cam.setBackgroundColor('#11141c');

    // enableCapture=false: 채팅창에 W/A/S/D를 정상적으로 입력할 수 있게
    this.keys = this.input.keyboard.addKeys('W,A,S,D', false);
    this.input.mouse.disableContextMenu();
    this.input.on('pointerdown', (pointer) => {
      if (this.hud.chatting) return;
      if (this.isSpectating) {
        this.cycleSpectate(pointer.rightButtonDown() ? -1 : 1); // 관전 중: 클릭(터치)으로 대상 변경
        return;
      }
      if (this.touch) return; // 모바일 공격은 조이스틱으로만
      if (pointer.rightButtonDown()) this.queueSuper();
      else if (pointer.leftButtonDown()) this.fireQueued = true;
    });

    // 모바일: 공격/필살기 조이스틱에서 손을 떼면 발사
    if (this.touch) {
      this.touch.onRelease = (kind, r) => this.onTouchRelease(kind, r);
      this.touch.show(true);
    }
    // 화면이 작으면(휴대폰) 카메라를 살짝 축소해 주변이 보이게
    this.applyZoom();
    this.scale.on('resize', this.applyZoom, this);
    this.input.keyboard.on('keydown-E', () => {
      if (!this.hud.chatting) this.queueSuper();
    });
    this.input.keyboard.on('keydown-LEFT', () => this.cycleSpectate(-1));
    this.input.keyboard.on('keydown-RIGHT', () => this.cycleSpectate(1));
    this.input.keyboard.on('keydown-F2', () => {
      if (!this.hud.chatting) this.debug = !this.debug;
    });
    // 채팅을 열면 눌려 있던 키 상태를 초기화 (W를 누른 채 Enter → 계속 걷는 현상 방지)
    this.hud.onChatToggle = () => this.input.keyboard.resetKeys();

    this.projectiles = new ProjectileView(this);
    this.projectiles.onSpawn = (kind, data) => this.onProjectileSpawn(kind, data);
    this.debugGfx = this.add.graphics().setDepth(50);
    this.gasGfx = this.add.graphics().setDepth(9); // 독가스: 수풀 위, 플레이어 아래
    this.hud.setTeamMode(this.isTeams);

    this.unsubs.push(
      Net.on('snapshot', (snap) => this.onSnapshot(snap)),
      Net.on('pongCheck', (t) => (this.rtt = performance.now() - t)),
      Net.on('playerLeft', ({ id }) => this.removeView(id)),
      Net.on('kill', (k) => this.onKill(k))
    );

    // 1초마다 핑 측정
    this.time.addEvent({ delay: 1000, loop: true, callback: () => Net.emit('pingCheck', performance.now()) });
    Net.emit('pingCheck', performance.now());

    this.events.once('shutdown', this.cleanup, this);
    this.events.once('destroy', this.cleanup, this);
  }

  // 배틀로얄에서 탈락해 다른 사람을 보고 있는지
  get isSpectating() {
    return this.isBR && this.serverMe && !this.serverMe.alive;
  }

  cycleSpectate(dir) {
    if (this.isSpectating && !this.hud.chatting) Net.emit('spectate', { dir });
  }

  // 게이지가 찼을 때만 필살기 요청 (실제 사용 가능 여부는 서버가 다시 판정)
  queueSuper() {
    if (this.serverMe && this.serverMe.alive && this.serverMe.sup >= 1) this.superQueued = true;
  }

  cleanup() {
    this.unsubs.forEach((off) => off());
    this.unsubs = [];
    if (this.touch) {
      this.touch.onRelease = null;
      this.touch.show(false);
    }
  }

  // 화면 크기에 맞춰 카메라 확대율 조절 (휴대폰 가로 화면이면 약 0.6배)
  applyZoom() {
    const z = Phaser.Math.Clamp(Math.min(this.scale.width / 1000, this.scale.height / 650), 0.55, 1);
    this.baseZoom = z;
    this.cameras.main.setZoom(z);
  }

  // ───────────────────────── 입력 계층 (PC / 모바일 공통) ─────────────────────────
  // 예측·전송 코드는 아래 세 가지만 물어봄: 이동 벡터, 조준(각도·거리), 발사/필살기 요청

  // 이동 입력 (-1 ~ 1)
  readMove() {
    if (this.hud.chatting) return { dx: 0, dy: 0 };
    if (this.touch) return { dx: this.touch.move.x, dy: this.touch.move.y };
    const k = this.keys;
    return { dx: (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0), dy: (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0) };
  }

  // 지금 조준 (PC: 마우스 / 모바일: 조준 중인 조이스틱, 아니면 마지막 조준 방향)
  readAim() {
    if (!this.touch) return this.computeAim();
    const a = this.touch.aiming;
    if (a) {
      const stats = this.myStats;
      const range = stats ? (a.kind === 'super' ? this.superRange(stats) : this.attackRange(stats)) : 300;
      return { angle: Math.atan2(a.y, a.x), dist: a.mag * range };
    }
    // 조준 안 할 땐 움직이는 방향을 바라봄
    const m = this.touch.move;
    if (m.x || m.y) this.lastAim = { angle: Math.atan2(m.y, m.x), dist: this.lastAim.dist };
    return this.lastAim;
  }

  attackRange(stats) {
    return stats.attack.range ?? stats.attack.maxRange;
  }

  superRange(stats) {
    const s = stats.super;
    return s.range ?? s.maxRange ?? s.radius ?? 300;
  }

  /**
   * 모바일 조이스틱에서 손을 뗌 → 발사 요청
   * tap(톡)이면 가장 가까운 적을 자동 조준, 끌었으면 끈 방향 × 거리
   */
  onTouchRelease(kind, r) {
    const stats = this.myStats;
    if (!stats || !this.serverMe || !this.serverMe.alive || this.hud.chatting) return;
    const range = kind === 'super' ? this.superRange(stats) : this.attackRange(stats);
    const aim = r.tap ? this.autoAim(range) : { angle: r.angle, dist: r.mag * range };
    this.aimOverride = aim;
    this.lastAim = aim;
    if (kind === 'super') this.queueSuper();
    else this.fireQueued = true;
  }

  // 자동 조준: 사거리 안의 가장 가까운 적 (기지전은 적 기지도 대상). 없으면 바라보던 방향
  autoAim(range) {
    if (!this.pred) return this.lastAim;
    const me = { x: this.pred.x + this.correction.x, y: this.pred.y + this.correction.y };
    const targets = [];
    for (const [id, v] of this.views) {
      if (id === this.myId || !v.root.visible || v.relation === 'ally') continue;
      targets.push({ x: v.root.x, y: v.root.y });
    }
    for (const b of this.world.breakables) {
      if (b.kind === 'base' && b.hp > 0 && b.team !== this.myTeam) targets.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }
    let best = null;
    let bestD = range * 1.1;
    for (const t of targets) {
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return { angle: this.lastAim.angle, dist: range * 0.7 };
    return { angle: Math.atan2(best.y - me.y, best.x - me.x), dist: bestD };
  }

  // ───────────────────────── 효과음 / 연출 ─────────────────────────

  // 화면 중심에서 멀수록 작게 (약 900px 밖은 안 들림)
  playAt(name, x, y, volume = 1) {
    const cam = this.cameras.main;
    const d = Math.hypot(x - cam.midPoint.x, y - cam.midPoint.y);
    Sound.play(name, volume * Phaser.Math.Clamp(1 - d / 900, 0, 1));
  }

  shootSoundFor(attackType, isSuper) {
    if (isSuper) return 'shootRail';
    return { spread: 'shootSpread', bullet: 'shootBullet', lob: 'shootLob' }[attackType] || 'shootBullet';
  }

  // 다른 사람의 총알/폭탄이 처음 보일 때 발사음 (내 것은 누르는 순간 이미 재생함)
  onProjectileSpawn(kind, data) {
    if (data.owner === this.myId) return;
    // 다른 사람의 공격 모션 (내 것은 누르는 순간 이미 재생함)
    const ownerView = this.views.get(data.owner);
    if (ownerView) data.sup ? ownerView.playSuper() : ownerView.playAttack();
    const now = performance.now();
    if (now - (this.lastShotSound.get(data.owner) || 0) < 120) return; // 산탄 5발 → 1번
    this.lastShotSound.set(data.owner, now);
    let name;
    if (typeof data.owner === 'string' && data.owner.startsWith('base:')) name = 'turret';
    else if (kind === 'bomb') name = 'shootLob';
    else {
      const owner = this.snapshots.length && this.snapshots[this.snapshots.length - 1].players.find((p) => p.id === data.owner);
      name = this.shootSoundFor(owner ? BlipCharacters[owner.ch].attack.type : 'bullet', data.sup);
    }
    this.playAt(name, data.x, data.y, 0.8);
  }

  // 내가 맞음: 맞은 양에 비례해 화면 흔들림 + 붉은 번쩍임 + 진동(모바일)
  onMeDamaged(amount, maxHp) {
    const ratio = Phaser.Math.Clamp(amount / maxHp, 0.05, 1);
    this.cameras.main.shake(140 + ratio * 200, 0.004 + ratio * 0.02);
    this.hud.hurtFlash(ratio * 2);
    Sound.play('hurt', 0.9);
    if (navigator.vibrate) navigator.vibrate(Math.round(20 + ratio * 80));
  }

  // 킬 이벤트: 내가 처치 → "처치!" 배너 + 연속 처치 + 카메라 줌 펀치 / 내가 당함 → 배너
  onKill(k) {
    if (k.killerId === this.myId && k.victimId !== this.myId) {
      this.streak++;
      const main = this.streak >= 2 ? `${this.streak}연속 처치!` : '처치!';
      this.hud.showKillBanner(main, k.victimName, 'kill');
      Sound.play('kill', 1);
      const cam = this.cameras.main;
      this.tweens.add({ targets: cam, zoom: this.baseZoom * 1.08, duration: 90, yoyo: true, ease: 'Quad.easeOut', onComplete: () => cam.setZoom(this.baseZoom) });
    } else if (k.victimId === this.myId) {
      this.streak = 0;
      this.hud.showKillBanner('쓰러졌습니다', `${k.killerName}에게 처치당함`, 'death');
      Sound.play('death', 1);
      if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
    } else {
      Sound.play('otherKill', 0.6);
    }
  }

  // 이펙트(서버 시각에 맞춰 재생)마다 효과음
  playFxSound(fx) {
    const names = { explosion: 'explosion', shockwave: 'shockwave', wallBreak: 'wallBreak', death: null };
    if (fx.type === 'cubePickup') {
      if (fx.owner === this.myId) Sound.play('cube', 1);
      else this.playAt('cube', fx.x, fx.y, 0.4);
    } else if (names[fx.type]) {
      this.playAt(names[fx.type], fx.x ?? 0, fx.y ?? 0, fx.big ? 1 : 0.8);
    }
  }

  // ===== 맵 그리기: 타일/스프라이트로 바꿀 곳 =====
  drawMap() {
    const world = this.world;
    const W = world.width;
    const H = world.height;
    const floor = this.add.graphics().setDepth(0);
    floor.fillStyle(0x222838, 1);
    floor.fillRect(0, 0, W, H);
    floor.lineStyle(1, 0x2b3346, 1);
    for (let x = 0; x <= W; x += 80) floor.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += 80) floor.lineBetween(0, y, W, y);
    floor.lineStyle(6, 0x5b6684, 1);
    floor.strokeRect(0, 0, W, H);

    // 부서지지 않는 벽
    const walls = this.add.graphics().setDepth(5);
    for (const w of world.walls) {
      walls.fillStyle(0x434c69, 1);
      walls.fillRect(w.x, w.y, w.w, w.h);
      walls.fillStyle(0x5f6b91, 1); // 윗면 하이라이트
      walls.fillRect(w.x, w.y, w.w, 6);
      walls.lineStyle(2, 0x171b27, 1);
      walls.strokeRect(w.x, w.y, w.w, w.h);
    }

    // 부서지는 벽 (나무 상자): 내구도에 따라 금이 가므로 각각 따로 그림
    // 기지전 기지: 포탑 사거리 원 + 회전하는 포탑 머리 + "우리 기지/적 기지" 이름표
    this.turretHeads = new Map(); // team → 포탑 머리 그래픽
    for (const b of world.breakables.filter((x) => x.kind === 'base')) {
      const ally = b.team === this.myTeam;
      const color = ally ? 0x4dabf7 : 0xff5c5c;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      this.add.circle(cx, cy, BlipConfig.teams.turretRange, color, 0.05).setStrokeStyle(2, color, 0.35).setDepth(1);
      const head = this.add.graphics().setDepth(7).setPosition(cx, cy);
      head.fillStyle(0x262a36, 1);
      head.fillRect(10, -7, 36, 14); // 포신 (오른쪽이 정면)
      head.fillStyle(color, 1);
      head.fillCircle(0, 0, 22);
      head.lineStyle(4, 0x171b27, 1);
      head.strokeCircle(0, 0, 22);
      head.rotation = b.team === 0 ? Math.PI / 2 : -Math.PI / 2;
      this.turretHeads.set(b.team, head);
      this.add
        .text(cx, b.y - 26, ally ? '우리 기지' : '적 기지', {
          fontFamily: 'sans-serif',
          fontSize: '14px',
          fontStyle: 'bold',
          color: ally ? '#a5d8ff' : '#ffc9c9',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(13); // 수풀(8)과 플레이어(10~11)보다 위
    }

    this.breakableGfx = world.breakables.map((b) => {
      const g = this.add.graphics().setDepth(5);
      this.drawBreakable(g, b);
      return g;
    });

    // 수풀: 플레이어(depth 10)보다 아래. 수풀 속 플레이어는 반투명으로 표시됨
    const bushes = this.add.graphics().setDepth(8);
    for (const b of world.bushes) {
      bushes.fillStyle(0x2f7d46, 0.92);
      bushes.fillRoundedRect(b.x, b.y, b.w, b.h, 14);
      // 잎사귀 무늬 (좌표로 정해지는 의사 난수 → 매번 같은 모양)
      let seed = (b.x * 73856093) ^ (b.y * 19349663);
      const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const count = Math.floor((b.w * b.h) / 900);
      for (let i = 0; i < count; i++) {
        bushes.fillStyle(rand() < 0.5 ? 0x3f9a58 : 0x256b3a, 0.9);
        bushes.fillCircle(b.x + 8 + rand() * (b.w - 16), b.y + 8 + rand() * (b.h - 16), 6 + rand() * 7);
      }
    }
  }

  drawBreakable(g, b) {
    g.clear();
    if (b.kind === 'base' && b.hp <= 0) {
      // 부서진 기지: 잔해
      const head = this.turretHeads && this.turretHeads.get(b.team);
      if (head) head.setVisible(false);
      g.fillStyle(0x2a2f3d, 1);
      g.fillRect(b.x + 10, b.y + 10, b.w - 20, b.h - 20);
      return;
    }
    if (b.hp <= 0) return;
    if (b.kind === 'base') {
      // 기지 몸체 (아군 파랑 / 적 빨강) + 위쪽 체력바
      const ally = b.team === this.myTeam;
      const color = ally ? 0x4dabf7 : 0xff5c5c;
      g.fillStyle(ally ? 0x1f3b5c : 0x5c1f24, 1);
      g.fillRoundedRect(b.x, b.y, b.w, b.h, 10);
      g.lineStyle(5, color, 1);
      g.strokeRoundedRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 10);
      const barW = b.w + 30;
      const bx = b.x - 15;
      const by = b.y - 20;
      g.fillStyle(0x000000, 0.7);
      g.fillRect(bx - 2, by - 2, barW + 4, 12);
      g.fillStyle(color, 1);
      g.fillRect(bx, by, barW * (b.hp / b.maxHp), 8);
      return;
    }
    if (b.kind === 'box') {
      // 배틀로얄 파워 큐브 상자: 보라색 금속 상자 + 가운데 큐브 문양
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      g.fillStyle(0x4b2f73, 1);
      g.fillRoundedRect(b.x, b.y, b.w, b.h, 6);
      g.lineStyle(3, 0xc77dff, 1);
      g.strokeRoundedRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, 6);
      g.fillStyle(0xe0b3ff, 1);
      g.fillPoints([{ x: cx, y: cy - 10 }, { x: cx + 10, y: cy }, { x: cx, y: cy + 10 }, { x: cx - 10, y: cy }], true);
      // 남은 내구도 막대
      g.fillStyle(0x000000, 0.6);
      g.fillRect(b.x + 4, b.y + b.h - 9, b.w - 8, 5);
      g.fillStyle(0xc77dff, 1);
      g.fillRect(b.x + 4, b.y + b.h - 9, (b.w - 8) * (b.hp / b.maxHp), 5);
      return;
    }
    g.fillStyle(0x9a6b3f, 1);
    g.fillRect(b.x, b.y, b.w, b.h);
    g.lineStyle(3, 0x6b4526, 1);
    g.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
    g.lineBetween(b.x + 4, b.y + 4, b.x + b.w - 4, b.y + b.h - 4); // 상자 대각선 판자
    // 내구도가 줄수록 금이 감
    const ratio = b.hp / b.maxHp;
    g.lineStyle(2, 0x2a1a0d, 0.9);
    if (ratio < 0.67) g.lineBetween(b.x + b.w * 0.2, b.y, b.x + b.w * 0.45, b.y + b.h * 0.6);
    if (ratio < 0.34) {
      g.lineBetween(b.x + b.w, b.y + b.h * 0.3, b.x + b.w * 0.6, b.y + b.h * 0.7);
      g.lineBetween(b.x + b.w * 0.45, b.y + b.h * 0.6, b.x + b.w * 0.3, b.y + b.h);
    }
  }

  // 서버가 보낸 부서지는 벽 내구도 반영 → 이동 판정(world.solids)과 그림 갱신
  applyWallHp(walls) {
    const key = walls.join(',');
    if (key === this.wallHpKey) return; // 변화 없음
    this.wallHpKey = key;
    let solidsChanged = false;
    this.world.breakables.forEach((b, i) => {
      const hp = walls[i] ?? b.hp;
      if (hp === b.hp) return;
      if ((hp > 0) !== (b.hp > 0)) solidsChanged = true;
      b.hp = hp;
      if (this.breakableGfx) this.drawBreakable(this.breakableGfx[i], b);
    });
    if (solidsChanged) BlipWorld.refreshSolids(this.world);
  }

  // ───────────────────────── 스냅샷 수신 ─────────────────────────

  onSnapshot(snap) {
    // 서버 시계 추정: (서버 시각 - 받은 시각)을 지수 평균. 지터가 있어도 천천히 안정됨.
    const sample = snap.t - Date.now();
    this.clockOffset = this.clockOffset === null ? sample : this.clockOffset + (sample - this.clockOffset) * 0.05;

    this.snapshots.push(snap);
    // 보간에 쓸 일 없는 오래된 스냅샷 정리 (약 1초 분량만 유지)
    while (this.snapshots.length > 2 && this.snapshots[0].t < snap.t - 1000) this.snapshots.shift();

    for (const fx of snap.fx) this.fxQueue.push({ ...fx, t: snap.t });

    // 벽 상태는 보간하지 않고 최신 값을 바로 씀 (예측 이동이 서버와 같은 벽 상태를 쓰도록)
    this.applyWallHp(snap.walls);

    const me = snap.players.find((p) => p.id === this.myId);
    if (me) this.reconcile(me);
    this.specId = snap.spec || null;

    if (me && me.tm !== undefined) this.myTeam = me.tm;
    if (this.isTeams) {
      const bases = this.world.breakables.filter((b) => b.kind === 'base');
      const ally = bases.find((b) => b.team === this.myTeam);
      const enemy = bases.find((b) => b.team !== this.myTeam);
      if (ally && enemy) this.hud.setTeamInfo(snap.timeLeftMs, ally.hp, ally.maxHp, enemy.hp, enemy.maxHp);
    } else if (this.isBR) this.hud.setBattleRoyaleInfo(snap.aliveCount, snap.gas);
    else this.hud.setTimer(snap.timeLeftMs);

    // 순위표는 숨은 플레이어도 포함된 scores로 (위치 정보 없음). 배틀로얄은 생존자 우선
    const rows = snap.scores
      .map((p) => {
        const info = this.lookup(p.id);
        const relation = this.isTeams ? (info.team === this.myTeam ? 'ally' : 'enemy') : null;
        return { id: p.id, ...info, kills: p.kills, deaths: p.deaths, out: this.isBR && !p.alive, relation };
      })
      // 기지전: 우리 팀 먼저 / 배틀로얄: 생존자 먼저 / 그 다음 킬 순
      .sort((a, b) => (a.relation === 'enemy') - (b.relation === 'enemy') || a.out - b.out || b.kills - a.kills || a.deaths - b.deaths);
    this.hud.setScoreboard(rows, this.myId);
  }

  // 독가스 그리기: 안전 구역 바깥 4면을 초록 안개로 덮음 (두 스냅샷 사이를 보간해 부드럽게 좁혀짐)
  drawGas(ga, gb, alpha) {
    const g = this.gasGfx;
    if (!gb || !gb.active) {
      if (this.gasKey) g.clear();
      this.gasKey = '';
      return;
    }
    const ref = ga && ga.active ? ga : gb;
    const x = ref.x + (gb.x - ref.x) * alpha;
    const y = ref.y + (gb.y - ref.y) * alpha;
    const w = ref.w + (gb.w - ref.w) * alpha;
    const h = ref.h + (gb.h - ref.h) * alpha;
    const key = `${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(1)},${h.toFixed(1)}`;
    if (key === this.gasKey) return;
    this.gasKey = key;

    const W = this.world.width;
    const H = this.world.height;
    g.clear();
    g.fillStyle(0x5fd35f, 0.32);
    g.fillRect(0, 0, W, y); // 위
    g.fillRect(0, y + h, W, H - y - h); // 아래
    g.fillRect(0, y, x, h); // 왼쪽
    g.fillRect(x + w, y, W - x - w, h); // 오른쪽
    if (w > 0 && h > 0) {
      g.lineStyle(4, 0xa9ff8a, 0.9);
      g.strokeRect(x, y, w, h);
    }
  }

  // 내 위치가 독가스 안인지 (경고 표시용, 판정은 서버가 함)
  isInGas(x, y) {
    const gas = this.snapshots.length && this.snapshots[this.snapshots.length - 1].gas;
    if (!gas || !gas.active) return false;
    return x < gas.x || x > gas.x + gas.w || y < gas.y || y > gas.y + gas.h;
  }

  /**
   * 서버 보정 (reconciliation)
   * 서버가 확정한 위치에서, 서버가 아직 처리하지 않은 내 입력들을 다시 적용해 예측 위치를 새로 구함.
   */
  reconcile(me) {
    this.serverMe = me;

    if (!me.alive) {
      // 죽어 있는 동안은 예측하지 않음
      this.pending = [];
      this.pred = { x: me.x, y: me.y };
      this.correction = { x: 0, y: 0 };
      return;
    }

    // 지금 화면에 보이는 위치 (보정 전후로 화면 위치가 튀지 않게 하기 위해 기억)
    const shownBefore = this.pred
      ? { x: this.pred.x + this.correction.x, y: this.pred.y + this.correction.y }
      : null;

    // 1) 서버가 처리한 입력은 대기 목록에서 제거
    this.pending = this.pending.filter((input) => input.seq > me.ack);

    // 2) 서버 위치에서 시작해 남은 입력을 다시 적용
    const stats = this.myStats;
    const p = { x: me.x, y: me.y };
    for (const input of this.pending) BlipPhysics.movePlayer(this.world, p, input, GAME_INPUT_DT, stats);
    this.pred = p;

    // 3) 화면 위치는 그대로 두고, 차이만큼을 correction으로 옮겨 서서히 줄임
    if (shownBefore) {
      this.correction.x = shownBefore.x - p.x;
      this.correction.y = shownBefore.y - p.y;
      // 부활 같은 큰 이동은 부드럽게 하지 않고 즉시 이동
      if (Math.hypot(this.correction.x, this.correction.y) > BlipConfig.net.snapDistance) {
        this.correction = { x: 0, y: 0 };
      }
    }
  }

  // ───────────────────────── 매 프레임 ─────────────────────────

  update() {
    // 실제 경과 시간으로 계산 (Phaser가 넘겨주는 delta는 프레임이 느리면 16.7ms 근처로 잘려서,
    // 그걸 쓰면 저사양 PC에서 입력이 덜 만들어져 캐릭터가 느리게 움직임)
    const now = performance.now();
    const dt = Math.min(now - (this.lastFrameAt ?? now), 250) / 1000; // 탭이 멈췄다 돌아와도 폭주하지 않게
    this.lastFrameAt = now;
    this.updateLocalPlayer(dt);
    this.renderRemote();
    this.updateHud();
  }

  // 마우스 위치 → 조준 각도와 거리 (화면에 보이는 내 위치 기준)
  computeAim() {
    if (!this.pred) return { angle: 0, dist: 0 };
    const pointer = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const dx = world.x - (this.pred.x + this.correction.x);
    const dy = world.y - (this.pred.y + this.correction.y);
    return { angle: Math.atan2(dy, dx), dist: Math.hypot(dx, dy) };
  }

  /**
   * 클라이언트 예측
   * 고정 스텝(1/60초)마다 입력 하나를 만들어 → 즉시 내 위치에 적용 → pending에 저장 → 서버로 전송
   */
  updateLocalPlayer(dt) {
    const stats = this.myStats;
    const canAct = this.serverMe && this.serverMe.alive && this.pred;
    const aim = this.readAim(); // PC: 마우스 / 모바일: 조이스틱
    const batch = [];

    this.accumulator += dt;
    while (this.accumulator >= GAME_INPUT_DT) {
      this.accumulator -= GAME_INPUT_DT;
      if (!canAct) continue;

      const chatting = this.hud.chatting; // 채팅 중엔 이동/공격 멈춤
      const move = this.readMove();
      const fire = this.fireQueued && !chatting;
      const sup = this.superQueued && !chatting;
      // 모바일은 손을 뗀 순간의 조준으로 쏨
      const shotAim = (fire || sup) && this.aimOverride ? this.aimOverride : aim;
      const input = {
        m: this.matchId,
        seq: ++this.seq,
        dx: move.dx,
        dy: move.dy,
        aim: shotAim.angle,
        aimDist: Math.round(shotAim.dist),
        fire,
        super: sup,
      };
      this.fireQueued = false;
      this.superQueued = false;
      if (fire || sup) this.aimOverride = null;

      // 내 발사음은 서버 응답을 기다리지 않고 바로 (탄약이 있을 때만)
      // 공격/필살기 모션도 바로 재생
      const myView = this.views.get(this.myId);
      if (fire && this.serverMe.ammo >= 1) {
        Sound.play(this.shootSoundFor(stats.attack.type, false), 0.9);
        if (myView) myView.playAttack();
      }
      if (sup) {
        Sound.play('superUse', 1);
        if (myView) myView.playSuper();
      }

      BlipPhysics.movePlayer(this.world, this.pred, input, GAME_INPUT_DT, stats); // 예측: 바로 움직임
      this.pending.push(input);
      batch.push(input);
    }
    if (!canAct) this.fireQueued = this.superQueued = false;
    if (this.pending.length > 600) this.pending.splice(0, this.pending.length - 600); // 서버 무응답 대비
    // 한 프레임에 만든 입력들을 묶어서 한 번에 전송
    if (batch.length) Net.emit('input', batch);

    // 보정 오차를 지수적으로 0에 가깝게
    const decay = Math.exp(-BlipConfig.net.correctionSmoothing * dt);
    this.correction.x *= decay;
    this.correction.y *= decay;

    if (!this.serverMe) return;
    const me = this.serverMe;
    const view = this.getView(this.myId, me.ch);
    const shownX = this.pred.x + this.correction.x;
    const shownY = this.pred.y + this.correction.y;
    this.meInBush = me.alive && BlipWorld.bushAt(this.world, shownX, shownY) >= 0;
    view.setVisible(me.alive);
    view.setConcealed(this.meInBush); // 수풀 속이면 반투명 (적에게는 아예 안 보임)
    view.setPosition(shownX, shownY);
    view.setAim(aim.angle, aim.dist); // 내 조준은 서버를 기다리지 않고 바로 따라감
    view.setGuideVisible(!this.touch || !!this.touch.aiming); // 모바일은 조준하는 동안만 가이드
    view.setHp(me.hp, me.mhp);
    view.setAmmo(me.ammo);
    view.setSuper(me.sup);
    view.setCubes(me.cubes);

    // 필살기 게이지가 막 찼을 때 알림음
    if (me.sup >= 1 && this.prevSup < 1 && me.alive) Sound.play('superReady', 0.8);
    this.prevSup = me.sup;
    if (this.touch) {
      this.touch.setSuperReady(me.alive && me.sup >= 1);
      this.touch.show(me.alive || !this.isBR); // 배틀로얄 관전 중엔 조이스틱 숨김 (터치로 관전 대상 변경)
    }
  }

  /**
   * 보간: 다른 플레이어, 투사체를 interpDelayMs 과거 시점으로 그림
   */
  renderRemote() {
    const snaps = this.snapshots;
    if (!snaps.length || this.clockOffset === null) return;

    const renderTime = Date.now() + this.clockOffset - BlipConfig.net.interpDelayMs;
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    let a = last;
    let b = last;
    if (renderTime <= first.t) {
      a = b = first;
    } else if (renderTime < last.t) {
      for (let i = 1; i < snaps.length; i++) {
        if (snaps[i].t >= renderTime) {
          a = snaps[i - 1];
          b = snaps[i];
          break;
        }
      }
    } // renderTime이 최신 스냅샷보다 늦으면(버퍼 부족) 최신 상태에 멈춰 있음
    const alpha = b.t === a.t ? 1 : Phaser.Math.Clamp((renderTime - a.t) / (b.t - a.t), 0, 1);

    const prevById = new Map(a.players.map((p) => [p.id, p]));
    const seen = new Set([this.myId]);

    for (const pb of b.players) {
      if (pb.id === this.myId) continue; // 나는 예측으로 그림
      seen.add(pb.id);
      const pa = prevById.get(pb.id);
      let x = pb.x;
      let y = pb.y;
      let aim = pb.aim;
      // 둘 다 살아 있고 순간이동(부활)이 아닐 때만 보간
      if (pa && pa.alive && pb.alive && Math.hypot(pb.x - pa.x, pb.y - pa.y) < 200) {
        x = pa.x + (pb.x - pa.x) * alpha;
        y = pa.y + (pb.y - pa.y) * alpha;
        aim = lerpAngle(pa.aim, pb.aim, alpha);
      }
      const view = this.getView(pb.id, pb.ch);
      view.setName(this.lookup(pb.id).name);
      view.setPosition(x, y);
      view.setAim(aim);
      view.setHp(pb.hp, pb.mhp);
      view.setSuper(pb.sup);
      view.setCubes(pb.cubes);
      view.setRelation(this.isTeams && pb.tm === this.myTeam ? 'ally' : 'enemy');
      view.setVisible(pb.alive);
      // 수풀 속인데 보이는 경우(같은 수풀 / 가까움 / 방금 공격함) → 반투명으로 표시
      view.setConcealed(BlipWorld.bushAt(this.world, x, y) >= 0);
    }

    // 스냅샷에 없는 플레이어 정리 (방을 나갔거나, 수풀에 숨어 서버가 안 보내 준 경우)
    for (const id of this.views.keys()) {
      if (!seen.has(id)) this.removeView(id);
    }

    this.projectiles.render(a, b, alpha, (ownerId) => this.ownerColor(ownerId));
    if (this.isTeams && b.turrets) {
      // 포탑 머리를 서버가 알려준 조준 방향으로 회전 (두 스냅샷 사이 보간)
      for (const tb of b.turrets) {
        const head = this.turretHeads.get(tb.team);
        const ta = (a.turrets || []).find((x) => x.team === tb.team);
        if (head) head.rotation = ta ? lerpAngle(ta.aim, tb.aim, alpha) : tb.aim;
      }
    }
    if (this.isBR) {
      this.projectiles.renderCubes(b.cubes || []);
      this.drawGas(a.gas, b.gas, alpha);
    }
    this.updateCameraTarget();

    // 보간 시각에 도달한 이펙트 재생
    while (this.fxQueue.length && this.fxQueue[0].t <= renderTime) {
      const fx = this.fxQueue.shift();
      this.projectiles.playFx(fx);
      this.playFxSound(fx);
      // 다른 사람의 충격파 필살기(고르보) → 그 사람의 필살기 모션
      if (fx.type === 'shockwave' && fx.owner !== this.myId && this.views.has(fx.owner)) this.views.get(fx.owner).playSuper();
      this.shakeIfNear(fx);
    }

    this.drawDebug(last);
  }

  // 총알 색: 플레이어 색. 포탑('base:팀') 총알은 아군 파랑 / 적 빨강
  ownerColor(ownerId) {
    if (typeof ownerId === 'string' && ownerId.startsWith('base:')) {
      return Number(ownerId.slice(5)) === this.myTeam ? 0x4dabf7 : 0xff5c5c;
    }
    return this.lookup(ownerId).color;
  }

  // 카메라 대상: 살아 있으면 나, 배틀로얄에서 탈락했으면 관전 대상
  updateCameraTarget() {
    const targetId = this.isSpectating && this.specId ? this.specId : this.myId;
    const view = this.views.get(targetId);
    if (!view) return;
    if (this.followId === targetId && this.followRoot === view.root) return;
    this.followId = targetId;
    this.followRoot = view.root; // 뷰가 다시 만들어지면(수풀 등) 다시 따라가도록 기억
    this.cameras.main.startFollow(view.root, false, 0.2, 0.2);
  }

  // 화면 중심 근처에서 터지면 화면 흔들림
  shakeIfNear(fx) {
    if (fx.type !== 'explosion' && fx.type !== 'shockwave') return;
    const cam = this.cameras.main;
    const d = Math.hypot(fx.x - cam.midPoint.x, fx.y - cam.midPoint.y);
    if (d < fx.r + 150) cam.shake(fx.type === 'shockwave' ? 180 : 120, 0.006);
  }

  // F2 디버그: 빨간 원 = 서버가 확정한 내 위치, 노란 원 = 다른 플레이어의 최신(보간 전) 서버 위치
  drawDebug(latest) {
    const g = this.debugGfx;
    g.clear();
    if (!this.debug) return;
    if (this.serverMe && this.serverMe.alive) {
      g.lineStyle(2, 0xff3b3b, 1);
      g.strokeCircle(this.serverMe.x, this.serverMe.y, this.myStats.radius);
    }
    g.lineStyle(2, 0xffe066, 0.8);
    for (const p of latest.players) {
      if (p.id !== this.myId && p.alive) g.strokeCircle(p.x, p.y, BlipCharacters[p.ch].radius);
    }
  }

  updateHud() {
    const me = this.serverMe;
    // 데스매치: 부활 카운트다운 / 배틀로얄: 관전 안내
    this.hud.setRespawn(me && !me.alive && !this.isBR ? me.respawnIn : null);
    const spec = this.isSpectating ? (this.specId ? this.lookup(this.specId).name : '') : null;
    this.hud.setSpectate(spec);
    if (me) this.hud.setMyStatus(me.ch, me.hp, me.sup, this.meInBush, me.mhp, me.cubes);
    this.hud.setGasWarning(!!(me && me.alive && this.pred && this.isInGas(this.pred.x, this.pred.y)));

    let text = `핑 ${Math.round(this.rtt)}ms`;
    if (Net.lag || Net.jitter) text += `  (인위적 지연 ${Net.lag}+${Net.jitter}ms)`;
    if (this.debug) {
      const err = Math.hypot(this.correction.x, this.correction.y);
      text += `\n[디버그] 확인 대기 입력 ${this.pending.length}개 · 보정 오차 ${err.toFixed(1)}px`;
      text += `\n빨강: 서버 확정 내 위치 · 노랑: 보간 전 서버 위치`;
    }
    this.hud.setNetInfo(text);
  }

  // ───────────────────────── 뷰 관리 ─────────────────────────

  getView(id, charId) {
    let view = this.views.get(id);
    if (view && view.charId !== charId) {
      // 캐릭터가 바뀌었으면 새로 만듦 (평소엔 경기 중 변경 불가라 거의 안 일어남)
      this.removeView(id);
      view = null;
    }
    if (!view) {
      const info = this.lookup(id);
      const isMe = id === this.myId;
      view = new PlayerView(this, { name: info.name, color: info.color, isMe, charId });
      // 체력이 줄 때: 나 → 화면 흔들림/번쩍임/효과음, 다른 사람 → 짧은 타격음
      view.onDamaged = isMe
        ? (amount, max) => this.onMeDamaged(amount, max)
        : () => this.playAt('hit', view.root.x, view.root.y, 0.7);
      this.views.set(id, view);
      if (isMe && !this.followId) this.updateCameraTarget();
    }
    return view;
  }

  removeView(id) {
    const view = this.views.get(id);
    if (!view) return;
    view.destroy();
    this.views.delete(id);
  }
}
