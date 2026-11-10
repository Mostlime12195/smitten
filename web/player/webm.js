// WebM, as much as clips need (web/player/clips.js): read what a
// MediaRecorder wrote, join several recordings of the same stream into one,
// keep only the last seconds, and write a file with a duration and cues so
// players can show its length and seek in it.
//
//   const parsed = readWebm(bytes)              // {header, tracks, tracksRaw, blocks}
//   const clip = joinSegments([{start, data: parsed}, ...], 10000)
//   const file = writeWebm(clip)                // Uint8Array
//
// Times are in milliseconds. A block is one frame of one track:
// {track, time, keyframe, flags, data}.

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Colour: 0x55b0, MatrixCoefficients: 0x55b1, Range: 0x55b9, TransferCharacteristics: 0x55ba, Primaries: 0x55bb,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
};
// What can be inside a Cluster: a Cluster of unknown size ends at the first
// element that is not one of these.
const CLUSTER_CHILDREN = new Set([ID.Timecode, ID.SimpleBlock, ID.BlockGroup, 0xa7, 0xab, 0x5854, 0xec]);

export const VIDEO = 1;
export const AUDIO = 2;

// ---------------------------------------------------------------------------
// Reading

/** An element ID (with its length marker) at p: {id, length}, or null past the end. */
function readId(b, p) {
  if (p >= b.length) return null;
  const first = b[p];
  const length = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0;
  if (!length || p + length > b.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + b[p + i];
  return { id, length };
}

/** A size at p: {value, length, unknown}, or null past the end. */
function readSize(b, p) {
  if (p >= b.length) return null;
  const first = b[p];
  let length = 1, mask = 0x80;
  while (length <= 8 && !(first & mask)) { length++; mask >>= 1; }
  if (length > 8 || p + length > b.length) return null;
  let value = first & (mask - 1);
  let unknown = value === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[p + i];
    if (b[p + i] !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

/** The elements in b[start, end): [{id, start, dataStart, end, unknown}], stopping at the first one cut off. */
function children(b, start, end, { stopUnknown = false } = {}) {
  const list = [];
  let p = start;
  while (p < end) {
    const id = readId(b, p);
    if (!id) break;
    const size = readSize(b, p + id.length);
    if (!size) break;
    const dataStart = p + id.length + size.length;
    const elEnd = size.unknown ? end : dataStart + size.value;
    list.push({ id: id.id, start: p, dataStart, end: Math.min(elEnd, end), unknown: size.unknown, cut: elEnd > end });
    if (size.unknown && stopUnknown) break;
    if (elEnd > end) break;
    p = elEnd;
  }
  return list;
}

/** The one element at p (as children() describes it), or null. */
function elementAt(b, p, end) {
  const id = readId(b, p);
  if (!id || p >= end) return null;
  const size = readSize(b, p + id.length);
  if (!size) return null;
  const dataStart = p + id.length + size.length;
  const elEnd = size.unknown ? end : dataStart + size.value;
  return { id: id.id, start: p, dataStart, end: Math.min(elEnd, end), unknown: size.unknown, cut: elEnd > end };
}

function uint(b, el) {
  let v = 0;
  for (let i = el.dataStart; i < el.end; i++) v = v * 256 + b[i];
  return v;
}

function float(b, el) {
  const view = new DataView(b.buffer, b.byteOffset + el.dataStart, el.end - el.dataStart);
  return el.end - el.dataStart === 4 ? view.getFloat32(0) : el.end - el.dataStart === 8 ? view.getFloat64(0) : 0;
}

function text(b, el) {
  let s = '';
  for (let i = el.dataStart; i < el.end; i++) s += String.fromCharCode(b[i]);
  return s;
}

function readTrack(b, entry) {
  const t = { number: 0, type: 0, codecId: '', codecPrivate: null, width: 0, height: 0, sampleRate: 0, channels: 0, colour: null };
  for (const el of children(b, entry.dataStart, entry.end)) {
    if (el.id === ID.TrackNumber) t.number = uint(b, el);
    else if (el.id === ID.TrackType) t.type = uint(b, el);
    else if (el.id === ID.CodecID) t.codecId = text(b, el);
    else if (el.id === ID.CodecPrivate) t.codecPrivate = b.slice(el.dataStart, el.end);
    else if (el.id === ID.Video) {
      for (const v of children(b, el.dataStart, el.end)) {
        if (v.id === ID.PixelWidth) t.width = uint(b, v);
        else if (v.id === ID.PixelHeight) t.height = uint(b, v);
        else if (v.id === ID.Colour) {
          // How the colors were stored (Chrome: full range, BT.709, sRGB).
          t.colour = {};
          for (const c of children(b, v.dataStart, v.end)) {
            if (c.id === ID.MatrixCoefficients) t.colour.matrix = uint(b, c);
            else if (c.id === ID.Range) t.colour.range = uint(b, c);
            else if (c.id === ID.TransferCharacteristics) t.colour.transfer = uint(b, c);
            else if (c.id === ID.Primaries) t.colour.primaries = uint(b, c);
          }
        }
      }
    } else if (el.id === ID.Audio) {
      for (const a of children(b, el.dataStart, el.end)) {
        if (a.id === ID.SamplingFrequency) t.sampleRate = float(b, a);
        else if (a.id === ID.Channels) t.channels = uint(b, a);
      }
    }
  }
  return t;
}

/** A Block or SimpleBlock's payload: {track, relative, flags, data}. */
function readBlock(b, el) {
  const track = readSize(b, el.dataStart);
  if (!track) return null;
  const p = el.dataStart + track.length;
  if (p + 3 > el.end) return null;
  const relative = (b[p] << 24 >> 16) | b[p + 1];
  return { track: track.value, relative, flags: b[p + 2], data: b.subarray(p + 3, el.end) };
}

/**
 * What a MediaRecorder (or writeWebm) wrote, maybe cut off at the end:
 * {header, timecodeScale, tracks, tracksRaw, blocks}. Block times are in
 * milliseconds from the recording's own start.
 */
export function readWebm(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const top = children(b, 0, b.length, { stopUnknown: true });
  const ebml = top.find((el) => el.id === ID.EBML);
  const segment = top.find((el) => el.id === ID.Segment);
  if (!ebml || !segment) throw new Error('this is not a WebM file');
  const out = { header: b.slice(ebml.start, ebml.end), timecodeScale: 1e6, tracks: [], tracksRaw: null, blocks: [] };
  const toMs = () => out.timecodeScale / 1e6;
  let p = segment.dataStart;
  const end = segment.end;
  while (p < end) {
    const el = elementAt(b, p, end);
    if (!el) break;
    if (el.id === ID.Info) {
      for (const c of children(b, el.dataStart, el.end)) if (c.id === ID.TimecodeScale) out.timecodeScale = uint(b, c) || 1e6;
    } else if (el.id === ID.Tracks && !el.cut) {
      out.tracksRaw = b.slice(el.start, el.end);
      for (const c of children(b, el.dataStart, el.end)) if (c.id === ID.TrackEntry) out.tracks.push(readTrack(b, c));
    } else if (el.id === ID.Cluster) {
      // A Cluster of unknown size (what MediaRecorders write while they
      // record) ends where an element that is not its own starts.
      let clusterTime = 0;
      let q = el.dataStart;
      const limit = el.unknown ? end : el.end;
      for (;;) {
        const c = elementAt(b, q, limit);
        if (!c || c.cut || c.unknown || !CLUSTER_CHILDREN.has(c.id)) break;
        if (c.id === ID.Timecode) clusterTime = uint(b, c);
        else if (c.id === ID.SimpleBlock) {
          const block = readBlock(b, c);
          if (block) {
            out.blocks.push({
              track: block.track, time: (clusterTime + block.relative) * toMs(),
              keyframe: (block.flags & 0x80) !== 0, flags: block.flags & 0x0f, data: block.data,
            });
          }
        } else if (c.id === ID.BlockGroup) {
          let block = null, reference = false;
          for (const g of children(b, c.dataStart, c.end)) {
            if (g.id === ID.Block) block = readBlock(b, g);
            else if (g.id === ID.ReferenceBlock) reference = true;
          }
          if (block) {
            out.blocks.push({
              track: block.track, time: (clusterTime + block.relative) * toMs(),
              keyframe: !reference, flags: block.flags & 0x0f, data: block.data,
            });
          }
        }
        q = c.end;
      }
      if (!el.unknown && !el.cut) q = el.end;
      if (q <= p) break;
      p = q;
      continue;
    } else if (el.unknown || el.cut) {
      break;
    }
    p = el.end;
  }
  if (!out.tracksRaw) throw new Error('this WebM file has no tracks');
  return out;
}

/** Two recordings can be joined when their tracks are the same apart from the picture size. */
export function trackSignature(tracks) {
  return tracks.map((t) => [t.number, t.type, t.codecId, t.codecPrivate ? Array.from(t.codecPrivate).join('.') : '', t.sampleRate, t.channels].join(',')).join('|');
}

// ---------------------------------------------------------------------------
// Joining and cutting

/**
 * segments: [{start, data}] in the order they were recorded, where start is
 * when that recording started (ms, on one clock for all) and data is what
 * readWebm returned. Recordings may overlap: each one's blocks stop where
 * the next one's blocks of the same track start. Keeps the last keepMs (or
 * a little more: the clip starts on a video keyframe at or before that
 * point). Returns what writeWebm takes, with times from 0.
 */
export function joinSegments(segments, keepMs = Infinity) {
  segments = segments.filter((s) => s.data && s.data.blocks.length);
  if (!segments.length) return null;
  // Only the newest run of recordings with the same tracks.
  const last = segments[segments.length - 1].data;
  const signature = trackSignature(last.tracks);
  let first = segments.length - 1;
  while (first > 0 && trackSignature(segments[first - 1].data.tracks) === signature) first--;
  segments = segments.slice(first);

  const video = last.tracks.find((t) => t.type === VIDEO)?.number;
  const all = [];
  for (let i = 0; i < segments.length; i++) {
    const { start, data } = segments[i];
    const next = segments[i + 1];
    // Where the next recording takes over, track by track.
    const until = new Map();
    if (next) {
      for (const blk of next.data.blocks) {
        if (!until.has(blk.track) && (blk.track !== video || blk.keyframe)) until.set(blk.track, next.start + blk.time);
      }
    }
    // A recording's video must start on a keyframe to be usable.
    let started = video === undefined;
    for (const blk of data.blocks) {
      const time = start + blk.time;
      if (blk.track === video && !started) {
        if (!blk.keyframe) continue;
        started = true;
      }
      if (until.has(blk.track) && time >= until.get(blk.track)) continue;
      all.push({ ...blk, time });
    }
  }
  if (!all.length) return null;
  all.sort((a, b) => a.time - b.time || (a.track === video ? -1 : b.track === video ? 1 : 0));
  const endTime = all[all.length - 1].time;
  // Start on the last video keyframe at or before the cut, else the first one.
  let from = all[0].time;
  if (video !== undefined) {
    let pick = null;
    for (const blk of all) {
      if (blk.track !== video || !blk.keyframe) continue;
      if (pick === null || blk.time <= endTime - keepMs) pick = blk.time;
      if (blk.time > endTime - keepMs) break;
    }
    if (pick !== null) from = pick;
  } else if (Number.isFinite(keepMs)) {
    from = Math.max(from, endTime - keepMs);
  }
  // Whole milliseconds from the start. Where recordings meet, two blocks of
  // a track can fall on the same one: keep the newer recording's (it starts
  // on a keyframe).
  const blocks = all.filter((blk) => blk.time >= from).map((blk) => ({ ...blk, time: Math.round(blk.time - from) }));
  const lastOf = new Map();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const blk = blocks[i];
    if (lastOf.has(blk.track) && blk.time >= lastOf.get(blk.track)) blocks.splice(i, 1);
    else lastOf.set(blk.track, blk.time);
  }
  return {
    header: last.header,
    tracks: last.tracks,
    tracksRaw: last.tracksRaw,
    blocks,
    duration: blocks.length ? blocks[blocks.length - 1].time + frameLength(blocks, video) : 0,
  };
}

/** The usual time between two video frames (0 without video). */
function frameLength(blocks, video) {
  const times = blocks.filter((b) => b.track === video).map((b) => b.time);
  const steps = [];
  for (let i = 1; i < times.length; i++) steps.push(times[i] - times[i - 1]);
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return steps[steps.length >> 1];
}

// ---------------------------------------------------------------------------
// Writing

function idBytes(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return out;
}

function sizeBytes(n, length = 0) {
  if (!length) {
    length = 1;
    while (length < 8 && n >= 2 ** (7 * length) - 1) length++;
  }
  const out = new Array(length);
  let v = n;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function element(id, data, sizeLength = 0) {
  const body = data instanceof Uint8Array ? data : concat(data);
  return concat([Uint8Array.from(idBytes(id)), Uint8Array.from(sizeBytes(body.length, sizeLength)), body]);
}

function uintElement(id, v, length = 0) {
  const bytes = [];
  for (let x = v; x > 0 || !bytes.length; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  while (bytes.length < length) bytes.unshift(0);
  return element(id, Uint8Array.from(bytes));
}

function floatElement(id, v) {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setFloat64(0, v);
  return element(id, data);
}

function stringElement(id, s) {
  return element(id, Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff));
}

function simpleBlock(blk, clusterTime) {
  const track = sizeBytes(blk.track);
  const relative = Math.round(blk.time) - clusterTime;
  const head = Uint8Array.from([...track, (relative >> 8) & 0xff, relative & 0xff, (blk.keyframe ? 0x80 : 0) | (blk.flags & 0x0f)]);
  return element(ID.SimpleBlock, [head, blk.data]);
}

/**
 * {header, tracks, tracksRaw, blocks, duration} (from joinSegments) as a
 * WebM file: a cluster starts at each video keyframe (and at least every
 * 30 seconds), and the cues list the clusters that start with one.
 */
export function writeWebm(clip) {
  const video = clip.tracks.find((t) => t.type === VIDEO)?.number;
  const clusters = [];
  let current = null;
  for (const blk of clip.blocks) {
    const time = Math.round(blk.time);
    const keyframe = blk.track === video && blk.keyframe;
    if (!current || (keyframe && current.blocks.length) || time - current.time > 30000) {
      current = { time, blocks: [], cue: keyframe };
      clusters.push(current);
    }
    current.blocks.push(blk);
  }
  const clusterBytes = clusters.map((c) => element(ID.Cluster, [uintElement(ID.Timecode, c.time), ...c.blocks.map((b) => simpleBlock(b, c.time))]));

  const info = element(ID.Info, [
    uintElement(ID.TimecodeScale, 1e6),
    stringElement(ID.MuxingApp, 'Smitten'),
    stringElement(ID.WritingApp, 'Smitten'),
    floatElement(ID.Duration, clip.duration || 0),
  ]);
  const tracks = clip.tracksRaw;
  // Positions are from the start of the Segment's data; the seek head's
  // have a fixed length, so its size is known before they are.
  const seek = (id, position) => element(ID.Seek, [element(ID.SeekID, Uint8Array.from(idBytes(id))), uintElement(ID.SeekPosition, position, 8)]);
  const hasCues = video !== undefined && clusters.some((c) => c.cue);
  const seekHead = (positions) => element(ID.SeekHead, [seek(ID.Info, positions[0]), seek(ID.Tracks, positions[1]), ...(hasCues ? [seek(ID.Cues, positions[2])] : [])]);
  const headLength = seekHead([0, 0, 0]).length;
  const infoAt = headLength;
  const tracksAt = infoAt + info.length;
  let at = tracksAt + tracks.length;
  const cuePoints = [];
  clusters.forEach((c, i) => {
    if (c.cue && video !== undefined) {
      cuePoints.push(element(ID.CuePoint, [
        uintElement(ID.CueTime, c.time),
        element(ID.CueTrackPositions, [uintElement(ID.CueTrack, video), uintElement(ID.CueClusterPosition, at)]),
      ]));
    }
    at += clusterBytes[i].length;
  });
  const cues = hasCues ? [element(ID.Cues, cuePoints)] : [];
  const body = concat([seekHead([infoAt, tracksAt, at]), info, tracks, ...clusterBytes, ...cues]);
  return concat([clip.header, element(ID.Segment, body, 8)]);
}

/** The Duration a WebM file states (ms), or null. */
export function webmDuration(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const segment = children(b, 0, b.length, { stopUnknown: true }).find((el) => el.id === ID.Segment);
  if (!segment) return null;
  for (const el of children(b, segment.dataStart, segment.end, { stopUnknown: true })) {
    if (el.id !== ID.Info) continue;
    let scale = 1e6, duration = null;
    for (const c of children(b, el.dataStart, el.end)) {
      if (c.id === ID.TimecodeScale) scale = uint(b, c);
      else if (c.id === ID.Duration) duration = float(b, c);
    }
    return duration === null ? null : duration * scale / 1e6;
  }
  return null;
}

/** For tests: a tiny WebM writer's parts (makes recordings without a browser). */
export const _internal = { element, uintElement, stringElement, floatElement, simpleBlock, ID };
