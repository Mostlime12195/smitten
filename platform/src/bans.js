// Address bans. Accounts stay open to everyone; when someone keeps coming
// back with new accounts, a moderator can block their network (by the salted
// hash of its address) from making accounts, publishing and reporting.
// Playing stays open. A ban lasts 30 days unless told otherwise, since a
// school or a phone network shares an address with many people.

import { HttpError } from './http.js';
import { db } from './db.js';
import { ipHash } from './auth.js';

const DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_BAN_DAYS = 30;

function activeBan(hash) {
  return db.get('SELECT reason, expires_at FROM address_bans WHERE ip_hash = ? AND (expires_at IS NULL OR expires_at > ?)', hash, Date.now());
}

/** Refuses the request if this address is banned. what: "make accounts", "publish" … */
export function checkAddress(ctx, what) {
  const ban = activeBan(ipHash(ctx));
  if (!ban) return;
  const until = ban.expires_at ? ` until ${new Date(ban.expires_at).toISOString().slice(0, 10)}` : '';
  throw new HttpError(403, `A moderator has stopped this network from being used to ${what}${until}. You can still play games.`, { code: 'address-banned' });
}

/** Remembers that an account was used from this address (for banning it later). */
export function noteAddress(ctx, userId) {
  const now = Date.now();
  db.run(`INSERT INTO user_addresses (user_id, ip_hash, last_seen) VALUES (?, ?, ?)
          ON CONFLICT (user_id, ip_hash) DO UPDATE SET last_seen = excluded.last_seen`, userId, ipHash(ctx), now);
  db.run('DELETE FROM user_addresses WHERE last_seen < ?', now - 30 * DAY);
}

/** The address hashes an account was used from lately. */
export function addressesOf(userId) {
  return db.all('SELECT ip_hash FROM user_addresses WHERE user_id = ? ORDER BY last_seen DESC', userId).map((r) => r.ip_hash);
}

/** Bans address hashes for days (0: until lifted). Returns how many. */
export function banAddresses(hashes, reason = '', days = DEFAULT_BAN_DAYS) {
  const now = Date.now();
  const expires = days > 0 ? now + days * DAY : null;
  db.tx(() => {
    for (const hash of hashes) {
      db.run(`INSERT INTO address_bans (ip_hash, reason, created_at, expires_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (ip_hash) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at, expires_at = excluded.expires_at`,
      hash, reason, now, expires);
    }
  });
  return hashes.length;
}

export function unbanAddresses(hashes) {
  let n = 0;
  db.tx(() => {
    for (const hash of hashes) n += Number(db.run('DELETE FROM address_bans WHERE ip_hash = ?', hash).changes);
  });
  return n;
}

export function listAddressBans() {
  db.run('DELETE FROM address_bans WHERE expires_at IS NOT NULL AND expires_at <= ?', Date.now());
  return db.all('SELECT ip_hash AS hash, reason, created_at AS createdAt, expires_at AS expiresAt FROM address_bans ORDER BY created_at DESC');
}
