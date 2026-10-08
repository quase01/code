/**
 * 이동/충돌 계산 (서버/클라이언트 공용)
 *
 * [왜 공용인가?]
 * 클라이언트 예측(client-side prediction)은 "서버가 계산할 결과를 미리 똑같이 계산"하는 것입니다.
 * 서버와 클라이언트가 같은 함수, 같은 입력, 같은 dt, 같은 캐릭터 수치, 같은 맵 상태(world)를 쓰면
 * 결과가 같으므로 평소에는 서버 보정이 거의 일어나지 않습니다.
 *
 * world는 shared/world.js의 buildWorld()로 만든 객체입니다. (width, height, solids)
 */
(function (root) {
  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  // 원(x, y, r)이 사각형과 겹치는지
  function circleHitsRect(x, y, r, rect) {
    const nx = clamp(x, rect.x, rect.x + rect.w);
    const ny = clamp(y, rect.y, rect.y + rect.h);
    const dx = x - nx;
    const dy = y - ny;
    return dx * dx + dy * dy < r * r;
  }

  // 원과 겹치는 첫 번째 막힘(벽/부서지는 벽)을 반환. 없으면 null
  function findSolidHit(world, x, y, r) {
    for (const s of world.solids) {
      if (circleHitsRect(x, y, r, s)) return s;
    }
    return null;
  }

  function circleHitsAnyWall(world, x, y, r) {
    return findSolidHit(world, x, y, r) !== null;
  }

  // 맵 바깥으로 나갔는지
  function isOutOfBounds(world, x, y, r = 0) {
    return x < r || y < r || x > world.width - r || y > world.height - r;
  }

  // 원이 사각형에 파고들었으면 가장 가까운 바깥으로 밀어냄 (pos를 직접 수정)
  function pushOutOfRect(pos, r, rect) {
    const nx = clamp(pos.x, rect.x, rect.x + rect.w);
    const ny = clamp(pos.y, rect.y, rect.y + rect.h);
    const dx = pos.x - nx;
    const dy = pos.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return;

    if (d2 > 0) {
      // 중심이 사각형 밖: 가장 가까운 점에서 바깥 방향으로 밀기 → 벽을 따라 미끄러짐
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * r;
      pos.y = ny + (dy / d) * r;
    } else {
      // 중심이 사각형 안(드문 경우): 가장 가까운 변 쪽으로 빼냄
      const left = pos.x - rect.x;
      const right = rect.x + rect.w - pos.x;
      const top = pos.y - rect.y;
      const bottom = rect.y + rect.h - pos.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) pos.x = rect.x - r;
      else if (m === right) pos.x = rect.x + rect.w + r;
      else if (m === top) pos.y = rect.y - r;
      else pos.y = rect.y + rect.h + r;
    }
  }

  // 벽과 맵 경계 밖으로 밀어냄. 두 벽이 만나는 모서리 대비로 2번 반복.
  function resolveWalls(world, pos, r) {
    for (let iter = 0; iter < 2; iter++) {
      for (const s of world.solids) pushOutOfRect(pos, r, s);
    }
    pos.x = clamp(pos.x, r, world.width - r);
    pos.y = clamp(pos.y, r, world.height - r);
  }

  /**
   * 입력 하나를 적용해 플레이어를 이동시킴 (pos를 직접 수정)
   * @param world 맵 상태
   * @param pos   {x, y}
   * @param input {dx, dy}  각각 -1 ~ 1
   * @param dt    초 단위 시간 (항상 1 / inputRate 고정값을 씀)
   * @param stats {speed, radius}  캐릭터 수치 (characters.json의 캐릭터 객체를 그대로 넘기면 됨)
   */
  function movePlayer(world, pos, input, dt, stats) {
    let dx = input.dx;
    let dy = input.dy;
    // 대각선 이동이 더 빠르지 않도록 정규화 (조작된 큰 값도 여기서 막힘)
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    const step = stats.speed * dt;
    pos.x += dx * step;
    pos.y += dy * step;
    // 한 스텝 이동량(약 4~5px)이 벽 두께보다 훨씬 작으므로 뚫고 지나갈 일이 없음.
    resolveWalls(world, pos, stats.radius);
  }

  /**
   * 외부 힘(넉백 등)으로 (dx, dy)만큼 밀기. 벽을 뚫지 않도록 10px 이하로 쪼개서 이동.
   * 서버 전용 (클라이언트는 이 결과를 스냅샷으로 받아 보정함)
   */
  function moveBy(world, pos, dx, dy, r) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 10));
    for (let i = 0; i < steps; i++) {
      pos.x += dx / steps;
      pos.y += dy / steps;
      resolveWalls(world, pos, r);
    }
  }

  const Physics = { clamp, circleHitsRect, findSolidHit, circleHitsAnyWall, isOutOfBounds, movePlayer, moveBy };

  if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
  else root.BlipPhysics = Physics;
})(this);
