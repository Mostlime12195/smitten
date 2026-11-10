// Recording from the microphone for the sound file editor: getUserMedia and
// MediaRecorder, a live level for the waveform while it records, and the
// recording decoded to mono at RECORD_RATE (wav.js). The browser's own
// decoder resamples it.

import { RECORD_RATE, MAX_RECORD_SECONDS, toMono } from './wav.js';

/** null if this page can record, or a message that says why not. */
export function recordingProblem() {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return `The browser lets only secure pages (https:// or localhost) use the microphone, and this page is ${location.protocol}//${location.host}. Open the editor at its https:// address to record.`;
  }
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot record sound (it has no microphone access for web pages).';
  if (typeof MediaRecorder === 'undefined') return 'This browser cannot record sound (it has no MediaRecorder).';
  if (typeof OfflineAudioContext === 'undefined') return 'This browser cannot record sound (it has no Web Audio).';
  return null;
}

/** A plain message for an error from getUserMedia or MediaRecorder. */
export function microphoneMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'The microphone is blocked: you or the browser said no. Allow the microphone for this site (click the icon at the left of the address bar), then click Record again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'There is no microphone. Connect one, then click Record again.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The microphone did not start. Another program can be using it. Close that program, then click Record again.';
    default:
      return `Recording did not work: ${e?.message || e}`;
  }
}

/**
 * One recording. await start() asks for the microphone and starts; then
 * level() is the loudness of the last moment (0 to 1) for a live view, and
 * seconds() how long it has recorded. await stop() gives
 * {sampleRate, channels: [Float32Array]} (mono, RECORD_RATE, at most
 * MAX_RECORD_SECONDS). It stops by itself at MAX_RECORD_SECONDS and calls
 * onLimit(). cancel() stops without a result.
 */
export class Recorder {
  constructor({ onLimit } = {}) {
    this.onLimit = onLimit;
    this.stream = null;
    this.media = null;
    this.chunks = [];
    this.context = null;
    this.analyser = null;
    this.buffer = null;
    this.started = 0;
    this.stopped = null;
    this.limitTimer = 0;
  }

  async start() {
    const problem = recordingProblem();
    if (problem) throw new Error(problem);
    // No echo cancelling or automatic gain: the sound as the microphone hears
    // it. Normalize in the editor makes a quiet recording louder.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    try {
      this.media = new MediaRecorder(this.stream);
    } catch (e) {
      this.release();
      throw e;
    }
    this.chunks = [];
    this.media.addEventListener('dataavailable', (e) => { if (e.data?.size) this.chunks.push(e.data); });
    this.stopped = new Promise((resolve, reject) => {
      this.media.addEventListener('stop', () => resolve());
      this.media.addEventListener('error', (e) => reject(e.error || e));
    });
    try {
      this.context = new AudioContext();
      const src = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buffer = new Float32Array(this.analyser.fftSize);
      src.connect(this.analyser);
    } catch {
      this.analyser = null; // no live view; the recording still works
    }
    this.media.start(250);
    this.started = performance.now();
    this.limitTimer = setTimeout(() => {
      if (this.media?.state === 'recording') this.onLimit?.();
    }, MAX_RECORD_SECONDS * 1000);
  }

  get recording() { return this.media?.state === 'recording'; }

  seconds() { return this.started ? (performance.now() - this.started) / 1000 : 0; }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buffer);
    let m = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const a = Math.abs(this.buffer[i]);
      if (a > m) m = a;
    }
    return Math.min(1, m);
  }

  async stop() {
    clearTimeout(this.limitTimer);
    if (!this.media) throw new Error('Nothing is recording.');
    if (this.media.state !== 'inactive') this.media.stop();
    await this.stopped;
    const type = this.media.mimeType || this.chunks[0]?.type || '';
    this.release();
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    if (!blob.size) throw new Error('The recording is empty: the microphone sent no sound.');
    const bytes = await blob.arrayBuffer();
    // Decoding in a context at RECORD_RATE resamples to that rate.
    const decoder = new OfflineAudioContext(1, 1, RECORD_RATE);
    let audio;
    try {
      audio = await decoder.decodeAudioData(bytes);
    } catch (e) {
      throw new Error(`The browser could not read its own recording (${type || 'unknown type'}): ${e?.message || e}`);
    }
    const channels = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    let mono = toMono(channels);
    const max = RECORD_RATE * MAX_RECORD_SECONDS;
    if (mono.length > max) mono = mono.slice(0, max);
    else if (mono === channels[0]) mono = Float32Array.from(mono);
    return { sampleRate: audio.sampleRate, channels: [mono] };
  }

  cancel() {
    clearTimeout(this.limitTimer);
    try { if (this.media && this.media.state !== 'inactive') this.media.stop(); } catch { /* already stopped */ }
    this.release();
    this.chunks = [];
  }

  release() {
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null;
    if (this.context) this.context.close().catch(() => {});
    this.context = null;
    this.analyser = null;
  }
}
