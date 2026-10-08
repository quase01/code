/**
 * 플레이어 하나를 화면에 그리는 클래스
 *
 * [스프라이트로 바꾸는 방법]
 * 게임 로직은 이 클래스의 메서드(setPosition, setAim, setHp, setAmmo, setSuper, setVisible, setName, flash)만 부릅니다.
 * 그래서 createBody()에서 도형 대신 this.scene.add.sprite(...)를 반환하게 바꾸면,
 * 나머지 코드는 건드리지 않고 그래픽만 교체할 수 있습니다.
 * 몸체(body)는 조준 방향으로 회전합니다. 그리는 기준은 "오른쪽(0rad)이 정면"입니다.
 *
 * [스프라이트 시트가 있는 캐릭터]
 * PLAYER_SPRITES에 등록된 캐릭터는 도형 대신 스프라이트 애니메이션으로 그립니다.
 * - idle / move: 멈춤·이동에 따라 자동으로 바뀌며 반복
 * - attack / super / hit: 한 번 재생 후 idle·move로 돌아감 (우선순위 super > attack > hit)
 * 프레임 번호는 시트의 왼쪽 위부터 오른쪽으로 0, 1, 2 … 입니다.
 */
const PLAYER_SPRITES = {
  tank: {
    key: 'gorbo',
    url: 'assets/gorbo.png', // image/grbo.png를 배경 제거 + 4×4 분할 + 0.5배 축소한 것
    frameWidth: 176,
    frameHeight: 132,
    bodyWidth: 100, // 프레임 안에서 몸통(무기 제외) 폭(px)
    sizeScale: 1.35, // 화면의 몸통 폭 = 판정 지름 × 이 값
    facing: Math.PI / 2, // 그림 속 캐릭터가 바라보는 방향 (아래쪽)
    anims: {
      idle: { frames: [0, 1, 2, 3], fps: 6, loop: true },
      move: { frames: [4, 5, 6, 7], fps: 10, loop: true },
      attack: { frames: [8, 9, 10, 11], fps: 16 }, // 산탄총 발사 (총구 불꽃 → 연기)
      hit: { frames: [12, 13], fps: 10 }, // 피격
      super: { frames: [14, 15, 15], fps: 6 }, // 대지 강타 (몸을 숙여 내려찍음)
    },
  },
  sniper: {
    key: 'nia',
    url: 'assets/nia.png', // image/nia.png를 배경 제거 + 프레임 자동 검출 + 0.5배 축소한 것 (머리 위쪽 맞춤)
    frameWidth: 150,
    frameHeight: 106,
    bodyWidth: 90, // 프레임 안에서 양갈래 머리까지의 폭(px)
    sizeScale: 1.75,
    facing: Math.PI / 2,
    anims: {
      idle: { frames: [0, 1, 2, 3], fps: 6, loop: true },
      move: { frames: [4, 5, 6, 7], fps: 10, loop: true },
      attack: { frames: [8, 9, 10, 11], fps: 14 }, // 권총 발사 (총구 불꽃)
      hit: { frames: [12, 13], fps: 10 }, // 피격 (눈 질끈)
      super: { frames: [8, 9, 9, 10, 10, 11], fps: 10 }, // 관통 레일: 전용 그림이 없어 공격 동작을 길게
      // 14, 15번(쓰러진 모습)은 아직 안 씀. 죽으면 캐릭터를 숨기기 때문
    },
  },
  thrower: {
    key: 'tort',
    url: 'assets/tort.png', // image/tort.png를 배경 제거(그림자는 반투명) + 4×4 분할 + 0.5배 축소한 것
    frameWidth: 130,
    frameHeight: 130,
    bodyWidth: 60, // 프레임 안에서 머리 폭(px)
    sizeScale: 1.1,
    facing: Math.PI / 2,
    anims: {
      idle: { frames: [0, 1, 2, 3], fps: 6, loop: true },
      // 6, 7번(옆모습·뒷모습)은 몸이 조준 방향으로 회전하는 방식과 안 맞아서 뺌
      move: { frames: [4, 5], fps: 6, loop: true },
      attack: { frames: [8, 9, 10, 11], fps: 12 }, // 폭탄 던지기 (들어 올림 → 뒤로 → 던짐)
      hit: { frames: [12, 12], fps: 8 }, // 피격
      super: { frames: [13, 13, 9, 10, 11], fps: 9 }, // 불꽃 융단: 폭탄을 높이 들었다가 던짐
      // 14, 15번(쓰러진 모습)은 아직 안 씀
    },
  },
};
const ONE_SHOT_PRIORITY = { hit: 1, attack: 2, super: 3 };

class PlayerView {
  // 씬의 preload()에서 호출: 스프라이트 시트 불러오기
  static preload(scene) {
    for (const def of Object.values(PLAYER_SPRITES)) {
      if (scene.textures.exists(def.key)) continue; // 다음 경기에서는 이미 불러와 있음
      scene.load.spritesheet(def.key, def.url, { frameWidth: def.frameWidth, frameHeight: def.frameHeight });
    }
  }

  // 씬의 create()에서 호출: 애니메이션 등록 (전역이라 한 번만)
  static createAnims(scene) {
    for (const def of Object.values(PLAYER_SPRITES)) {
      for (const [name, a] of Object.entries(def.anims)) {
        const key = `${def.key}-${name}`;
        if (scene.anims.exists(key)) continue;
        scene.anims.create({
          key,
          frames: a.frames.map((frame) => ({ key: def.key, frame })),
          frameRate: a.fps,
          repeat: a.loop ? -1 : 0,
        });
      }
    }
  }

  constructor(scene, { name, color, isMe, charId }) {
    this.scene = scene;
    this.isMe = isMe;
    this.color = color;
    this.charId = charId;
    this.char = BlipCharacters[charId];
    this.radius = this.char.radius;
    this.hp = null;
    this.ammoKey = null;
    this.superReady = null;
    this.guideKey = null;
    this.flashTween = null;
    this.superTween = null;

    // 스프라이트 애니메이션 상태
    this.spriteDef = PLAYER_SPRITES[charId] && scene.textures.exists(PLAYER_SPRITES[charId].key) ? PLAYER_SPRITES[charId] : null;
    this.oneShot = null; // 재생 중인 1회성 동작 ('attack' | 'super' | 'hit')
    this.oneShotAt = 0;
    this.lastPos = null;
    this.lastMoveAt = 0;

    // 컨테이너 하나에 모아서 위치만 옮기면 전부 따라옴 (컨테이너 자체는 회전하지 않음)
    this.root = scene.add.container(0, 0).setDepth(isMe ? 11 : 10);

    // 필살기 준비 표시 (몸 둘레의 빛나는 링)
    this.superRing = scene.add.graphics();
    this.superRing.lineStyle(4, 0xffd43b, 1);
    this.superRing.strokeCircle(0, 0, this.radius + 6);
    this.superRing.setVisible(false);

    // 조준 가이드 (내 캐릭터만): 공격 타입마다 모양이 다름
    this.aimGuide = isMe ? scene.add.graphics() : null;

    this.body = this.createBody(color, charId);

    // 머리 위: 닉네임 + 체력바
    this.nameText = scene.add
      .text(0, -this.radius - 14, name, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: isMe ? '#7cf0c8' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    this.hpBar = scene.add.graphics();

    // 체력바 오른쪽: 파워 큐브 개수 (배틀로얄)
    this.cubes = 0;
    this.cubeText = scene.add
      .text(27, -this.radius - 9, '', {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#e0b3ff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0, 0.5);

    // 발 아래: 탄약 칸 (내 캐릭터만)
    this.ammoBar = isMe ? scene.add.graphics() : null;

    const parts = [this.superRing];
    if (this.aimGuide) parts.push(this.aimGuide);
    parts.push(this.body, this.nameText, this.hpBar, this.cubeText);
    if (this.ammoBar) parts.push(this.ammoBar);
    this.root.add(parts);
  }

  // ===== 몸체: 지금은 도형. 스프라이트로 교체할 곳은 여기 =====
  createBody(color, charId) {
    if (this.spriteDef) return this.createSprite(this.spriteDef);
    const g = this.scene.add.graphics();
    const r = this.radius;
    const dark = 0x262a36;

    // 1) 손에 든 무기 (몸통보다 먼저 그려서 몸 뒤로)
    switch (charId) {
      case 'tank': // 고르보: 짧고 굵은 쌍열 산탄총
        g.fillStyle(dark, 1);
        g.fillRect(r - 8, -11, 18, 9);
        g.fillRect(r - 8, 2, 18, 9);
        break;
      case 'sniper': // 니아: 길고 가는 총열
        g.fillStyle(dark, 1);
        g.fillRect(r - 6, -3, 30, 6);
        g.fillRect(r + 18, -5, 6, 10);
        break;
      case 'thrower': // 토트: 손에 든 폭탄 + 심지 불꽃
        g.fillStyle(dark, 1);
        g.fillCircle(r + 3, 9, 8);
        g.fillStyle(0xffb02e, 1);
        g.fillCircle(r + 8, 2, 3);
        break;
      default:
        g.fillStyle(0xffffff, 0.9);
        g.fillRect(r, -3, 14, 6);
    }

    // 2) 몸통
    g.fillStyle(color, 1);
    g.fillCircle(0, 0, r);

    // 3) 캐릭터별 특징
    switch (charId) {
      case 'tank': // 철판 테두리 + 리벳
        g.lineStyle(6, 0x3b4152, 1);
        g.strokeCircle(0, 0, r - 3);
        g.fillStyle(0xc9ced9, 1);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          g.fillCircle(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3), 2.2);
        }
        g.fillStyle(0x000000, 0.35); // 눈구멍 슬릿
        g.fillRect(r * 0.15, -7, 6, 14);
        break;
      case 'sniper': // 외눈 렌즈
        g.fillStyle(0xffffff, 1);
        g.fillCircle(r * 0.35, 0, 7);
        g.fillStyle(0x1a1d26, 1);
        g.fillCircle(r * 0.35 + 1.5, 0, 3.5);
        g.fillStyle(0x7cf0ff, 1);
        g.fillCircle(r * 0.35 + 2.5, -1.5, 1.2);
        break;
      case 'thrower': // 고글 두 개 + 머리띠
        g.fillStyle(0x3b4152, 1);
        g.fillRect(-r * 0.2, -r + 2, 6, (r - 2) * 2);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(r * 0.4, -6, 5);
        g.fillCircle(r * 0.4, 6, 5);
        g.fillStyle(0x1a1d26, 1);
        g.fillCircle(r * 0.4 + 1.5, -6, 2.5);
        g.fillCircle(r * 0.4 + 1.5, 6, 2.5);
        break;
    }
    g.lineStyle(3, 0x000000, 0.4);
    g.strokeCircle(0, 0, r);
    return g;
  }

  createSprite(def) {
    const s = this.scene.add.sprite(0, 0, def.key, def.anims.idle.frames[0]);
    s.setScale((this.radius * 2 * def.sizeScale) / def.bodyWidth);
    s.on('animationcomplete', () => {
      this.oneShot = null;
      this.updateBaseAnim();
    });
    s.play(`${def.key}-idle`);
    return s;
  }

  // 1회성 동작이 없으면 이동 여부에 따라 idle / move 반복
  updateBaseAnim() {
    if (!this.spriteDef || this.oneShot) return;
    const moving = performance.now() - this.lastMoveAt < 120;
    this.body.play(`${this.spriteDef.key}-${moving ? 'move' : 'idle'}`, true);
  }

  // 1회성 동작 재생. 더 중요한 동작이 재생 중이면 무시
  playOneShot(name) {
    if (!this.spriteDef) return;
    const now = performance.now();
    if (this.oneShot && ONE_SHOT_PRIORITY[this.oneShot] > ONE_SHOT_PRIORITY[name]) return;
    if (this.oneShot === name && now - this.oneShotAt < 100) return; // 산탄 5발 → 한 번만
    this.oneShot = name;
    this.oneShotAt = now;
    this.body.play(`${this.spriteDef.key}-${name}`);
  }

  playAttack() {
    this.playOneShot('attack');
  }

  playSuper() {
    this.playOneShot('super');
  }

  setPosition(x, y) {
    this.root.setPosition(x, y);
    // 프레임 사이에 위치가 바뀌었으면 이동 중 (내 캐릭터는 예측 위치, 다른 사람은 보간 위치)
    if (this.lastPos && Math.hypot(x - this.lastPos.x, y - this.lastPos.y) > 0.3) this.lastMoveAt = performance.now();
    this.lastPos = { x, y };
    this.updateBaseAnim();
  }

  /**
   * @param angle 조준 각도
   * @param dist  마우스까지 거리 (내 캐릭터의 투척 가이드에만 사용)
   */
  setAim(angle, dist = 0) {
    this.body.rotation = this.spriteDef ? angle - this.spriteDef.facing : angle;
    if (this.aimGuide) {
      this.aimGuide.rotation = angle;
      this.drawAimGuide(dist);
    }
  }

  // 공격 타입별 조준 가이드 (오른쪽 방향으로 그리고 회전시킴)
  drawAimGuide(dist) {
    const a = this.char.attack;
    const lobDist = a.type === 'lob' ? Phaser.Math.Clamp(dist, 0, a.maxRange) : 0;
    const key = a.type === 'lob' ? Math.round(lobDist / 2) : 'static';
    if (key === this.guideKey) return; // 바뀐 게 없으면 다시 안 그림
    this.guideKey = key;

    const g = this.aimGuide;
    const r = this.radius;
    g.clear();
    switch (a.type) {
      case 'spread': {
        // 부채꼴: 산탄이 퍼지는 범위
        const half = (a.spreadDeg * Math.PI) / 180 / 2;
        g.fillStyle(0xffffff, 0.07);
        g.slice(0, 0, a.range, -half, half, false);
        g.fillPath();
        g.lineStyle(2, 0xffffff, 0.18);
        g.strokePath();
        break;
      }
      case 'bullet':
        // 긴 직선: 사거리 끝까지
        g.lineStyle(2, 0xffffff, 0.18);
        g.lineBetween(r + 4, 0, a.range, 0);
        g.fillStyle(0xffffff, 0.35);
        g.fillCircle(a.range, 0, 3);
        break;
      case 'lob':
        // 떨어질 지점의 폭발 범위 원
        g.lineStyle(2, 0xffffff, 0.12);
        g.lineBetween(r + 4, 0, lobDist, 0);
        g.fillStyle(0xffffff, 0.08);
        g.fillCircle(lobDist, 0, a.blastRadius);
        g.lineStyle(2, 0xffffff, 0.4);
        g.strokeCircle(lobDist, 0, a.blastRadius);
        break;
    }
  }

  setName(name) {
    if (this.nameText.text !== name) this.nameText.setText(name);
  }

  setVisible(visible) {
    this.root.setVisible(visible);
  }

  // 수풀 속이면 반투명 (컨테이너 전체 투명도라 피격 깜빡임과 겹치지 않음)
  setConcealed(concealed) {
    this.root.setAlpha(concealed ? 0.5 : 1);
  }

  // 체력이 줄었으면 자동으로 피격 깜빡임
  // maxHp: 파워 큐브로 늘어난 최대 체력 (없으면 캐릭터 기본값)
  setHp(hp, maxHp) {
    const max = maxHp || this.char.maxHp;
    if (hp === this.hp && max === this.maxHp) return;
    if (this.hp !== null && hp < this.hp) {
      this.flash();
      if (this.onDamaged) this.onDamaged(this.hp - hp, max); // 효과음/화면 흔들림용
    }
    this.hp = hp;
    this.maxHp = max;

    const w = 46;
    const h = 6;
    const x = -w / 2;
    const y = -this.radius - 12;
    const ratio = Phaser.Math.Clamp(hp / max, 0, 1);
    // 나: 초록 / 아군: 파랑 / 적: 빨강 (기지전이 아니면 다른 사람은 모두 적)
    const fill = this.isMe ? 0x51e08a : this.relation === 'ally' ? 0x4dabf7 : 0xff5c5c;

    const g = this.hpBar;
    g.clear();
    g.fillStyle(0x000000, 0.6);
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(fill, 1);
    g.fillRect(x, y, w * ratio, h);
  }

  // 조준 가이드 표시 여부 (모바일은 조이스틱으로 조준하는 동안만 보임)
  setGuideVisible(visible) {
    if (this.aimGuide) this.aimGuide.setVisible(visible);
  }

  // 나와의 관계: 'me' | 'ally' | 'enemy' → 체력바 색
  setRelation(relation) {
    if (relation === this.relation) return;
    this.relation = relation;
    const hp = this.hp;
    this.hp = null; // 체력바 강제로 다시 그리기 (깜빡임은 생략)
    if (hp !== null) this.setHp(hp, this.maxHp);
  }

  // 파워 큐브 개수 표시 (0개면 숨김)
  setCubes(n) {
    n = n || 0;
    if (n === this.cubes) return;
    this.cubes = n;
    this.cubeText.setText(n > 0 ? `◆${n}` : '');
  }

  // 탄약 칸: 꽉 찬 칸 + 충전 중인 칸은 부분적으로 채움
  setAmmo(ammo) {
    if (!this.ammoBar) return;
    const key = Math.round(ammo * 30);
    if (key === this.ammoKey) return;
    this.ammoKey = key;

    const max = this.char.attack.maxAmmo;
    const segW = 14;
    const gap = 3;
    const totalW = max * segW + (max - 1) * gap;
    const y = this.radius + 8;
    const g = this.ammoBar;
    g.clear();
    for (let i = 0; i < max; i++) {
      const x = -totalW / 2 + i * (segW + gap);
      const fill = Phaser.Math.Clamp(ammo - i, 0, 1);
      g.fillStyle(0x000000, 0.6);
      g.fillRect(x - 1, y - 1, segW + 2, 7);
      if (fill > 0) {
        g.fillStyle(fill >= 1 ? 0xffb02e : 0x8a6a33, 1);
        g.fillRect(x, y, segW * fill, 5);
      }
    }
  }

  // 필살기 게이지가 가득 차면 몸 둘레에 깜빡이는 링 (적도 볼 수 있음)
  setSuper(charge) {
    const ready = charge >= 1;
    if (ready === this.superReady) return;
    this.superReady = ready;
    this.superRing.setVisible(ready);
    if (this.superTween) {
      this.superTween.stop();
      this.superTween = null;
    }
    if (ready) {
      this.superRing.setAlpha(1);
      this.superTween = this.scene.tweens.add({
        targets: this.superRing,
        alpha: 0.25,
        duration: 450,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  // 피격 깜빡임
  flash() {
    this.playOneShot('hit');
    if (this.flashTween) this.flashTween.stop();
    this.body.setAlpha(1);
    this.flashTween = this.scene.tweens.add({
      targets: this.body,
      alpha: 0.2,
      duration: 60,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.body.setAlpha(1),
    });
  }

  destroy() {
    if (this.flashTween) this.flashTween.stop();
    if (this.superTween) this.superTween.stop();
    this.root.destroy();
  }
}
