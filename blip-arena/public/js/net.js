/**
 * 소켓 통신 래퍼
 *
 * 게임 코드는 socket.io를 직접 쓰지 않고 Net.emit / Net.on만 씁니다.
 * 이 안에서 "인위적 지연"을 끼워 넣기 때문에, 주소창에
 *   http://localhost:3000/?lag=150&jitter=50
 * 처럼 붙이면 이 탭만 보내는 패킷과 받는 패킷이 각각 150~200ms씩 늦어집니다.
 */
const Net = (() => {
  const params = new URLSearchParams(location.search);
  const lag = Math.max(0, Number(params.get('lag')) || 0);
  const jitter = Math.max(0, Number(params.get('jitter')) || 0);

  const socket = io();
  const outDelay = BlipLag.createDelayer(lag, jitter);
  const inDelay = BlipLag.createDelayer(lag, jitter);

  if (lag || jitter) console.log(`[Net] 인위적 지연: 단방향 ${lag}ms + 지터 0~${jitter}ms`);

  return {
    lag,
    jitter,
    get id() {
      return socket.id;
    },

    // 서버로 보내기 (ack: 서버 응답 콜백, 선택)
    emit(event, data, ack) {
      outDelay(() => {
        if (ack) socket.emit(event, data, (res) => inDelay(() => ack(res)));
        else socket.emit(event, data);
      });
    },

    // 서버 메시지 구독. 반환값을 호출하면 구독 해제.
    on(event, handler) {
      const wrapped = (data) => inDelay(() => handler(data));
      socket.on(event, wrapped);
      return () => socket.off(event, wrapped);
    },

    onDisconnect(handler) {
      socket.on('disconnect', handler);
    },
  };
})();
