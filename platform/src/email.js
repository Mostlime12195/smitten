// Email on accounts, when the site can send mail (EMAIL_TRANSPORT; mail.js
// sends it). An address is optional. It's never shown publicly or to anyone
// but its owner, and it's only used for account mail:
//   - confirming it (a link, 24 hours),
//   - resetting a forgotten password (a link from /recover, 1 hour),
//   - "your password was changed", "your email was changed/removed",
//   - "a moderator hid your game" / "your game is back".
// No marketing, no tracking: plain text and simple HTML.
//
// An address only counts once it's confirmed: until then it waits in
// email_tokens, and only a confirmed one can get reset links. A confirmed
// address belongs to one account. Answers never say whether an address is
// on an account: adding one that's taken looks the same as any other (the
// address gets a note instead of a link), and asking for a reset link
// always says "if it's on an account, we've sent a link".

import { HttpError, json, readJson } from './http.js';
import { db, hmac, newToken, rateLimit, sha256 } from './db.js';
import { confirmPassword, ipHash, requireSameOrigin, requireUser } from './auth.js';
import { checkAddress } from './bans.js';
import { EMAIL_PATTERN } from './config.js';
import { queueMail } from './mail.js';

const HOUR = 3600_000;
export const VERIFY_MS = 24 * HOUR;
export const RESET_MS = HOUR;

// Rate limits, per hour.
const LIMITS = {
  verifyPerAccount: 5, // confirmation mails an account asks for
  verifyPerAddress: 3, // confirmation mails one address gets, from any account
  resetPerIp: 10,
  resetPerAddress: 3,
  resetPerAccount: 3,
  verifyPerIp: 30, // links opened
};

const turnedOff = () => new HttpError(404, "This site doesn't send email.", { code: 'email-off' });

function requireMail(ctx) {
  if (!ctx.config.email) throw turnedOff();
}

/** A cleaned-up address (trimmed, lower case), or a 422 for the email field. */
export function cleanEmail(value) {
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!address) throw new HttpError(422, 'Type your email address.', { field: 'email' });
  if (address.length > 254 || !EMAIL_PATTERN.test(address) || address.includes('..')) {
    throw new HttpError(422, "That doesn't look like an email address.", { field: 'email' });
  }
  return address;
}

/** For rate limits: a salted hash, so the limits table holds no addresses. */
const addressKey = (ctx, address) => hmac(ctx.config.secret, `email|${address}`).slice(0, 32);

/** "k***@g***.com", for moderators. */
export function maskEmail(address) {
  if (!address) return null;
  const [local, domain = ''] = address.split('@');
  const parts = domain.split('.');
  const tld = parts.length > 1 ? `.${parts.pop()}` : '';
  return `${local[0]}***@${(parts.join('.')[0] || '')}***${tld}`;
}

function pendingRow(userId) {
  return db.get("SELECT email, expires_at FROM email_tokens WHERE user_id = ? AND purpose = 'verify' AND expires_at > ? ORDER BY created_at DESC LIMIT 1", userId, Date.now());
}

/** What the account page shows: {email, pendingEmail: {address, expiresAt} | null}. */
export function emailState(user) {
  const pending = pendingRow(user.id);
  return {
    email: user.email || null,
    pendingEmail: pending ? { address: pending.email, expiresAt: pending.expires_at } : null,
  };
}

// ---------------------------------------------------------------------------
// The messages

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A message in the site's look: {subject, title, paragraphs, button: {label,
 * url}, after}. Returns {subject, text, html}. Paragraphs are plain text.
 */
function message(ctx, { subject, title, paragraphs, button = null, after = [] }) {
  const host = new URL(ctx.origin).host;
  const footer = `You're getting this because this address was given for a Smitten account at ${host}. Smitten never asks for your password by email.`;
  const text = [
    title,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(button ? [`${button.label}:`, button.url, ''] : []),
    ...after.flatMap((p) => [p, '']),
    '--',
    footer,
    '',
  ].join('\n');

  const font = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif";
  const p = (t, style = '') => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;${style}">${escapeHtml(t)}</p>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#f7f7f8;color:#18181b;font-family:${font};">
<div style="max-width:480px;margin:0 auto;padding:24px;border:1px solid #e3e3e7;border-radius:12px;background:#ffffff;">
<p style="margin:0 0 18px;font-size:15px;font-weight:650;"><span style="color:#e5487a;">&#9829;</span> Smitten</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:650;">${escapeHtml(title)}</h1>
${paragraphs.map((t) => p(t)).join('\n')}
${button ? `<p style="margin:20px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 12px;font-size:13px;line-height:1.45;color:#585b64;">Or open this link: <a href="${escapeHtml(button.url)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(button.url)}</a></p>` : ''}
${after.map((t) => p(t, 'color:#585b64;font-size:14px;')).join('\n')}
<p style="margin:20px 0 0;padding-top:14px;border-top:1px solid #e3e3e7;font-size:12px;line-height:1.45;color:#8a8d96;">${escapeHtml(footer)}</p>
</div>
</body>
</html>
`;
  return { subject, text, html };
}

/** Queues a message to an account's confirmed address, if it has one and is in good standing. */
function mailAccount(ctx, user, content) {
  if (!ctx.config.email || !user?.email || user.status !== 'active') return false;
  return queueMail(ctx.config, { to: user.email, userId: user.id, ...message(ctx, content) });
}

// ---------------------------------------------------------------------------
// Confirming an address

/**
 * Starts confirming an address for an account: a link to it (or, if another
 * account has it, a note saying so; the answer is the same). The newest
 * address waiting replaces any earlier one.
 */
export function startVerification(ctx, user, address) {
  rateLimit(`email-verify:a:${addressKey(ctx, address)}`, LIMITS.verifyPerAddress, 'sent mail to that address');
  rateLimit(`email-verify:u:${user.id}`, LIMITS.verifyPerAccount, 'asked for confirmation emails');
  const owner = db.get('SELECT id, username FROM users WHERE email = ?', address);
  const token = newToken();
  const now = Date.now();
  db.tx(() => {
    db.run("DELETE FROM email_tokens WHERE (user_id = ? AND purpose = 'verify') OR expires_at < ?", user.id, now);
    // When the address is taken, the stored token is never sent: it can't be used.
    db.run("INSERT INTO email_tokens (token_hash, user_id, purpose, email, created_at, expires_at) VALUES (?, ?, 'verify', ?, ?, ?)",
      sha256(owner ? newToken() : token), user.id, address, now, now + VERIFY_MS);
  });
  if (owner) {
    queueMail(ctx.config, {
      to: address,
      userId: owner.id,
      ...message(ctx, {
        subject: 'This email is already on a Smitten account',
        title: 'This email is already on a Smitten account',
        paragraphs: [
          `Someone tried to add this address to another Smitten account. It's already on yours (@${owner.username}), so nothing changed.`,
          "If that was you and you can't get into your account, you can reset your password:",
        ],
        button: { label: 'Reset my password', url: `${ctx.origin}/recover` },
        after: ["If it wasn't you, you don't need to do anything."],
      }),
    });
    return;
  }
  queueMail(ctx.config, {
    to: address,
    userId: user.id,
    expiresAt: now + VERIFY_MS,
    ...message(ctx, {
      subject: 'Confirm your email for Smitten',
      title: 'Confirm your email',
      paragraphs: [
        `Open this link to add this address to your Smitten account, @${user.username}. It works once, for 24 hours.`,
        "Then you can reset your password by email if you forget it. We'll only write about your account: no newsletters.",
      ],
      button: { label: 'Confirm my email', url: `${ctx.origin}/verify-email#token=${token}` },
      after: ["If you didn't ask for this, ignore this email. Nothing changes until the link is opened."],
    }),
  });
}

/** POST /api/auth/verify-email {token}: confirms the address the link was sent to. Works from any browser. */
export async function verifyEmail(ctx) {
  requireSameOrigin(ctx);
  requireMail(ctx);
  const body = await readJson(ctx.request);
  rateLimit(`email-verify:ip:${ipHash(ctx)}`, LIMITS.verifyPerIp, 'opened confirmation links');
  const token = typeof body.token === 'string' && body.token.length < 200 ? body.token : '';
  const row = token ? db.get("SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = 'verify'", sha256(token)) : null;
  if (!row || row.expires_at < Date.now()) {
    throw new HttpError(400, "That link doesn't work anymore. You can send a new one from your account settings.", { code: 'bad-link' });
  }
  const user = db.get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user || user.status !== 'active') throw new HttpError(400, "That link doesn't work anymore.", { code: 'bad-link' });
  const taken = () => new HttpError(409, 'That address is already on another Smitten account.', { code: 'email-taken' });
  if (db.get('SELECT id FROM users WHERE email = ? AND id != ?', row.email, user.id)) {
    db.run('DELETE FROM email_tokens WHERE token_hash = ?', row.token_hash);
    throw taken();
  }
  const now = Date.now();
  try {
    db.tx(() => {
      db.run('UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?', row.email, now, now, user.id);
      db.run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'verify'", user.id);
      // Reset links sent to an earlier address stop working.
      db.run("DELETE FROM password_resets WHERE user_id = ? AND kind = 'email'", user.id);
    });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw taken();
    throw e;
  }
  if (user.email && user.email !== row.email) {
    mailAccount(ctx, user, {
      subject: 'Your Smitten email was changed',
      title: 'Your email was changed',
      paragraphs: [
        `The email on your Smitten account, @${user.username}, was changed, so mail about it goes to the new address from now on.`,
        "If you didn't do this, sign in and change your password, or reset it:",
      ],
      button: { label: 'Reset my password', url: `${ctx.origin}/recover` },
    });
  }
  return json({ ok: true, username: user.username, email: row.email });
}

// ---------------------------------------------------------------------------
// The account's address (account settings; a web session)

/** POST /api/account/email {email, password}: add or change the address (it's confirmed by a link first). */
export async function setEmail(ctx) {
  requireMail(ctx);
  const user = requireUser(ctx);
  const body = await readJson(ctx.request);
  const address = cleanEmail(body.email);
  if (user.password_hash) await confirmPassword(ctx, user, body.password);
  if (address === user.email) throw new HttpError(422, "That's already your email.", { field: 'email' });
  startVerification(ctx, user, address);
  return json(emailState(user));
}

/** POST /api/account/email/resend: a new link for the address waiting to be confirmed. */
export function resendVerification(ctx) {
  requireMail(ctx);
  const user = requireUser(ctx);
  const pending = pendingRow(user.id);
  if (!pending) throw new HttpError(404, 'There is no email waiting to be confirmed.', { code: 'nothing-pending' });
  startVerification(ctx, user, pending.email);
  return json(emailState(user));
}

/** POST /api/account/email/cancel: forget the address waiting to be confirmed. */
export function cancelPendingEmail(ctx) {
  const user = requireUser(ctx);
  db.run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'verify'", user.id);
  return json(emailState(user));
}

/** DELETE /api/account/email {password}: remove the address (and any waiting). Works when email is off, too. */
export async function removeEmail(ctx) {
  const user = requireUser(ctx);
  const body = await readJson(ctx.request);
  if (user.password_hash) await confirmPassword(ctx, user, body.password);
  db.tx(() => {
    db.run('UPDATE users SET email = NULL, email_verified_at = NULL, updated_at = ? WHERE id = ?', Date.now(), user.id);
    db.run('DELETE FROM email_tokens WHERE user_id = ?', user.id);
    db.run("DELETE FROM password_resets WHERE user_id = ? AND kind = 'email'", user.id);
    // Nothing else goes out to it (the note below is queued afterwards).
    db.run('DELETE FROM mail_queue WHERE user_id = ?', user.id);
  });
  if (user.email) {
    mailAccount(ctx, user, {
      subject: 'Your email was removed from Smitten',
      title: 'Your email was removed',
      paragraphs: [
        `This address was removed from your Smitten account, @${user.username}. This is the last email about it you'll get from us.`,
        "If you didn't do this, sign in and change your password.",
      ],
    });
  }
  return json({ email: null, pendingEmail: null });
}

// ---------------------------------------------------------------------------
// Resetting a password by email

/**
 * POST /api/auth/recover/email {email}: a reset link (1 hour) to the
 * address, if it's confirmed on an account. The answer is the same either
 * way. Limited per address (network), per address (email) and per account;
 * a network a moderator banned can't send them.
 */
export async function requestReset(ctx) {
  requireSameOrigin(ctx);
  requireMail(ctx);
  const body = await readJson(ctx.request);
  rateLimit(`reset-mail:ip:${ipHash(ctx)}`, LIMITS.resetPerIp, 'asked for reset links');
  checkAddress(ctx, 'send password reset emails');
  const address = cleanEmail(body.email);
  rateLimit(`reset-mail:a:${addressKey(ctx, address)}`, LIMITS.resetPerAddress, 'asked for reset links for that address');
  const user = db.get('SELECT * FROM users WHERE email = ? AND email_verified_at IS NOT NULL', address);
  if (user && user.status === 'active') {
    let allowed = true;
    try {
      rateLimit(`reset-mail:u:${user.id}`, LIMITS.resetPerAccount, '');
    } catch {
      // Over the account's limit: quietly nothing, so the answer doesn't change.
      allowed = false;
    }
    if (allowed) {
      const token = newToken();
      const now = Date.now();
      db.run('DELETE FROM password_resets WHERE expires_at < ?', now);
      db.run("INSERT INTO password_resets (token_hash, user_id, expires_at, kind) VALUES (?, ?, ?, 'email')", sha256(token), user.id, now + RESET_MS);
      mailAccount(ctx, user, {
        subject: 'Reset your Smitten password',
        title: 'Reset your password',
        paragraphs: [
          `Someone asked to reset the password for your Smitten account. Your username is @${user.username}.`,
          'Open this link to choose a new password. It works once, for an hour.',
        ],
        button: { label: 'Choose a new password', url: `${ctx.origin}/recover#reset=${token}` },
        after: [
          user.hackclub_id && !user.password_hash ? 'You can also keep signing in with Hack Club, without a password.' : null,
          "If you didn't ask for this, ignore this email: your password stays the same.",
        ].filter(Boolean),
      });
    }
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Notes about the account

export function notifyPasswordChanged(ctx, user) {
  mailAccount(ctx, user, {
    subject: 'Your Smitten password was changed',
    title: 'Your password was changed',
    paragraphs: [
      `The password for your Smitten account, @${user.username}, was just changed, and everywhere else you were signed in has been signed out.`,
      "If you did this, you're all set. If you didn't, reset it now:",
    ],
    button: { label: 'Reset my password', url: `${ctx.origin}/recover` },
  });
}

/** A moderator hid (or restored) a game: tells its owner. */
export function notifyGame(ctx, game, action) {
  if (!game.owner_id) return;
  const user = db.get('SELECT * FROM users WHERE id = ?', game.owner_id);
  const hidden = action === 'hidden';
  mailAccount(ctx, user, hidden ? {
    subject: 'A moderator hid one of your games',
    title: 'A moderator hid your game',
    paragraphs: [
      `A moderator hid your game “${game.title}” from Smitten. People can't find or play it now.`,
      "It's still in your account settings, where you can delete it. Games are hidden when they break the site's rules, like sharing personal information, being mean to people, or showing things that aren't okay for everyone.",
    ],
    button: { label: 'Your games', url: `${ctx.origin}/account` },
  } : {
    subject: 'Your game is back on Smitten',
    title: 'Your game is back',
    paragraphs: [`A moderator looked at your game “${game.title}”, and it's public again: people can find and play it.`],
    button: { label: 'See it', url: `${ctx.origin}/play/${game.id}` },
  });
}
