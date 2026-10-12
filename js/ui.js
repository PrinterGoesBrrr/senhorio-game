// Senhorio — interface e jogador humano

const $ = (s) => document.querySelector(s);
function h(tag, cls = '', text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const HumanAgent = {
  takeTurn() {
    return new Promise((resolve) => { UI.turnResolve = resolve; UI.render(); });
  },

  chooseDiscard(game, p, n) {
    return UI.selectCards({
      title: `Mão cheia! Descarta ${n} carta(s)`,
      subtitle: 'Máximo de 7 cartas na mão. Nem os senhorios podem ter tudo.',
      items: p.hand.map((card) => ({ card })),
      validate: (s) => s.length === n,
      status: (s) => `${s.length}/${n} selecionadas`,
      confirmLabel: 'Descartar',
    });
  },

  choosePayment(game, p, amount, to) {
    const where = (c) => (p.bank.includes(c) ? 'Banco' : p.improvements.includes(c) ? 'Remodelação' : `🏠 ${COLORS[c.curColor].name}`);
    return UI.selectCards({
      title: `Tens de pagar ${amount}M€ a ${to.avatar} ${to.name}`,
      subtitle: 'Escolhe do teu banco e/ou propriedades. Não há troco: é o mercado a funcionar.',
      items: payableItems(p).map((card) => ({ card, label: where(card) })),
      validate: (s) => sum(s) >= amount,
      status: (s) => `Selecionado: ${sum(s)}M€ de ${amount}M€`,
      confirmLabel: 'Pagar 😭',
    });
  },

  useJustSayNo(game, p, ctx) {
    const text = ctx.blocked
      ? `${ctx.opponent.name} bloqueou a tua jogada com uma Providência Cautelar. Contra-atacar com a tua?`
      : `${ctx.desc}. Usar uma Providência Cautelar para bloquear?`;
    return UI.choice('⚖️ Providência Cautelar', text, [
      { label: 'Sim, para tribunal!', value: true, primary: true },
      { label: 'Não', value: false },
    ], { cancelable: false });
  },
};

const UI = {
  game: null,
  me: null,
  busy: false,
  turnResolve: null,

  start(name, nOpp) {
    const bots = shuffle([...BOTS]).slice(0, nOpp);
    const configs = [
      { name, avatar: '🧑', agent: HumanAgent, isHuman: true },
      ...bots.map((b) => ({ ...b, agent: AIAgent })),
    ];
    this.game = new Game(configs, {
      onUpdate: () => this.render(),
      onLog: (m, k) => this.addLog(m, k),
      onWin: (w) => this.showWinner(w),
    });
    this.me = this.game.players[0];
    this.busy = false;
    this.turnResolve = null;
    $('#log').replaceChildren();
    $('#setup').hidden = true;
    $('#game').hidden = false;
    this.game.run();
  },

  isMyTurn() {
    const g = this.game;
    return g && !g.winner && g.turnPlayer === this.me && !!this.turnResolve;
  },

  endTurn() {
    if (!this.turnResolve || this.busy) return;
    const resolve = this.turnResolve;
    this.turnResolve = null;
    resolve();
    this.render();
  },

  // ---- Renderização ----

  render() {
    if (!this.game) return;
    this.renderOpponents();
    this.renderCenter();
    this.renderMe();
  },

  renderOpponents() {
    const g = this.game;
    $('#opponents').replaceChildren(...g.opponents(this.me).map((o) => {
      const el = h('div', 'opp' + (g.turnPlayer === o && !g.winner ? ' active' : ''));
      const head = h('div', 'opp-head');
      head.append(h('span', 'avatar', o.avatar), h('b', '', o.name));
      const stats = h('div', 'opp-stats', `🃏 ${o.hand.length}  ·  💰 ${bankTotal(o)}M€  ·  🏘️ ${completeColors(o).size}/3`);
      const piles = h('div', 'piles');
      const list = getPiles(o);
      if (list.length) piles.append(...list.map((x) => this.pileEl(x, false)));
      else piles.append(h('div', 'empty', 'Ainda sem imóveis'));
      el.append(head, stats, piles);
      return el;
    }));
  },

  renderCenter() {
    const g = this.game;
    const mine = this.isMyTurn();
    $('#deck-count').textContent = `${g.deck.length} cartas`;
    const top = g.discard[g.discard.length - 1];
    $('#discard-top').replaceChildren(top ? this.cardEl(top) : h('div', 'card placeholder', 'vazio'));
    $('#turn-info').textContent = g.winner ? 'Fim do jogo' : mine ? 'É a tua vez!' : `Vez de ${g.turnPlayer.avatar} ${g.turnPlayer.name}…`;
    $('#plays').textContent = mine ? `${'●'.repeat(Math.max(0, g.playsLeft))}${'○'.repeat(3 - Math.max(0, g.playsLeft))}  jogadas restantes` : '';
    $('#end-turn').disabled = !mine || this.busy;
  },

  renderMe() {
    const me = this.me;
    const mine = this.isMyTurn() && !this.busy;
    $('#me-head').textContent = `${me.avatar} ${me.name}  ·  🏘️ ${completeColors(me).size}/3 conjuntos completos (precisas de 3 cores diferentes)`;
    const piles = getPiles(me);
    $('#my-props').replaceChildren(...(piles.length ? piles.map((x) => this.pileEl(x, true)) : [h('div', 'empty', 'Ainda não tens imóveis. Ao contrário dos fundos de investimento.')]));
    $('#bank-total').textContent = `${bankTotal(me)}M€`;
    $('#my-bank').replaceChildren(...me.bank.map((c) => this.chipEl(c)));
    $('#my-hand').replaceChildren(...me.hand.map((c) => {
      const el = this.cardEl(c);
      if (mine) el.classList.add('playable');
      el.onclick = () => this.onHandClick(c);
      return el;
    }));
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

  addLog(msg, kind) {
    const log = $('#log');
    log.prepend(h('div', `log-line ${kind}`, msg));
    while (log.children.length > 80) log.lastChild.remove();
  },

  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this._toast);
    this._toast = setTimeout(() => { t.hidden = true; }, 2200);
  },

  // ---- Modais ----

  modal(build) {
    return new Promise((resolve) => {
      const ov = $('#modal');
      ov.replaceChildren();
      const box = h('div', 'modal-box');
      ov.append(box);
      ov.hidden = false;
      build(box, (v) => { ov.hidden = true; ov.replaceChildren(); resolve(v); });
    });
  },

  choice(title, text, options, { cancelable = true, card = null } = {}) {
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
    });
  },

  selectCards({ title, subtitle, items, validate, status, single = false, cancelable = false, confirmLabel = 'Confirmar' }) {
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
    });
  },

  pickOpponent(title) {
    return this.choice(title, '', this.game.opponents(this.me).map((o) => ({
      label: `${o.avatar} ${o.name} (${assetsTotal(o)}M€ em ativos)`,
      value: o,
    })));
  },

  // ---- Jogadas do humano ----

  async onHandClick(card) {
    if (!this.isMyTurn() || this.busy) return;
    if (this.game.playsLeft <= 0) { this.toast('Já fizeste 3 jogadas. Termina a vez.'); return; }
    const options = this.handOptions(card);
    const chosen = await this.choice(card.name, '', options.map((o) => ({ label: o.label, value: o, disabled: !o.run })), { card });
    if (!chosen) return;
    this.busy = true;
    this.render();
    try {
      await chosen.run();
    } finally {
      this.busy = false;
      this.render();
      if (this.game.winner) this.endTurn();
    }
  },

  async onWildClick(card) {
    if (!this.isMyTurn() || this.busy) return;
    const color = await this.choice('Reclassificar curinga', 'Mudar a cor de um curinga é grátis (não gasta jogada).',
      card.colors.filter((c) => c !== card.curColor).map((c) => ({ label: COLORS[c].name, value: c })));
    if (color) {
      this.game.moveWild(this.me, card, color);
      if (this.game.winner) this.endTurn();
    }
  },

  handOptions(card) {
    const g = this.game;
    const me = this.me;
    const opps = g.opponents(me);
    const o = [];
    const bank = { label: `💰 Depositar no banco (${card.value}M€)`, run: () => g.bankCard(me, card) };

    if (card.type === 'money') return [bank];
    if (card.type === 'property') return [{ label: `🏠 Jogar em ${COLORS[card.color].name}`, run: () => g.playProperty(me, card, card.color) }];
    if (card.type === 'wild') return card.colors.map((c) => ({ label: `🏠 Jogar como ${COLORS[c].name}`, run: () => g.playProperty(me, card, c) }));

    if (card.type === 'rent') {
      for (const c of card.colors.filter((c) => rentFor(me, c) > 0)) {
        o.push({ label: `🧾 Cobrar renda de ${COLORS[c].name} (${rentFor(me, c)}M€${card.multi ? ' a um jogador' : ' a todos'})`, run: () => this.rentFlow(card, c) });
      }
      if (!o.length) o.push({ label: 'Não tens propriedades destas cores' });
      return [...o, bank];
    }

    switch (card.action) {
      case 'passGo':
        o.push({ label: '👵 Comprar 2 cartas', run: () => g.playAction(me, card) });
        break;
      case 'debtCollector':
        o.push({ label: '📨 Cobrar 5M€ a um jogador', run: async () => {
          const t = await this.pickOpponent('A quem vais mandar o Cobrador do Fraque?');
          if (t) await g.playAction(me, card, { target: t });
        } });
        break;
      case 'birthday':
        o.push({ label: '🛗 Cobrar 2M€ a todos', run: () => g.playAction(me, card) });
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
        for (const c of cols) o.push({ label: `${card.action === 'house' ? '🔨 Remodelar' : '🧳 Pôr em AL'}: ${COLORS[c].name}`, run: () => g.playAction(me, card, { color: c }) });
        if (!cols.length) o.push({ label: card.action === 'house' ? 'Precisas de um conjunto completo (sem Transportes/Contadores)' : 'Precisas de um conjunto já remodelado' });
        break;
      }
      case 'justSayNo':
        o.push({ label: '⚖️ Só se usa em resposta a um ataque' });
        break;
      case 'doubleRent':
        o.push({ label: '📈 Joga-se ao cobrar uma Renda' });
        break;
    }
    return [...o, bank];
  },

  async rentFlow(card, color) {
    const g = this.game;
    let target = null;
    if (card.multi) {
      target = await this.pickOpponent(`A quem cobras ${rentFor(this.me, color)}M€ de renda?`);
      if (!target) return;
    }
    const doubles = this.me.hand.filter((c) => c.action === 'doubleRent');
    const maxD = Math.min(doubles.length, g.playsLeft - 1);
    let n = 0;
    if (maxD > 0) {
      const base = rentFor(this.me, color);
      const opts = [];
      for (let i = 0; i <= maxD; i++) opts.push({ label: i ? `Usar ${i}× (${base * 2 ** i}M€, gasta mais ${i} jogada${i > 1 ? 's' : ''})` : `Não (${base}M€)`, value: i, primary: i === 1 });
      n = await this.choice('📈 Atualização da Renda?', 'Tens cartas para duplicar a renda.', opts);
      if (n === null) return;
    }
    await g.playAction(this.me, card, { color, target, doubles: doubles.slice(0, n) });
  },

  async pickStealable(title, players) {
    const items = players.flatMap((o) => stealableProps(o).map((card) => ({ card, owner: o, label: `${o.avatar} ${o.name}` })));
    const sel = await this.selectCards({ title, items, single: true, cancelable: true, validate: (s) => s.length === 1 });
    return sel && items.find((i) => i.card === sel[0]);
  },

  async slyFlow(card) {
    const it = await this.pickStealable('🛂 Golden Visa: que propriedade queres?', this.game.opponents(this.me));
    if (it) await this.game.playAction(this.me, card, { target: it.owner, card: it.card });
  },

  async forcedFlow(card) {
    const theirs = await this.pickStealable('🤝 Permuta: que propriedade queres receber?', this.game.opponents(this.me));
    if (!theirs) return;
    const mine = await this.pickStealable('🤝 Permuta: que propriedade dás em troca?', [this.me]);
    if (!mine) return;
    await this.game.playAction(this.me, card, { target: theirs.owner, theirs: theirs.card, mine: mine.card });
  },

  async dealBreakerFlow(card) {
    const options = this.game.opponents(this.me).flatMap((o) => getPiles(o).filter((x) => x.complete).map((x) => ({
      label: `${o.avatar} ${o.name}: ${COLORS[x.color].name} (renda ${pileRent(x)}M€)`,
      value: { o, color: x.color },
    })));
    const t = await this.choice('🦅 Fundo Abutre: que conjunto compras ao desbarato?', '', options);
    if (t) await this.game.playAction(this.me, card, { target: t.o, color: t.color });
  },

  showWinner(w) {
    this.render();
    const won = w === this.me;
    this.choice(
      won ? '🏆 És o Senhorio Supremo!' : `🏆 ${w.avatar} ${w.name} ganhou`,
      won
        ? 'Três conjuntos completos. Os teus inquilinos agradecem… ou não, que já foram despejados.'
        : 'Não te preocupes: há um quarto partilhado na Amadora por apenas 750€/mês. Despesas não incluídas.',
      [{ label: 'Jogar outra vez', value: true, primary: true }],
      { cancelable: false },
    ).then(() => {
      $('#game').hidden = true;
      $('#setup').hidden = false;
      this.game = null;
    });
  },
};
