// Sending mail. A request only queues a message (mail_queue in SQLite); a
// worker in the server sends it in the background, one at a time, retrying
// with backoff, so a slow or broken mail server never holds up a request.
//
// How it's sent is EMAIL_TRANSPORT (config.js, deploy/env.example):
//   smtp    a small SMTP client (node:net, node:tls): STARTTLS on 587,
//           implicit TLS on 465, AUTH PLAIN or LOGIN. Nest blocks port 25,
//           but 587 and 465 are open.
//   resend  Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
//   log     writes each message to EMAIL_LOG_FILE (JSON lines) or the
//           console: for trying things out locally, and the tests.
// Unset, there's no email: accounts work as before (src/email.js).
//
// Failures are logged with the message's number and the reason only: never
// an address, a link or a body.

import net from 'node:net';
import tls from 'node:tls';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';

const MAX_ATTEMPTS = 8;
const DAY = 86400_000;

// ---------------------------------------------------------------------------
// The queue

/**
 * Queues a message: {to, subject, text, html, userId, expiresAt}. userId ties
 * it to an account (deleting the account deletes it); expiresAt is when it's
 * no longer worth sending (a link in it expires), at most a day. Returns
 * whether it was queued (false when email is off).
 */
export function queueMail(config, { to, subject, text, html, userId = null, expiresAt = null }) {
  if (!config.email) return false;
  const now = Date.now();
  db.run(`INSERT INTO mail_queue (user_id, to_addr, subject, text_body, html_body, attempts, next_attempt_at, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`, userId, to, subject, text, html, now, now, Math.min(expiresAt ?? now + DAY, now + DAY));
  if (worker.config === config) wake(0);
  return true;
}

const worker = { config: null, timer: null, running: false, again: false };

/** Starts sending queued mail (the server does this at start). */
export function startMailWorker(config) {
  if (!config.email) return;
  worker.config = config;
  wake(0);
}

export function stopMailWorker() {
  clearTimeout(worker.timer);
  worker.config = null;
}

function wake(ms) {
  clearTimeout(worker.timer);
  worker.timer = setTimeout(drain, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
  worker.timer.unref();
}

async function drain() {
  if (worker.running) {
    worker.again = true;
    return;
  }
  const config = worker.config;
  if (!config) return;
  worker.running = true;
  try {
    for (;;) {
      worker.again = false;
      const now = Date.now();
      db.run('DELETE FROM mail_queue WHERE expires_at <= ?', now);
      const row = db.get('SELECT * FROM mail_queue WHERE next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT 1', now);
      if (!row) break;
      await attempt(config, row);
    }
  } catch (e) {
    console.error('Mail: the queue failed:', clean(e?.message || e));
  } finally {
    worker.running = false;
  }
  if (!worker.config) return;
  const next = db.get('SELECT MIN(next_attempt_at) AS t FROM mail_queue').t;
  if (worker.again) wake(0);
  else if (next != null) wake(next - Date.now());
}

async function attempt(config, row) {
  const attempts = row.attempts + 1;
  try {
    await send(config, { id: row.id, createdAt: row.created_at, to: row.to_addr, subject: row.subject, text: row.text_body, html: row.html_body });
    db.run('DELETE FROM mail_queue WHERE id = ?', row.id);
  } catch (e) {
    const reason = clean(e?.message || e);
    if (e?.permanent || attempts >= MAX_ATTEMPTS) {
      db.run('DELETE FROM mail_queue WHERE id = ?', row.id);
      console.error(`Mail #${row.id}: not sent, giving up after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${reason}`);
      return;
    }
    // 1, 4, 16, 64 … times the base (30 s), at most 6 hours.
    const delay = Math.min(config.email.retryBaseMs * 4 ** (attempts - 1), 6 * 3600_000);
    db.run('UPDATE mail_queue SET attempts = ?, next_attempt_at = ? WHERE id = ?', attempts, Date.now() + delay, row.id);
    console.error(`Mail #${row.id}: not sent (attempt ${attempts}), trying again in ${Math.round(delay / 1000)} s: ${reason}`);
  }
}

/** An error message for the log: no addresses, no line breaks, not too long. */
function clean(message) {
  return String(message)
    .replace(/<?[^\s<>@"']+@[^\s<>@"']+>?/g, '<address>')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);
}

// ---------------------------------------------------------------------------
// Sending one message

/** Sends {id, createdAt, to, subject, text, html} with the configured transport. Throws {permanent} errors. */
export async function send(config, message) {
  const email = config.email;
  if (email.transport === 'log') return sendLog(email, message);
  if (email.transport === 'resend') return sendResend(email, message);
  const data = buildMessage({ ...message, from: email.from, fromAddress: email.fromAddress });
  return sendSmtp(email.smtp, { from: email.fromAddress, to: message.to, data });
}

function sendLog(email, message) {
  const entry = { at: new Date().toISOString(), from: email.from, to: message.to, subject: message.subject, text: message.text, html: message.html };
  if (email.logFile) appendFileSync(email.logFile, `${JSON.stringify(entry)}\n`);
  else console.log(`\n--- Mail to ${message.to}: ${message.subject}\n${message.text}\n---\n`);
}

class MailError extends Error {
  constructor(message, permanent = false) {
    super(message);
    this.permanent = permanent;
  }
}

async function sendResend(email, message) {
  let res;
  try {
    res = await fetch(`${email.resend.url}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${email.resend.apiKey}`,
        'Content-Type': 'application/json',
        // The same message isn't sent twice if a retry follows a lost answer.
        'Idempotency-Key': `smitten-${message.id}-${message.createdAt}`,
      },
      body: JSON.stringify({
        from: email.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'Auto-Submitted': 'auto-generated' },
      }),
      signal: AbortSignal.timeout(email.timeoutMs),
    });
  } catch (e) {
    throw new MailError(`Resend: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
  }
  if (res.ok) return;
  const data = await res.json().catch(() => null);
  const detail = data?.message ? `: ${data.message}` : '';
  // 4xx (other than 408, 409 and 429) won't get better by retrying.
  throw new MailError(`Resend answered ${res.status}${detail}`, res.status >= 400 && res.status < 500 && ![408, 409, 429].includes(res.status));
}

// ---------------------------------------------------------------------------
// Building a message (RFC 5322 and MIME): multipart/alternative with a text
// and an HTML part, both quoted-printable UTF-8, CRLF line endings.

/** A header value: as is when it's plain ASCII, otherwise RFC 2047 encoded words. */
export function encodeHeader(value) {
  const text = String(value).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words = [];
  let chunk = '';
  for (const ch of text) {
    // An encoded word is at most 75 characters; 39 bytes make 64, so a
    // "Subject: " line stays within 78.
    if (Buffer.byteLength(chunk + ch) > 39) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

/** Quoted-printable (RFC 2045) of UTF-8 text, lines at most 76 characters. */
export function quotedPrintable(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const bytes = Buffer.from(line, 'utf8');
    let out = '';
    let current = '';
    bytes.forEach((b, i) => {
      const last = i === bytes.length - 1;
      const plain = (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !last);
      const token = plain ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`;
      if (current.length + token.length > 75) {
        out += `${current}=\r\n`;
        current = '';
      }
      current += token;
    });
    return out + current;
  }).join('\r\n');
}

function rfc5322Date(date = new Date()) {
  return date.toUTCString().replace(/GMT$/, '+0000');
}

/** The whole message, ready for SMTP's DATA (before dot-stuffing). */
export function buildMessage({ from, fromAddress, to, subject, text, html, date = new Date() }) {
  const domain = fromAddress.split('@')[1] || 'localhost';
  const boundary = `=_smitten_${randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${from}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${rfc5322Date(date)}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
    `Content-Type: multipart/alternative;\r\n boundary="${boundary}"`,
  ];
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=utf-8`,
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(body),
  ].join('\r\n');
  return [headers.join('\r\n'), '', part('text/plain', text), part('text/html', html), `--${boundary}--`, ''].join('\r\n');
}

/** SMTP's transparency (RFC 5321 4.5.2): a line starting with "." gets another. */
export function dotStuff(data) {
  return data.replace(/\r\n/g, '\n').split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

// ---------------------------------------------------------------------------
// SMTP (RFC 5321), with STARTTLS (RFC 3207) and AUTH PLAIN/LOGIN (RFC 4954)

/** Reads replies (possibly multi-line: "250-…" then "250 …") from a socket. */
class Replies {
  constructor(timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.lines = [];
    this.ready = [];
    this.waiting = null;
    this.error = null;
  }

  attach(socket) {
    this.socket = socket;
    this.onData = (chunk) => this.push(chunk);
    this.onError = (e) => this.fail(new MailError(`SMTP: ${e.code || e.message}`));
    this.onClose = () => this.fail(new MailError('SMTP: the server closed the connection'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  push(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('latin1') : chunk;
    if (this.buffer.length > 64 * 1024) return this.fail(new MailError('SMTP: the reply is too long'));
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, '');
      this.buffer = this.buffer.slice(i + 1);
      const m = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (!m) return this.fail(new MailError('SMTP: the server sent something that isn\'t SMTP'));
      this.lines.push(m[3]);
      if (m[2] !== '-') {
        this.ready.push({ code: Number(m[1]), lines: this.lines });
        this.lines = [];
      }
    }
    this.flush();
  }

  fail(error) {
    this.error ??= error;
    this.flush();
  }

  flush() {
    if (!this.waiting) return;
    const { resolve, reject, timer } = this.waiting;
    if (this.ready.length) resolve(this.ready.shift());
    else if (this.error) reject(this.error);
    else return;
    clearTimeout(timer);
    this.waiting = null;
  }

  next() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new MailError('SMTP: timed out waiting for the server'));
      }, this.timeoutMs);
      this.waiting = { resolve, reject, timer };
      this.flush();
    });
  }
}

function connect(smtp, tlsOptions) {
  return new Promise((resolve, reject) => {
    const options = { host: smtp.host, port: smtp.port };
    const socket = smtp.secure === 'tls'
      ? tls.connect({ ...options, servername: net.isIP(smtp.host) ? undefined : smtp.host, ...tlsOptions })
      : net.connect(options);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new MailError('SMTP: timed out connecting'));
    }, smtp.timeoutMs);
    socket.once(smtp.secure === 'tls' ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      socket.off('error', onError);
      resolve(socket);
    });
    const onError = (e) => {
      clearTimeout(timer);
      reject(new MailError(`SMTP: couldn't connect (${e.code || e.message})`));
    };
    socket.once('error', onError);
  });
}

function upgrade(socket, smtp, tlsOptions) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: net.isIP(smtp.host) ? undefined : smtp.host, ...tlsOptions });
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new MailError('SMTP: timed out starting TLS'));
    }, smtp.timeoutMs);
    secure.once('secureConnect', () => {
      clearTimeout(timer);
      secure.off('error', onError);
      resolve(secure);
    });
    const onError = (e) => {
      clearTimeout(timer);
      reject(new MailError(`SMTP: TLS failed (${e.code || e.message})`));
    };
    secure.once('error', onError);
  });
}

/**
 * Sends one message: {from, to, data} (data from buildMessage). smtp:
 * {host, port, secure: 'tls' | 'starttls' | 'none', user, pass, helo,
 * timeoutMs}. tlsOptions are passed to node:tls (the tests' own CA).
 */
export async function sendSmtp(smtp, { from, to, data }, { tlsOptions = {} } = {}) {
  let socket = await connect(smtp, tlsOptions);
  let replies = new Replies(smtp.timeoutMs);
  replies.attach(socket);
  let encrypted = smtp.secure === 'tls';

  const expect = async (codes, what) => {
    const reply = await replies.next();
    if (!codes.includes(reply.code)) {
      throw new MailError(`SMTP: ${what} answered ${reply.code} ${reply.lines.join(' ').slice(0, 200)}`, reply.code >= 500);
    }
    return reply;
  };
  const command = (line, codes, what = line.split(' ')[0]) => {
    socket.write(`${line}\r\n`);
    return expect(codes, what);
  };

  try {
    await expect([220], 'the greeting');
    let ehlo = await command(`EHLO ${smtp.helo}`, [250]);
    const has = (ext) => ehlo.lines.some((l) => l.toUpperCase().split(/\s+/)[0] === ext);

    if (smtp.secure === 'starttls') {
      if (!has('STARTTLS')) throw new MailError("SMTP: the server doesn't offer STARTTLS (set SMTP_SECURE=tls for port 465)", true);
      await command('STARTTLS', [220]);
      replies.detach();
      socket = await upgrade(socket, smtp, tlsOptions);
      replies = new Replies(smtp.timeoutMs);
      replies.attach(socket);
      encrypted = true;
      ehlo = await command(`EHLO ${smtp.helo}`, [250]);
    }

    if (smtp.user) {
      if (!encrypted && smtp.secure !== 'none') throw new MailError('SMTP: refusing to send the password without TLS', true);
      const auth = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l));
      const mechanisms = auth ? auth.slice(5).toUpperCase().split(/\s+/) : [];
      const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
      if (mechanisms.includes('PLAIN')) {
        await command(`AUTH PLAIN ${b64(`\0${smtp.user}\0${smtp.pass}`)}`, [235], 'AUTH PLAIN');
      } else if (mechanisms.includes('LOGIN')) {
        await command('AUTH LOGIN', [334], 'AUTH LOGIN');
        await command(b64(smtp.user), [334], 'AUTH LOGIN (username)');
        await command(b64(smtp.pass), [235], 'AUTH LOGIN (password)');
      } else {
        throw new MailError("SMTP: the server doesn't offer AUTH PLAIN or LOGIN", true);
      }
    }

    await command(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
    await command(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await command('DATA', [354]);
    const body = dotStuff(data);
    socket.write(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`);
    await expect([250], 'the message');
    socket.write('QUIT\r\n');
    await Promise.race([replies.next().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
  } finally {
    replies.detach();
    socket.on('error', () => {});
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref();
  }
}
