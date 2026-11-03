// Moderation from the server's shell: calls the admin API of the site
// running on this machine with ADMIN_TOKEN (from the environment or .env).
//
//   node scripts/admin.mjs reports                 hidden and reported games
//   node scripts/admin.mjs hide <game id>
//   node scripts/admin.mjs restore <game id>        make it public, close its reports
//   node scripts/admin.mjs delete <game id>
//   node scripts/admin.mjs user <username>          an account and its games
//   node scripts/admin.mjs email <username>         whether it has a confirmed email (masked, never the whole address)
//   node scripts/admin.mjs ban <username> [reason]  sign out, hide games, block sign-in
//   node scripts/admin.mjs ban-network <username> [reason]  the account and the addresses it used (30 days)
//   node scripts/admin.mjs ban-ip <address> [reason]     no new accounts, publishing or reports from it (30 days)
//   node scripts/admin.mjs unban-ip <address>
//   node scripts/admin.mjs ip-bans                      address bans in force (as hashes)
//   node scripts/admin.mjs unban <username>
//   node scripts/admin.mjs reset-link <username>    a one-time link to set a new password
//   node scripts/admin.mjs delete-user <username>   the account and all its games
//   node scripts/admin.mjs log                      what moderators did
//   node scripts/admin.mjs request                  the client address the server sees (checks TRUST_PROXY)

import { loadConfig } from '../src/config.js';

const config = loadConfig();
const [command, arg, ...rest] = process.argv.slice(2);
const base = process.env.ADMIN_URL || `http://127.0.0.1:${config.port}`;

const COMMANDS = {
  reports: ['GET', () => '/api/admin/reports'],
  log: ['GET', () => '/api/admin/log'],
  request: ['GET', () => '/api/admin/request'],
  hide: ['POST', (id) => `/api/admin/games/${id}/hide`],
  restore: ['POST', (id) => `/api/admin/games/${id}/restore`],
  delete: ['DELETE', (id) => `/api/admin/games/${id}`],
  user: ['GET', (name) => `/api/admin/users/${encodeURIComponent(name)}`],
  email: ['GET', (name) => `/api/admin/users/${encodeURIComponent(name)}`, null,
    (data) => (data?.user ? { username: data.user.username, email: data.user.email, emailPending: data.user.emailPending } : data)],
  ban: ['POST', (name) => `/api/admin/users/${encodeURIComponent(name)}/ban`, () => ({ reason: rest.join(' ') })],
  unban: ['POST', (name) => `/api/admin/users/${encodeURIComponent(name)}/unban`],
  'ban-network': ['POST', (name) => `/api/admin/users/${encodeURIComponent(name)}/ban`, () => ({ reason: rest.join(' '), addresses: true })],
  'ban-ip': ['POST', () => '/api/admin/addresses/ban', (ip) => ({ ip, reason: rest.join(' ') })],
  'unban-ip': ['POST', () => '/api/admin/addresses/unban', (ip) => ({ ip })],
  'ip-bans': ['GET', () => '/api/admin/addresses'],
  'reset-link': ['POST', (name) => `/api/admin/users/${encodeURIComponent(name)}/reset-password`],
  'delete-user': ['DELETE', (name) => `/api/admin/users/${encodeURIComponent(name)}`],
};

const spec = COMMANDS[command];
if (!spec || ((spec[1].length || spec[2]?.length) && !arg)) {
  console.error('Usage: node scripts/admin.mjs <command> [argument]\nCommands: ' + Object.keys(COMMANDS).join(', '));
  process.exit(2);
}
if (!config.adminToken) {
  console.error('Set ADMIN_TOKEN (in .env or the environment) first.');
  process.exit(2);
}

const [method, path, body, show = (data) => data] = spec;
const headers = { Authorization: `Bearer ${config.adminToken}` };
const payload = body ? JSON.stringify(body(arg)) : undefined;
if (payload) headers['Content-Type'] = 'application/json';
let res;
try {
  res = await fetch(`${base}${path(arg)}`, { method, headers, body: payload });
} catch {
  console.error(`Nothing answers at ${base}. Is the site running?`);
  process.exit(1);
}
const data = await res.json().catch(() => null);
console.log(JSON.stringify(res.ok ? show(data) : data, null, 2));
process.exit(res.ok ? 0 : 1);
