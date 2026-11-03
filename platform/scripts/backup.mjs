// Copies the database to <DATA_DIR>/backups/smitten-<date>.db while the site
// runs (SQLite's online backup, so the copy is consistent), and keeps the
// newest KEEP_BACKUPS (14) of them. Game files never change in place (an
// update writes a new file and renames it), so copying the games folder
// with rsync or tar alongside is enough for them.
//
//   node scripts/backup.mjs            (deploy/smitten-backup.timer runs it daily)

import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const dir = join(config.dataDir, 'backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const dest = join(dir, `smitten-${stamp}.db`);

const db = new DatabaseSync(config.dbFile, { readOnly: true });
const pages = await backup(db, dest);
db.close();
console.log(`Backed up ${pages} pages to ${dest}`);

const keep = Number.parseInt(process.env.KEEP_BACKUPS, 10) || 14;
const old = readdirSync(dir).filter((f) => /^smitten-\d{8}-\d{6}\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) rmSync(join(dir, f));
if (old.length) console.log(`Removed ${old.length} older backup(s).`);
