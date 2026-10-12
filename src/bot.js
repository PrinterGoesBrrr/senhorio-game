'use strict';

// Senhorio — adversários controlados pelo computador. Jogam no servidor e só
// usam o que um jogador veria: a própria mão e a mesa.

const {
  COLORS, PROP_VALUE, isPropertyCard, colorsOf, getPiles, pileRent, rentFor, completeColors,
  bankTotal, assetsTotal, stealableProps, buildableColors,
} = require('../public/rules');

const BOTS = [
  { name: 'Fundo Abutre Lda.', avatar: '🦅' },
  { name: 'Nómada Digital', avatar: '💻' },
  { name: 'Tia do AL', avatar: '👵' },
  { name: 'Eng.º do Pladur', avatar: '👷' },
  { name: 'Sr. Golden Visa', avatar: '🛂' },
];

// Quanto vale ganhar uma carta desta cor.
function gainScore(p, color) {
  const s = COLORS[color].size;
  const n = p.props.filter((c) => c.curColor === color).length;
  const partial = n % s;
  const done = completeColors(p);
  if (partial === s - 1) {
    if (done.has(color)) return 5;
    return done.size >= 2 ? 100 : 12;
  }
  if (n >= s && partial === 0) return 1.5;
  return 2 + partial * 3 + PROP_VALUE[color] * 0.5;
}

// Quanto custa perder esta carta da mesa.
function lossScore(p, card) {
  const pile = getPiles(p).find((x) => x.cards.includes(card));
  if (!pile) return card.value;
  if (pile.complete) return 30 + pileRent(pile);
  return 2 + pile.cards.length * 3 + card.value * 0.5;
}

function keepScore(c) {
  if (isPropertyCard(c)) return 50;
  if (c.type === 'money') return c.value * 3;
  if (c.type === 'rent') return 14;
  const scores = { justSayNo: 45, dealBreaker: 44, slyDeal: 30, forcedDeal: 25, debtCollector: 20, house: 18, hotel: 18, birthday: 15, passGo: 12, doubleRent: 8 };
  return scores[c.action] ?? 10;
}

// Menor subconjunto de notas que cobre o valor (sem troco, minimizar o excesso).
function minOverpay(cards, amount) {
  let best = new Map([[0, []]]);
  for (const c of cards) {
    const next = new Map(best);
    for (const [s, arr] of best) if (!next.has(s + c.value)) next.set(s + c.value, [...arr, c]);
    best = next;
  }
  const target = Math.min(...[...best.keys()].filter((s) => s >= amount));
  return best.get(target);
}

const richest = (players) => [...players].sort((a, b) => assetsTotal(b) - assetsTotal(a))[0];

const AIAgent = {
  async takeTurn(game, p) {
    await game.sleep(700);
    this.optimizeWilds(game, p);
    while (game.playsLeft > 0 && !game.winner) {
      const move = this.pickMove(game, p);
      if (!move) break;
      await move();
      if (!game.winner) this.optimizeWilds(game, p);
      await game.sleep(900);
    }
  },

  optimizeWilds(game, p) {
    for (const w of p.props.filter((c) => c.type === 'wild')) {
      if (game.winner) return;
      const idx = p.props.indexOf(w);
      p.props.splice(idx, 1);
      let best = w.curColor;
      let bestScore = -Infinity;
      for (const c of w.colors) {
        const s = gainScore(p, c) + (c === w.curColor ? 0.01 : 0);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      p.props.splice(idx, 0, w);
      if (best !== w.curColor) game.moveWild(p, w, best);
    }
  },

  bestSteal(game, p) {
    return game.opponents(p)
      .flatMap((o) => stealableProps(o).map((card) => ({ o, card, s: Math.max(...colorsOf(card).map((c) => gainScore(p, c))) })))
      .sort((a, b) => b.s - a.s)[0];
  },

  bestRent(game, p) {
    const opps = game.opponents(p);
    const doubles = p.hand.filter((c) => c.action === 'doubleRent');
    let best = null;
    for (const card of p.hand.filter((c) => c.type === 'rent')) {
      for (const color of card.colors) {
        const base = rentFor(p, color);
        if (!base) continue;
        const nd = base >= 2 ? Math.max(0, Math.min(doubles.length, game.playsLeft - 1)) : 0;
        const amount = base * 2 ** nd;
        let value;
        let target = null;
        if (card.multi) {
          const t = opps.map((o) => ({ o, v: Math.min(amount, assetsTotal(o)) })).sort((a, b) => b.v - a.v)[0];
          value = t.v;
          target = t.o;
        } else {
          value = opps.reduce((s, o) => s + Math.min(amount, assetsTotal(o)), 0);
        }
        value -= nd * 0.5;
        if (!best || value > best.value) best = { card, value, opts: { color, target, doubles: doubles.slice(0, nd) } };
      }
    }
    return best;
  },

  pickMove(game, p) {
    const opps = game.opponents(p);
    const hand = p.hand;
    const find = (a) => hand.find((c) => c.action === a);

    const pg = find('passGo');
    if (pg) return () => game.playAction(p, pg);

    const propMoves = hand.filter(isPropertyCard).map((card) => {
      let best = null;
      for (const color of colorsOf(card)) {
        const s = gainScore(p, color);
        if (!best || s > best.s) best = { card, color, s };
      }
      return best;
    }).sort((a, b) => b.s - a.s);
    const playProp = (m) => () => game.playProperty(p, m.card, m.color);
    if (propMoves[0]?.s >= 12) return playProp(propMoves[0]);

    const db = find('dealBreaker');
    if (db) {
      const mine = completeColors(p);
      const t = opps
        .flatMap((o) => getPiles(o).filter((x) => x.complete).map((x) => ({ o, x, s: pileRent(x) + (mine.has(x.color) ? 0 : 10) + (completeColors(o).size >= 2 ? 5 : 0) })))
        .sort((a, b) => b.s - a.s)[0];
      if (t) return () => game.playAction(p, db, { target: t.o, color: t.x.color });
    }

    const sly = find('slyDeal');
    const steal = this.bestSteal(game, p);
    if (sly && steal?.s >= 5) return () => game.playAction(p, sly, { target: steal.o, card: steal.card });

    if (propMoves.length) return playProp(propMoves[0]);

    const rent = this.bestRent(game, p);
    if (rent?.value >= 2) return () => game.playAction(p, rent.card, rent.opts);

    const dc = find('debtCollector');
    if (dc && assetsTotal(richest(opps)) > 0) return () => game.playAction(p, dc, { target: richest(opps) });

    const bd = find('birthday');
    if (bd && opps.some((o) => assetsTotal(o) > 0)) return () => game.playAction(p, bd);

    for (const imp of hand.filter((c) => c.action === 'house' || c.action === 'hotel')) {
      const color = buildableColors(p, imp.action)[0];
      if (color) return () => game.playAction(p, imp, { color });
    }

    const fd = find('forcedDeal');
    if (fd && steal) {
      const mine = stealableProps(p).map((card) => ({ card, s: lossScore(p, card) })).sort((a, b) => a.s - b.s)[0];
      if (mine && steal.s >= 12 && steal.s - mine.s >= 5) return () => game.playAction(p, fd, { target: steal.o, theirs: steal.card, mine: mine.card });
    }

    if (sly && steal) return () => game.playAction(p, sly, { target: steal.o, card: steal.card });
    if (rent?.value >= 1) return () => game.playAction(p, rent.card, rent.opts);

    const money = hand.filter((c) => c.type === 'money').sort((a, b) => b.value - a.value)[0];
    if (money) return () => game.bankCard(p, money);

    if (bankTotal(p) < 5 || hand.length > 7) {
      const junk = hand
        .filter((c) => (c.type === 'action' || c.type === 'rent') && c.action !== 'justSayNo' && c.action !== 'dealBreaker')
        .sort((a, b) => keepScore(a) - keepScore(b))[0];
      if (junk) return () => game.bankCard(p, junk);
    }
    return null;
  },

  chooseDiscard(game, p, n) {
    return [...p.hand].sort((a, b) => keepScore(a) - keepScore(b)).slice(0, n);
  },

  choosePayment(game, p, amount) {
    if (bankTotal(p) >= amount) return minOverpay(p.bank, amount);
    const chosen = [...p.bank];
    let rem = amount - bankTotal(p);
    const others = [
      ...p.improvements.map((c) => ({ c, s: 25 + c.value })),
      ...p.props.filter((c) => c.value > 0).map((c) => ({ c, s: lossScore(p, c) })),
    ].sort((a, b) => a.s - b.s);
    for (const { c } of others) {
      if (rem <= 0) break;
      chosen.push(c);
      rem -= c.value;
    }
    return chosen;
  },

  useJustSayNo(game, p, ctx) {
    let importance;
    if (ctx.kind === 'dealBreaker') importance = 10;
    else if (ctx.kind === 'sly' || ctx.kind === 'forced') {
      importance = ctx.blocked ? Math.max(...colorsOf(ctx.card).map((c) => gainScore(p, c))) / 2 : lossScore(p, ctx.card) / 2;
    } else {
      importance = ctx.blocked ? ctx.amount : Math.min(ctx.amount, assetsTotal(p));
    }
    return importance >= 4 || (importance >= 3 && Math.random() < 0.5);
  },
};

module.exports = { AIAgent, BOTS };
