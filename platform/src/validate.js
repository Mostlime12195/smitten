// Checks for what people publish: titles, descriptions, the word filter,
// thumbnails, engine modules and report reasons.

import blocked from '../config/blocked-words.json';
import { HttpError } from './http.js';

export const LIMITS = {
  title: 60,
  description: 1000,
  note: 500,
  thumbnailSide: 4096,
};

// The optional engine modules a game can ask the player to load
// (web/editor/core/modules.js).
export const MODULES = ['physics2d', '3d', 'physics3d', 'video', 'synth'];

export const REPORT_REASONS = [
  { id: 'sexual', label: 'Sexual or inappropriate content' },
  { id: 'hate', label: 'Hate, bullying or harassment' },
  { id: 'violence', label: 'Graphic violence or self-harm' },
  { id: 'personal-info', label: "Shares someone's personal information" },
  { id: 'scam', label: 'Scam, spam or misleading' },
  { id: 'stolen', label: "Copied someone else's work" },
  { id: 'other', label: 'Something else' },
];

const invalid = (field, message) => new HttpError(422, message, { field });

// ---------------------------------------------------------------------------
// Text

// Control characters (other than newlines and tabs in descriptions) and
// invisible formatting characters that can hide or reorder text.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

export function cleanTitle(value) {
  if (typeof value !== 'string') throw invalid('title', 'Give the game a title.');
  const title = value.normalize('NFC').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (!title) throw invalid('title', 'Give the game a title.');
  if ([...title].length > LIMITS.title) throw invalid('title', `The title is too long (${LIMITS.title} characters at most).`);
  if (!/[\p{L}\p{N}]/u.test(title)) throw invalid('title', 'The title needs at least one letter or number.');
  checkWords('title', title);
  return title;
}

export function cleanDescription(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw invalid('description', 'The description must be text.');
  const text = value.normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(/\t/g, ' ')
    .replace(/[  ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if ([...text].length > LIMITS.description) throw invalid('description', `The description is too long (${LIMITS.description} characters at most).`);
  checkWords('description', text);
  return text;
}

export function cleanNote(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw invalid('note', 'The note must be text.');
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if ([...text].length > LIMITS.note) throw invalid('note', `The note is too long (${LIMITS.note} characters at most).`);
  return text;
}

// ---------------------------------------------------------------------------
// Word filter (config/blocked-words.json)

const LOOKALIKES = { 0: 'o', 1: 'i', '!': 'i', '|': 'i', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't', '+': 't', 8: 'b', 9: 'g' };
const ENDINGS = ['', 's', 'es', 'ed', 'er', 'ers', 'ing', 'z'];

const WORDS = new Set(blocked.words);
const ANYWHERE = blocked.anywhere;
const PHRASES = blocked.phrases || [];

function matchesWord(token) {
  for (const end of ENDINGS) {
    if (end && !token.endsWith(end)) continue;
    if (WORDS.has(token.slice(0, token.length - end.length))) return true;
  }
  return ANYWHERE.some((w) => token.includes(w));
}

/** Returns the first blocked word or phrase in text, or null. */
export function findBlockedWord(text) {
  const base = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const letters = [...base].map((c) => LOOKALIKES[c] ?? c).join('');
  for (const raw of letters.split(/\s+/)) {
    if (!raw) continue;
    // "dumb-word" is checked as "dumb" and "word", "w.o.r.d" as "word", and
    // stretched letters ("wooooord") as both one and two of them.
    const parts = [...raw.split(/[^a-z]+/), raw.replace(/[^a-z]/g, '')];
    const candidates = new Set(parts.flatMap((p) => [p, p.replace(/(.)\1{2,}/g, '$1'), p.replace(/(.)\1{2,}/g, '$1$1')]));
    for (const c of candidates) if (c && matchesWord(c)) return c;
  }
  const spaced = ` ${letters.replace(/[^a-z]+/g, ' ').trim()} `;
  for (const phrase of PHRASES) if (spaced.includes(` ${phrase} `)) return phrase;
  return null;
}

function checkWords(field, text) {
  if (findBlockedWord(text)) {
    throw invalid(field, `The ${field} has a word that isn't allowed on Smitten. Please change it.`);
  }
}

// ---------------------------------------------------------------------------
// Other fields

export function cleanModules(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalid('modules', 'modules must be a list of engine module names.');
  const out = [];
  for (const m of value) {
    if (!MODULES.includes(m)) throw invalid('modules', `Unknown engine module "${String(m).slice(0, 40)}". Known: ${MODULES.join(', ')}.`);
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

export function cleanEngineVersion(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 32 || !/^[0-9A-Za-z.+-]+$/.test(value)) {
    throw invalid('engineVersion', 'engineVersion must look like "0.2.0".');
  }
  return value;
}

/** Checks a PNG's signature and header; returns {width, height}. */
export function inspectPng(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) {
    throw invalid('thumbnail', 'The thumbnail must be a PNG image.');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  if (dv.getUint32(8) !== 13 || type !== 'IHDR') throw invalid('thumbnail', 'The thumbnail PNG is damaged.');
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  if (!width || !height || width > LIMITS.thumbnailSide || height > LIMITS.thumbnailSide) {
    throw invalid('thumbnail', `The thumbnail must be at most ${LIMITS.thumbnailSide}×${LIMITS.thumbnailSide} pixels.`);
  }
  return { width, height };
}
