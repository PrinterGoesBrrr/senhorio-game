// Senhorio — cliente. O servidor é a autoridade: aqui só se desenha o estado
// recebido e se enviam as jogadas e as respostas aos pedidos.

const $ = (s) => document.querySelector(s);
function h(tag, cls = '', text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let ws = null;
let state = null;
let identity = { room: null, token: null, playerId: null };
let reconnectDelay = 500;

// ---------------------------------------------------------------- ligação

function connect(onOpen) {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    if (onOpen && ws.readyState === WebSocket.OPEN) onOpen();
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    reconnectDelay = 500;
    if (onOpen) onOpen();
    else if (identity.room) {
      ws.send(JSON.stringify({ type: 'join', room: identity.room, token: identity.token, name: savedName() }));
    }
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'joined') {
      identity = { room: msg.room, token: msg.token, playerId: msg.playerId };
      localStorage.setItem('senhorio:session', JSON.stringify(identity));
      history.replaceState(null, '', `#${msg.room}`);
    } else if (msg.type === 'left') {
      backToGate();
    } else if (msg.type === 'state') {
      state = msg.state;
      render();
    } else if (msg.type === 'error') {
      if (!state) {
        showGateError(msg.message);
        // A sessão guardada já não serve (sala apagada, por exemplo).
        if (identity.room) {
          localStorage.removeItem('senhorio:session');
          identity = { room: null, token: null, playerId: null };
          history.replaceState(null, '', location.pathname);
        }
      } else {
        toast(msg.message);
        // Um pedido recusado volta a abrir-se para o jogador corrigir.
        if (shownPrompt) { shownPrompt = null; render(); }
      }
    }
  };

  ws.onclose = () => {
    if (state) $('#turn-info').textContent = 'Ligação perdida. A tentar de novo…';
    setTimeout(() => connect(), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
}

function act(action, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return toast('Sem ligação ao servidor.');
  ws.send(JSON.stringify({ type: 'action', action, payload: payload || {} }));
  return undefined;
}

function savedName() {
  return localStorage.getItem('senhorio:name') || 'Senhorio Novato';
}

function backToGate() {
  localStorage.removeItem('senhorio:session');
  identity = { room: null, token: null, playerId: null };
  state = null;
  history.replaceState(null, '', location.pathname);
  closeModal();
  showScreen('gate');
}

// ---------------------------------------------------------------- entrada

function showGateError(text) {
  const el = $('#gate-error');
  el.textContent = text;
  el.hidden = false;
}

function typedName() {
  const name = $('#name-input').value.trim() || 'Senhorio Novato';
  localStorage.setItem('senhorio:name', name);
  return name;
}

$('#create-btn').onclick = () => {
  const name = typedName();
  connect(() => ws.send(JSON.stringify({ type: 'create', name })));
};

$('#join-btn').onclick = () => {
  const room = $('#room-input').value.trim().toUpperCase();
  if (room.length !== 4) return showGateError('O código da mesa tem quatro caracteres.');
  const name = typedName();
  connect(() => ws.send(JSON.stringify({ type: 'join', room, name })));
  return undefined;
};

$('#room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join-btn').click(); });

$('#room-chip').onclick = async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${identity.room}`);
    toast('Link da mesa copiado.');
  } catch {
    toast(`Código da mesa: ${identity.room}`);
  }
};

$('#leave-btn').onclick = async () => {
  const playing = state && state.phase === 'play';
  const ok = await UI.choice('Sair da mesa', playing
    ? 'Tens a certeza? Um bot fica com o teu lugar e o teu património até ao fim do jogo.'
    : 'Tens a certeza que queres sair da mesa?', [
    { label: 'Sair da mesa', value: true, primary: true },
    { label: 'Ficar', value: false },
  ], { cancelable: false });
  if (!ok) return;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'leave' }));
  backToGate();
};

$('#restart-btn').onclick = async () => {
  const ok = await UI.choice('Novo jogo', 'Voltar à sala de espera com os jogadores atuais? A partida em curso perde-se.', [
    { label: 'Recomeçar', value: true, primary: true },
    { label: 'Cancelar', value: false },
  ], { cancelable: false });
  if (ok) act('restart');
};

$('#end-turn').onclick = () => { if (state && state.isMyTurn) act('endTurn'); };

$('#rules-btn').onclick = () => {
  if (!$('#modal').hidden) return;
  UI.modal((box, close) => {
    box.append($('#rules-tpl').content.cloneNode(true));
    const ok = h('button', 'btn primary', 'Percebi');
    ok.onclick = () => close();
    box.append(ok);
  });
};

(function boot() {
  $('#name-input').value = localStorage.getItem('senhorio:name') || '';
  const hash = location.hash.replace('#', '').toUpperCase();
  const saved = JSON.parse(localStorage.getItem('senhorio:session') || 'null');
  if (saved && saved.room && (!hash || hash === saved.room)) {
    identity = saved;
    connect();
  } else if (hash.length === 4) {
    $('#room-input').value = hash;
  }
})();

// ---------------------------------------------------------------- estado

const myId = () => identity.playerId;
const playerById = (id) => state.players.find((p) => p.id === id);
const mePublic = () => playerById(myId());
const opponents = () => {
  // Pela ordem da mesa, a começar em quem joga a seguir a mim.
  const i = state.players.findIndex((p) => p.id === myId());
  return [...state.players.slice(i + 1), ...state.players.slice(0, Math.max(0, i))];
};
const isHost = () => state.hostId === myId();

function showScreen(name) {
  for (const s of ['gate', 'lobby', 'game']) $(`#${s}`).hidden = s !== name;
  const inRoom = name !== 'gate';
  $('#room-chip').hidden = !inRoom;
  $('#leave-btn').hidden = !inRoom;
  if (!inRoom) $('#restart-btn').hidden = true;
}

let shownPrompt = null; // seq do pedido do servidor aberto no ecrã
let endShown = false;
let wasMyTurn = false;
const baseTitle = document.title;

function render() {
  if (!state) return;
  window.__s = state;
  $('#room-code').textContent = state.room || identity.room || '----';
  $('#restart-btn').hidden = !isHost() || state.phase === 'lobby';

  if (state.phase === 'lobby') {
    showScreen('lobby');
    renderLobby();
    if (modalKind === 'prompt' || modalKind === 'end') closeModal();
    endShown = false;
    shownPrompt = null;
    return;
  }

  showScreen('game');
  UI.render();
  syncPrompt();

  if (state.isMyTurn && !wasMyTurn) document.title = '🔔 É a tua vez — Senhorio';
  if (!state.isMyTurn) document.title = baseTitle;
  wasMyTurn = state.isMyTurn;

  if (state.phase === 'over' && !endShown) {
    endShown = true;
    UI.showWinner();
  }
}

function renderLobby() {
  $('#lobby-code').textContent = state.room || identity.room;
  $('#lobby-players').replaceChildren(...state.players.map((p) => {
    const row = h('div', 'lobby-row' + (p.connected ? '' : ' offline'));
    const tags = [];
    if (p.id === myId()) tags.push('tu');
    if (p.id === state.hostId) tags.push('anfitrião');
    if (p.bot) tags.push('bot');
    if (!p.connected) tags.push('desligado');
    row.append(h('span', 'avatar', p.avatar), h('b', '', p.name));
    if (tags.length) row.append(h('small', '', tags.join(' · ')));
    if (p.bot && isHost()) {
      const x = h('button', 'bot-remove', '×');
      x.title = `Tirar ${p.name} da mesa`;
      x.setAttribute('aria-label', x.title);
      x.onclick = () => act('removeBot', { bot: p.id });
      row.append(x);
    }
    return row;
  }));

  const box = $('#lobby-controls');
  box.replaceChildren();
  if (isHost()) {
    const full = state.players.length >= 5;
    const add = h('button', 'btn', full ? 'A mesa está cheia' : '🤖 Adicionar bot');
    add.disabled = full;
    add.onclick = () => act('addBot');
    const start = h('button', 'btn primary big', 'Começar a especular');
    start.disabled = state.players.length < 2;
    start.onclick = () => act('start');
    box.append(add, start);
    if (state.players.length < 2) box.append(h('p', 'fineprint', 'São precisos pelo menos 2 jogadores. Junta um bot ou espera por um amigo.'));
  } else {
    box.append(h('p', 'fineprint', 'À espera que o anfitrião comece o jogo…'));
  }
}

// Pedidos do servidor dirigidos a mim: pagar, descartar, Providência Cautelar.
function syncPrompt() {
  const q = state.pending && state.pending.playerId === myId() ? state.pending : null;
  if (!q) {
    if (modalKind === 'prompt') closeModal();
    shownPrompt = null;
    return;
  }
  if (shownPrompt === q.seq) return;
  closeModal();
  shownPrompt = q.seq;
  UI.prompt(q);
}

// ---------------------------------------------------------------- modais

let modalKind = null; // null | 'local' | 'prompt' | 'end'
let modalClose = null;

function closeModal() {
  if (modalClose) modalClose(null);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

const UI = {
  // ---- Renderização ----

  render() {
    this.renderOpponents();
    this.renderCenter();
    this.renderMe();
    this.renderLog();
  },

  renderOpponents() {
    $('#opponents').replaceChildren(...opponents().map((o) => {
      const active = state.current === o.id && state.phase === 'play';
      const el = h('div', 'opp' + (active ? ' active' : '') + (o.connected ? '' : ' offline'));
      const head = h('div', 'opp-head');
      head.append(h('span', 'avatar', o.avatar), h('b', '', o.name));
      const tags = [o.bot ? 'bot' : '', o.connected ? '' : 'desligado'].filter(Boolean);
      if (tags.length) head.append(h('small', 'tag', tags.join(' · ')));
      const stats = h('div', 'opp-stats', `🃏 ${o.handCount}  ·  💰 ${bankTotal(o)}M€  ·  🏘️ ${completeColors(o).size}/3`);
      const piles = h('div', 'piles');
      const list = getPiles(o);
      if (list.length) piles.append(...list.map((x) => this.pileEl(x, false)));
      else piles.append(h('div', 'empty', 'Ainda sem imóveis'));
      el.append(head, stats, piles);
      return el;
    }));
  },

  turnText() {
    if (state.phase === 'over') return 'Fim do jogo';
    if (state.isMyTurn) return 'É a tua vez!';
    const q = state.pending;
    if (q && q.playerId === myId()) return 'Tens uma decisão a tomar…';
    if (q) {
      const who = playerById(q.playerId);
      const what = { pay: 'a pagar', discard: 'a descartar', jsn: 'a pensar numa Providência Cautelar' }[q.kind] || 'a decidir';
      return `À espera de ${who.avatar} ${who.name} (${what})…`;
    }
    const cur = playerById(state.current);
    if (!cur) return '';
    if (cur.id === myId()) return 'A jogada está a decorrer…';
    return `Vez de ${cur.avatar} ${cur.name}…${cur.connected ? '' : ' (desligado, à espera que volte)'}`;
  },

  renderCenter() {
    const mine = state.current === myId() && state.phase === 'play';
    $('#deck-count').textContent = `${state.deckCount} cartas`;
    const top = state.discardTop;
    $('#discard-top').replaceChildren(top ? this.cardEl(top) : h('div', 'card placeholder', 'vazio'));
    $('#turn-info').textContent = this.turnText();
    const left = Math.max(0, state.playsLeft);
    $('#plays').textContent = mine ? `${'●'.repeat(left)}${'○'.repeat(Math.max(0, 3 - left))}  jogadas restantes` : '';
    $('#end-turn').disabled = !state.isMyTurn;
  },

  renderMe() {
    const me = mePublic();
    if (!me) return;
    const hand = state.me ? state.me.hand : [];
    $('#me-head').textContent = `${me.avatar} ${me.name}  ·  🏘️ ${completeColors(me).size}/3 conjuntos completos (precisas de 3 cores diferentes)`;
    const piles = getPiles(me);
    $('#my-props').replaceChildren(...(piles.length ? piles.map((x) => this.pileEl(x, true)) : [h('div', 'empty', 'Ainda não tens imóveis. Ao contrário dos fundos de investimento.')]));
    $('#bank-total').textContent = `${bankTotal(me)}M€`;
    $('#my-bank').replaceChildren(...me.bank.map((c) => this.chipEl(c)));
    $('#my-hand').replaceChildren(...hand.map((c) => {
      const el = this.cardEl(c);
      if (state.isMyTurn) el.classList.add('playable');
      el.onclick = () => this.onHandClick(c);
      return el;
    }));
  },

  renderLog() {
    const log = $('#log');
    const last = state.log[state.log.length - 1];
    if (last && log.dataset.last === String(last.n)) return;
    log.dataset.last = last ? String(last.n) : '';
    log.replaceChildren(...[...state.log].reverse().map((l) => h('div', `log-line ${l.kind}`, l.text)));
  },

  cardBg(card) {
    if (card.type === 'property') return COLORS[card.color].hex;
    if (card.type === 'wild' || card.type === 'rent') {
      if (card.multi) return `linear-gradient(90deg, ${COLOR_KEYS.map((k) => COLORS[k].hex).join(', ')})`;
      return `linear-gradient(90deg, ${COLORS[card.colors[0]].hex} 50%, ${COLORS[card.colors[1]].hex} 50%)`;
    }
    if (card.type === 'money') return '#3d8b4f';
    return '#5b3f8c';
  },

  cardEl(card) {
    const el = h('div', `card ${card.type}`);
    el.title = `${card.name}: ${card.desc}`;
    const top = h('div', 'card-top');
    top.style.background = this.cardBg(card);
    if (card.type === 'property') top.style.color = COLORS[card.color].text;
    const kind = {
      money: 'DINHEIRO',
      property: COLORS[card.color]?.name,
      wild: card.multi ? 'CURINGA TOTAL' : 'CURINGA',
      rent: card.multi ? 'RENDA LIVRE' : 'RENDA',
      action: 'AÇÃO',
    }[card.type];
    top.append(h('span', 'kind', kind));
    if (card.value) top.append(h('span', 'value', `${card.value}M€`));
    el.append(top, h('div', 'name', card.name));
    if (card.icon) el.append(h('div', 'icon', card.icon));
    if (card.type === 'money') el.append(h('div', 'big-money', `${card.value}M€`));
    if (card.type === 'property') {
      const t = h('div', 'rent-table');
      COLORS[card.color].rent.forEach((r, i) => t.append(h('div', '', `${i + 1} 🏠 → ${r}M€`)));
      el.append(t);
    }
    el.append(h('div', 'desc', card.desc));
    return el;
  },

  miniEl(card) {
    const el = h('div', 'mini' + (card.type === 'wild' ? ' wild' : ''), card.name);
    el.style.setProperty('--c', COLORS[card.curColor].hex);
    el.title = `${card.name}: ${card.desc}`;
    return el;
  },

  chipEl(card) {
    const el = h('div', `chip ${card.type}`, `${card.value}M€`);
    el.title = card.name;
    return el;
  },

  pileEl(pile, interactive) {
    const c = COLORS[pile.color];
    const el = h('div', 'pile' + (pile.complete ? ' complete' : ''));
    el.style.setProperty('--c', c.hex);
    const label = h('div', 'pile-label');
    label.append(
      h('b', '', `${c.name} ${pile.cards.length}/${c.size}${pile.house ? ' 🔨' : ''}${pile.hotel ? ' 🧳' : ''}`),
      h('span', '', `renda ${pileRent(pile)}M€`),
    );
    el.append(label);
    for (const card of pile.cards) {
      const m = this.miniEl(card);
      if (interactive && card.type === 'wild') {
        m.classList.add('clickable');
        m.onclick = () => this.onWildClick(card);
      }
      el.append(m);
    }
    return el;
  },

  // ---- Modais ----

  modal(build, kind = 'local') {
    // Um pedido do servidor tapado por outro modal volta a abrir-se a seguir.
    if (modalKind === 'prompt') shownPrompt = null;
    closeModal();
    return new Promise((resolve) => {
      const ov = $('#modal');
      ov.replaceChildren();
      const box = h('div', 'modal-box');
      ov.append(box);
      ov.hidden = false;
      modalKind = kind;
      const close = (v) => {
        if (modalClose !== close) return;
        modalClose = null;
        modalKind = null;
        ov.hidden = true;
        ov.replaceChildren();
        resolve(v);
        if (kind !== 'prompt' && state && state.phase !== 'lobby') setTimeout(syncPrompt);
      };
      modalClose = close;
      build(box, close);
    });
  },

  choice(title, text, options, { cancelable = true, card = null, kind = 'local' } = {}) {
    return this.modal((box, close) => {
      box.append(h('h3', '', title));
      if (card) box.append(this.cardEl(card));
      if (text) box.append(h('p', '', text));
      const list = h('div', 'options');
      for (const o of options) {
        const b = h('button', 'btn' + (o.primary ? ' primary' : ''), o.label);
        b.disabled = !!o.disabled;
        b.onclick = () => close(o.value);
        list.append(b);
      }
      if (cancelable) {
        const b = h('button', 'btn ghost', 'Cancelar');
        b.onclick = () => close(null);
        list.append(b);
      }
      box.append(list);
    }, kind);
  },

  selectCards({ title, subtitle, items, validate, status, single = false, cancelable = false, confirmLabel = 'Confirmar', kind = 'local' }) {
    return this.modal((box, close) => {
      const sel = new Set();
      const picked = () => items.filter((i) => sel.has(i)).map((i) => i.card);
      box.append(h('h3', '', title));
      if (subtitle) box.append(h('p', 'sub', subtitle));
      const grid = h('div', 'select-grid');
      const st = h('div', 'status');
      const ok = h('button', 'btn primary', confirmLabel);
      const refresh = () => {
        ok.disabled = !validate(picked());
        st.textContent = status ? status(picked()) : '';
      };
      for (const it of items) {
        const wrap = h('div', 'select-item');
        wrap.append(this.cardEl(it.card));
        if (it.label) wrap.append(h('div', 'select-label', it.label));
        wrap.onclick = () => {
          if (single) {
            sel.clear();
            grid.querySelectorAll('.selected').forEach((e) => e.classList.remove('selected'));
          }
          if (sel.has(it)) { sel.delete(it); wrap.classList.remove('selected'); } else { sel.add(it); wrap.classList.add('selected'); }
          refresh();
        };
        grid.append(wrap);
      }
      const btns = h('div', 'options');
      ok.onclick = () => close(picked());
      btns.append(ok);
      if (cancelable) {
        const c = h('button', 'btn ghost', 'Cancelar');
        c.onclick = () => close(null);
        btns.append(c);
      }
      box.append(grid, st, btns);
      refresh();
    }, kind);
  },

  pickOpponent(title) {
    return this.choice(title, '', opponents().map((o) => ({
      label: `${o.avatar} ${o.name} (${assetsTotal(o)}M€ em ativos)`,
      value: o,
    })));
  },

  // ---- Pedidos do servidor ----

  async prompt(q) {
    const me = mePublic();
    const ids = (cards) => cards.map((c) => c.id);
    if (q.kind === 'discard') {
      const cards = await this.selectCards({
        kind: 'prompt',
        title: `Mão cheia! Descarta ${q.n} carta(s)`,
        subtitle: 'Máximo de 7 cartas na mão. Nem os senhorios podem ter tudo.',
        items: state.me.hand.map((card) => ({ card })),
        validate: (s) => s.length === q.n,
        status: (s) => `${s.length}/${q.n} selecionadas`,
        confirmLabel: 'Descartar',
      });
      if (cards) act('respond', { cards: ids(cards) });
    } else if (q.kind === 'pay') {
      const to = playerById(q.to);
      const where = (c) => (me.bank.some((x) => x.id === c.id) ? 'Banco' : me.improvements.some((x) => x.id === c.id) ? 'Remodelação' : `🏠 ${COLORS[c.curColor].name}`);
      const cards = await this.selectCards({
        kind: 'prompt',
        title: `Tens de pagar ${q.amount}M€ a ${to.avatar} ${to.name}`,
        subtitle: 'Escolhe do teu banco e/ou propriedades. Não há troco: é o mercado a funcionar.',
        items: payableItems(me).map((card) => ({ card, label: where(card) })),
        validate: (s) => sum(s) >= q.amount,
        status: (s) => `Selecionado: ${sum(s)}M€ de ${q.amount}M€`,
        confirmLabel: 'Pagar 😭',
      });
      if (cards) act('respond', { cards: ids(cards) });
    } else if (q.kind === 'jsn') {
      const accept = await this.choice('⚖️ Providência Cautelar', q.text, [
        { label: 'Sim, para tribunal!', value: true, primary: true },
        { label: 'Não', value: false },
      ], { cancelable: false, kind: 'prompt' });
      if (accept !== null) act('respond', { accept });
    }
  },

  // ---- Jogadas ----

  onHandClick(card) {
    if (!state.isMyTurn) return;
    if (state.playsLeft <= 0) { this.toastNoPlays(); return; }
    const options = this.handOptions(card);
    this.choice(card.name, '', options.map((o) => ({ label: o.label, value: o, disabled: !o.run })), { card })
      .then((chosen) => chosen && chosen.run());
  },

  toastNoPlays() { toast('Já fizeste 3 jogadas. Termina a vez.'); },

  async onWildClick(card) {
    if (!state.isMyTurn) return;
    const color = await this.choice('Reclassificar curinga', 'Mudar a cor de um curinga é grátis (não gasta jogada).',
      card.colors.filter((c) => c !== card.curColor).map((c) => ({ label: COLORS[c].name, value: c })));
    if (color) act('moveWild', { card: card.id, color });
  },

  handOptions(card) {
    const me = mePublic();
    const opps = opponents();
    const play = (extra) => act('play', { card: card.id, ...extra });
    const o = [];
    const bank = { label: `💰 Depositar no banco (${card.value}M€)`, run: () => play({ as: 'bank' }) };

    if (card.type === 'money') return [bank];
    if (card.type === 'property') return [{ label: `🏠 Jogar em ${COLORS[card.color].name}`, run: () => play({ as: 'property', color: card.color }) }];
    if (card.type === 'wild') return card.colors.map((c) => ({ label: `🏠 Jogar como ${COLORS[c].name}`, run: () => play({ as: 'property', color: c }) }));

    if (card.type === 'rent') {
      for (const c of card.colors.filter((x) => rentFor(me, x) > 0)) {
        o.push({ label: `🧾 Cobrar renda de ${COLORS[c].name} (${rentFor(me, c)}M€${card.multi ? ' a um jogador' : ' a todos'})`, run: () => this.rentFlow(card, c) });
      }
      if (!o.length) o.push({ label: 'Não tens propriedades destas cores' });
      return [...o, bank];
    }

    switch (card.action) {
      case 'passGo':
        o.push({ label: '👵 Comprar 2 cartas', run: () => play({ as: 'action' }) });
        break;
      case 'debtCollector':
        o.push({ label: '📨 Cobrar 5M€ a um jogador', run: async () => {
          const t = await this.pickOpponent('A quem vais mandar o Cobrador do Fraque?');
          if (t) play({ as: 'action', target: t.id });
        } });
        break;
      case 'birthday':
        o.push({ label: '🛗 Cobrar 2M€ a todos', run: () => play({ as: 'action' }) });
        break;
      case 'slyDeal':
        o.push(opps.some((x) => stealableProps(x).length)
          ? { label: '🛂 Ficar com uma propriedade', run: () => this.slyFlow(card) }
          : { label: 'Ninguém tem propriedades roubáveis' });
        break;
      case 'forcedDeal':
        o.push(opps.some((x) => stealableProps(x).length) && stealableProps(me).length
          ? { label: '🤝 Trocar propriedades', run: () => this.forcedFlow(card) }
          : { label: 'Não há propriedades para trocar' });
        break;
      case 'dealBreaker':
        o.push(opps.some((x) => completeColors(x).size)
          ? { label: '🦅 Roubar um conjunto completo', run: () => this.dealBreakerFlow(card) }
          : { label: 'Ninguém tem conjuntos completos' });
        break;
      case 'house':
      case 'hotel': {
        const cols = buildableColors(me, card.action);
        for (const c of cols) o.push({ label: `${card.action === 'house' ? '🔨 Remodelar' : '🧳 Pôr em AL'}: ${COLORS[c].name}`, run: () => play({ as: 'action', color: c }) });
        if (!cols.length) o.push({ label: card.action === 'house' ? 'Precisas de um conjunto completo (sem Transportes/Contadores)' : 'Precisas de um conjunto já remodelado' });
        break;
      }
      case 'justSayNo':
        o.push({ label: '⚖️ Só se usa em resposta a um ataque' });
        break;
      case 'doubleRent':
        o.push({ label: '📈 Joga-se ao cobrar uma Renda' });
        break;
      default:
        break;
    }
    return [...o, bank];
  },

  async rentFlow(card, color) {
    const me = mePublic();
    let target = null;
    if (card.multi) {
      target = await this.pickOpponent(`A quem cobras ${rentFor(me, color)}M€ de renda?`);
      if (!target) return;
    }
    const doubles = state.me.hand.filter((c) => c.action === 'doubleRent');
    const maxD = Math.min(doubles.length, state.playsLeft - 1);
    let n = 0;
    if (maxD > 0) {
      const base = rentFor(me, color);
      const opts = [];
      for (let i = 0; i <= maxD; i++) opts.push({ label: i ? `Usar ${i}× (${base * 2 ** i}M€, gasta mais ${i} jogada${i > 1 ? 's' : ''})` : `Não (${base}M€)`, value: i, primary: i === 1 });
      n = await this.choice('📈 Atualização da Renda?', 'Tens cartas para duplicar a renda.', opts);
      if (n === null) return;
    }
    act('play', { card: card.id, as: 'action', color, target: target && target.id, doubles: doubles.slice(0, n).map((c) => c.id) });
  },

  async pickStealable(title, players) {
    const items = players.flatMap((o) => stealableProps(o).map((card) => ({ card, owner: o, label: `${o.avatar} ${o.name}` })));
    const sel = await this.selectCards({ title, items, single: true, cancelable: true, validate: (s) => s.length === 1 });
    return sel && items.find((i) => i.card === sel[0]);
  },

  async slyFlow(card) {
    const it = await this.pickStealable('🛂 Golden Visa: que propriedade queres?', opponents());
    if (it) act('play', { card: card.id, as: 'action', target: it.owner.id, theirs: it.card.id });
  },

  async forcedFlow(card) {
    const theirs = await this.pickStealable('🤝 Permuta: que propriedade queres receber?', opponents());
    if (!theirs) return;
    const mine = await this.pickStealable('🤝 Permuta: que propriedade dás em troca?', [mePublic()]);
    if (!mine) return;
    act('play', { card: card.id, as: 'action', target: theirs.owner.id, theirs: theirs.card.id, mine: mine.card.id });
  },

  async dealBreakerFlow(card) {
    const options = opponents().flatMap((o) => getPiles(o).filter((x) => x.complete).map((x) => ({
      label: `${o.avatar} ${o.name}: ${COLORS[x.color].name} (renda ${pileRent(x)}M€)`,
      value: { o, color: x.color },
    })));
    const t = await this.choice('🦅 Fundo Abutre: que conjunto compras ao desbarato?', '', options);
    if (t) act('play', { card: card.id, as: 'action', target: t.o.id, color: t.color });
  },

  async showWinner() {
    const w = playerById(state.winner);
    const won = state.winner === myId();
    const options = isHost()
      ? [{ label: 'Jogar outra vez', value: 'again', primary: true }, { label: 'Ver a mesa', value: null }]
      : [{ label: 'Ver a mesa', value: null, primary: true }];
    const v = await this.choice(
      won ? '🏆 És o Senhorio Supremo!' : `🏆 ${w ? `${w.avatar} ${w.name}` : 'Alguém'} ganhou`,
      (won
        ? 'Três conjuntos completos. Os teus inquilinos agradecem… ou não, que já foram despejados.'
        : 'Não te preocupes: há um quarto partilhado na Amadora por apenas 750€/mês. Despesas não incluídas.')
        + (isHost() ? '' : ' O anfitrião pode começar outro jogo.'),
      options,
      { cancelable: false, kind: 'end' },
    );
    if (v === 'again') act('restart');
  },
};

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
}, 25000);
