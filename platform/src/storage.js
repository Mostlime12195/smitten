// Game files on disk: <DATA_DIR>/games/<id>/game.love (the source, for
// remixing), play.love (the play build, what the play page runs; games
// published before play builds have none) and thumbnail.png.
// Writes go to a temporary file first and are renamed into place, so a
// download never sees half a file.

import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

let gamesDir = null;

export function initStorage(config) {
  gamesDir = config.gamesDir;
}

const dirOf = (id) => join(gamesDir, id);
export const GAME_FILE = 'game.love';
export const PLAY_FILE = 'play.love';
export const THUMBNAIL_FILE = 'thumbnail.png';

async function writeAtomic(path, bytes) {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

/**
 * Stores a game's files. No thumbnail removes the old one; no play build
 * removes the old one too, so the play page never runs an older version.
 */
export async function storeGameFiles(id, gameBytes, thumbnail, playBytes = null) {
  await mkdir(dirOf(id), { recursive: true });
  await writeAtomic(join(dirOf(id), GAME_FILE), gameBytes);
  if (playBytes) await writeAtomic(join(dirOf(id), PLAY_FILE), playBytes);
  else await rm(join(dirOf(id), PLAY_FILE), { force: true });
  if (thumbnail) await writeAtomic(join(dirOf(id), THUMBNAIL_FILE), thumbnail);
  else await rm(join(dirOf(id), THUMBNAIL_FILE), { force: true });
}

export async function removeGameFiles(id) {
  await rm(dirOf(id), { recursive: true, force: true });
}

/**
 * A stored file as {size, etag, notModified, body}, or null if it's missing.
 * notModified: the request's If-None-Match matches. body is a stream, except
 * for HEAD requests and 304s.
 */
export async function readGameFile(id, name, request) {
  const path = join(dirOf(id), name);
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const match = (request.headers.get('If-None-Match') || '').split(',').map((s) => s.trim().replace(/^W\//, ''));
  const notModified = match.includes(etag) || match.includes('*');
  const body = notModified || request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path));
  return { size: info.size, etag, notModified, body };
}
