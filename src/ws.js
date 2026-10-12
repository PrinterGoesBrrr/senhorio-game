'use strict';

// Implementação mínima do protocolo WebSocket (RFC 6455) para não depender
// de pacotes externos: o servidor arranca com `node server.js` e mais nada.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

class Connection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.OPEN = 1;
    this.CLOSED = 3;
    this.readyState = 1;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = null;

    this.lastSeen = Date.now();

    socket.on('data', (chunk) => { this.lastSeen = Date.now(); this.feed(chunk); });
    // O socket fica meio-aberto quando o cliente envia FIN: fechamos o nosso lado
    // para que a desligação seja detectada de imediato.
    socket.on('end', () => { socket.destroy(); this.finish(); });
    socket.on('close', () => this.finish());
    socket.on('error', () => { socket.destroy(); this.finish(); });
  }

  finish() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const frame = this.readFrame();
      if (!frame) break;
      this.handleFrame(frame);
    }
  }

  readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > 8n * 1024n * 1024n) { this.close(1009); return null; }
      length = Number(big);
      offset += 8;
    }

    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

    this.buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }

  handleFrame({ fin, opcode, payload }) {
    if (opcode === OP.CLOSE) {
      this.sendFrame(OP.CLOSE, Buffer.alloc(0));
      this.socket.end();
      this.finish();
      return;
    }
    if (opcode === OP.PING) { this.sendFrame(OP.PONG, payload); return; }
    if (opcode === OP.PONG) return;

    if (opcode === OP.CONT) {
      this.fragments.push(payload);
    } else {
      this.fragments = [payload];
      this.fragmentOp = opcode;
    }

    if (!fin) return;
    const full = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.fragmentOp === OP.TEXT) this.emit('message', full.toString('utf8'));
    this.fragmentOp = null;
  }

  sendFrame(opcode, payload) {
    if (this.readyState !== 1 || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text) {
    this.sendFrame(OP.TEXT, Buffer.from(text, 'utf8'));
  }

  ping() {
    this.sendFrame(OP.PING, Buffer.alloc(0));
  }

  close() {
    this.sendFrame(OP.CLOSE, Buffer.alloc(0));
    this.socket.end();
    this.finish();
  }
}

function attachWebSocket(server, onConnection, { heartbeatMs = 30000, idleMs = 90000 } = {}) {
  const live = new Set();

  const beat = setInterval(() => {
    const now = Date.now();
    for (const conn of live) {
      if (conn.readyState !== 1) { live.delete(conn); continue; }
      if (now - conn.lastSeen > idleMs) { conn.socket.destroy(); conn.finish(); live.delete(conn); continue; }
      conn.ping();
    }
  }, heartbeatMs);
  beat.unref();

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    const conn = new Connection(socket);
    live.add(conn);
    conn.on('close', () => live.delete(conn));
    onConnection(conn, req);
  });
}

module.exports = { attachWebSocket, Connection };
