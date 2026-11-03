-- Email on accounts (src/email.js), only when the site can send mail
-- (EMAIL_TRANSPORT). An address is optional, never shown to anyone but its
-- owner, and only used for account mail: confirming it, password resets,
-- "your password was changed" and "a moderator hid or restored your game".

-- The confirmed address (lower case), or NULL. An address waiting to be
-- confirmed lives only in email_tokens until its link is opened.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
CREATE UNIQUE INDEX users_email ON users (email) WHERE email IS NOT NULL;

-- Links sent by email, single use. Only the SHA-256 of a token is stored.
--   'verify': confirms `email` for the account (24 hours; the newest only).
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX email_tokens_user ON email_tokens (user_id, purpose);

-- Password reset links: 'admin' (made by a moderator, 24 hours) or 'email'
-- (asked for at /recover, 1 hour).
ALTER TABLE password_resets ADD COLUMN kind TEXT NOT NULL DEFAULT 'admin';

-- Mail waiting to be sent. A request only adds a row; src/mail.js sends it
-- in the background, retrying with backoff, and deletes it once it's sent,
-- has failed for good, or is no longer useful (expires_at: a link in it has
-- expired). Deleting the account deletes its queued mail.
CREATE TABLE mail_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX mail_queue_next ON mail_queue (next_attempt_at);
