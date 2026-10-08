/**
 * 효과음 (Web Audio로 직접 합성 → 음원 파일이 필요 없음)
 *
 * Sound.play('explosion', 0.6)  // 이름, 볼륨(0~1)
 *
 * 브라우저 정책상 사용자가 화면을 한 번 누르거나 키를 눌러야 소리가 나기 시작합니다.
 * (첫 입력 때 AudioContext를 만들고 깨움)
 *
 * [진짜 음원으로 바꾸려면]
 * SOUNDS의 함수 대신 new Audio('/sfx/explosion.mp3').play() 같은 코드를 넣으면 됩니다.
 * 게임 코드는 Sound.play(이름)만 부르므로 다른 곳은 고칠 필요가 없습니다.
 */
const Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  const lastPlayed = new Map(); // 같은 소리가 한 프레임에 수십 번 겹치지 않게
  try {
    muted = localStorage.getItem('blip.muted') === '1';
  } catch (_) {}

  // 첫 사용자 입력 때 오디오 준비 (브라우저 자동재생 정책)
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.45;
      master.connect(ctx.destination);
      // 화이트 노이즈 1초 분량 (폭발, 산탄 등에 재사용)
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  window.addEventListener('pointerdown', ensure, { passive: true });
  window.addEventListener('keydown', ensure);

  // 음 하나: 주파수가 freq → freqEnd로 미끄러지며 vol에서 0으로 사라짐
  function tone({ freq, freqEnd = freq, type = 'square', dur = 0.1, vol = 0.3, delay = 0 }) {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // 잡음: 필터 주파수를 filter → filterEnd로 움직여 "펑", "치익" 같은 소리
  function noise({ dur = 0.2, vol = 0.4, filter = 2000, filterEnd = filter, kind = 'lowpass', delay = 0 }) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.frequency.setValueAtTime(filter, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, filterEnd), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(gain).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // v = 볼륨 배율 (거리에 따라 작아짐)
  const SOUNDS = {
    shootSpread: (v) => {
      noise({ dur: 0.2, vol: 0.55 * v, filter: 3500, filterEnd: 300 });
      tone({ freq: 140, freqEnd: 60, type: 'sine', dur: 0.15, vol: 0.4 * v });
    },
    shootBullet: (v) => {
      tone({ freq: 1500, freqEnd: 250, type: 'sawtooth', dur: 0.12, vol: 0.18 * v });
      noise({ dur: 0.06, vol: 0.25 * v, filter: 6000, kind: 'highpass' });
    },
    shootLob: (v) => tone({ freq: 200, freqEnd: 480, type: 'triangle', dur: 0.16, vol: 0.35 * v }),
    shootRail: (v) => {
      tone({ freq: 300, freqEnd: 2400, type: 'sawtooth', dur: 0.25, vol: 0.2 * v });
      noise({ dur: 0.3, vol: 0.3 * v, filter: 8000, filterEnd: 1500, kind: 'bandpass' });
    },
    turret: (v) => tone({ freq: 700, freqEnd: 180, type: 'square', dur: 0.1, vol: 0.15 * v }),
    explosion: (v) => {
      noise({ dur: 0.55, vol: 0.7 * v, filter: 1400, filterEnd: 80 });
      tone({ freq: 90, freqEnd: 35, type: 'sine', dur: 0.45, vol: 0.5 * v });
    },
    shockwave: (v) => {
      tone({ freq: 140, freqEnd: 40, type: 'sine', dur: 0.5, vol: 0.6 * v });
      noise({ dur: 0.4, vol: 0.4 * v, filter: 900, filterEnd: 100 });
    },
    wallBreak: (v) => {
      noise({ dur: 0.25, vol: 0.45 * v, filter: 2500, filterEnd: 400, kind: 'bandpass' });
      tone({ freq: 260, freqEnd: 90, type: 'triangle', dur: 0.2, vol: 0.3 * v });
    },
    hit: (v) => tone({ freq: 1000, freqEnd: 700, type: 'square', dur: 0.05, vol: 0.12 * v }), // 적이 맞음
    hurt: (v) => {
      tone({ freq: 220, freqEnd: 110, type: 'sawtooth', dur: 0.14, vol: 0.3 * v }); // 내가 맞음
      noise({ dur: 0.08, vol: 0.25 * v, filter: 1500 });
    },
    cube: (v) => [660, 880, 1320].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.12, vol: 0.25 * v, delay: i * 0.06 })),
    kill: (v) => {
      tone({ freq: 880, type: 'square', dur: 0.09, vol: 0.22 * v });
      tone({ freq: 1320, type: 'square', dur: 0.18, vol: 0.22 * v, delay: 0.09 });
    },
    otherKill: (v) => tone({ freq: 660, freqEnd: 440, type: 'triangle', dur: 0.15, vol: 0.15 * v }),
    death: (v) => {
      tone({ freq: 440, freqEnd: 80, type: 'sawtooth', dur: 0.6, vol: 0.3 * v });
      noise({ dur: 0.4, vol: 0.3 * v, filter: 800, filterEnd: 100 });
    },
    superReady: (v) => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.18, vol: 0.25 * v, delay: i * 0.07 })),
    superUse: (v) => {
      tone({ freq: 180, freqEnd: 900, type: 'sawtooth', dur: 0.25, vol: 0.2 * v });
      noise({ dur: 0.3, vol: 0.3 * v, filter: 500, filterEnd: 5000, kind: 'bandpass' });
    },
    victory: (v) => [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.25, vol: 0.3 * v, delay: i * 0.1 })),
  };

  return {
    play(name, volume = 1) {
      if (muted || volume <= 0.03 || !SOUNDS[name]) return;
      if (!ensure() || ctx.state !== 'running') return;
      const now = performance.now();
      if (now - (lastPlayed.get(name) || 0) < 40) return; // 40ms 안에 같은 소리는 한 번만
      lastPlayed.set(name, now);
      SOUNDS[name](Math.min(1, volume));
    },
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      try {
        localStorage.setItem('blip.muted', value ? '1' : '0');
      } catch (_) {}
      if (master) master.gain.value = muted ? 0 : 0.45;
    },
    names: Object.keys(SOUNDS),
  };
})();
