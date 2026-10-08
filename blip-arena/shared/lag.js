/**
 * 인위적 지연기 (랙 테스트용, 서버/클라이언트 공용)
 *
 * createDelayer(150, 50) → 넘겨받은 함수를 150~200ms 뒤에 실행.
 * 실제 TCP(WebSocket)처럼 순서는 지킵니다. 지터 때문에 나중 패킷이 먼저 도착하지는 않습니다.
 * lagMs, jitterMs가 모두 0이면 지연 없이 바로 실행합니다.
 */
(function (root) {
  function createDelayer(lagMs, jitterMs) {
    let lastAt = 0;
    return function delay(fn) {
      if (lagMs <= 0 && jitterMs <= 0) return fn();
      const target = Math.max(lastAt, Date.now() + lagMs + Math.random() * jitterMs);
      lastAt = target;
      setTimeout(fn, target - Date.now());
    };
  }

  const Lag = { createDelayer };
  if (typeof module !== 'undefined' && module.exports) module.exports = Lag;
  else root.BlipLag = Lag;
})(this);
