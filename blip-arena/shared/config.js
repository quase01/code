/**
 * ===============================================================
 *  게임 공통 설정 파일
 * ===============================================================
 * 캐릭터별 수치(체력, 속도, 무기, 필살기)는 shared/characters.json에 있습니다.
 * 여기에는 모든 캐릭터에 공통인 값과 네트워크/경기 설정만 둡니다.
 *
 * 이 파일은 서버(Node.js)와 브라우저가 "똑같은 파일"을 불러 씁니다.
 *  - 서버: require('../shared/config')
 *  - 브라우저: <script src="/shared/config.js"> → window.BlipConfig
 * 그래서 값이 양쪽에서 항상 일치하고, 클라이언트 예측 결과가 서버 계산과 같게 나옵니다.
 *
 * 값을 바꾼 뒤에는 서버를 재시작하고 브라우저를 새로고침하세요.
 */
(function (root) {
  const CONFIG = {
    // ---------------- 네트워크 ----------------
    net: {
      tickRate: 30,            // 서버 게임 루프의 초당 틱 수 (스냅샷도 이 주기로 전송)
      inputRate: 60,           // 클라이언트가 입력을 샘플링하는 초당 횟수 (예측의 고정 스텝)
      interpDelayMs: 100,      // 다른 플레이어를 몇 ms 과거 시점으로 그릴지 (보간 버퍼, 틱 3개 분량)
      maxInputsPerTick: 8,     // 서버가 한 틱에 처리할 최대 입력 수 (밀린 입력은 다음 틱에)
      inputBurstSec: 1,        // 입력 속도 제한: 평균 inputRate/초까지만 처리. 랙 후 몰려온 입력은 이 초만큼까지 한꺼번에 허용
      maxQueuedInputs: 60,     // 서버에 쌓아 둘 최대 입력 수 (넘치면 오래된 것부터 버림)
      correctionSmoothing: 12, // 예측 오차를 흡수하는 속도 (클수록 빨리 따라붙음)
      snapDistance: 150,       // 오차가 이보다 크면 부드럽게 말고 즉시 위치 이동 (부활 등)
    },

    // ---------------- 플레이어 공통 ----------------
    player: {
      regenDelayMs: 3000,      // 마지막 피격 후 이 시간이 지나면 회복 시작
      regenPercentPerSec: 0.13, // 회복 중 초당 회복량 (최대 체력 대비 비율, 0.13 = 13%)
      respawnDelayMs: 3000,    // 사망 후 부활까지 걸리는 시간
      knockbackDecay: 10,      // 넉백 감속 정도 (클수록 짧게 밀림)
    },

    // ---------------- 경기 ----------------
    match: {
      durationMs: 3 * 60 * 1000, // 경기 시간 (3분)
      maxPlayers: 6,             // 방 최대 인원
      minPlayersToStart: 1,      // 시작에 필요한 최소 인원 (혼자 테스트용으로 1, 실전은 2 추천)
    },

    // ---------------- 맵 요소 ----------------
    world: {
      defaultBreakableHp: 120, // 부서지는 벽의 기본 내구도 (맵 JSON의 breakableHp / 벽별 hp가 우선)
    },
    bush: {
      revealDistance: 110,     // 수풀 속 적이라도 이 거리(px) 안이면 보임
      revealAfterAttackMs: 1000, // 수풀 속에서 공격하면 이 시간 동안 모두에게 드러남
      revealAfterHitMs: 1000,  // 수풀 속에서 맞으면 이 시간 동안 드러남
    },

    // ---------------- 게임 모드 ----------------
    modes: {
      deathmatch: { name: '데스매치', description: '3분 동안 킬을 가장 많이 한 사람이 승리. 죽으면 부활.' },
      battleroyale: { name: '배틀로얄', description: '부활 없음. 좁혀 오는 독가스 속에서 마지막 1명이 승리.' },
      teams: { name: '기지전', description: '2팀으로 나눠 싸움. 포탑이 지키는 상대 기지를 먼저 부수는 팀이 승리.' },
    },

    // ---------------- 기지전 (팀전) ----------------
    teams: {
      names: ['1팀', '2팀'],       // 로비/결과 화면에 쓰는 팀 이름
      lobbyColors: [0xffb347, 0xb197fc], // 로비에서 팀 구분 색 (인게임은 아군 파랑/적 빨강)
      durationMs: 5 * 60 * 1000,   // 시간 제한. 끝나면 기지 체력 비율이 높은 팀 승리
      respawnDelayMs: 4000,        // 부활 대기 시간 (내 기지 근처에서 부활)
      baseSize: 90,                // 기지 크기 (정사각형, px)
      baseHp: 3000,                // 기지 체력
      turretRange: 360,            // 포탑 사거리 (기지 중심 기준)
      turretDamage: 28,            // 포탑 한 발 데미지
      turretCooldownMs: 700,       // 포탑 발사 간격
      turretBulletSpeed: 950,
    },
    defaultMode: 'deathmatch',

    // ---------------- 배틀로얄 ----------------
    battleRoyale: {
      gasStartMs: 30 * 1000,       // 경기 시작 후 독가스가 좁혀 오기 시작하는 시점
      gasShrinkMs: 150 * 1000,     // 맵 가장자리에서 완전히 닫힐 때까지 걸리는 시간
      gasCloseRatio: 0,            // 다 좁혀졌을 때 안전 구역 크기 (맵 대비 비율, 0 = 완전히 닫힘)
      gasDps: 15,                  // 독가스 안에 있을 때 초당 데미지 (1초마다 한 번에 들어감)
      gasDpsAfterClose: 30,        // 완전히 닫힌 뒤 초당 데미지 (승부를 확실히 내기 위해)
      maxDurationMs: 6 * 60 * 1000, // 안전장치: 이 시간이 지나면 남은 사람 중 체력 높은 순으로 종료
      boxCount: 10,                // 맵 JSON에 powerBoxes가 없을 때 무작위로 놓을 상자 수
      boxSize: 48,                 // 상자 크기 (px)
      boxHp: 100,                  // 상자 내구도
      cubeHpBonus: 0.12,           // 파워 큐브 1개당 최대 체력 +12% (먹는 순간 늘어난 만큼 회복)
      cubeDamageBonus: 0.1,        // 파워 큐브 1개당 공격력 +10%
      cubePickupRange: 14,         // 몸 반지름 + 이 거리 안에 들어오면 큐브를 먹음
    },

    defaultCharacter: 'tank', // 캐릭터를 안 골랐을 때 (characters.json의 id)
    defaultMap: 'arena',      // 기본 맵 (shared/maps/ 안의 파일 이름, .json 제외)

    // 플레이어 색상 (입장 순서대로 비어 있는 색 배정)
    colors: [0xff6b6b, 0x4dabf7, 0x69db7c, 0xffd43b, 0xda77f2, 0xff922b],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  else root.BlipConfig = CONFIG;
})(this);
