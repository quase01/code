/**
 * 맵 데이터(JSON) → "현재 맵 상태(world)" 변환 (서버/클라이언트 공용)
 *
 * 맵 JSON 형식 (shared/maps/<id>.json):
 * {
 *   "name": "맵 이름", "description": "설명",
 *   "width": 1600, "height": 1200,
 *   "breakableHp": 120,                       // (선택) 부서지는 벽 기본 내구도
 *   "walls":      [{ "x", "y", "w", "h" }],     // 부서지지 않는 벽
 *   "breakables": [{ "x", "y", "w", "h", "hp"? }], // 부서지는 벽 (hp 생략 시 기본값)
 *   "bushes":     [{ "x", "y", "w", "h" }],     // 수풀 (겹치거나 맞닿은 사각형은 하나의 수풀로 취급)
 *   "spawnPoints":[{ "x", "y" }],               // (선택) 부활 위치 후보. 없으면 무작위
 *   "powerBoxes": [{ "x", "y" }],               // (선택) 배틀로얄 파워 큐브 상자 위치(중심). 없으면 무작위
 *   "gasCenter":  { "x", "y" },                 // (선택) 배틀로얄 독가스가 좁혀 들어갈 중심. 없으면 맵 중앙
 *   "bases":      [{ "x", "y" }, { "x", "y" }]  // (선택) 기지전 1팀/2팀 기지 중심. 없으면 맵 왼쪽/오른쪽 가운데
 * }
 *
 * 배틀로얄의 파워 큐브 상자(extras.boxes, kind: 'box')와 기지전의 기지(extras.bases, kind: 'base')는
 * breakables 뒤에 붙입니다. 위치는 서버가 경기 시작 때 정해서 클라이언트에 보내므로,
 * 양쪽 world의 벽 순서가 똑같습니다. (스냅샷의 walls 배열이 이 순서)
 *
 * world.solids = 지금 이동/총알을 막는 사각형 목록 (벽 + 아직 안 부서진 벽).
 * 벽이 부서지면 refreshSolids()로 다시 만듭니다. 서버와 클라이언트 예측이 같은 목록을 쓰므로
 * 벽이 부서진 직후 그 자리로 걸어 들어가도 예측이 어긋나지 않습니다.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const CONFIG = isNode ? require('./config') : root.BlipConfig;

  const rect = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });

  // 두 사각형이 겹치거나 맞닿는지
  function rectsTouch(a, b) {
    return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  }

  /**
   * @param map    맵 JSON
   * @param extras { boxes: [{x, y, w, h, hp}], bases: [{x, y, w, h, hp, team}] }  (선택)
   */
  function buildWorld(map, extras = {}) {
    const defaultHp = map.breakableHp ?? CONFIG.world.defaultBreakableHp;
    const crates = (map.breakables || []).map((r) => ({ ...rect(r), kind: 'crate', maxHp: r.hp ?? defaultHp }));
    const boxes = (extras.boxes || []).map((r) => ({ ...rect(r), kind: 'box', maxHp: r.hp }));
    const bases = (extras.bases || []).map((r) => ({ ...rect(r), kind: 'base', team: r.team, maxHp: r.hp }));
    const world = {
      width: map.width,
      height: map.height,
      walls: (map.walls || []).map(rect),
      // 부서지는 벽 = 맵의 상자 + 파워 큐브 상자 + 기지. id는 배열 순서 (스냅샷 walls의 순서)
      breakables: crates.concat(boxes, bases).map((b, i) => ({ ...b, id: i, hp: b.maxHp })),
      bushes: (map.bushes || []).map((r) => ({ ...rect(r), group: -1 })),
      spawnPoints: Array.isArray(map.spawnPoints) && map.spawnPoints.length ? map.spawnPoints : null,
      solids: [],
    };

    // 수풀 묶기: 서로 겹치거나 맞닿은 사각형들은 같은 group 번호 → "같은 수풀"
    let group = 0;
    for (const start of world.bushes) {
      if (start.group >= 0) continue;
      start.group = group;
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop();
        for (const other of world.bushes) {
          if (other.group < 0 && rectsTouch(cur, other)) {
            other.group = group;
            stack.push(other);
          }
        }
      }
      group++;
    }

    refreshSolids(world);
    return world;
  }

  // 이동/총알을 막는 사각형 목록 갱신 (부서진 벽 제외)
  function refreshSolids(world) {
    world.solids = world.walls.concat(world.breakables.filter((b) => b.hp > 0));
  }

  // (x, y)가 들어 있는 수풀의 group 번호. 수풀 밖이면 -1
  function bushAt(world, x, y) {
    for (const b of world.bushes) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.group;
    }
    return -1;
  }

  // 맵 JSON 검사: 문제 목록을 반환 (빈 배열이면 정상)
  function validateMap(map) {
    const errors = [];
    if (!map || typeof map !== 'object') return ['JSON 객체가 아닙니다.'];
    if (!(map.width > 0) || !(map.height > 0)) errors.push('width, height는 0보다 큰 숫자여야 합니다.');
    for (const key of ['walls', 'breakables', 'bushes']) {
      if (map[key] === undefined) continue;
      if (!Array.isArray(map[key])) {
        errors.push(`${key}는 배열이어야 합니다.`);
        continue;
      }
      map[key].forEach((r, i) => {
        const ok = r && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v)) && r.w > 0 && r.h > 0;
        if (!ok) errors.push(`${key}[${i}]: x, y, w, h는 숫자이고 w, h는 0보다 커야 합니다.`);
      });
    }
    if (map.bases !== undefined && (!Array.isArray(map.bases) || map.bases.length !== 2)) {
      errors.push('bases는 기지 2개의 중심 [{ "x", "y" }, { "x", "y" }] 배열이어야 합니다.');
    }
    for (const key of ['spawnPoints', 'powerBoxes', 'bases']) {
      if (map[key] === undefined) continue;
      if (!Array.isArray(map[key])) errors.push(`${key}는 배열이어야 합니다.`);
      else map[key].forEach((p, i) => {
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') errors.push(`${key}[${i}]: x, y는 숫자여야 합니다.`);
      });
    }
    if (map.gasCenter !== undefined && (typeof map.gasCenter?.x !== 'number' || typeof map.gasCenter?.y !== 'number')) {
      errors.push('gasCenter는 { "x": 숫자, "y": 숫자 } 형식이어야 합니다.');
    }
    return errors;
  }

  const World = { buildWorld, refreshSolids, bushAt, validateMap };
  if (isNode) module.exports = World;
  else root.BlipWorld = World;
})(this);
