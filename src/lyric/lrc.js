/**
 * lrc.js
 * Pure timing logic for the lyric video tool. No DOM, no canvas, fully unit-testable.
 *
 *  - parseLrc / formatLrc          read and write standard (and "enhanced") LRC files
 *  - splitLyrics                   plain pasted lyrics -> lines (strips [Verse] style tags)
 *  - spreadLines                   rough even spread of lines over a time range
 *  - buildTimeline                 entries -> renderable timeline with line and word timings
 *  - lineIndexAt                   which line is active at time t
 *  - parseTime / formatTime        "m:ss.s" helpers for the UI
 */

const TAG_ONLY = /^\s*\[[a-z]+:[^\]]*\]\s*$/i;           // [ar:Artist], [ti:Title], [offset:+300] ...
const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_STAMP = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

/** Convert pieces of a timestamp to seconds. Fraction digits are decimal ("5" is .5, "05" is .05, "500" is .500). */
function stampToSeconds(m, s, frac) {
  const f = frac ? Number('0.' + frac) : 0;
  return Number(m) * 60 + Number(s) + f;
}

/** @returns {boolean} true when the text looks like an LRC file (at least two timestamped lines). */
export function isLrc(text) {
  const matches = String(text).match(/^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/gm);
  return !!matches && matches.length >= 2;
}

/**
 * Parse LRC text.
 * Supports multiple timestamps per line, the [offset:ms] tag, ignores metadata tags, and reads
 * enhanced per-word stamps like "<00:12.30>Hello <00:12.80>world".
 * Lines with a stamp but no text are kept: they mark "nothing on screen" (end of the previous line).
 * @returns {{entries: {t:number, text:string, words?: {t:number, text:string}[]}[], offset:number}}
 */
export function parseLrc(input) {
  const text = String(input).replace(/^\uFEFF/, '');
  let offset = 0;
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    if (TAG_ONLY.test(raw)) {
      const m = raw.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
      if (m) offset = Number(m[1]) / 1000;
      continue;
    }
    const stamps = [...raw.matchAll(STAMP)];
    if (!stamps.length) continue;
    let body = raw.replace(STAMP, '').trim();
    let words;
    if (WORD_STAMP.test(body)) {
      WORD_STAMP.lastIndex = 0;
      words = [];
      const parts = body.split(WORD_STAMP);
      // split with 3 capture groups yields: [pre, m, s, f, text, m, s, f, text ...]
      for (let i = 1; i + 3 < parts.length + 1; i += 4) {
        const wt = stampToSeconds(parts[i], parts[i + 1], parts[i + 2]);
        const wtext = (parts[i + 3] || '').trim();
        if (wtext) words.push({ t: wt, text: wtext });
      }
      body = words.map(w => w.text).join(' ');
    }
    WORD_STAMP.lastIndex = 0;
    for (const st of stamps) {
      const t = stampToSeconds(st[1], st[2], st[3]);
      const entry = { t, text: body };
      if (words && words.length) {
        const shift = t - words[0].t;
        entry.words = words.map(w => ({ t: w.t + shift, text: w.text }));
      }
      entries.push(entry);
    }
  }
  entries.sort((a, b) => a.t - b.t);
  if (offset) for (const e of entries) {
    e.t = Math.max(0, e.t - offset);
    if (e.words) for (const w of e.words) w.t = Math.max(0, w.t - offset);
  }
  return { entries, offset };
}

/** @param {{t:number|null,text:string}[]} entries @returns {string} LRC text */
export function formatLrc(entries) {
  return entries
    .filter(e => e.t != null)
    .map(e => `[${formatTime(e.t, 2, true)}]${e.text}`)
    .join('\n');
}

/** Pasted lyrics to clean lines. Removes section tags such as [Verse 1] or [Chorus], blank lines, zero-width characters. */
export function splitLyrics(text) {
  return String(text)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^\[[^\]]*\]$/.test(l));
}

/**
 * Even-ish spread of lines across [start, end]. Longer lines get proportionally more time.
 * This is a fallback so the preview is useful before the user has tapped anything.
 */
export function spreadLines(lines, start, end) {
  if (!lines.length) return [];
  const span = Math.max(1, end - start);
  const weights = lines.map(l => Math.max(8, l.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return lines.map((text, i) => {
    const t = start + (acc / total) * span;
    acc += weights[i];
    return { t, text };
  });
}

/**
 * Fill ONLY the lines that have no time yet, and never touch a line that already has one.
 * Unsynced lines between two synced lines are spread between those two times (weighted by text length).
 * Unsynced lines before the first synced line are spread from a short lead-in; after the last, to near the end.
 * With no synced lines at all this is a plain spread over the whole song.
 * @param {{t:number|null,text:string}[]} entries lyric order
 * @param {number} duration song length in seconds
 * @returns {(number|null)[]} a NEW array of times, same length as entries
 */
export function fillMissingTimes(entries, duration) {
  const n = entries.length;
  const times = entries.map(e => e.t);
  if (!n) return times;
  const lead = Math.min(1, duration * 0.05);
  const tail = Math.max(lead + 1, duration - 0.5);
  const weight = i => Math.max(8, entries[i].text.length);
  let i = 0;
  while (i < n) {
    if (times[i] != null) { i++; continue; }
    let j = i;
    while (j < n && times[j] == null) j++;                 // null run is [i, j)
    const prev = i > 0 ? i - 1 : -1;
    const a = prev >= 0 ? times[prev] : lead;
    let b = j < n ? times[j] : tail;
    const group = [];
    if (prev >= 0) group.push(prev);
    for (let k = i; k < j; k++) group.push(k);
    if (b - a < 0.4 * group.length) b = a + 0.4 * group.length;   // anchors too close or out of order: keep it monotonic
    const total = group.reduce((acc, k) => acc + weight(k), 0);
    let acc = 0;
    for (const k of group) {
      if (k >= i) times[k] = a + (acc / total) * (b - a);
      acc += weight(k);
    }
    i = j;
  }
  return times;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Build a renderable timeline.
 * @param {{t:number, text:string, words?:{t:number,text:string}[]}[]} entries sorted by t
 * @param {number} duration total audio duration in seconds
 * @returns {{start:number,end:number,text:string,words:{text:string,start:number,end:number}[]}[]}
 *
 * Rules:
 *  - A line stays on screen until the next entry starts, but never longer than a "hold" limit,
 *    so an instrumental break does not freeze the last line.
 *  - Word times inside a line: use enhanced LRC word stamps when present, otherwise spread the
 *    words by letter count across the time the line is actually sung. Line-level sync is accurate;
 *    word-level timing inside a line is an estimate unless real word stamps are provided.
 *    Each line carries `real: true` only when its word times are real. The looks use this flag so they
 *    never animate ESTIMATED word times as if they were true.
 */
export function buildTimeline(entries, duration) {
  const sorted = [...entries].filter(e => e.t != null).sort((a, b) => a.t - b.t);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const text = e.text.trim();
    if (!text) continue;                                   // gap marker, only used as an end time below
    const tokens = text.split(/\s+/);
    const nextT = i + 1 < sorted.length ? sorted[i + 1].t : duration;
    const hold = clamp(1.4 + tokens.length * 0.6, 2.4, 8);   // 2 words ~2.6s, 8 words ~6.2s
    const start = e.t;
    const end = Math.max(start + 0.4, Math.min(nextT, start + hold, duration > 0 ? duration : Infinity));
    let words, real = false;
    if (e.words && e.words.length === tokens.length) {
      real = true;                                          // word times came from the source, not from an estimate
      words = e.words.map((w, k) => ({
        text: w.text,
        start: w.t,
        end: k + 1 < e.words.length ? e.words[k + 1].t : end,
      }));
    } else {
      const chars = tokens.reduce((a, w) => a + w.length, 0);
      let sung = Math.min(end - start, Math.max(0.5, chars * 0.085));
      if (end - start <= sung * 1.25) sung = (end - start) * 0.92;
      const weights = tokens.map(w => w.length + 1.5);
      const total = weights.reduce((a, b) => a + b, 0);
      let acc = 0;
      words = tokens.map((w, k) => {
        const ws = start + (acc / total) * sung;
        acc += weights[k];
        const we = start + (acc / total) * sung;
        return { text: w, start: ws, end: we };
      });
    }
    out.push({ start, end, text, words, real });
  }
  return out;
}

/** Index of the line that is current at time t, or -1 before the first line or inside a gap. */
export function lineIndexAt(timeline, t) {
  let lo = 0, hi = timeline.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found !== -1 && t < timeline[found].end ? found : -1;
}

/** Index of the most recent line that has started (even if its hold has expired), or -1. */
export function lastStartedIndex(timeline, t) {
  let lo = 0, hi = timeline.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** "m:ss.s" -> seconds. Accepts "83", "1:23", "1:23.4". Returns null when invalid. */
export function parseTime(str) {
  const s = String(str).trim();
  if (!s) return null;
  const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

/** Seconds -> "m:ss.s" (or "mm:ss.ss" when lrc is true). */
export function formatTime(sec, decimals = 1, lrc = false) {
  const t = Math.max(0, sec || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sStr = s.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  return `${lrc ? String(m).padStart(2, '0') : m}:${sStr}`;
}
