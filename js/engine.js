// Senhorio — motor do jogo (regras do Monopoly Deal)

const SPEED = { factor: 1 };
const sleep = (ms) => (SPEED.factor ? new Promise((r) => setTimeout(r, ms * SPEED.factor)) : Promise.resolve());

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sum = (cards) => cards.reduce((s, c) => s + c.value, 0);
const isPropertyCard = (c) => c.type === 'property' || c.type === 'wild';
const colorsOf = (c) => (c.type === 'property' ? [c.color] : c.colors);

// Os montes de propriedades são derivados: as cartas de cada cor são agrupadas em
// conjuntos do tamanho da cor, e as remodelações ligam-se aos conjuntos completos.
function getPiles(p) {
  const piles = [];
  for (const color of COLOR_KEYS) {
    const cards = p.props.filter((c) => c.curColor === color);
    if (!cards.length) continue;
    const size = COLORS[color].size;
    const colorPiles = [];
    for (let i = 0; i < cards.length; i += size) {
      const chunk = cards.slice(i, i + size);
      colorPiles.push({ color, cards: chunk, complete: chunk.length === size && chunk.some((c) => !c.multi), house: null, hotel: null });
    }
    const houses = p.improvements.filter((c) => c.curColor === color && c.action === 'house');
    const hotels = p.improvements.filter((c) => c.curColor === color && c.action === 'hotel');
    for (const pile of colorPiles) {
      if (!pile.complete || NO_BUILD.includes(color)) continue;
      if (houses.length) pile.house = houses.shift();
      if (pile.house && hotels.length) pile.hotel = hotels.shift();
    }
    piles.push(...colorPiles);
  }
  return piles;
}

function pileRent(pile) {
  const c = COLORS[pile.color];
  return c.rent[Math.min(pile.cards.length, c.size) - 1] + (pile.house ? 3 : 0) + (pile.hotel ? 4 : 0);
}

function rentFor(p, color) {
  return Math.max(0, ...getPiles(p).filter((x) => x.color === color).map(pileRent));
}

const completeColors = (p) => new Set(getPiles(p).filter((x) => x.complete).map((x) => x.color));
const bankTotal = (p) => sum(p.bank);
const payableItems = (p) => [...p.bank, ...p.props.filter((c) => c.value > 0), ...p.improvements];
const assetsTotal = (p) => sum(payableItems(p));
const stealableProps = (p) => getPiles(p).filter((x) => !x.complete).flatMap((x) => x.cards);

function buildableColors(p, kind) {
  const ok = (x) => x.complete && !NO_BUILD.includes(x.color) && (kind === 'house' ? !x.house : x.house && !x.hotel);
  return [...new Set(getPiles(p).filter(ok).map((x) => x.color))];
}

function propLabel(card) {
  return card.type === 'wild' ? `${card.name} (como ${COLORS[card.curColor].name})` : `${card.name} (${COLORS[card.color].name})`;
}

class Game {
  constructor(configs, hooks = {}) {
    this.players = configs.map((c, i) => ({
      id: i, name: c.name, avatar: c.avatar, agent: c.agent, isHuman: !!c.isHuman,
      hand: [], bank: [], props: [], improvements: [],
    }));
    this.deck = shuffle(buildDeck());
    this.discard = [];
    this.current = 0;
    this.playsLeft = 0;
    this.winner = null;
    this.turnCount = 0;
    this.hooks = hooks;
  }

  log(msg, kind = '') { this.hooks.onLog?.(msg, kind); this.update(); }
  update() { this.hooks.onUpdate?.(); }
  get turnPlayer() { return this.players[this.current]; }
  opponents(p) { return this.players.filter((o) => o !== p); }

  async run() {
    for (const p of this.players) this.draw(p, 5, true);
    this.log('As chaves foram distribuídas. Que comece a especulação!', 'system');
    while (!this.winner) {
      await this.playTurn(this.turnPlayer);
      if (this.winner) break;
      this.current = (this.current + 1) % this.players.length;
    }
    this.hooks.onWin?.(this.winner);
  }

  async playTurn(p) {
    this.turnCount++;
    this.playsLeft = 3;
    this.log(`Vez de ${p.avatar} ${p.name}`, 'turn');
    this.draw(p, p.hand.length === 0 ? 5 : 2);
    await p.agent.takeTurn(this, p);
    if (this.winner) return;
    if (p.hand.length > 7) {
      const n = p.hand.length - 7;
      const cards = await p.agent.chooseDiscard(this, p, n);
      for (const c of cards) { this.removeCard(p, c); this.toDiscard(c); }
      this.log(`${p.name} descartou ${n} carta(s).`);
    }
  }

  draw(p, n, silent = false) {
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) {
        if (!this.discard.length) break;
        this.deck = shuffle(this.discard);
        this.discard = [];
        this.log('O baralho acabou. Reciclámos o descarte, tipo reabilitação urbana.', 'system');
      }
      p.hand.push(this.deck.pop());
      drawn++;
    }
    if (!silent) this.log(`${p.name} comprou ${drawn} carta(s).`);
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
    this.log(`${p.name}: remodelações sem conjunto completo foram parar ao banco.`);
  }

  checkWin() {
    if (this.winner) return true;
    const order = [this.turnPlayer, ...this.opponents(this.turnPlayer)];
    for (const p of order) {
      if (completeColors(p).size >= 3) {
        this.winner = p;
        this.log(`🏆 ${p.name} tem 3 conjuntos completos e é o Senhorio Supremo!`, 'win');
        return true;
      }
    }
    return false;
  }

  // ---- Jogadas ----

  bankCard(p, card) {
    this.removeCard(p, card);
    p.bank.push(card);
    this.playsLeft--;
    this.log(`${p.name} depositou ${card.name} (${card.value}M€) no banco.`);
  }

  playProperty(p, card, color) {
    this.removeCard(p, card);
    card.curColor = color;
    p.props.push(card);
    this.playsLeft--;
    this.log(`${p.name} adquiriu ${propLabel(card)}.`, 'prop');
    this.normalize(p);
    this.checkWin();
  }

  // Mudar a cor de um curinga é grátis (não conta como jogada).
  moveWild(p, card, color) {
    if (card.curColor === color) return;
    card.curColor = color;
    p.props.splice(p.props.indexOf(card), 1);
    p.props.push(card);
    this.log(`${p.name} reclassificou um ${card.name} como ${COLORS[color].name}.`);
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
      this.log(kind === 'house'
        ? `${p.name} fez uma Remodelação Low-Cost em ${COLORS[opts.color].name}. Pladur por todo o lado!`
        : `${p.name} transformou ${COLORS[opts.color].name} em Alojamento Local. Malas com rodinhas a toda a hora!`, 'prop');
      this.normalize(p);
      return;
    }

    this.toDiscard(card);
    switch (kind) {
      case 'passGo':
        this.log(`${p.name} recebeu uma ${card.name}! 👵`);
        this.draw(p, 2);
        break;

      case 'debtCollector':
        this.log(`${p.name} enviou o ${card.name} a ${opts.target.name}.`, 'action');
        await this.charge(p, opts.target, 5, card);
        break;

      case 'birthday':
        this.log(`${p.name} cobra a ${card.name}: 2M€ a cada um!`, 'action');
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
        this.log(`${p.name} cobra renda de ${COLORS[opts.color].name}: ${amount}M€${extra}${card.multi ? ` a ${opts.target.name}` : ' a todos'}.`, 'action');
        for (const t of targets) {
          if (this.winner) break;
          await this.charge(p, t, amount, card);
        }
        break;
      }

      case 'slyDeal': {
        const { target, card: prop } = opts;
        this.log(`${p.name} usa ${card.name} para ficar com ${prop.name} de ${target.name}.`, 'action');
        const desc = `${p.name} quer ficar com a tua propriedade ${prop.name} (${card.name})`;
        if (await this.justSayNoChain(p, target, { kind: 'sly', card: prop, desc })) break;
        if (!target.props.includes(prop)) break;
        this.removeCard(target, prop);
        p.props.push(prop);
        this.normalize(target);
        this.normalize(p);
        this.log(`${prop.name} mudou de dono. ${target.name} ficou a ver navios.`);
        break;
      }

      case 'forcedDeal': {
        const { target, theirs, mine } = opts;
        this.log(`${p.name} propõe uma ${card.name} a ${target.name}: ${mine.name} ⇄ ${theirs.name}.`, 'action');
        const desc = `${p.name} quer trocar ${mine.name} pela tua ${theirs.name} (${card.name})`;
        if (await this.justSayNoChain(p, target, { kind: 'forced', card: theirs, desc })) break;
        if (!target.props.includes(theirs) || !p.props.includes(mine)) break;
        this.removeCard(target, theirs);
        this.removeCard(p, mine);
        p.props.push(theirs);
        target.props.push(mine);
        this.normalize(target);
        this.normalize(p);
        this.log('Negócio fechado. Ninguém leu as letras pequenas.');
        break;
      }

      case 'dealBreaker': {
        const { target, color } = opts;
        this.log(`🦅 ${p.name} lança o ${card.name} sobre o conjunto ${COLORS[color].name} de ${target.name}!`, 'action');
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
        this.log(`O conjunto ${COLORS[color].name} é agora de ${p.name}. Os inquilinos nem foram avisados.`);
        break;
      }
    }
    this.checkWin();
  }

  async charge(from, target, amount, card) {
    if (amount <= 0) return;
    if (assetsTotal(target) === 0) {
      this.log(`${target.name} não tem nada para pagar. Tão falido como um jovem em Lisboa.`);
      return;
    }
    const desc = `${from.name} exige-te ${amount}M€ (${card.name})`;
    if (await this.justSayNoChain(from, target, { kind: 'pay', amount, card, desc })) return;
    await this.collect(target, from, amount);
  }

  async collect(payer, receiver, amount) {
    const items = payableItems(payer);
    const chosen = sum(items) <= amount ? items : await payer.agent.choosePayment(this, payer, amount, receiver);
    let paid = 0;
    for (const c of chosen) {
      const from = this.removeCard(payer, c);
      if (from === 'props') receiver.props.push(c);
      else { if (from === 'improvements') delete c.curColor; receiver.bank.push(c); }
      paid += c.value;
    }
    this.normalize(payer);
    this.normalize(receiver);
    const what = chosen.map((c) => (isPropertyCard(c) ? `🏠${c.name}` : `${c.value}M€`)).join(', ');
    this.log(`${payer.name} pagou ${paid}M€ a ${receiver.name}${paid > amount ? ' (troco? não há troco)' : ''}: ${what || 'nada'}.`, 'pay');
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
      const use = await responder.agent.useJustSayNo(this, responder, { ...ctx, blocked, attacker, target, opponent: other });
      if (!use) break;
      this.removeCard(responder, jsn);
      this.toDiscard(jsn);
      blocked = !blocked;
      this.log(`⚖️ ${responder.name} interpôs uma Providência Cautelar! ${blocked ? 'Ação bloqueada.' : 'O bloqueio caiu.'}`, 'jsn');
      [responder, other] = [other, responder];
      await sleep(400);
    }
    return blocked;
  }
}
