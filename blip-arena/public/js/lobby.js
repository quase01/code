/**
 * 로비 & 앱 흐름 관리 (진입점)
 *
 * 화면 흐름: 첫 화면 → (방 만들기/참가) → 대기실(캐릭터 선택) → (방장이 시작) → 게임 → 결과 → 대기실
 *
 * 캐릭터 수치는 서버와 같은 파일(/shared/characters.json)을 받아서
 * window.BlipCharacters에 넣어 둡니다. PlayerView, GameScene, HUD가 이 값을 씁니다.
 */
(async function () {
  const $ = (id) => document.getElementById(id);

  // ───────── 캐릭터/맵 데이터 불러오기 ─────────
  let MAPS;
  try {
    const [chars, maps] = await Promise.all([
      fetch('/shared/characters.json').then((r) => r.json()),
      fetch('/api/maps').then((r) => r.json()), // 서버가 shared/maps/*.json에서 읽은 맵 목록
    ]);
    window.BlipCharacters = chars.characters;
    MAPS = maps;
  } catch (err) {
    $('home-error').textContent = '게임 데이터를 불러오지 못했습니다. 새로고침해 주세요.';
    console.error(err);
    return;
  }
  const CHARACTER_IDS = Object.keys(BlipCharacters);

  const App = {
    inRoom: false,
    room: null, // 서버가 보내준 방 정보 {code, hostId, state, players: [{id, name, color, character}]}
    game: null, // Phaser.Game 인스턴스 (게임 중일 때만)
    hud: new HUD(),
    character: loadSaved('blip.character', BlipConfig.defaultCharacter),
  };
  if (!BlipCharacters[App.character]) App.character = BlipConfig.defaultCharacter;
  window.App = App; // 콘솔 디버깅용

  // ───────── PC / 모바일 자동 감지 ─────────
  // 터치가 주 입력이면 가상 조이스틱 사용 + 모바일용 HUD 배치 (body.touch)
  App.isTouch = TouchControls.isTouchDevice();
  App.touch = App.isTouch ? new TouchControls() : null;
  document.body.classList.toggle('touch', App.isTouch);

  function loadSaved(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (_) {
      return fallback; // 저장소 사용 불가 시 무시
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  // ───────── 화면 전환 ─────────
  function showScreen(name) {
    $('screen-home').hidden = name !== 'home';
    $('screen-room').hidden = name !== 'room';
  }

  function setError(where, msg) {
    $(`${where}-error`).textContent = msg || '';
  }

  // ───────── 첫 화면 ─────────
  $('nickname').value = loadSaved('blip.nickname', '');

  function getName() {
    const name = $('nickname').value.trim();
    if (!name) {
      setError('home', '닉네임을 입력해 주세요.');
      $('nickname').focus();
      return null;
    }
    save('blip.nickname', name);
    return name;
  }

  function onJoined(res) {
    if (!res || !res.ok) {
      setError('home', (res && res.error) || '요청에 실패했습니다.');
      return;
    }
    setError('home', '');
    setError('room', '');
    App.inRoom = true;
    App.room = res.room;
    renderRoom();
    if (res.game) startGame(res.game); // 진행 중인 경기에 바로 합류
    else showScreen('room');
  }

  function createRoom() {
    const name = getName();
    if (name) Net.emit('createRoom', { name, character: App.character }, onJoined);
  }

  function joinRoom() {
    const name = getName();
    if (!name) return;
    const code = $('room-code').value.trim();
    if (!/^\d{4}$/.test(code)) {
      setError('home', '방 코드는 숫자 4자리입니다.');
      return;
    }
    Net.emit('joinRoom', { name, code, character: App.character }, onJoined);
  }

  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('nickname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) createRoom();
  });
  $('room-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  $('room-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  });

  // ───────── 캐릭터 선택 ─────────
  function charIcon(charId, color, small) {
    const icon = document.createElement('span');
    icon.className = `char-icon ${charId}${small ? ' small' : ''}`;
    icon.style.setProperty('--c', toCssColor(color));
    return icon;
  }

  // 선택 카드용: 인게임과 같은 스프라이트 시트의 대기(idle) 프레임. 선택된 카드는 CSS로 움직임
  const CARD_SPRITE_H = 96; // 카드 안 그림 높이(px)
  function charPortrait(charId, color) {
    const def = PLAYER_SPRITES[charId];
    if (!def) return charIcon(charId, color);
    const s = CARD_SPRITE_H / def.frameHeight;
    const idle = def.anims.idle;
    const icon = document.createElement('span');
    icon.className = 'char-icon char-sprite';
    icon.style.setProperty('--c', toCssColor(color));
    icon.style.setProperty('--fw', `${def.frameWidth * s}px`);
    icon.style.setProperty('--fh', `${CARD_SPRITE_H}px`);
    icon.style.setProperty('--n', idle.frames.length);
    icon.style.setProperty('--dur', `${idle.frames.length / idle.fps}s`);
    const img = document.createElement('span');
    img.className = 'char-sprite-img';
    img.style.backgroundImage = `url(${def.url})`;
    // 시트는 가로 4칸. 대기 프레임은 첫 줄 0~3번이라고 가정
    img.style.backgroundSize = `${def.frameWidth * 4 * s}px auto`;
    icon.append(img);
    return icon;
  }

  function myColor() {
    const me = App.room && App.room.players.find((p) => p.id === Net.id);
    return me ? me.color : BlipConfig.colors[0];
  }

  // 카드 목록은 한 번만 만들고, 선택 상태만 갱신
  const cards = new Map();
  for (const id of CHARACTER_IDS) {
    const c = BlipCharacters[id];
    const btn = document.createElement('button');
    btn.className = 'char-card';
    btn.type = 'button';
    const name = document.createElement('span');
    name.className = 'char-name';
    name.textContent = c.name;
    const role = document.createElement('span');
    role.className = 'char-role';
    role.textContent = c.role;
    btn.append(charPortrait(id, myColor()), name, role);
    btn.addEventListener('click', () => selectCharacter(id));
    $('char-list').append(btn);
    cards.set(id, btn);
  }

  function selectCharacter(id) {
    if (App.room && App.room.state === 'playing') return;
    App.character = id;
    save('blip.character', id);
    renderCharacters();
    if (App.inRoom) {
      Net.emit('selectCharacter', { character: id }, (res) => {
        if (!res.ok) setError('room', res.error);
      });
    }
  }

  function attackSummary(a) {
    const range = a.type === 'lob' ? a.maxRange : a.range;
    const dmg = a.type === 'spread' ? `${a.damage}×${a.pellets}` : a.damage;
    const kind = { spread: '산탄', bullet: '단발', lob: '투척(벽 너머)' }[a.type] || a.type;
    return `${kind} · 데미지 ${dmg} · 사거리 ${range}`;
  }

  function renderCharacters() {
    const color = myColor();
    const locked = !!(App.room && App.room.state === 'playing');
    for (const [id, btn] of cards) {
      btn.classList.toggle('selected', id === App.character);
      btn.disabled = locked;
      btn.querySelector('.char-icon').style.setProperty('--c', toCssColor(color));
    }

    const c = BlipCharacters[App.character];
    const detail = $('char-detail');
    detail.replaceChildren();
    const desc = document.createElement('div');
    desc.textContent = c.description;
    const sup = document.createElement('div');
    const supName = document.createElement('b');
    supName.textContent = `필살기 「${c.super.name}」 `;
    sup.append(supName, document.createTextNode(c.super.description));
    const stats = document.createElement('div');
    stats.className = 'char-stats';
    for (const text of [`체력 ${c.maxHp}`, `속도 ${c.speed}`, attackSummary(c.attack), `탄약 ${c.attack.maxAmmo}칸`]) {
      const s = document.createElement('span');
      s.textContent = text;
      stats.append(s);
    }
    detail.append(desc, sup, stats);
  }

  // ───────── 맵 선택 (방장만) ─────────
  // 맵 JSON으로 작은 미리보기를 그림 (벽: 회색, 부서지는 벽: 갈색, 수풀: 초록)
  function drawMapPreview(canvas, map) {
    const ctx = canvas.getContext('2d');
    const s = Math.min(canvas.width / map.width, canvas.height / map.height);
    ctx.fillStyle = '#222838';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const fill = (rects, color) => {
      ctx.fillStyle = color;
      for (const r of rects || []) ctx.fillRect(r.x * s, r.y * s, Math.max(1, r.w * s), Math.max(1, r.h * s));
    };
    fill(map.bushes, '#2f7d46');
    fill(map.walls, '#7a86aa');
    fill(map.breakables, '#b07c47');
  }

  const mapCards = new Map();
  for (const [id, map] of Object.entries(MAPS)) {
    const btn = document.createElement('button');
    btn.className = 'map-card';
    btn.type = 'button';
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    drawMapPreview(canvas, map);
    const name = document.createElement('span');
    name.className = 'map-name';
    name.textContent = map.name;
    btn.title = map.description || '';
    btn.append(canvas, name);
    btn.addEventListener('click', () => {
      Net.emit('selectMap', { mapId: id }, (res) => {
        if (!res.ok) setError('room', res.error);
      });
    });
    $('map-list').append(btn);
    mapCards.set(id, btn);
  }

  // ───────── 모드 선택 (방장만) ─────────
  const modeCards = new Map();
  for (const [id, mode] of Object.entries(BlipConfig.modes)) {
    const btn = document.createElement('button');
    btn.className = 'mode-card';
    btn.type = 'button';
    const name = document.createElement('span');
    name.className = 'mode-name';
    name.textContent = mode.name;
    const desc = document.createElement('span');
    desc.className = 'mode-desc';
    desc.textContent = mode.description;
    btn.append(name, desc);
    btn.addEventListener('click', () => {
      Net.emit('selectMode', { mode: id }, (res) => {
        if (!res.ok) setError('room', res.error);
      });
    });
    $('mode-list').append(btn);
    modeCards.set(id, btn);
  }

  function renderModes() {
    const room = App.room;
    if (!room) return;
    const isHost = room.hostId === Net.id;
    for (const [id, btn] of modeCards) {
      btn.classList.toggle('selected', id === room.mode);
      btn.disabled = !isHost || room.state === 'playing';
    }
    $('mode-hint').textContent = isHost ? '' : '(방장이 고름)';
  }

  function renderMaps() {
    const room = App.room;
    if (!room) return;
    const isHost = room.hostId === Net.id;
    for (const [id, btn] of mapCards) {
      btn.classList.toggle('selected', id === room.mapId);
      btn.disabled = !isHost || room.state === 'playing';
    }
    const map = MAPS[room.mapId];
    $('map-hint').textContent = map ? `— ${map.name}${isHost ? '' : ' (방장이 고름)'}` : '';
  }

  // ───────── 대기실 ─────────
  function renderRoom() {
    const room = App.room;
    if (!room) return;
    const isHost = room.hostId === Net.id;
    $('room-code-display').textContent = room.code;

    // 서버가 기억하는 내 캐릭터를 기준으로 맞춤
    const me = room.players.find((p) => p.id === Net.id);
    if (me && BlipCharacters[me.character]) App.character = me.character;

    const list = $('player-list');
    list.replaceChildren(
      ...room.players.map((p) => {
        const li = document.createElement('li');
        const c = BlipCharacters[p.character];
        const name = document.createElement('span');
        name.textContent = `${p.name} — ${c ? c.name : p.character}`;
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = [p.id === room.hostId ? '방장' : '', p.id === Net.id ? '나' : ''].filter(Boolean).join(' · ');
        li.append(charIcon(p.character, p.color, true), name, tag);
        return li;
      })
    );

    // 기지전이면 일반 목록 대신 팀 나누기 화면
    const isTeams = room.mode === 'teams';
    list.hidden = isTeams;
    $('team-panel').hidden = !isTeams;
    let teamWarning = '';
    if (isTeams) {
      renderTeams(room, isHost);
      const counts = [0, 1].map((t) => room.players.filter((p) => p.team === t).length);
      if (counts[0] === 0 || counts[1] === 0 || counts[0] !== counts[1]) {
        teamWarning = ` · 두 팀 인원이 같아야 시작할 수 있어요 (지금 ${counts[0]} vs ${counts[1]})`;
      }
    }

    $('btn-start').hidden = !isHost;
    $('btn-start').disabled = room.state === 'playing';
    $('room-hint').textContent =
      room.state === 'playing'
        ? '경기가 진행 중입니다.'
        : (isHost
            ? `${room.players.length}/${room.maxPlayers}명 · 준비되면 게임 시작을 누르세요.`
            : `${room.players.length}/${room.maxPlayers}명 · 방장이 시작하기를 기다리는 중…`) + teamWarning;
    renderCharacters();
    renderMaps();
    renderModes();
  }

  // ───────── 기지전 팀 나누기 (방장만 변경) ─────────
  function renderTeams(room, isHost) {
    for (const col of document.querySelectorAll('.team-col')) {
      const team = Number(col.dataset.team);
      const members = room.players.filter((p) => p.team === team);
      const head = document.createElement('div');
      head.className = 'team-head';
      head.style.color = toCssColor(BlipConfig.teams.lobbyColors[team]);
      head.textContent = `${BlipConfig.teams.names[team]} (${members.length})`;
      const rows = members.map((p) => {
        const row = document.createElement('div');
        row.className = 'team-member' + (p.id === Net.id ? ' me' : '');
        const name = document.createElement('span');
        name.textContent = p.name + (p.id === Net.id ? ' (나)' : '');
        row.append(charIcon(p.character, p.color, true), name);
        if (isHost && room.state !== 'playing') {
          const move = document.createElement('button');
          move.type = 'button';
          move.className = 'team-move';
          move.textContent = team === 0 ? '→' : '←';
          move.title = `${BlipConfig.teams.names[1 - team]}으로 옮기기`;
          move.addEventListener('click', () => {
            Net.emit('setTeam', { playerId: p.id, team: 1 - team }, (res) => {
              if (!res.ok) setError('room', res.error);
            });
          });
          row.append(move);
        }
        return row;
      });
      col.style.borderColor = toCssColor(BlipConfig.teams.lobbyColors[team]);
      col.replaceChildren(head, ...rows);
    }
    $('btn-auto-teams').hidden = !isHost || room.state === 'playing';
  }

  $('btn-auto-teams').addEventListener('click', () => {
    Net.emit('autoTeams', {}, (res) => {
      if (!res.ok) setError('room', res.error);
    });
  });
  renderCharacters();

  $('btn-start').addEventListener('click', () => {
    Net.emit('startGame', {}, (res) => {
      if (!res.ok) setError('room', res.error);
    });
  });

  function leaveLocal() {
    App.inRoom = false;
    App.room = null;
    $('result').hidden = true;
    showScreen('home');
  }

  $('btn-leave').addEventListener('click', () => {
    Net.emit('leaveRoom');
    leaveLocal();
  });

  // ───────── 게임 시작/종료 ─────────
  function startGame(data) {
    stopGame();
    $('result').hidden = true;
    $('screen-home').hidden = true;
    $('screen-room').hidden = true;
    App.hud.show();
    // channel: 'all' 전체 / 'team' 팀 채팅 (서버가 같은 팀에게만 전달)
    App.hud.onChatSend = (text, channel) => Net.emit('chat', { text, team: channel === 'team' });

    App.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#11141c',
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene: [],
    });
    App.game.scene.add('Game', GameScene, true, {
      myId: Net.id,
      matchId: data.matchId,
      mode: data.mode,
      myTeam: (App.room && App.room.players.find((p) => p.id === Net.id) || {}).team, // 기지전 내 팀
      bases: data.bases, // 기지전 기지 위치 (서버가 정함)
      map: data.map, // 서버가 보내준 맵 원본 JSON
      boxes: data.boxes, // 배틀로얄 파워 큐브 상자 위치 (서버가 정함)
      walls: data.walls, // 부서지는 벽의 현재 내구도 (경기 중 참가 대비)
      hud: App.hud,
      touch: App.touch, // 모바일이면 가상 조이스틱, PC면 null
      lookup: (id) => {
        const p = App.room && App.room.players.find((pl) => pl.id === id);
        return p ? { name: p.name, color: p.color, team: p.team } : { name: '…', color: 0x999999 };
      },
    });
  }

  function stopGame() {
    if (App.game) {
      App.game.destroy(true);
      App.game = null;
    }
    App.hud.hide();
  }

  function showResult({ mode, ranking, teamResult }) {
    const isBR = mode === 'battleroyale';
    const isTeams = mode === 'teams';
    const winner = ranking[0];
    const mine = ranking.find((r) => r.id === Net.id);
    $('result-title').textContent = `${BlipConfig.modes[mode]?.name || ''} 결과`;
    if (isTeams && teamResult) {
      // 기지전: "1팀 승리! (상대 기지 파괴) · 우리 팀 승리"
      const names = BlipConfig.teams.names;
      const w = teamResult.winner;
      const why = teamResult.reason === 'base' ? '상대 기지 파괴' : '시간 종료 · 기지 체력 우세';
      $('result-sub').textContent =
        (w === null ? '무승부 (시간 종료 · 기지 체력 같음)' : `${names[w]} 승리! (${why})`) +
        (mine && w !== null ? ` · 우리 팀 ${mine.team === w ? '승리' : '패배'}` : '');
    } else {
      $('result-sub').textContent =
        (winner ? `${isBR ? '최후의 생존자' : '1위'}: ${winner.name}` : '') +
        (mine && mine.place ? ` · 내 순위 ${mine.place}위` : mine ? ' · 관전으로 참가' : '');
    }

    const list = $('result-list');
    list.replaceChildren(
      ...ranking.map((r) => {
        const li = document.createElement('li');
        if (r.id === Net.id) li.classList.add('me');
        const rank = document.createElement('span');
        rank.className = 'result-rank';
        if (isTeams) {
          // 팀 색 + 승리/패배
          const w = teamResult && teamResult.winner;
          rank.textContent = w === null || w === undefined ? '무' : r.team === w ? '승' : '패';
          rank.style.color = toCssColor(BlipConfig.teams.lobbyColors[r.team]);
          li.title = BlipConfig.teams.names[r.team];
        } else {
          rank.textContent = r.place ? `${r.place}위` : '관전';
        }
        const name = document.createElement('span');
        name.textContent = r.name + (r.id === Net.id ? ' (나)' : '');
        const score = document.createElement('span');
        score.className = 'tag';
        // 배틀로얄은 데스가 0 아니면 1이라 킬만 표시
        score.textContent = isBR ? `${r.kills}킬` : `${r.kills}킬 / ${r.deaths}데스`;
        li.append(rank, charIcon(r.character, r.color, true), name, score);
        return li;
      })
    );
    showScreen('room');
    $('result').hidden = false;
  }

  $('btn-result-ok').addEventListener('click', () => {
    $('result').hidden = true;
  });

  // ───────── 서버 메시지 ─────────
  Net.on('roomUpdate', (room) => {
    if (!App.inRoom || !App.room || room.code !== App.room.code) return;
    App.room = room;
    renderRoom();
  });

  Net.on('gameStart', (data) => {
    if (App.inRoom) startGame(data);
  });

  Net.on('matchEnd', (data) => {
    if (!App.inRoom) return;
    stopGame();
    showResult(data);
    // 이겼으면(1위 또는 이긴 팀) 승리 효과음
    const mine = data.ranking.find((r) => r.id === Net.id);
    if (mine && mine.place === 1) Sound.play('victory', 1);
  });

  Net.on('chat', (msg) => App.hud.addChat(msg));
  Net.on('kill', (k) => App.hud.addKill(k, Net.id));
  Net.on('playerLeft', ({ name }) => App.hud.addChat({ system: true, text: `${name} 님이 나갔습니다.` }));

  Net.onDisconnect(() => {
    stopGame();
    leaveLocal();
    setError('home', '서버와 연결이 끊어졌습니다. 서버가 켜져 있는지 확인해 주세요.');
  });
})();
