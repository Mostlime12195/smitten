// Online rooms (smitten.net, love/src/modules/net): a small relay for the
// games on this site. A game's page (public/play.js) opens a WebSocket to
//
//   /api/games/<id>/rooms/<room>?max=<players>&name=<guest name>[&resume=<token>]
//
// and carries messages between it and the game. Everyone in the same room of
// the same game gets what the others send. That is all: what the messages
// mean, who decides what, prediction and the rest are the game's. Nothing is
// kept (rooms live in memory and end when the last player leaves or the
// server stops), and nothing a game sends is looked at beyond its size or
// written to the log.
//
// Messages are JSON text frames.
//   page -> server  {t: "to", to: <peer id>, d: <data>}   to one peer
//                   {t: "all", d: <data>}                  to everyone else
//   server -> page  {t: "welcome", room, me, host, max, token, peers: [{id, name, guest?}]}
//                   (peers includes me; again after a reconnect)
//                   {t: "joined", peer: {id, name, guest?}}
//                   {t: "left", id, host}
//                   {t: "msg", from, d}
//                   {t: "warn", reason}   a message was dropped: too-fast,
//                                         too-big, no-peer or bad-message
// The server ends a connection with close code 4000 and a reason: full,
// no-game, bad-room, bad-name, too-many-rooms, busy, banned, idle, expired
// (a resume token it doesn't know), slow (the page doesn't read what it
// gets), unavailable (rooms are off). Close code 1000 or 1001 from the page
// means it left; a connection that drops without one keeps its place for
// ROOM_GRACE_SECONDS, so the page can come back with its token.
//
// This is a minimal WebSocket server (RFC 6455): text frames, no
// extensions, no compression.

import { createHash, randomBytes } from 'node:crypto';
import { currentUser, ipHash } from './auth.js';
import { checkAddress } from './bans.js';
import { getRow } from './games.js';
import { cleanGuestName } from './validate.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
// The largest frame or message the server reads at all; past this the
// connection ends (a game's own limit, ROOM_MESSAGE_BYTES, is below it).
const MAX_FRAME = 64 * 1024;
// Past this much unsent data to one page, the page isn't keeping up.
const MAX_BUFFERED = 1024 * 1024;
const ROOM_NAME = /^[\p{L}\p{N} _.-]+$/u;
const ROOM_PATH = /^\/api\/games\/([^/]+)\/rooms\/([^/]+)$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

// ---------------------------------------------------------------------------
// WebSocket connections

class Connection {
  constructor(socket, addr) {
    this.socket = socket;
    this.addr = addr;
    this.buffer = Buffer.alloc(0);
    this.parts = null;
    this.partBytes = 0;
    this.closing = false;
    this.ended = false;
    this.peerCode = null;
    this.lastSeen = Date.now();
    this.lastPing = Date.now();
    this.onmessage = null;
    this.onend = null;
    socket.setNoDelay(true);
    socket.on('data', (data) => this.feed(data));
    socket.on('error', () => {});
    socket.on('close', () => this.finish());
  }

  feed(data) {
    this.lastSeen = Date.now();
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;
    while (!this.ended) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      let length = b[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        length = b.readUInt32BE(2) ? Infinity : b.readUInt32BE(6);
        at = 10;
      }
      // Clients must mask their frames; nothing here uses extensions.
      if ((b[0] & 0x70) || !(b[1] & 0x80)) return this.fail(1002, 'protocol');
      if (length > MAX_FRAME) return this.fail(1009, 'too-big');
      if (b.length < at + 4 + length) return;
      const mask = b.subarray(at, at + 4);
      const payload = Buffer.from(b.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < length; i++) payload[i] ^= mask[i & 3];
      this.buffer = b.subarray(at + 4 + length);
      this.frame(fin, op, payload);
    }
  }

  frame(fin, op, payload) {
    if (op >= 8) {
      if (!fin || payload.length > 125) return this.fail(1002, 'protocol');
      if (op === 8) {
        this.peerCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        this.close(this.peerCode === 1005 ? 1000 : this.peerCode, '');
      } else if (op === 9) {
        this.write(0x8a, payload);
      } else if (op !== 10) {
        this.fail(1002, 'protocol');
      }
      return;
    }
    if (this.closing) return;
    if (op === 0) {
      if (!this.parts) return this.fail(1002, 'protocol');
      this.parts.push(payload);
      this.partBytes += payload.length;
      if (this.partBytes > MAX_FRAME) return this.fail(1009, 'too-big');
      if (fin) {
        const whole = Buffer.concat(this.parts);
        this.parts = null;
        this.message(whole);
      }
    } else if (op === 1) {
      if (this.parts) return this.fail(1002, 'protocol');
      if (fin) this.message(payload);
      else {
        this.parts = [payload];
        this.partBytes = payload.length;
      }
    } else if (op === 2) {
      this.fail(1003, 'text-only');
    } else {
      this.fail(1002, 'protocol');
    }
  }

  message(bytes) {
    let text;
    try {
      text = utf8.decode(bytes);
    } catch {
      return this.fail(1007, 'bad-text');
    }
    this.onmessage?.(text, bytes.length);
  }

  write(first, payload) {
    if (this.ended || this.socket.destroyed) return;
    const n = payload.length;
    const head = n < 126 ? Buffer.from([first, n])
      : n < 65536 ? Buffer.from([first, 126, n >> 8, n & 255])
        : Buffer.concat([Buffer.from([first, 127, 0, 0, 0, 0]), Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])]);
    this.socket.write(n ? Buffer.concat([head, payload]) : head);
  }

  send(text) {
    if (!this.closing) this.write(0x81, Buffer.from(text));
  }

  ping() {
    this.lastPing = Date.now();
    if (!this.closing) this.write(0x89, Buffer.alloc(0));
  }

  get buffered() {
    return this.socket.writableLength;
  }

  /** Sends a close frame and ends the connection. */
  close(code, reason) {
    if (this.closing) return;
    this.closing = true;
    const text = Buffer.from(String(reason).slice(0, 100));
    const payload = Buffer.alloc(2 + text.length);
    payload.writeUInt16BE(code, 0);
    text.copy(payload, 2);
    this.write(0x88, payload);
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2000).unref();
  }

  fail(code, reason) {
    this.close(code, reason);
    this.ended = true;
  }

  destroy() {
    this.socket.destroy();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.ended = true;
    this.closing = true;
    const onend = this.onend;
    this.onend = null;
    this.onmessage = null;
    connections.delete(this);
    const n = (perAddress.get(this.addr) || 1) - 1;
    if (n > 0) perAddress.set(this.addr, n);
    else perAddress.delete(this.addr);
    onend?.(this.peerCode);
  }
}

// ---------------------------------------------------------------------------
// Rooms

const games = new Map();        // game id -> Map(room key -> room)
const tokens = new Map();       // resume token -> peer
const connections = new Set();  // every open connection
const perAddress = new Map();   // address hash -> open connections
let timer = null;

const peerView = (p) => (p.guest ? { id: p.id, name: p.name, guest: true } : { id: p.id, name: p.name });

function broadcast(room, text, except = null) {
  for (const p of room.peers.values()) {
    if (p !== except) deliver(p, text);
  }
}

function deliver(peer, text) {
  const conn = peer.conn;
  if (!conn) return; // reconnecting: what it misses is lost
  if (conn.buffered > MAX_BUFFERED) {
    kick(peer, 'slow');
    return;
  }
  conn.send(text);
}

function welcome(peer) {
  const room = peer.room;
  peer.conn.send(JSON.stringify({
    t: 'welcome', room: room.name, me: peer.id, host: room.host, max: room.max, token: peer.token,
    peers: [...room.peers.values()].map(peerView),
  }));
}

/** Takes a peer out of its room, and tells the others. */
function remove(peer) {
  if (peer.removed) return;
  peer.removed = true;
  clearTimeout(peer.grace);
  tokens.delete(peer.token);
  const room = peer.room;
  room.peers.delete(peer.id);
  if (!room.peers.size) {
    const rooms = games.get(room.game);
    rooms?.delete(room.key);
    if (rooms && !rooms.size) games.delete(room.game);
    return;
  }
  // The host is the peer that has been in the room longest.
  if (room.host === peer.id) room.host = room.peers.keys().next().value;
  broadcast(room, JSON.stringify({ t: 'left', id: peer.id, host: room.host }));
}

/** Ends a peer's place in the room and its connection, with a reason. */
function kick(peer, reason) {
  const conn = peer.conn;
  peer.conn = null;
  remove(peer);
  if (conn) {
    conn.onend = null;
    conn.close(4000, reason);
  }
}

function attach(peer, conn) {
  peer.conn = conn;
  conn.onmessage = (text, bytes) => fromPeer(peer, conn, text, bytes);
  conn.onend = (code) => {
    if (peer.conn !== conn) return;
    peer.conn = null;
    // Left on purpose (leave(), or the page closed): gone now. Otherwise the
    // connection dropped: keep the place for a while.
    if (code === 1000 || code === 1001) remove(peer);
    else peer.grace = setTimeout(() => remove(peer), peer.config.graceSeconds * 1000);
  };
}

function warn(peer, reason) {
  const now = Date.now();
  if (now - (peer.warned[reason] || 0) < 1000) return;
  peer.warned[reason] = now;
  peer.conn?.send(JSON.stringify({ t: 'warn', reason }));
}

/** A token bucket: true if there is room for cost now. */
function take(bucket, cost, rate, burst) {
  const now = Date.now();
  bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * rate);
  bucket.at = now;
  if (bucket.tokens < cost) return false;
  bucket.tokens -= cost;
  return true;
}

function fromPeer(peer, conn, text, bytes) {
  if (peer.conn !== conn || peer.removed) return;
  const limits = peer.config;
  const room = peer.room;
  room.active = Date.now();
  if (bytes > limits.messageBytes + 64) return warn(peer, 'too-big');
  if (!take(peer.messages, 1, limits.messagesPerSecond, limits.messagesPerSecond)
    || !take(peer.bytes, bytes, limits.bytesPerSecond, limits.bytesPerSecond * 2)) {
    return warn(peer, 'too-fast');
  }
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return warn(peer, 'bad-message');
  }
  if (!msg || typeof msg !== 'object') return warn(peer, 'bad-message');
  if (msg.t === 'to') {
    const target = Number.isSafeInteger(msg.to) ? room.peers.get(msg.to) : null;
    if (!target || target === peer) return warn(peer, 'no-peer');
    deliver(target, JSON.stringify({ t: 'msg', from: peer.id, d: msg.d }));
  } else if (msg.t === 'all') {
    broadcast(room, JSON.stringify({ t: 'msg', from: peer.id, d: msg.d }), peer);
  } else {
    warn(peer, 'bad-message');
  }
}

/** A room's key from the name a game gives: 1 to 32 letters, numbers, spaces, _ . and -; case doesn't matter. */
function roomKey(raw) {
  let name;
  try {
    name = decodeURIComponent(raw).normalize('NFC').trim();
  } catch {
    return null;
  }
  if (!name || [...name].length > 32 || !ROOM_NAME.test(name)) return null;
  return { key: name.toLowerCase(), name };
}

/** Puts a new connection in its room, or returns why it can't go in. */
function join(ctx, conn, gameId, rawRoom) {
  const limits = ctx.config.rooms;
  const params = ctx.url.searchParams;
  if (!limits.on) return 'unavailable';
  const game = getRow(gameId);
  if (!game || game.status !== 'public') return 'no-game';
  const named = roomKey(rawRoom);
  if (!named) return 'bad-room';
  try {
    checkAddress(ctx, 'play online');
  } catch {
    return 'banned';
  }

  // Back after a dropped connection.
  const resume = params.get('resume');
  if (resume) {
    const peer = tokens.get(resume);
    if (!peer || peer.room.game !== game.id || peer.room.key !== named.key) return 'expired';
    clearTimeout(peer.grace);
    const old = peer.conn;
    if (old) {
      old.onend = null;
      old.destroy();
    }
    attach(peer, conn);
    welcome(peer);
    return null;
  }

  if (connections.size > limits.total || (perAddress.get(conn.addr) || 0) > limits.perAddress) return 'busy';
  const user = currentUser(ctx);
  let name;
  if (user) name = user.display_name || user.username;
  else {
    try {
      name = cleanGuestName(params.get('name'));
    } catch {
      return 'bad-name';
    }
  }

  let rooms = games.get(game.id);
  let room = rooms?.get(named.key);
  if (!room) {
    if (rooms && rooms.size >= limits.perGame) return 'too-many-rooms';
    const asked = Number.parseInt(params.get('max'), 10);
    const max = Math.min(limits.maxPeers, Math.max(2, Number.isFinite(asked) ? asked : 8));
    room = { game: game.id, key: named.key, name: named.name, max, peers: new Map(), nextId: 1, host: null, active: Date.now() };
    if (!rooms) games.set(game.id, rooms = new Map());
    rooms.set(named.key, room);
  } else if (room.peers.size >= room.max) {
    return 'full';
  }

  const id = room.nextId++;
  const peer = {
    id, room, config: limits, conn: null, grace: null, removed: false, warned: {},
    name: !user && name === 'Guest' ? `Guest ${id}` : name,
    guest: !user,
    token: randomBytes(18).toString('base64url'),
    messages: { tokens: limits.messagesPerSecond, at: Date.now() },
    bytes: { tokens: limits.bytesPerSecond * 2, at: Date.now() },
  };
  room.peers.set(id, peer);
  if (room.host === null) room.host = id;
  room.active = Date.now();
  tokens.set(peer.token, peer);
  attach(peer, conn);
  welcome(peer);
  broadcast(room, JSON.stringify({ t: 'joined', peer: peerView(peer) }), peer);
  return null;
}

// Once a second: pings, connections that stopped answering, idle rooms.
function sweep(limits) {
  const now = Date.now();
  const ping = limits.pingSeconds * 1000;
  for (const conn of connections) {
    if (now - conn.lastSeen > ping * 2.5) conn.destroy();
    else if (now - conn.lastPing >= ping) conn.ping();
  }
  for (const rooms of games.values()) {
    for (const room of rooms.values()) {
      if (now - room.active > limits.idleSeconds * 1000) {
        for (const peer of [...room.peers.values()]) kick(peer, 'idle');
      }
    }
  }
}

function refuse(socket, status, text) {
  socket.on('error', () => {});
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Bad Request'}\r\n`
    + `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`);
}

/**
 * The server's 'upgrade' event (server.js). ctx is as for a request: config,
 * url, ip and request (its headers, for the session cookie).
 */
export function handleUpgrade(ctx, req, socket, head) {
  const m = ROOM_PATH.exec(ctx.url.pathname);
  if (!m) return refuse(socket, 404, 'Not found.');
  const key = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' || !key) {
    return refuse(socket, 400, 'This address takes a WebSocket.');
  }
  // Browsers always send Origin. Other pages can't use the rooms through
  // their visitors; a program can say anything, and the limits are for it.
  if (req.headers.origin !== ctx.config.publicOrigin) return refuse(socket, 403, 'Rooms are for the games on this site.');

  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const conn = new Connection(socket, ipHash(ctx));
  connections.add(conn);
  perAddress.set(conn.addr, (perAddress.get(conn.addr) || 0) + 1);
  if (!timer) {
    const limits = ctx.config.rooms;
    timer = setInterval(() => sweep(limits), 1000);
    timer.unref();
  }

  let why;
  try {
    why = join(ctx, conn, m[1], m[2]);
  } catch (e) {
    console.error('rooms:', e);
    why = 'busy';
  }
  if (why) conn.close(4000, why);
  else if (head?.length) conn.feed(head);
}

/** Ends every connection (the server is stopping). */
export function closeRooms() {
  clearInterval(timer);
  timer = null;
  for (const conn of [...connections]) {
    conn.onend = null;
    conn.close(1012, 'restart');
  }
  games.clear();
  tokens.clear();
}

