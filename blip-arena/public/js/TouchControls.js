/**
 * 모바일 터치 조작 (가상 조이스틱)
 *
 *  - 왼쪽 절반: 아무 곳이나 누르면 그 자리에 이동 조이스틱이 생김
 *  - 오른쪽 아래 공격 버튼: 끌어서 조준 → 놓으면 발사
 *      · 그냥 톡 치면(끌지 않음) 자동 조준 (가장 가까운 적)
 *      · 끌었다가 가운데로 되돌려 놓으면 취소
 *  - 그 위 필살기 버튼: 공격 버튼과 같은 방식 (게이지가 찼을 때만 활성)
 *
 * 포인터 이벤트(pointerId)로 손가락마다 따로 추적하므로 이동하면서 동시에 조준할 수 있습니다.
 * 게임 코드는 move(이동 벡터), aiming(조준 중인 방향)과 onRelease 콜백만 사용합니다.
 */
class TouchControls {
  // 터치가 주 입력 장치인지 (?mobile=1 / ?mobile=0으로 강제 가능)
  static isTouchDevice() {
    const forced = new URLSearchParams(location.search).get('mobile');
    if (forced === '1') return true;
    if (forced === '0') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }

  constructor() {
    this.root = document.getElementById('touch-controls');
    this.moveZone = this.root.querySelector('.tc-move-zone');
    this.moveStick = this.root.querySelector('.tc-move-stick');
    this.moveKnob = this.moveStick.querySelector('.tc-knob');
    this.attackBtn = this.root.querySelector('.tc-attack');
    this.superBtn = this.root.querySelector('.tc-super');

    this.radius = 60; // 조이스틱이 움직일 수 있는 반지름(px)
    this.move = { x: 0, y: 0 }; // -1~1 이동 입력
    this.aiming = null; // 조준 중이면 {kind: 'attack'|'super', x, y, mag}
    this.onRelease = null; // (kind, {tap, angle, mag}) → 발사 요청
    this.superReady = false;

    this.bindMoveStick();
    this.bindAimButton(this.attackBtn, 'attack');
    this.bindAimButton(this.superBtn, 'super');
    // 길게 누를 때 뜨는 메뉴/돋보기 막기
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(visible) {
    this.root.hidden = !visible;
    if (!visible) this.reset();
  }

  reset() {
    this.move = { x: 0, y: 0 };
    this.aiming = null;
    this.moveStick.hidden = true;
    for (const btn of [this.attackBtn, this.superBtn]) this.setKnob(btn.querySelector('.tc-knob'), 0, 0);
  }

  setSuperReady(ready) {
    if (ready === this.superReady) return;
    this.superReady = ready;
    this.superBtn.classList.toggle('ready', ready);
  }

  setKnob(knob, x, y) {
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  // 손가락 이동량 → 반지름 안으로 자른 벡터
  clampVec(dx, dy) {
    const len = Math.hypot(dx, dy);
    const k = len > this.radius ? this.radius / len : 1;
    return { px: dx * k, py: dy * k, x: (dx * k) / this.radius, y: (dy * k) / this.radius, mag: Math.min(1, len / this.radius) };
  }

  bindMoveStick() {
    let id = null;
    let origin = null;
    const zone = this.moveZone;
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      zone.setPointerCapture(id);
      origin = { x: e.clientX, y: e.clientY };
      // 누른 자리에 조이스틱 표시
      this.moveStick.hidden = false;
      this.moveStick.style.left = `${origin.x}px`;
      this.moveStick.style.top = `${origin.y}px`;
      this.setKnob(this.moveKnob, 0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const v = this.clampVec(e.clientX - origin.x, e.clientY - origin.y);
      this.setKnob(this.moveKnob, v.px, v.py);
      // 살짝 건드린 정도(15% 미만)는 무시
      this.move = v.mag < 0.15 ? { x: 0, y: 0 } : { x: v.x, y: v.y };
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.move = { x: 0, y: 0 };
      this.moveStick.hidden = true;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  bindAimButton(btn, kind) {
    let id = null;
    let origin = null;
    let dragged = false; // 한 번이라도 조준 범위 밖으로 끌었는지 (톡 치기와 구분)
    const knob = btn.querySelector('.tc-knob');
    btn.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      if (kind === 'super' && !this.superReady) return;
      e.preventDefault();
      id = e.pointerId;
      btn.setPointerCapture(id);
      const r = btn.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      dragged = false;
      btn.classList.add('active');
    });
    btn.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const v = this.clampVec(e.clientX - origin.x, e.clientY - origin.y);
      this.setKnob(knob, v.px, v.py);
      if (v.mag >= 0.25) {
        dragged = true;
        this.aiming = { kind, x: v.x, y: v.y, mag: v.mag };
      } else {
        this.aiming = null; // 가운데로 돌아오면 조준 해제 (놓으면 취소)
      }
    });
    const end = (e, canceled) => {
      if (e.pointerId !== id) return;
      id = null;
      btn.classList.remove('active');
      this.setKnob(knob, 0, 0);
      const aim = this.aiming;
      this.aiming = null;
      if (canceled || !this.onRelease) return;
      if (aim) this.onRelease(kind, { tap: false, angle: Math.atan2(aim.y, aim.x), mag: aim.mag });
      else if (!dragged) this.onRelease(kind, { tap: true }); // 톡 → 자동 조준
      // 끌었다가 가운데로 돌아와서 놓음 → 취소 (아무것도 안 함)
    };
    btn.addEventListener('pointerup', (e) => end(e, false));
    btn.addEventListener('pointercancel', (e) => end(e, true));
  }
}
