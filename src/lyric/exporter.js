/**
 * exporter.js
 * Renders the lyric video on a canvas and encodes it entirely in the browser. Nothing is uploaded.
 *
 * Three paths, chosen at runtime from what THIS browser can do:
 *   1. WebCodecs + MP4   H.264 video, AAC (or Opus) audio. Fast, and the format social apps accept.
 *   2. WebCodecs + WebM  when the browser has no H.264 encoder: VP9/AV1 in a WebM container. Never an
 *                        ".mp4" that secretly holds VP9, which most apps and players reject.
 *   3. MediaRecorder     for browsers without WebCodecs: records the canvas in REAL TIME (a 30 s clip takes 30 s).
 *
 * Memory: the song is never fully decoded when the browser can stream-decode it (openAudio). Only the
 * selected clip is decoded, in small chunks, while exporting.
 */
import {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  AudioBufferSink, Input, BlobSource, MP3, WAVE, OGG, FLAC, MP4, ADTS, MATROSKA,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from 'mediabunny';
import { createRenderer } from './looks.js';

export const SIZES = {
  '540': { width: 540, height: 960, label: '540p, fastest' },
  '720': { width: 720, height: 1280, label: '720p, recommended' },
  '1080': { width: 1080, height: 1920, label: '1080p, computers' },
};

export class ExportError extends Error {
  constructor(code, message) { super(message); this.name = 'ExportError'; this.code = code; }
}

export function pickBitrate(width, height, fps) { return Math.round(width * height * fps * 0.15); }

/* ------------------------------------------------------------------ audio source */

/**
 * Open a song with the smallest possible memory cost.
 * @returns {Promise<{kind:'stream'|'buffer', duration:number, sampleRate:number, channels:number, dispose:()=>void, track?:object, input?:object, buffer?:AudioBuffer}>}
 *  - 'stream': only metadata is read now; the clip is decoded chunk by chunk during export.
 *  - 'buffer': fallback, the whole song is decoded into an AudioBuffer (needed when the browser cannot stream-decode it).
 */
export async function openAudio(file) {
  if (typeof AudioDecoder !== 'undefined') {
    try {
      const input = new Input({ source: new BlobSource(file), formats: [MP3, WAVE, OGG, FLAC, MP4, ADTS, MATROSKA] });
      const track = await input.getPrimaryAudioTrack();
      if (track && await track.canDecode()) {
        const [duration, sampleRate, channels] = await Promise.all([input.computeDuration([track]), track.getSampleRate(), track.getNumberOfChannels()]);
        if (duration > 0 && sampleRate > 0) {
          return { kind: 'stream', input, track, duration, sampleRate, channels: Math.min(2, channels), dispose: () => input.dispose() };
        }
      }
      input.dispose();
    } catch { /* not streamable here, fall back to a full decode */ }
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const buffer = await ac.decodeAudioData(await file.arrayBuffer());
    return { kind: 'buffer', buffer, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: Math.min(2, buffer.numberOfChannels), dispose() {} };
  } finally { ac.close(); }
}

/** Yield the selected clip as small AudioBuffers (at most 2 channels), trimmed exactly to [start, end). */
async function* clipChunks(src, start, end) {
  const channels = src.channels;
  if (src.kind === 'buffer') {
    const b = src.buffer, sr = b.sampleRate, s0 = Math.max(0, Math.floor(start * sr)), s1 = Math.min(b.length, Math.ceil(end * sr)), step = sr * 5;
    for (let a = s0; a < s1; a += step) {
      const len = Math.min(step, s1 - a);
      const out = new AudioBuffer({ length: len, numberOfChannels: channels, sampleRate: sr });
      for (let c = 0; c < channels; c++) out.copyToChannel(b.getChannelData(c).subarray(a, a + len), c);
      yield out;
    }
    return;
  }
  const sink = new AudioBufferSink(src.track);
  for await (const { buffer, timestamp } of sink.buffers(start, end)) {
    const sr = buffer.sampleRate;
    const from = Math.max(0, Math.round((start - timestamp) * sr)), to = Math.min(buffer.length, Math.round((end - timestamp) * sr));
    if (to <= from) continue;
    const out = new AudioBuffer({ length: to - from, numberOfChannels: channels, sampleRate: sr });
    for (let c = 0; c < channels; c++) out.copyToChannel(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).subarray(from, to), c);
    yield out;
  }
}

/** Apply a 10 ms fade-in and a fade-out (longer when the clip is cut mid-song) in place, to avoid clicks. */
function applyFades(chunk, done, total, fadeInSamples, fadeOutSamples) {
  if (done > fadeInSamples && done + chunk.length < total - fadeOutSamples) return;
  for (let c = 0; c < chunk.numberOfChannels; c++) {
    const d = chunk.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const g = done + i; let m = 1;
      if (g < fadeInSamples) m = g / fadeInSamples;
      const rem = total - 1 - g;
      if (rem < fadeOutSamples) m = Math.min(m, Math.max(0, rem) / fadeOutSamples);
      d[i] *= m;
    }
  }
}
const fadeOutSeconds = (end, duration) => (end < duration - 0.05 ? 0.35 : 0.05);

/* ------------------------------------------------------------------ capability probing */

/** WebCodecs path. Never throws. Prefers MP4/H.264, falls back to WebM, never mislabels a container. */
export async function probeSupport(width, height, fps, audio, opts = {}) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return { ok: false, reason: 'webcodecs' };
  const aOpts = { numberOfChannels: audio ? audio.channels : 2, sampleRate: audio ? audio.sampleRate : 48000, bitrate: 128000 };
  const vOpts = { width, height, frameRate: fps, bitrate: pickBitrate(width, height, fps) };
  if (!opts.forceWebm) {
    const v = await getFirstEncodableVideoCodec(['avc'], vOpts);
    const a = v ? await getFirstEncodableAudioCodec(['aac', 'opus'], aOpts) : null;
    if (v && a) return { ok: true, container: 'mp4', ext: 'mp4', video: v, audio: a };
  }
  const v2 = await getFirstEncodableVideoCodec(['vp9', 'av1', 'vp8'], vOpts);
  const a2 = await getFirstEncodableAudioCodec(['opus'], aOpts);
  if (v2 && a2) return { ok: true, container: 'webm', ext: 'webm', video: v2, audio: a2 };
  return { ok: false, reason: !v2 ? 'video' : 'audio' };
}

/**
 * MediaRecorder path: which container can this browser record? Null when it cannot record a canvas at all.
 * An MP4 label must always mean H.264. The bare type "video/mp4" is only trusted in WebKit (Safari), where it
 * means H.264 + AAC; Chromium accepts it and silently records VP9 inside an MP4, which most apps reject.
 */
export function recorderSupport() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream || !(window.AudioContext || window.webkitAudioContext)) return null;
  const isWebKit = /AppleWebKit/i.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|Android/i.test(navigator.userAgent);
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,opus',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  if (isWebKit) candidates.push('video/mp4');
  const mime = candidates.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
  return mime ? { mime, container: mime.startsWith('video/mp4') ? 'mp4' : 'webm', ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}

/** One answer for the UI: how will this browser export? */
export async function probeCapabilities(width, height, fps, audio, opts = {}) {
  const wc = await probeSupport(width, height, fps, audio, opts);
  if (wc.ok) return { mode: 'webcodecs', ...wc };
  const rec = recorderSupport();
  if (rec) return { mode: 'recorder', ...rec, video: null, audio: null };
  return { mode: 'none', reason: wc.reason };
}

const tick = () => new Promise(r => setTimeout(r, 0));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

function clipBounds(o) {
  const start = Math.max(0, o.start || 0);
  const end = Math.min(o.audio.duration, o.end || o.audio.duration);
  if (!(end - start > 0.2)) throw new ExportError('RANGE', 'The selected clip is too short.');
  if (!o.timeline.length) throw new ExportError('NO_LYRICS', 'Add and sync some lyrics before exporting.');
  return { start, end };
}

/* ------------------------------------------------------------------ path 1 and 2: WebCodecs */

/**
 * @param {object} o
 * @param {object} o.audio        result of openAudio()
 * @param {object[]} o.timeline   from buildTimeline()
 * @param {string} o.look @param {number} o.width @param {number} o.height @param {number} [o.fps]
 * @param {number} [o.start] @param {number} [o.end]   clip range in song seconds
 * @param {CanvasImageSource|null} [o.bgImage] @param {boolean} [o.watermark]
 * @param {boolean} [o.forceWebm]  test hook
 * @param {(p:{frame:number,frames:number,fps:number,eta:number})=>void} [o.onProgress] @param {AbortSignal} [o.signal]
 */
export async function exportVideo(o) {
  const { audio, timeline, look, width, height, bgImage = null, watermark = true, onProgress, signal } = o;
  const fps = o.fps || 30;
  const { start, end } = clipBounds(o);
  const support = await probeSupport(width, height, fps, audio, { forceWebm: o.forceWebm });
  if (!support.ok) {
    const why = {
      webcodecs: 'This browser cannot use the fast exporter.',
      video: 'This device cannot encode video at this size. Try 540p.',
      audio: 'This browser cannot encode audio for this file type.',
    }[support.reason];
    throw new ExportError('UNSUPPORTED_' + support.reason.toUpperCase(), why);
  }

  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { alpha: false });
  const renderer = createRenderer({ width, height, look, timeline, bgImage, watermark });

  const format = support.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: support.video, bitrate: pickBitrate(width, height, fps) });
  const audioSource = new AudioBufferSource({ codec: support.audio, bitrate: 128000 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);

  const began = performance.now();
  const frames = Math.max(1, Math.round((end - start) * fps));
  try {
    await output.start();
    // Audio first, in small chunks: nothing larger than ~5 seconds of samples is ever held at once.
    let done = 0, total = null;
    for await (const chunk of clipChunks(audio, start, end)) {
      if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const sr = chunk.sampleRate;
      if (total === null) total = Math.round((end - start) * sr);
      applyFades(chunk, done, total, Math.floor(0.01 * sr), Math.floor(fadeOutSeconds(end, audio.duration) * sr));
      done += chunk.length;
      await audioSource.add(chunk);
    }
    audioSource.close();
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      renderer.draw(ctx, start + i / fps);
      await videoSource.add(i / fps, 1 / fps);
      if (i % 6 === 0) {
        const elapsed = (performance.now() - began) / 1000, rate = (i + 1) / Math.max(0.001, elapsed);
        if (onProgress) onProgress({ frame: i + 1, frames, fps: rate, eta: (frames - i - 1) / rate });
        if (i % 24 === 0) await tick();
      }
    }
    videoSource.close();
    await output.finalize();
  } catch (err) {
    try { await output.cancel(); } catch { /* already closed */ }
    throw err;
  }
  if (onProgress) onProgress({ frame: frames, frames, fps: 0, eta: 0 });
  return {
    blob: new Blob([output.target.buffer], { type: support.container === 'mp4' ? 'video/mp4' : 'video/webm' }),
    ext: support.ext, container: support.container, mode: 'webcodecs',
    seconds: end - start, frames, videoCodec: support.video, audioCodec: support.audio,
    elapsed: (performance.now() - began) / 1000,
  };
}

/* ------------------------------------------------------------------ path 3: MediaRecorder, real time */

/** Collect the clip into ONE AudioBuffer (only used by the real-time fallback, clips are short). */
async function clipToBuffer(audio, start, end, ac) {
  const parts = []; let len = 0;
  for await (const c of clipChunks(audio, start, end)) { parts.push(c); len += c.length; }
  if (!parts.length) throw new ExportError('NO_AUDIO', 'Could not read audio for this clip.');
  const out = ac.createBuffer(parts[0].numberOfChannels, len, parts[0].sampleRate);
  let at = 0;
  for (const c of parts) { for (let ch = 0; ch < c.numberOfChannels; ch++) out.copyToChannel(c.getChannelData(ch), ch, at); at += c.length; }
  return out;
}

export async function recordVideo(o) {
  const { audio, timeline, look, width, height, bgImage = null, watermark = true, onProgress, signal } = o;
  const fps = 30;
  const { start, end } = clipBounds(o);
  const rec = recorderSupport();
  if (!rec) throw new ExportError('UNSUPPORTED_RECORDER', 'This browser cannot export video. Try the latest Chrome, Edge or Safari.');

  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(canvas);
  const cleanup = () => { canvas.remove(); ac.close().catch(() => {}); };
  const began = performance.now();
  try {
    if (ac.state === 'suspended') await ac.resume();
    const clip = await clipToBuffer(audio, start, end, ac);
    const dest = ac.createMediaStreamDestination();
    const node = ac.createBufferSource(); node.buffer = clip; node.connect(dest);
    const ctx = canvas.getContext('2d', { alpha: false });
    const renderer = createRenderer({ width, height, look, timeline, bgImage, watermark });
    const stream = canvas.captureStream(fps);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    const recorder = new MediaRecorder(stream, { mimeType: rec.mime, videoBitsPerSecond: pickBitrate(width, height, fps), audioBitsPerSecond: 128000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res, rej) => { recorder.onstop = res; recorder.onerror = e => rej((e && e.error) || new Error('Recording failed')); });
    renderer.draw(ctx, start);
    recorder.start(1000);
    const t0 = ac.currentTime + 0.15;
    node.start(t0);
    for (;;) {
      if (signal && signal.aborted) { try { recorder.stop(); } catch { /* ignore */ } throw new DOMException('Export cancelled', 'AbortError'); }
      const elapsed = ac.currentTime - t0, t = start + Math.max(0, elapsed);
      if (t >= end) break;
      renderer.draw(ctx, t);
      if (onProgress) onProgress({ frame: Math.round((t - start) * fps), frames: Math.round((end - start) * fps), fps: 0, eta: end - t });
      await nextFrame();
    }
    await new Promise(r => setTimeout(r, 200));            // let the last frame and audio reach the recorder
    recorder.stop(); await stopped;
    const blob = new Blob(chunks, { type: rec.mime.split(';')[0] });
    if (!blob.size) throw new ExportError('EMPTY', 'The recording came out empty. Keep this tab in front while it records.');
    if (onProgress) onProgress({ frame: 1, frames: 1, fps: 0, eta: 0 });
    return { blob, ext: rec.ext, container: rec.container, mode: 'recorder', seconds: end - start, frames: Math.round((end - start) * fps), videoCodec: 'recorder', audioCodec: 'recorder', elapsed: (performance.now() - began) / 1000 };
  } finally { cleanup(); }
}

/** Use the fast exporter when the browser supports it, otherwise record in real time. */
export async function exportAny(o) {
  const caps = await probeCapabilities(o.width, o.height, o.fps || 30, o.audio, { forceWebm: o.forceWebm });
  if (caps.mode === 'webcodecs') return exportVideo(o);
  if (caps.mode === 'recorder') return recordVideo(o);
  throw new ExportError('UNSUPPORTED', 'This browser cannot export video. Try the latest Chrome, Edge or Safari.');
}
