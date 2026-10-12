'use strict';

// Senhorio — motor do jogo (regras do Monopoly Deal), autoridade no servidor.
//
// O ciclo de jogo é assíncrono: cada jogador tem um agente (bot ou humano) e o
// motor espera pelas decisões dele. Para humanos, uma decisão é um pedido
// (`pending`) que vai no estado para o browser desse jogador; a resposta chega
// pela ligação e resolve a promessa. Tudo o que vem do cliente é validado aqui.

const {
  COLORS, buildDeck, sum, isPropertyCard, colorsOf, getPiles, rentFor, completeColors,
  payableItems, assetsTotal, stealableProps, buildableColors, propLabel,
} = require('../public/rules');
const { AIAgent, BOTS } = require('./bot');

const MAX_PLAYERS = 5;
const HUMAN_AVATARS = ['🧑', '👩', '🧔', '👱', '🧓'];

// Uma promessa que nunca se resolve: congela o ciclo de uma partida que já
// foi reiniciada, para não mexer no estado da nova.
const NEVER = new Promise(() => {});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Jogador humano: as decisões vêm do browser.
const HumanAgent = {
  takeTurn(game) {
    return new Promise((resolve) => { game.turnEnd = resolve; game.update(); });
  },

  chooseDiscard(game, p, n) {
    return game.ask(p, { kind: 'discard', n }, () => AIAgent.chooseDiscard(game, p, n));
  },

  choosePayment(game, p, amount, to) {
    return game.ask(p, { kind: 'pay', amount, to: to.id }, () => AIAgent.choosePayment(game, p, amount, to));
  },

  useJustSayNo(game, p, ctx) {
    const text = ctx.blocked
      ? `${ctx.opponent.name} bloqueou a tua jogada com uma Providência Cautelar. Contra-atacar com a tua?`
      : `${ctx.desc}. Usar uma Providência Cautelar para bloquear?`;
    return game.ask(p, { kind: 'jsn', text }, () => AIAgent.useJustSayNo(game, p, ctx));
  },
};

class Game {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby'; // lobby | play | over
    this.log = [];
    this.logSeq = 0;
    this.version = 0;
    this.epoch = 0;
    this.reset();
  }

  reset() {
    this.deck = [];
    this.discard = [];
    this.current = 0;
    this.playsLeft = 0;
    this.winner = null;
    this.turnCount = 0;
    this.turnEnd = null; // resolve a vez de um humano
    this.busy = false;   // uma jogada de um humano ainda está a decorrer
    this.pending = null; // decisão à espera de um humano
    this.promptSeq = 0;
    for (const p of this.players) Object.assign(p, { hand: [], bank: [], props: [], improvements: [] });
  }

  // ---------- jogadores ----------

  addPlayer(id, name, { bot = false, avatar } = {}) {
    if (this.phase !== 'lobby') fail('O jogo já começou.');
    if (this.players.length >= MAX_PLAYERS) fail(`A mesa está cheia (máximo ${MAX_PLAYERS}).`);
    const taken = new Set(this.players.map((p) => p.avatar));
    const player = {
      id, name, bot, connected: true,
      avatar: avatar || HUMAN_AVATARS.find((a) => !taken.has(a)) || '🧑',
      hand: [], bank: [], props: [], improvements: [],
    };
    this.players.push(player);
    if (!this.hostId && !bot) this.hostId = id;
    this.note(`${player.avatar} ${name} sentou-se à mesa.`, 'system');
    return player;
  }

  addBot(hostId, botId) {
    if (this.hostId !== hostId) fail('Só o anfitrião pode adicionar bots.');
    const taken = new Set(this.players.map((p) => p.name));
    const free = BOTS.filter((b) => !taken.has(b.name));
    const pick = free.length ? free[Math.floor(Math.random() * free.length)] : { name: `Bot ${this.players.length + 1}`, avatar: '🤖' };
    return this.addPlayer(botId, pick.name, { bot: true, avatar: pick.avatar });
  }

  removeBot(hostId, botId) {
    if (this.hostId !== hostId) fail('Só o anfitrião pode tirar bots.');
    if (this.phase !== 'lobby') fail('O jogo já começou.');
    if (!this.player(botId).bot) fail('Esse jogador não é um bot.');
    this.removePlayer(botId);
  }

  humansConnected() {
    return this.players.filter((p) => !p.bot && p.connected).length;
  }

  // Na sala de espera o lugar desaparece. A meio do jogo, um bot fica com o
  // lugar para a partida não encravar à espera de quem já foi embora.
  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const p = this.players[idx];
    if (this.phase === 'lobby') {
      this.players.splice(idx, 1);
      this.note(`${p.name} levantou-se da mesa.`, 'system');
    } else {
      p.connected = false;
      p.bot = true;
      p.left = true;
      this.note(`${p.name} abandonou a partida. Um bot fica a gerir o património.`, 'system');
      if (this.pending && this.pending.playerId === id) this.pending.resolve(this.pending.fallback());
      if (this.turnEnd && this.turnPlayer === p && !this.busy) this.finishHumanTurn();
    }
    if (this.hostId === id) {
      const next = this.players.find((x) => !x.bot && x.connected);
      this.hostId = next ? next.id : null;
    }
    this.update();
    return { remaining: this.humansConnected() };
  }

  player(id) {
    const p = this.players.find((x) => x.id === id);
    if (!p) fail('Jogador não encontrado.');
    return p;
  }

  get turnPlayer() { return this.players[this.current]; }
  opponents(p) { return this.players.filter((o) => o !== p); }
  agentFor(p) { return p.bot ? AIAgent : HumanAgent; }

  // ---------- registo e notificações ----------

  note(text, kind = '') {
    this.log.push({ n: this.logSeq++, text, kind });
    if (this.log.length > 120) this.log.splice(0, this.log.length - 120);
  }

  say(msg, kind = '') { this.note(msg, kind); this.update(); }
  update() { this.hooks.onChange?.(); }

  // Pausa entre jogadas dos bots. Sem nenhum humano ligado, os bots esperam.
  async sleep(ms) {
    const e = this.epoch;
    await delay(ms);
    await this.hooks.waitForAudience?.();
    if (e !== this.epoch) await NEVER;
  }

  ask(p, prompt, fallback) {
    const e = this.epoch;
    return new Promise((resolve) => {
      this.pending = {
        ...prompt,
        seq: ++this.promptSeq,
        playerId: p.id,
        fallback,
        resolve: (v) => { this.pending = null; resolve(v); this.update(); },
      };
      this.update();
    }).then((v) => (e === this.epoch ? v : NEVER));
  }

  // ---------- arranque ----------

  start(id) {
    if (this.phase !== 'lobby') fail('O jogo já começou.');
    if (this.hostId !== id) fail('Só o anfitrião pode começar.');
    if (this.players.length < 2) fail('São precisos pelo menos 2 jogadores.');
    this.reset();
    shuffle(this.players);
    this.deck = shuffle(buildDeck());
    this.phase = 'play';
    this.run(this.epoch);
  }

  restart(id) {
    if (this.hostId !== id) fail('Só o anfitrião pode recomeçar.');
    this.epoch++;
    // Os lugares que ficaram com bots por abandono saem da mesa.
    this.players = this.players.filter((p) => !p.left);
    this.phase = 'lobby';
    this.reset();
    this.note('Mesa arrumada. À espera de um novo jogo.', 'system');
  }

  // Termina tudo o que esteja à espera (sala apagada).
  abort() { this.epoch++; }

  async run(epoch) {
    for (const p of this.players) this.draw(p, 5, true);
    this.say(`As chaves foram distribuídas. ${this.turnPlayer.name} começa. Que comece a especulação!`, 'system');
    while (!this.winner) {
      await this.playTurn(this.turnPlayer);
      if (epoch !== this.epoch) return;
      if (this.winner) break;
      this.current = (this.current + 1) % this.players.length;
    }
    this.phase = 'over';
    this.update();
  }

  async playTurn(p) {
    this.turnCount++;
    this.playsLeft = 3;
    this.say(`Vez de ${p.avatar} ${p.name}`, 'turn');
    this.draw(p, p.hand.length === 0 ? 5 : 2);
    await this.agentFor(p).takeTurn(this, p);
    if (this.winner) return;
    if (p.hand.length > 7) {
      const n = p.hand.length - 7;
      const cards = await this.agentFor(p).chooseDiscard(this, p, n);
      for (const c of cards) { this.removeCard(p, c); this.toDiscard(c); }
      this.say(`${p.name} descartou ${n} carta(s).`);
    }
  }

  // ---------- jogadas dos humanos (validadas) ----------

  requireMyMove(id) {
    if (this.phase !== 'play') fail('O jogo não está a decorrer.');
    const p = this.player(id);
    if (this.turnPlayer !== p || !this.turnEnd) fail('Não é a tua vez.');
    if (this.busy || this.pending) fail('Espera que a jogada anterior acabe.');
    return p;
  }

  finishHumanTurn() {
    const end = this.turnEnd;
    this.turnEnd = null;
    if (end) end();
    this.update();
  }

  endTurn(id) {
    this.requireMyMove(id);
    this.finishHumanTurn();
  }

  moveWildBy(id, cardId, color) {
    const p = this.requireMyMove(id);
    const card = p.props.find((c) => c.id === cardId && c.type === 'wild');
    if (!card) fail('Esse curinga não está na tua mesa.');
    if (!card.colors.includes(color)) fail('Esse curinga não serve para essa cor.');
    this.moveWild(p, card, color);
    if (this.winner) this.finishHumanTurn();
  }

  // Valida uma jogada vinda do browser e corre-a. A validação é síncrona, para
  // o erro voltar logo ao jogador; a jogada em si pode esperar por outros.
  play(id, payload) {
    const p = this.requireMyMove(id);
    if (this.playsLeft <= 0) fail('Já fizeste 3 jogadas. Termina a vez.');
    const card = p.hand.find((c) => c.id === payload.card);
    if (!card) fail('Essa carta não está na tua mão.');
    const opp = (pid) => {
      const o = this.players.find((x) => x.id === pid);
      if (!o || o === p) fail('Escolhe um adversário.');
      return o;
    };
    const color = payload.color;

    if (payload.as === 'bank') {
      if (isPropertyCard(card)) fail('Propriedades não vão para o banco.');
      return this.runBusy(() => this.bankCard(p, card));
    }

    if (payload.as === 'property') {
      if (!isPropertyCard(card)) fail('Essa carta não é uma propriedade.');
      if (!colorsOf(card).includes(color)) fail('Essa propriedade não serve para essa cor.');
      return this.runBusy(() => this.playProperty(p, card, color));
    }

    const kind = card.type === 'rent' ? 'rent' : card.action;
    const opts = {};
    switch (kind) {
      case 'passGo':
      case 'birthday':
        break;
      case 'debtCollector':
        opts.target = opp(payload.target);
        break;
      case 'rent': {
        if (!card.colors.includes(color)) fail('Essa renda não é dessa cor.');
        if (!rentFor(p, color)) fail('Não tens propriedades dessa cor.');
        opts.color = color;
        if (card.multi) opts.target = opp(payload.target);
        const ids = [...new Set(payload.doubles || [])];
        opts.doubles = ids.map((d) => p.hand.find((c) => c.id === d && c.action === 'doubleRent') || fail('Atualização da Renda inválida.'));
        if (opts.doubles.length > this.playsLeft - 1) fail('Não tens jogadas que cheguem para tantas atualizações.');
        break;
      }
      case 'slyDeal':
        opts.target = opp(payload.target);
        opts.card = stealableProps(opts.target).find((c) => c.id === payload.theirs) || fail('Essa propriedade não se pode levar.');
        break;
      case 'forcedDeal':
        opts.target = opp(payload.target);
        opts.theirs = stealableProps(opts.target).find((c) => c.id === payload.theirs) || fail('Essa propriedade não se pode levar.');
        opts.mine = stealableProps(p).find((c) => c.id === payload.mine) || fail('Essa propriedade tua não se pode trocar.');
        break;
      case 'dealBreaker':
        opts.target = opp(payload.target);
        if (!completeColors(opts.target).has(color)) fail('Esse conjunto não está completo.');
        opts.color = color;
        break;
      case 'house':
      case 'hotel':
        if (!buildableColors(p, kind).includes(color)) fail('Não podes construir nesse conjunto.');
        opts.color = color;
        break;
      default:
        fail('Essa carta não se joga assim.');
    }
    return this.runBusy(() => this.playAction(p, card, opts));
  }

  async runBusy(fn) {
    const e = this.epoch;
    this.busy = true;
    this.update();
    try {
      await fn();
    } finally {
      if (e === this.epoch) {
        this.busy = false;
        if (this.winner || this.turnPlayer.bot) this.finishHumanTurn();
        this.update();
      }
    }
  }

  // Resposta a um pedido (pagar, descartar, Providência Cautelar).
  respond(id, payload) {
    const q = this.pending;
    if (!q || q.playerId !== id) fail('Não há nada à tua espera.');
    const p = this.player(id);
    const pickIds = (pool) => {
      const ids = payload.cards;
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Escolha inválida.');
      return ids.map((cid) => pool.find((c) => c.id === cid) || fail('Escolha inválida.'));
    };
    if (q.kind === 'discard') {
      const cards = pickIds(p.hand);
      if (cards.length !== q.n) fail(`Escolhe exatamente ${q.n} carta(s).`);
      return q.resolve(cards);
    }
    if (q.kind === 'pay') {
      const cards = pickIds(payableItems(p));
      if (sum(cards) < q.amount) fail(`Ainda faltam ${q.amount - sum(cards)}M€.`);
      return q.resolve(cards);
    }
    if (q.kind === 'jsn') return q.resolve(!!payload.accept);
    return undefined;
  }

  // ---------- motor ----------

  draw(p, n, silent = false) {
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) {
        if (!this.discard.length) break;
        this.deck = shuffle(this.discard);
        this.discard = [];
        this.say('O baralho acabou. Reciclámos o descarte, tipo reabilitação urbana.', 'system');
      }
      p.hand.push(this.deck.pop());
      drawn++;
    }
    if (!silent) this.say(`${p.name} comprou ${drawn} carta(s).`);
  }

  removeCard(p, card) {
    for (const key of ['hand', 'bank', 'props', 'improvements']) {
      const i = p[key].indexOf(card);
      if (i >= 0) { p[key].splice(i, 1); return key; }
    }
    return null;
  }

  toDiscard(card) {
    delete card.curColor;
    this.discard.push(card);
  }

  // Remodelações que deixaram de estar num conjunto completo vão para o banco.
  normalize(p) {
    const attached = new Set();
    for (const x of getPiles(p)) { if (x.house) attached.add(x.house); if (x.hotel) attached.add(x.hotel); }
    const loose = p.improvements.filter((c) => !attached.has(c));
    if (!loose.length) return;
    p.improvements = p.improvements.filter((c) => attached.has(c));
    for (const c of loose) { delete c.curColor; p.bank.push(c); }
    this.say(`${p.name}: remodelações sem conjunto completo foram parar ao banco.`);
  }

  checkWin() {
    if (this.winner) return true;
    const order = [this.turnPlayer, ...this.opponents(this.turnPlayer)];
    for (const p of order) {
      if (completeColors(p).size >= 3) {
        this.winner = p;
        this.say(`🏆 ${p.name} tem 3 conjuntos completos e é o Senhorio Supremo!`, 'win');
        return true;
      }
    }
    return false;
  }

  bankCard(p, card) {
    this.removeCard(p, card);
    p.bank.push(card);
    this.playsLeft--;
    this.say(`${p.name} depositou ${card.name} (${card.value}M€) no banco.`);
  }

  playProperty(p, card, color) {
    this.removeCard(p, card);
    card.curColor = color;
    p.props.push(card);
    this.playsLeft--;
    this.say(`${p.name} adquiriu ${propLabel(card)}.`, 'prop');
    this.normalize(p);
    this.checkWin();
  }

  // Mudar a cor de um curinga é grátis (não conta como jogada).
  moveWild(p, card, color) {
    if (card.curColor === color) return;
    card.curColor = color;
    p.props.splice(p.props.indexOf(card), 1);
    p.props.push(card);
    this.say(`${p.name} reclassificou um ${card.name} como ${COLORS[color].name}.`);
    this.normalize(p);
    this.checkWin();
  }

  async playAction(p, card, opts = {}) {
    const kind = card.type === 'rent' ? 'rent' : card.action;
    this.removeCard(p, card);
    this.playsLeft--;

    if (kind === 'house' || kind === 'hotel') {
      card.curColor = opts.color;
      p.improvements.push(card);
      this.say(kind === 'house'
        ? `${p.name} fez uma Remodelação Low-Cost em ${COLORS[opts.color].name}. Pladur por todo o lado!`
        : `${p.name} transformou ${COLORS[opts.color].name} em Alojamento Local. Malas com rodinhas a toda a hora!`, 'prop');
      this.normalize(p);
      return;
    }

    this.toDiscard(card);
    switch (kind) {
      case 'passGo':
        this.say(`${p.name} recebeu uma ${card.name}! 👵`);
        this.draw(p, 2);
        break;

      case 'debtCollector':
        this.say(`${p.name} enviou o ${card.name} a ${opts.target.name}.`, 'action');
        await this.charge(p, opts.target, 5, card);
        break;

      case 'birthday':
        this.say(`${p.name} cobra a ${card.name}: 2M€ a cada um!`, 'action');
        for (const o of this.opponents(p)) {
          if (this.winner) break;
          await this.charge(p, o, 2, card);
        }
        break;

      case 'rent': {
        const doubles = opts.doubles || [];
        for (const d of doubles) { this.removeCard(p, d); this.toDiscard(d); this.playsLeft--; }
        const amount = rentFor(p, opts.color) * 2 ** doubles.length;
        const targets = card.multi ? [opts.target] : this.opponents(p);
        const extra = doubles.length ? ` com ${doubles.length}× Atualização da Renda 📈` : '';
        this.say(`${p.name} cobra renda de ${COLORS[opts.color].name}: ${amount}M€${extra}${card.multi ? ` a ${opts.target.name}` : ' a todos'}.`, 'action');
        for (const t of targets) {
          if (this.winner) break;
          await this.charge(p, t, amount, card);
        }
        break;
      }

      case 'slyDeal': {
        const { target, card: prop } = opts;
        this.say(`${p.name} usa ${card.name} para ficar com ${prop.name} de ${target.name}.`, 'action');
        const desc = `${p.name} quer ficar com a tua propriedade ${prop.name} (${card.name})`;
        if (await this.justSayNoChain(p, target, { kind: 'sly', card: prop, desc })) break;
        if (!target.props.includes(prop)) break;
        this.removeCard(target, prop);
        p.props.push(prop);
        this.normalize(target);
        this.normalize(p);
        this.say(`${prop.name} mudou de dono. ${target.name} ficou a ver navios.`);
        break;
      }

      case 'forcedDeal': {
        const { target, theirs, mine } = opts;
        this.say(`${p.name} propõe uma ${card.name} a ${target.name}: ${mine.name} ⇄ ${theirs.name}.`, 'action');
        const desc = `${p.name} quer trocar ${mine.name} pela tua ${theirs.name} (${card.name})`;
        if (await this.justSayNoChain(p, target, { kind: 'forced', card: theirs, desc })) break;
        if (!target.props.includes(theirs) || !p.props.includes(mine)) break;
        this.removeCard(target, theirs);
        this.removeCard(p, mine);
        p.props.push(theirs);
        target.props.push(mine);
        this.normalize(target);
        this.normalize(p);
        this.say('Negócio fechado. Ninguém leu as letras pequenas.');
        break;
      }

      case 'dealBreaker': {
        const { target, color } = opts;
        this.say(`🦅 ${p.name} lança o ${card.name} sobre o conjunto ${COLORS[color].name} de ${target.name}!`, 'action');
        const desc = `${p.name} quer roubar-te o conjunto completo ${COLORS[color].name} (${card.name})`;
        if (await this.justSayNoChain(p, target, { kind: 'dealBreaker', color, desc })) break;
        const pile = getPiles(target).find((x) => x.complete && x.color === color);
        if (!pile) break;
        const cards = [...pile.cards];
        const imps = [pile.house, pile.hotel].filter(Boolean);
        for (const c of [...cards, ...imps]) this.removeCard(target, c);
        p.props.unshift(...cards);
        p.improvements.push(...imps);
        this.normalize(target);
        this.normalize(p);
        this.say(`O conjunto ${COLORS[color].name} é agora de ${p.name}. Os inquilinos nem foram avisados.`);
        break;
      }

      default:
        break;
    }
    this.checkWin();
  }

  async charge(from, target, amount, card) {
    if (amount <= 0) return;
    if (assetsTotal(target) === 0) {
      this.say(`${target.name} não tem nada para pagar. Tão falido como um jovem em Lisboa.`);
      return;
    }
    const desc = `${from.name} exige-te ${amount}M€ (${card.name})`;
    if (await this.justSayNoChain(from, target, { kind: 'pay', amount, card, desc })) return;
    await this.collect(target, from, amount);
  }

  async collect(payer, receiver, amount) {
    const items = payableItems(payer);
    const chosen = sum(items) <= amount ? items : await this.agentFor(payer).choosePayment(this, payer, amount, receiver);
    let paid = 0;
    for (const c of chosen) {
      const from = this.removeCard(payer, c);
      if (!from) continue;
      if (from === 'props') receiver.props.push(c);
      else { if (from === 'improvements') delete c.curColor; receiver.bank.push(c); }
      paid += c.value;
    }
    this.normalize(payer);
    this.normalize(receiver);
    const what = chosen.map((c) => (isPropertyCard(c) ? `🏠${c.name}` : `${c.value}M€`)).join(', ');
    this.say(`${payer.name} pagou ${paid}M€ a ${receiver.name}${paid > amount ? ' (troco? não há troco)' : ''}: ${what || 'nada'}.`, 'pay');
    this.checkWin();
  }

  // Providências Cautelares podem ser contrariadas por outras, indefinidamente.
  async justSayNoChain(attacker, target, ctx) {
    let blocked = false;
    let responder = target;
    let other = attacker;
    for (;;) {
      const jsn = responder.hand.find((c) => c.action === 'justSayNo');
      if (!jsn) break;
      const use = await this.agentFor(responder).useJustSayNo(this, responder, { ...ctx, blocked, attacker, target, opponent: other });
      if (!use || !responder.hand.includes(jsn)) break;
      this.removeCard(responder, jsn);
      this.toDiscard(jsn);
      blocked = !blocked;
      this.say(`⚖️ ${responder.name} interpôs uma Providência Cautelar! ${blocked ? 'Ação bloqueada.' : 'O bloqueio caiu.'}`, 'jsn');
      [responder, other] = [other, responder];
      await this.sleep(400);
    }
    return blocked;
  }

  // ---------- estado visível ----------

  // Cada jogador vê a sua mão; dos outros só sabe quantas cartas têm.
  stateFor(viewerId) {
    const me = this.players.find((p) => p.id === viewerId) || null;
    const q = this.pending;
    let pending = null;
    if (q) {
      pending = { playerId: q.playerId, kind: q.kind };
      if (q.playerId === viewerId) Object.assign(pending, { seq: q.seq, n: q.n, amount: q.amount, to: q.to, text: q.text });
    }
    const turn = this.phase === 'play' ? this.turnPlayer : null;
    return {
      version: this.version,
      phase: this.phase,
      hostId: this.hostId,
      current: turn ? turn.id : null,
      isMyTurn: !!(turn && turn.id === viewerId && this.turnEnd && !this.busy && !q),
      playsLeft: this.playsLeft,
      deckCount: this.deck.length,
      discardTop: this.discard[this.discard.length - 1] || null,
      winner: this.winner ? this.winner.id : null,
      pending,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        bot: !!p.bot,
        connected: p.connected,
        handCount: p.hand.length,
        bank: p.bank,
        props: p.props,
        improvements: p.improvements,
      })),
      me: me && { id: me.id, hand: me.hand },
      log: this.log.slice(-80),
    };
  }
}

module.exports = { Game, GameError, MAX_PLAYERS };
