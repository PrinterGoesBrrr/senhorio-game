'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const url = require('url');

const { attachWebSocket } = require('./src/ws');
const { Game, GameError } = require('./src/game');

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6; // salas inactivas são limpas ao fim de 6 horas

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(url.parse(req.url).pathname);

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Impede sair da pasta public com ../
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Proibido');
    return undefined;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    return res.end(data);
  });
  return undefined;
});

/** @type {Map<string, {code:string, game:Game, sockets:Map<string, Set<WebSocket>>, tokens:Map<string,string>, touched:number}>} */
const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeCode();
  const room = {
    code,
    sockets: new Map(),
    tokens: new Map(), // token -> playerId
    touched: Date.now(),
    queued: false,
    wakers: [],
  };
  room.game = new Game({
    onChange: () => broadcast(room),
    // Os bots só jogam com alguém a ver; sem ninguém, esperam que alguém volte.
    waitForAudience: () => (room.game.humansConnected() > 0 ? null : new Promise((r) => room.wakers.push(r))),
  });
  rooms.set(code, room);
  return room;
}

function deleteRoom(room) {
  rooms.delete(room.code);
  room.game.abort();
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// O motor avisa a cada mudança; juntamos as que acontecem na mesma volta do
// ciclo de eventos num só envio.
function broadcast(room) {
  room.touched = Date.now();
  if (room.queued) return;
  room.queued = true;
  setImmediate(() => {
    room.queued = false;
    if (rooms.get(room.code) !== room) return;
    room.game.version += 1;
    for (const [playerId, set] of room.sockets) {
      const state = room.game.stateFor(playerId);
      state.room = room.code;
      for (const ws of set) send(ws, { type: 'state', state });
    }
  });
}

const ACTIONS = {
  start: (g, id) => g.start(id),
  play: (g, id, p) => g.play(id, p),
  moveWild: (g, id, p) => g.moveWildBy(id, p.card, p.color),
  endTurn: (g, id) => g.endTurn(id),
  respond: (g, id, p) => g.respond(id, p),
  restart: (g, id) => g.restart(id),
  addBot: (g, id) => g.addBot(id, crypto.randomUUID()),
  removeBot: (g, id, p) => g.removeBot(id, p.bot),
};

attachWebSocket(server, (ws) => {
  ws.roomCode = null;
  ws.playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    try {
      if (msg.type === 'create') {
        const name = String(msg.name || '').trim().slice(0, 20) || 'Senhorio';
        const room = createRoom();
        attach(ws, room, name);
        return;
      }

      if (msg.type === 'join') {
        const code = String(msg.room || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) return send(ws, { type: 'error', message: 'Mesa não encontrada. Confirma o código.' });

        // Reconexão com token
        const existingId = msg.token && room.tokens.get(msg.token);
        if (existingId && room.game.players.some((p) => p.id === existingId)) {
          bind(ws, room, existingId);
          room.game.player(existingId).connected = true;
          send(ws, { type: 'joined', room: room.code, token: msg.token, playerId: existingId });
          broadcast(room);
          return;
        }

        const name = String(msg.name || '').trim().slice(0, 20) || 'Senhorio';
        attach(ws, room, name);
        return;
      }

      if (msg.type === 'leave') {
        const room = rooms.get(ws.roomCode);
        if (room && ws.playerId) {
          const playerId = ws.playerId;
          const set = room.sockets.get(playerId);
          if (set) {
            set.delete(ws);
            if (set.size === 0) room.sockets.delete(playerId);
          }
          for (const [t, pid] of room.tokens) {
            if (pid === playerId) room.tokens.delete(t);
          }
          ws.roomCode = null;
          ws.playerId = null;
          const res = room.game.removePlayer(playerId);
          if (res && res.remaining === 0) deleteRoom(room);
          else broadcast(room);
          send(ws, { type: 'left' });
        }
        return;
      }

      if (msg.type === 'action') {
        const room = rooms.get(ws.roomCode);
        if (!room || !ws.playerId) return;
        const handler = ACTIONS[msg.action];
        if (!handler) return send(ws, { type: 'error', message: 'Ação desconhecida.' });
        handler(room.game, ws.playerId, msg.payload || {});
        broadcast(room);
        return;
      }

      if (msg.type === 'ping') return send(ws, { type: 'pong' });
    } catch (err) {
      if (err instanceof GameError) {
        send(ws, { type: 'error', message: err.message });
      } else {
        console.error(err);
        send(ws, { type: 'error', message: 'Alguma coisa correu mal no servidor.' });
      }
    }
    return undefined;
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return;
    const set = room.sockets.get(ws.playerId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        room.sockets.delete(ws.playerId);
        const player = room.game.players.find((p) => p.id === ws.playerId);
        if (player && !player.bot) player.connected = false;
      }
    }
    broadcast(room);
  });
});

function attach(ws, room, name) {
  const playerId = crypto.randomUUID();
  const token = crypto.randomUUID();
  try {
    room.game.addPlayer(playerId, name);
  } catch (err) {
    if (room.game.players.length === 0) rooms.delete(room.code);
    return send(ws, { type: 'error', message: err.message });
  }
  room.tokens.set(token, playerId);
  bind(ws, room, playerId);
  send(ws, { type: 'joined', room: room.code, token, playerId });
  broadcast(room);
  return undefined;
}

function bind(ws, room, playerId) {
  ws.roomCode = room.code;
  ws.playerId = playerId;
  if (!room.sockets.has(playerId)) room.sockets.set(playerId, new Set());
  room.sockets.get(playerId).add(ws);
  // Volta a pôr os bots a jogar, se estavam à espera de alguém.
  const wakers = room.wakers.splice(0);
  setImmediate(() => wakers.forEach((w) => w()));
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.touched > ROOM_TTL_MS) deleteRoom(room);
  }
}, 1000 * 60 * 10).unref();

server.listen(PORT, () => {
  console.log(`Senhorio a correr em http://localhost:${PORT}`);
});
