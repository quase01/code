/**
 * 인게임 HUD (HTML 오버레이)
 * - 상단 중앙: 남은 시간
 * - 우측 상단: 킬 순위표
 * - 하단 중앙: 킬 로그
 * - 좌측 하단: 채팅 (Enter로 열고/보내기, Esc로 취소)
 * - 좌측 상단: 핑/디버그 정보
 * 텍스트는 전부 textContent로 넣어서, 닉네임/채팅에 HTML을 넣어도 실행되지 않습니다.
 */

// 정수 색상(0xff6b6b) → CSS 색상('#ff6b6b')
function toCssColor(c) {
  return '#' + (c >>> 0).toString(16).padStart(6, '0');
}

// 한국어 조사 고르기: 받침 있으면 batchim, 없으면 noBatchim ("철수가" / "민준이")
function josa(word, batchim, noBatchim) {
  const code = word.charCodeAt(word.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? batchim : noBatchim;
  return noBatchim;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('hud'),
      timer: $('timer'),
      board: $('scoreboard'),
      killfeed: $('killfeed'),
      chatLog: $('chat-log'),
      chatInput: $('chat-input'),
      respawn: $('respawn'),
      netinfo: $('netinfo'),
      myChar: $('my-char'),
      superBar: $('super-bar'),
      superFill: $('super-fill'),
      superLabel: $('super-label'),
      spectate: $('spectate'),
      myStatus: $('mystatus'),
      teamBar: $('team-bar'),
      tbAlly: $('tb-ally'),
      tbEnemy: $('tb-enemy'),
      tbTime: $('tb-time'),
      teamChatHint: $('team-chat-hint'),
      hurt: $('hurt-overlay'),
      killBanner: $('kill-banner'),
      soundBtn: $('btn-sound'),
      chatBtn: $('btn-chat'),
      teamChatBtn: $('btn-team-chat'),
      chatSend: $('chat-send'),
      gasWarning: $('gas-warning'),
    };
    this.spectateText = null;
    this.statusKey = '';
    this.active = false;
    this.chatting = false; // true인 동안 GameScene은 이동/발사 입력을 보내지 않음
    this.onChatSend = null; // (text, channel) => void   channel: 'all' | 'team'
    this.chatChannel = 'all';
    this.teamChatEnabled = false; // 기지전에서만 true (T키 / Tab 전환 사용 가능)
    this.teamKey = '';
    this.onChatToggle = null; // (open) => void
    this.boardKey = '';
    this.timerText = '';

    window.addEventListener('keydown', (e) => this.handleKey(e));
    this.el.chatInput.addEventListener('blur', () => {
      if (this.chatting) this.closeChat();
    });

    // 소리 켬/끔 (설정은 브라우저에 저장)
    const updateSoundBtn = () => (this.el.soundBtn.textContent = Sound.muted ? '소리 끔' : '소리 켬');
    updateSoundBtn();
    this.el.soundBtn.addEventListener('click', () => {
      Sound.setMuted(!Sound.muted);
      updateSoundBtn();
      this.el.soundBtn.blur(); // 포커스가 남으면 스페이스/엔터가 버튼을 누름
    });

    // 모바일 채팅 버튼들. pointerdown + preventDefault: 입력창 포커스가 먼저 빠지지 않게
    const tapButton = (btn, fn) =>
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fn();
      });
    tapButton(this.el.chatBtn, () => (this.chatting ? this.closeChat() : this.openChat('all')));
    tapButton(this.el.teamChatBtn, () => (this.chatting ? this.closeChat() : this.openChat('team')));
    tapButton(this.el.chatSend, () => this.sendChat());
  }

  sendChat() {
    const text = this.el.chatInput.value.trim();
    if (text && this.onChatSend) this.onChatSend(text, this.chatChannel);
    this.closeChat();
  }

  /** 내가 맞았을 때 화면 가장자리 붉은 번쩍임 (strength 0~1) */
  hurtFlash(strength) {
    const el = this.el.hurt;
    // 순간적으로 켰다가 CSS transition으로 서서히 사라지게
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(1, 0.35 + strength));
    void el.offsetWidth; // 스타일 즉시 적용
    el.style.transition = '';
    el.style.opacity = '0';
  }

  /** 킬 연출 배너. kind: 'kill' (내가 처치) | 'death' (내가 당함) */
  showKillBanner(main, sub, kind) {
    const b = this.el.killBanner;
    b.hidden = false;
    b.className = kind === 'death' ? 'death' : '';
    b.querySelector('.kb-main').textContent = main;
    b.querySelector('.kb-sub').textContent = sub;
    // 같은 배너가 연달아 떠도 튀어나오는 애니메이션이 다시 재생되게
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this.killBannerTimer);
    this.killBannerTimer = setTimeout(() => (b.hidden = true), 1800);
  }

  handleKey(e) {
    if (!this.active) return;
    // 한글 입력 조합 중의 Enter는 무시 (안 그러면 마지막 글자가 잘리거나 두 번 전송됨)
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (!this.chatting) this.openChat('all');
      else this.sendChat();
    } else if (e.key === 'Escape' && this.chatting) {
      e.preventDefault();
      this.closeChat();
    } else if (!this.chatting && this.teamChatEnabled && e.code === 'KeyT') {
      // T: 팀 채팅 열기 (e.code라서 한글 입력 상태여도 동작)
      e.preventDefault();
      this.openChat('team');
    } else if (this.chatting && this.teamChatEnabled && e.key === 'Tab') {
      // 채팅 중 Tab: 전체 ↔ 팀 전환
      e.preventDefault();
      this.setChatChannel(this.chatChannel === 'team' ? 'all' : 'team');
    }
  }

  setChatChannel(channel) {
    this.chatChannel = channel;
    const input = this.el.chatInput;
    input.classList.toggle('team', channel === 'team');
    if (!this.teamChatEnabled) input.placeholder = '메시지 입력 후 Enter (Esc 취소)';
    else if (channel === 'team') input.placeholder = '[팀] 팀원에게만 보입니다 · Tab: 전체 채팅으로';
    else input.placeholder = '[전체] 모두에게 보입니다 · Tab: 팀 채팅으로';
  }

  openChat(channel = 'all') {
    this.chatting = true;
    this.setChatChannel(this.teamChatEnabled ? channel : 'all');
    this.el.root.classList.add('chatting');
    this.el.chatInput.value = '';
    this.el.chatInput.hidden = false;
    this.el.chatSend.hidden = false;
    this.el.chatInput.focus();
    if (this.onChatToggle) this.onChatToggle(true);
  }

  closeChat() {
    this.chatting = false;
    this.el.root.classList.remove('chatting');
    this.el.chatInput.value = '';
    this.el.chatInput.hidden = true;
    this.el.chatSend.hidden = true;
    this.el.chatInput.blur();
    if (this.onChatToggle) this.onChatToggle(false);
  }

  show() {
    this.el.root.hidden = false;
    this.active = true;
    this.el.killfeed.replaceChildren();
    this.el.board.replaceChildren();
    this.boardKey = '';
    this.timerText = '';
    this.statusKey = '';
    this.spectateText = null;
    this.teamKey = '';
    this.setRespawn(null);
    this.setSpectate(null);
    this.setGasWarning(false);
    this.setTeamMode(false);
  }

  // 기지전 여부: 상단 기지 체력바, 팀 채팅 사용
  setTeamMode(on) {
    this.teamChatEnabled = on;
    this.el.teamBar.hidden = !on;
    this.el.timer.hidden = on;
    this.el.teamChatHint.hidden = !on;
    this.el.teamChatBtn.hidden = !on;
  }

  /** 기지전 상단: 우리 기지 / 남은 시간 / 적 기지 */
  setTeamInfo(timeLeftMs, allyHp, allyMax, enemyHp, enemyMax) {
    const total = Math.ceil(timeLeftMs / 1000);
    const time = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    const key = `${time}|${allyHp}|${enemyHp}`;
    if (key === this.teamKey) return;
    this.teamKey = key;
    this.el.tbTime.textContent = time;
    this.el.tbTime.classList.toggle('urgent', total <= 30);
    this.el.tbAlly.style.width = `${(100 * Math.max(0, allyHp)) / allyMax}%`;
    this.el.tbEnemy.style.width = `${(100 * Math.max(0, enemyHp)) / enemyMax}%`;
    this.el.tbAlly.parentElement.title = `${allyHp} / ${allyMax}`;
    this.el.tbEnemy.parentElement.title = `${enemyHp} / ${enemyMax}`;
  }

  /** 하단 중앙: 내 캐릭터, 체력, 필살기 게이지 (maxHp, cubes는 배틀로얄 파워 큐브 반영) */
  setMyStatus(charId, hp, superCharge, inBush, maxHp, cubes) {
    const c = BlipCharacters[charId];
    const max = maxHp || c.maxHp;
    const pct = Math.floor(Math.min(1, superCharge) * 100);
    const key = `${charId}:${hp}:${max}:${pct}:${inBush}:${cubes}`;
    if (key === this.statusKey) return;
    this.statusKey = key;

    const ready = superCharge >= 1;
    this.el.myChar.textContent =
      `${c.name} (${c.role}) · 체력 ${hp}/${max}` +
      (cubes ? ` · 파워 큐브 ${cubes}개 (공격력 +${Math.round(cubes * BlipConfig.battleRoyale.cubeDamageBonus * 100)}%)` : '') +
      (inBush ? ' · 수풀 속 (공격하면 들킴)' : '');
    this.el.superFill.style.width = `${pct}%`;
    this.el.superBar.classList.toggle('ready', ready);
    this.el.superLabel.textContent = ready
      ? `${c.super.name} 준비! [E / 우클릭]`
      : `${c.super.name} ${pct}%`;
  }

  hide() {
    if (this.chatting) this.closeChat();
    this.active = false;
    this.el.root.hidden = true;
    this.el.killBanner.hidden = true;
  }

  setTimer(ms) {
    const total = Math.ceil(ms / 1000);
    const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    if (text === this.timerText) return;
    this.timerText = text;
    this.el.timer.textContent = text;
    this.el.timer.classList.toggle('urgent', total <= 10);
  }

  /** 배틀로얄 상단: "생존 N명 · 독가스 0:12 후" / "독가스 좁혀지는 중" */
  setBattleRoyaleInfo(aliveCount, gas) {
    let text = `생존 ${aliveCount}명`;
    let urgent = false;
    if (gas) {
      if (!gas.active) {
        const s = Math.ceil(gas.startsIn / 1000);
        text += ` · 독가스 ${s}초 후`;
        urgent = s <= 5;
      } else {
        text += ' · 독가스 좁혀지는 중';
        urgent = true;
      }
    }
    if (text === this.timerText) return;
    this.timerText = text;
    this.el.timer.textContent = text;
    this.el.timer.classList.toggle('urgent', urgent);
  }

  // 배틀로얄 탈락 후 관전 안내 (null이면 숨김)
  setSpectate(name) {
    const text = name === null ? null : `탈락! 관전 중: ${name || '…'}   ← → 또는 클릭으로 다른 사람 보기`;
    if (text === this.spectateText) return;
    this.spectateText = text;
    this.el.spectate.hidden = text === null;
    this.el.myStatus.hidden = text !== null; // 관전 중엔 내 체력/필살기 표시 숨김
    if (text !== null) this.el.spectate.textContent = text;
  }

  setGasWarning(on) {
    if (this.el.gasWarning.hidden === !on) return;
    this.el.gasWarning.hidden = !on;
  }

  /**
   * rows: [{id, name, color, kills, deaths, out, relation}] — 이미 정렬된 상태
   * out = 배틀로얄 탈락, relation = 기지전에서 'ally' | 'enemy'
   */
  setScoreboard(rows, myId) {
    const key = rows.map((r) => `${r.id}:${r.name}:${r.kills}:${r.out}:${r.relation}`).join('|');
    if (key === this.boardKey) return; // 바뀐 게 없으면 DOM 갱신 생략
    this.boardKey = key;

    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const row = el(
        'div',
        'sb-row' + (r.id === myId ? ' me' : '') + (r.out ? ' out' : '') + (r.relation ? ` ${r.relation}` : '')
      );
      row.append(el('span', 'sb-rank', String(i + 1)));
      const dot = el('span', 'dot');
      dot.style.background = toCssColor(r.color);
      row.append(dot, el('span', 'sb-name', r.name), el('span', 'sb-kills', `${r.kills}킬`));
      frag.append(row);
    });
    this.el.board.replaceChildren(frag);
  }

  /** "A가 B를 처치" */
  addKill(k, myId) {
    const item = el('div', 'kf-item');
    if (k.killerId === myId || k.victimId === myId) item.classList.add('me');

    const killer = el('span', 'kf-name', k.killerName);
    killer.style.color = toCssColor(k.killerColor);
    const victim = el('span', 'kf-name', k.victimName);
    victim.style.color = toCssColor(k.victimColor);

    item.append(
      killer,
      document.createTextNode(`${josa(k.killerName, '이', '가')} `),
      victim,
      document.createTextNode(`${josa(k.victimName, '을', '를')} 처치`)
    );
    this.el.killfeed.append(item);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
    setTimeout(() => item.remove(), 5000);
  }

  /** msg: {name, color, text, team?} 또는 {system: true, text}. team이면 팀 채팅 */
  addChat(msg) {
    const line = el('div', 'chat-line' + (msg.system ? ' system' : '') + (msg.team ? ' team' : ''));
    if (msg.system) {
      line.textContent = msg.text;
    } else {
      const name = el('span', 'chat-name', msg.name);
      name.style.color = toCssColor(msg.color);
      if (msg.team) line.append(el('span', 'chat-tag', '[팀] '));
      line.append(name, document.createTextNode(`: ${msg.text}`));
    }
    this.el.chatLog.append(line);
    while (this.el.chatLog.children.length > 8) this.el.chatLog.firstChild.remove();
  }

  setRespawn(ms) {
    if (ms == null) {
      this.el.respawn.hidden = true;
      return;
    }
    this.el.respawn.hidden = false;
    this.el.respawn.textContent = `${Math.max(1, Math.ceil(ms / 1000))}초 후 부활`;
  }

  setNetInfo(text) {
    if (this.el.netinfo.textContent !== text) this.el.netinfo.textContent = text;
  }
}
