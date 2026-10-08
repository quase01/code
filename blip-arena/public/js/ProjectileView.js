/**
 * 투사체(총알, 폭탄)와 이펙트(폭발, 충격파)를 화면에 그리는 클래스
 *
 * 서버 스냅샷 두 개 사이를 보간해서 그립니다.
 * 스프라이트로 바꾸려면 createBullet() / createBomb() / playFx()만 고치면 됩니다.
 *
 * 폭탄의 포물선: 서버는 "땅 위 위치(x, y)"와 "비행 진행도 p(0~1)"만 보내고,
 * 높이는 클라이언트가 sin(p·π)로 계산해 위로 띄워 그립니다. 판정은 땅 위 위치 기준입니다.
 */
const BOMB_ARC_HEIGHT = 110; // 폭탄이 가장 높이 뜨는 높이 (화면 연출용, 판정과 무관)

class ProjectileView {
  constructor(scene) {
    this.scene = scene;
    this.bullets = new Map(); // id → 게임 오브젝트
    this.bombs = new Map(); // id → {shadow, ball, target}
    this.cubes = new Map(); // id → 파워 큐브 오브젝트 (배틀로얄)
    this.onSpawn = null; // (kind 'bullet'|'bomb', 데이터) → 새 투사체가 처음 보일 때 (효과음용)
  }

  // ===== 파워 큐브 모양: 스프라이트로 교체할 곳 =====
  createCube(x, y) {
    const cube = this.scene.add.rectangle(x, y, 18, 18, 0xc77dff).setStrokeStyle(3, 0xf3d9ff).setDepth(6).setAngle(45);
    // 둥실둥실 + 반짝임
    this.scene.tweens.add({ targets: cube, y: y - 5, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.scene.tweens.add({ targets: cube, alpha: 0.65, duration: 400, yoyo: true, repeat: -1 });
    return cube;
  }

  // 바닥의 파워 큐브 (움직이지 않으므로 보간 없이 목록만 맞춤)
  renderCubes(list) {
    const alive = new Set();
    for (const c of list) {
      alive.add(c.id);
      if (!this.cubes.has(c.id)) this.cubes.set(c.id, this.createCube(c.x, c.y));
    }
    for (const [id, obj] of this.cubes) {
      if (!alive.has(id)) {
        this.scene.tweens.killTweensOf(obj);
        obj.destroy();
        this.cubes.delete(id);
      }
    }
  }

  // ===== 총알 모양: 스프라이트로 교체할 곳 =====
  createBullet(color, radius, isSuper) {
    if (isSuper) {
      // 필살기 탄: 흰 몸통 + 주인 색 테두리, 더 큼
      return this.scene.add.circle(0, 0, radius, 0xffffff).setStrokeStyle(4, color).setDepth(21);
    }
    return this.scene.add.circle(0, 0, radius, color).setStrokeStyle(2, 0xffffff, 0.9).setDepth(20);
  }

  // ===== 폭탄 모양: 스프라이트로 교체할 곳 =====
  createBomb(color, blastRadius, tx, ty) {
    return {
      // 떨어질 지점 표시 (모두에게 보여서 피할 수 있음)
      target: this.scene.add.circle(tx, ty, blastRadius, color, 0.12).setStrokeStyle(2, color, 0.7).setDepth(3),
      shadow: this.scene.add.ellipse(0, 0, 18, 9, 0x000000, 0.35).setDepth(4),
      ball: this.scene.add.circle(0, 0, 9, 0x2b2f3a).setStrokeStyle(3, color).setDepth(22),
    };
  }

  /**
   * @param a, b     보간할 두 스냅샷 (a가 과거)
   * @param alpha    0~1, a와 b 사이 어디쯤인지
   * @param colorOf  (ownerId) → 색상
   */
  render(a, b, alpha, colorOf) {
    // --- 총알 ---
    const prevBullets = new Map(a.bullets.map((x) => [x.id, x]));
    const aliveBullets = new Set();
    for (const nb of b.bullets) {
      aliveBullets.add(nb.id);
      let s = this.bullets.get(nb.id);
      if (!s) {
        s = this.createBullet(colorOf(nb.owner), nb.r, nb.sup);
        this.bullets.set(nb.id, s);
        if (this.onSpawn) this.onSpawn('bullet', nb);
      }
      const pb = prevBullets.get(nb.id);
      if (pb) s.setPosition(pb.x + (nb.x - pb.x) * alpha, pb.y + (nb.y - pb.y) * alpha);
      else s.setPosition(nb.x, nb.y);
    }
    for (const [id, s] of this.bullets) {
      if (!aliveBullets.has(id)) {
        s.destroy();
        this.bullets.delete(id);
      }
    }

    // --- 폭탄 ---
    const prevBombs = new Map(a.bombs.map((x) => [x.id, x]));
    const aliveBombs = new Set();
    for (const nb of b.bombs) {
      aliveBombs.add(nb.id);
      let o = this.bombs.get(nb.id);
      if (!o) {
        o = this.createBomb(colorOf(nb.owner), nb.r, nb.tx, nb.ty);
        this.bombs.set(nb.id, o);
        if (this.onSpawn) this.onSpawn('bomb', nb);
      }
      const pb = prevBombs.get(nb.id);
      const x = pb ? pb.x + (nb.x - pb.x) * alpha : nb.x;
      const y = pb ? pb.y + (nb.y - pb.y) * alpha : nb.y;
      const p = pb ? pb.p + (nb.p - pb.p) * alpha : nb.p;
      const height = Math.sin(p * Math.PI) * BOMB_ARC_HEIGHT * (nb.sup ? 1.2 : 1);
      o.shadow.setPosition(x, y).setScale(1 - 0.4 * Math.sin(p * Math.PI));
      o.ball.setPosition(x, y - height).setScale(1 + 0.5 * Math.sin(p * Math.PI));
    }
    for (const [id, o] of this.bombs) {
      if (!aliveBombs.has(id)) {
        o.target.destroy();
        o.shadow.destroy();
        o.ball.destroy();
        this.bombs.delete(id);
      }
    }
  }

  // ===== 이펙트: 스프라이트/파티클로 교체할 곳 =====
  playFx(fx) {
    const scene = this.scene;
    if (fx.type === 'explosion') {
      const blast = scene.add.circle(fx.x, fx.y, fx.r, 0xffa94d, 0.6).setDepth(15).setScale(0.3);
      const core = scene.add.circle(fx.x, fx.y, fx.r * 0.5, 0xfff3bf, 0.9).setDepth(16).setScale(0.3);
      scene.tweens.add({ targets: blast, scale: 1, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => blast.destroy() });
      scene.tweens.add({ targets: core, scale: 1, alpha: 0, duration: 220, ease: 'Cubic.easeOut', onComplete: () => core.destroy() });
    } else if (fx.type === 'wallBreak') {
      // 상자 파편이 사방으로 튀며 사라짐
      const cx = fx.x + fx.w / 2;
      const cy = fx.y + fx.h / 2;
      const colors = fx.kind === 'box' ? [0x4b2f73, 0xc77dff] : [0x9a6b3f, 0x6b4526];
      for (let i = 0; i < 10; i++) {
        const size = 6 + Math.random() * 8;
        const chip = scene.add.rectangle(cx, cy, size, size * 0.6, colors[i % 2]).setDepth(16);
        const ang = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 50;
        scene.tweens.add({
          targets: chip,
          x: cx + Math.cos(ang) * dist,
          y: cy + Math.sin(ang) * dist,
          angle: Math.random() * 360,
          alpha: 0,
          duration: 450,
          ease: 'Cubic.easeOut',
          onComplete: () => chip.destroy(),
        });
      }
    } else if (fx.type === 'death') {
      // 킬 연출: 쓰러진 캐릭터 색의 파편이 사방으로 튀고, 하얀 링이 퍼짐
      const color = fx.color ?? 0xffffff;
      const flash = scene.add.circle(fx.x, fx.y, 30, 0xffffff, 0.9).setDepth(17);
      scene.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
      const ring = scene.add.circle(fx.x, fx.y, 50).setStrokeStyle(5, color, 1).setDepth(17).setScale(0.2);
      scene.tweens.add({ targets: ring, scale: 1.6, alpha: 0, duration: 500, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 50 + Math.random() * 60;
        const piece = scene.add.circle(fx.x, fx.y, 4 + Math.random() * 5, i % 3 ? color : 0xffffff).setDepth(17);
        scene.tweens.add({
          targets: piece,
          x: fx.x + Math.cos(ang) * dist,
          y: fx.y + Math.sin(ang) * dist,
          scale: 0.2,
          alpha: 0,
          duration: 550 + Math.random() * 250,
          ease: 'Cubic.easeOut',
          onComplete: () => piece.destroy(),
        });
      }
    } else if (fx.type === 'cubePickup') {
      // 큐브를 먹으면 보라색 링이 퍼짐
      const ring = scene.add.circle(fx.x, fx.y, 26).setStrokeStyle(4, 0xe0b3ff, 1).setDepth(16).setScale(0.3);
      scene.tweens.add({ targets: ring, scale: 1.4, alpha: 0, duration: 350, onComplete: () => ring.destroy() });
    } else if (fx.type === 'shockwave') {
      const ring = scene.add.circle(fx.x, fx.y, fx.r).setStrokeStyle(10, fx.color ?? 0xffffff, 0.9).setDepth(15).setScale(0.15);
      const fill = scene.add.circle(fx.x, fx.y, fx.r, fx.color ?? 0xffffff, 0.18).setDepth(14).setScale(0.15);
      scene.tweens.add({ targets: [ring, fill], scale: 1, alpha: 0, duration: 420, ease: 'Cubic.easeOut', onComplete: () => { ring.destroy(); fill.destroy(); } });
    }
  }
}
