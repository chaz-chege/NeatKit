/**
 * main.js: UI wiring for the lyric video tool.
 * State lives in one object (S). Everything runs in the browser; nothing is uploaded.
 */
import { LOOKS, createRenderer, loadFonts } from './looks.js';
import { isLrc, parseLrc, formatLrc, splitLyrics, fillMissingTimes, buildTimeline, parseTime, formatTime } from './lrc.js';
import { exportAny, probeCapabilities, openAudio, pickBitrate, SIZES } from './exporter.js';
import { readEmbedded } from './embedded.js';
import { parseTimingsJson, looksLikeJson } from './timings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const track = (name, params = {}) => { try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch { /* analytics must never break the tool */ } };
const PREVIEW = { w: 540, h: 960 };
const QUERY = new URLSearchParams(location.search);
const DEBUG = QUERY.has('lyricdebug');                       // test hooks exist ONLY with ?lyricdebug
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.userAgentData && navigator.userAgentData.mobile);

const S = {
  audio: $('#audio'), url: null,
  src: null,                   // result of openAudio(): { kind, duration, sampleRate, channels, dispose }
  duration: 0, name: '',
  entries: [],                 // [{t:number|null, text}] in lyric order
  order: [],                   // synced entries sorted by time: [{t, i}] for fast "which row is active"
  timeline: [], renderer: null, look: 'karaoke',
  bg: null, tapIdx: -1, exporting: null, resultURL: null, scrubbing: false,
  snapshot: null,              // times before the last bulk change, for Undo
  embedded: null,              // lyrics read from the song file, offered via the "Use" button
  dirty: true,                 // preview needs a redraw even though audio is paused
  caps: null,
};

const canvas = $('#stage'); canvas.width = PREVIEW.w; canvas.height = PREVIEW.h;
const ctx = canvas.getContext('2d', { alpha: false });
const invalidate = () => { S.dirty = true; };

/* ------------------------------------------------------------------ small UI helpers */

let msgTimer = 0;
function say(text, kind = 'info') {
  const el = $('#msg'); el.textContent = text; el.dataset.kind = kind; el.hidden = !text;
  clearTimeout(msgTimer); if (text && kind === 'info') msgTimer = setTimeout(() => { el.hidden = true; }, 7000);
}
const fmt = s => formatTime(s, 1);
const mb = bytes => (bytes / 1048576).toFixed(bytes > 1.0e7 ? 0 : 1) + ' MB';

/* ------------------------------------------------------------------ timeline + renderer */

function rebuild() {
  const synced = S.entries.filter(e => e.t != null);
  S.timeline = buildTimeline(synced, S.duration || 600);
  S.order = S.entries.map((e, i) => ({ t: e.t, i })).filter(x => x.t != null).sort((a, b) => a.t - b.t);
  S.renderer = createRenderer({ width: PREVIEW.w, height: PREVIEW.h, look: S.look, timeline: S.timeline, bgImage: S.bg, watermark: true });
  const n = S.entries.length, k = synced.length;
  const wordLevel = S.timeline.some(l => l.real);
  $('#syncStatus').textContent = !n ? 'No lyrics yet' : (k === n ? `All ${n} lines synced` : `${k} of ${n} lines synced`) + (k ? (wordLevel ? ' · word-level timing' : ' · line-level timing') : '');
  $('#syncStatus').dataset.ok = n && k === n ? '1' : '0';
  $('#undoBulk').hidden = !S.snapshot;
  updateExportEstimate(); updateSyncButtons(); invalidate();
}

function drawPreview() {
  const t = S.audio.currentTime || 0;
  S.renderer.draw(ctx, t);
  if (!S.timeline.length) {
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center';
    ctx.font = '600 30px Outfit, system-ui, sans-serif';
    ctx.fillText(S.src ? 'Now add and sync lyrics' : 'Add a song to start', PREVIEW.w / 2, PREVIEW.h / 2 - 8);
    ctx.font = '400 20px Outfit, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Your preview shows up here', PREVIEW.w / 2, PREVIEW.h / 2 + 28); ctx.restore();
  }
  if (!S.scrubbing && S.duration) $('#scrub').value = String(Math.round((t / S.duration) * 1000));
  $('#timeLabel').textContent = `${fmt(t)} / ${fmt(S.duration)}`;
  if (S.tapIdx >= 0 && TAP.armed) $('#tapClock').textContent = fmt(t);
  highlightActiveRow(t);
}
/** Redraw only while playing, or when something changed. A paused, untouched preview costs nothing. */
function loop() {
  if (!S.audio.paused || S.dirty) { S.dirty = false; drawPreview(); }
  requestAnimationFrame(loop);
}
['seeked', 'play', 'pause', 'loadedmetadata'].forEach(ev => S.audio.addEventListener(ev, invalidate));

/* ------------------------------------------------------------------ audio */

async function loadAudio(file) {
  if (!file) return;
  say('Reading your song…');
  let src;
  try { src = await openAudio(file); }
  catch { say('Could not read that audio file. Try an MP3, WAV, M4A or OGG.', 'error'); return; }
  stopTapSession(); if (S.src) S.src.dispose();
  S.src = src; S.duration = src.duration; S.name = file.name;
  if (S.url) URL.revokeObjectURL(S.url);
  S.url = URL.createObjectURL(file); S.audio.src = S.url; S.audio.load();
  $('#fileName').textContent = file.name; $('#audioMeta').textContent = `${fmt(S.duration)} · ${Math.round(src.sampleRate / 1000)} kHz`;
  $('#drop').dataset.has = '1';
  $('#rangeStart').value = '0:00.0'; $('#rangeEnd').value = fmt(S.duration);
  rebuild(); refreshSupport(); renderLines();
  track('lyric_audio_loaded', { seconds: Math.round(S.duration), stream: src.kind === 'stream' ? 1 : 0 });
  say('');
  applyEmbedded(file);
}

/** Pull lyrics and cover art out of the song file itself (Suno MP3s carry both), like HookCut did. */
async function applyEmbedded(file) {
  const emb = await readEmbedded(file);
  if (file.name !== S.name) return;                          // another song was loaded while this was reading
  S.embedded = emb.lyrics;
  $('#useEmbedded').hidden = true;
  const found = [];
  if (emb.lyrics) {
    if (!$('#lyrics').value.trim()) { $('#lyrics').value = emb.lyrics; onLyricsInput(); found.push('lyrics'); }
    else if (emb.lyrics !== $('#lyrics').value) { $('#useEmbedded').hidden = false; }
  }
  if (emb.cover && !S.bg) { await setBackground(emb.cover, 'Cover art from your song'); found.push('cover art'); }
  if (found.length) say(`Found ${found.join(' and ')} inside your song file and used ${found.length > 1 ? 'them' : 'it'}.`);
  track('lyric_embedded', { lyrics: emb.lyrics ? 1 : 0, cover: emb.cover ? 1 : 0 });
}

function togglePlay() {
  if (!S.src) return say('Add a song first.', 'error');
  if (S.audio.paused) S.audio.play(); else S.audio.pause();
}
S.audio.addEventListener('play', () => { $('#play').textContent = 'Pause'; $('#play').setAttribute('aria-label', 'Pause'); });
S.audio.addEventListener('pause', () => { $('#play').textContent = 'Play'; $('#play').setAttribute('aria-label', 'Play'); });
S.audio.addEventListener('ended', () => { if (S.tapIdx >= 0) finishTap(true); });

/* ------------------------------------------------------------------ undo for bulk changes */

function takeSnapshot() { S.snapshot = S.entries.map(e => e.t); }
function undoBulk() {
  if (!S.snapshot || S.snapshot.length !== S.entries.length) { S.snapshot = null; rebuild(); return; }
  S.entries.forEach((e, i) => { e.t = S.snapshot[i]; });
  S.snapshot = null; stopTapSession(); renderTapUI(); rebuild(); renderLines();
  say('Restored your previous timings.');
}

/* ------------------------------------------------------------------ lyrics */

function onLyricsInput() {
  const text = $('#lyrics').value;
  if (isLrc(text)) {
    S.entries = parseLrc(text).entries.filter(e => e.text.trim());
    $('#lrcNote').textContent = 'LRC timings detected and applied.';
  } else {
    const lines = splitLyrics(text), old = S.entries;
    S.entries = lines.map((txt, i) => {
      const keep = old.length === lines.length ? old[i] : (old[i] && old[i].text === txt ? old[i] : null);
      const entry = { text: txt, t: keep ? keep.t : null };
      if (keep && keep.words && keep.text === txt && keep.t != null) entry.words = keep.words;   // unchanged line keeps its word timing
      return entry;
    });
    $('#lrcNote').textContent = 'Section tags like [Verse] and [Chorus] are removed for you.';
  }
  S.snapshot = null; stopTapSession(); $('#syncDone').hidden = true; renderTapUI(); rebuild(); renderLines();
}

async function importLrc(file) {
  if (!file) return;
  const text = await file.text();
  if (/\.json$/i.test(file.name) || looksLikeJson(text)) return importTimings(text);
  $('#lyrics').value = text; onLyricsInput();
  say(isLrc(text) ? 'LRC imported. Timings applied.' : 'Imported as plain lyrics. Sync them with Tap sync.');
}

/** A timings file from HookCut (or any Whisper-style JSON): replaces the lyric lines with their timings. */
function importTimings(text) {
  let r;
  try { r = parseTimingsJson(text); } catch (err) { return say(err.message, 'error'); }
  S.snapshot = null; stopTapSession(); $('#syncDone').hidden = true;
  S.entries = r.entries.map(e => ({ t: e.t, text: e.text, ...(e.words ? { words: e.words } : {}) }));
  $('#lyrics').value = S.entries.map(e => e.text).join('\n');
  $('#lrcNote').textContent = r.wordLevel ? 'Imported with word-level timing.' : 'Imported with line timing.';
  renderTapUI(); rebuild(); renderLines();
  const missing = S.entries.filter(e => e.t == null).length;
  say(`Imported ${S.entries.length} lines` + (r.wordLevel ? ' with word-level timing' : '') + (missing ? `. ${missing} still need a time.` : '. Everything is synced.'));
  track('lyric_import', { kind: r.kind, lines: S.entries.length, words: r.wordLevel ? 1 : 0 });
}

/** Fill in lines that have no time. Lines that already have a time are never touched. */
function autoSpread() {
  if (!S.entries.length) return say('Paste your lyrics first.', 'error');
  if (!S.src) return say('Add a song first.', 'error');
  const missing = S.entries.filter(e => e.t == null).length;
  if (!missing) return say('Every line already has a time, so there is nothing to fill. Use Tap sync to redo them, or edit a time in the list.');
  takeSnapshot();
  const times = fillMissingTimes(S.entries, S.duration);
  S.entries.forEach((e, i) => { e.t = times[i]; });
  stopTapSession(); renderTapUI(); rebuild(); renderLines();
  say(missing === S.entries.length
    ? 'Lines spread evenly. This is only a rough guide. Use Tap sync for real timing.'
    : `Filled ${missing} unsynced ${missing === 1 ? 'line' : 'lines'} between your synced ones. Your other times were not changed.`);
}

/* ------------------------------------------------------------------ tap sync */

let countdownTimer = 0;
const TAP = { armed: false };                 // true only while the song is playing and taps count

const syncReady = () => !!(S.src && S.entries.length);
function updateSyncButtons() {
  const ready = syncReady() && !S.exporting;
  $('#tapStart').disabled = !ready;
  $('#spread').disabled = !ready;
  $('#syncHint').textContent = !S.src ? 'Add your song first (step 1).' : !S.entries.length ? 'Paste your lyrics first (step 2).' : '';
  $('#fineTune').hidden = !S.entries.length;                                  // times can always be typed by hand
  const anySynced = S.entries.some(e => e.t != null);
  $('#shiftEarlier').disabled = $('#shiftLater').disabled = !anySynced;
}

/** End any tap session (also cancels a running countdown). Does not touch the timings already tapped. */
function stopTapSession() {
  clearInterval(countdownTimer); countdownTimer = 0;
  TAP.armed = false; S.tapIdx = -1;
  $('#countdown').hidden = true;
}

/** Some browsers only let audio start from a user gesture, so "unlock" it silently while the user presses Start. */
function unlockAudio() {
  const v = S.audio.volume; S.audio.volume = 0;
  const p = S.audio.play();
  const restore = () => { S.audio.pause(); S.audio.currentTime = 0; S.audio.volume = v; };
  if (p && p.then) p.then(restore).catch(() => { S.audio.volume = v; }); else restore();
}

function startTap() {
  if (!syncReady()) return updateSyncButtons();
  stopTapSession();
  if (S.entries.some(e => e.t != null)) takeSnapshot(); else S.snapshot = null;
  S.entries.forEach(e => { delete e.words; e.t = null; });
  S.tapIdx = 0; $('#syncDone').hidden = true;
  unlockAudio();
  rebuild(); renderLines(); renderTapUI(); say('');
  let n = 3; $('#countNum').textContent = String(n); $('#countdown').hidden = false;
  countdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) { $('#countNum').textContent = String(n); return; }
    clearInterval(countdownTimer); countdownTimer = 0; $('#countdown').hidden = true;
    S.audio.currentTime = 0; S.audio.play(); TAP.armed = true; renderTapUI();
  }, 1000);
  $('#tapPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  track('lyric_tap_start', { lines: S.entries.length });
}

function pulse() {
  for (const id of ['#tapBtn', '#tapNow']) { const el = $(id); el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 140); }
  try { if (navigator.vibrate) navigator.vibrate(15); } catch { /* not supported */ }
}
function tap() {
  if (S.tapIdx < 0 || !TAP.armed) return;
  const lat = (Number($('#latency').value) || 0) / 1000;
  S.entries[S.tapIdx].t = Math.max(0, S.audio.currentTime - lat);
  pulse();
  S.tapIdx++;
  if (S.tapIdx >= S.entries.length) return finishTap(false);
  rebuild(); renderLines(); renderTapUI();
}
/** Undo the last tap AND jump the song back so the line can be tapped again. */
function undoTap() {
  if (S.tapIdx <= 0 || !TAP.armed) return;
  S.tapIdx--; S.entries[S.tapIdx].t = null;
  const prev = S.tapIdx > 0 ? S.entries[S.tapIdx - 1].t : 0;
  S.audio.currentTime = Math.max(0, (prev ?? 0) - 0.3);
  rebuild(); renderLines(); renderTapUI();
  say('Undone. The song jumped back so you can tap that line again.');
}
function cancelTap() {
  const was = S.tapIdx >= 0;
  stopTapSession(); S.audio.pause();
  if (was) { rebuild(); renderLines(); renderTapUI(); say('Tap sync cancelled. Lines you already tapped were kept.'); }
}
function finishTap(early) {
  const done = S.entries.filter(e => e.t != null).length;
  stopTapSession(); S.audio.pause();
  rebuild(); renderLines(); renderTapUI();
  const first = S.entries.map(e => e.t).filter(t => t != null).sort((x, y) => x - y)[0] ?? 0;
  S.audio.currentTime = Math.max(0, first - 1);
  if (done === S.entries.length) $('#syncDone').hidden = false;
  say(early ? `The song ended with ${done} of ${S.entries.length} lines tapped. The rest are still not set.` : '');
  track('lyric_tap_done', { lines: S.entries.length, tapped: done });
}
function renderTapUI() {
  const on = S.tapIdx >= 0, n = S.entries.length;
  $('#tapPanel').hidden = !(on && TAP.armed);
  $('#howto').hidden = on;
  $('#syncPanel').dataset.tapping = on ? '1' : '0';      // while tapping, hide everything that is not the tap flow
  $('#tapStart').textContent = on ? 'Restart' : (S.entries.some(e => e.t != null) ? 'Sync again with tap' : 'Start tap sync');
  if (on) {
    const cur = S.entries[S.tapIdx], next = S.entries[S.tapIdx + 1];
    $('#tapCount').textContent = `Line ${S.tapIdx + 1} of ${n}`;
    $('#tapNow').textContent = cur ? cur.text : '';
    $('#tapNext').textContent = next ? `Then: ${next.text}` : 'This is the last line';
    $('#tapBar').style.width = `${(S.tapIdx / n) * 100}%`;
    $('#tapBtn').disabled = !TAP.armed;
    $('#tapUndo').disabled = S.tapIdx === 0 || !TAP.armed;
  }
  updateSyncButtons();
}
/** Move every synced line (and its imported word times) by d seconds. Undo-able. */
function shiftAll(d) {
  if (!S.entries.some(e => e.t != null)) return;
  takeSnapshot();
  S.entries.forEach(e => {
    if (e.t == null) return;
    e.t = Math.max(0, e.t + d);
    if (e.words) e.words = e.words.map(w => ({ ...w, t: Math.max(0, w.t + d) }));
  });
  rebuild(); renderLines();
  say(`Moved every line ${d < 0 ? 'earlier' : 'later'} by ${Math.abs(d).toFixed(1)} s. Press Undo last change if that was wrong.`);
}

/* ------------------------------------------------------------------ line table */

function renderLines() {
  const list = $('#linesList');
  list.innerHTML = '';
  S.entries.forEach((e, i) => {
    const row = document.createElement('div'); row.className = 'row'; row.dataset.i = String(i);
    const prev = i ? S.entries[i - 1].t : null;
    if (e.t != null && prev != null && e.t < prev) row.dataset.warn = '1';
    row.innerHTML =
      `<span class="num">${i + 1}</span>` +
      `<input class="tin" inputmode="decimal" aria-label="Start time for line ${i + 1}" placeholder="not set" value="${e.t != null ? fmt(e.t) : ''}">` +
      `<span class="nudge"><button type="button" data-act="minus" aria-label="Earlier by 0.1 seconds">−</button><button type="button" data-act="plus" aria-label="Later by 0.1 seconds">+</button>` +
      `<button type="button" data-act="now" aria-label="Set to current playback time" title="Set to current time">Now</button>` +
      `<button type="button" data-act="play" aria-label="Play from this line" title="Play from here">▶</button></span>` +
      `<span class="txt"></span>`;
    row.querySelector('.txt').textContent = e.text;
    list.appendChild(row);
  });
  activeRow = -2;                                  // force the highlight to refresh on the next draw
  $('#lineCount').textContent = S.entries.length ? `${S.entries.length} lines` : '';
}
function setEntryTime(i, t) {
  const e = S.entries[i], before = e.t;
  e.t = t == null ? null : Math.max(0, Math.min(S.duration || 1e6, t));
  if (e.words) {                                    // keep word timings in step with the line
    if (e.t == null || before == null) delete e.words;
    else { const d = e.t - before; e.words = e.words.map(w => ({ ...w, t: w.t + d })); }
  }
  const row = $(`#linesList .row[data-i="${i}"]`);
  if (row) { $('.tin', row).value = S.entries[i].t != null ? fmt(S.entries[i].t) : ''; }
  rebuild();
}
$('#linesList').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const i = Number(b.closest('.row').dataset.i), e = S.entries[i], act = b.dataset.act;
  if (act === 'minus') setEntryTime(i, (e.t ?? S.audio.currentTime) - (ev.shiftKey ? 0.5 : 0.1));
  else if (act === 'plus') setEntryTime(i, (e.t ?? S.audio.currentTime) + (ev.shiftKey ? 0.5 : 0.1));
  else if (act === 'now') setEntryTime(i, S.audio.currentTime);
  else if (act === 'play') { S.audio.currentTime = Math.max(0, (e.t ?? 0) - 0.4); S.audio.play(); }
});
$('#linesList').addEventListener('change', ev => {
  if (!ev.target.classList.contains('tin')) return;
  const i = Number(ev.target.closest('.row').dataset.i), v = ev.target.value.trim();
  if (!v) return setEntryTime(i, null);
  const t = parseTime(v);
  if (t == null) { ev.target.value = S.entries[i].t != null ? fmt(S.entries[i].t) : ''; return say('Use a time like 1:23.4', 'error'); }
  setEntryTime(i, t);
});

let activeRow = -2;
/** Binary search over the time-sorted entries: O(log n) per frame. */
function highlightActiveRow(t) {
  let lo = 0, hi = S.order.length - 1, a = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (S.order[mid].t <= t) { a = S.order[mid].i; lo = mid + 1; } else hi = mid - 1; }
  if (a === activeRow) return;
  const list = $('#linesList');
  const old = list.querySelector('.row.on'); if (old) old.classList.remove('on');
  const row = a >= 0 ? list.querySelector(`.row[data-i="${a}"]`) : null;
  if (row) { row.classList.add('on'); if (!S.audio.paused && list.matches(':not(:hover)')) { const r = row.offsetTop - list.clientHeight / 2; list.scrollTo({ top: Math.max(0, r), behavior: 'smooth' }); } }
  activeRow = a;
}

/* ------------------------------------------------------------------ looks + background */

function renderChips() {
  const box = $('#chips');
  LOOKS.forEach(l => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = l.name; b.dataset.id = l.id;
    b.addEventListener('click', () => { S.look = l.id; syncChips(); rebuild(); track('lyric_look', { look: l.id }); });
    box.appendChild(b);
  });
  syncChips();
}
function syncChips() { document.querySelectorAll('#chips .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === S.look))); }

async function setBackground(file, label) {
  if (!file) return;
  try { S.bg = await createImageBitmap(file); } catch { return say('Could not read that image.', 'error'); }
  $('#bgName').textContent = label || file.name; $('#bgClear').hidden = false; rebuild();
}
function clearBackground() { S.bg = null; $('#bgName').textContent = 'Use the look’s own background'; $('#bgClear').hidden = true; $('#bgFile').value = ''; rebuild(); }

/* ------------------------------------------------------------------ export */

function clipRange() {
  const start = parseTime($('#rangeStart').value), end = parseTime($('#rangeEnd').value);
  return { start: start == null ? 0 : start, end: end == null ? S.duration : Math.min(end, S.duration) };
}
const LARGE_FILE_BYTES = 100 * 1048576;
function updateExportEstimate() {
  const { start, end } = clipRange(), sz = SIZES[$('#size').value] || SIZES['720'];
  if (!S.duration) { $('#estimate').textContent = ''; return; }
  const secs = Math.max(0, end - start), bytes = (pickBitrate(sz.width, sz.height, 30) + 128000) * secs / 8;
  const risky = bytes > LARGE_FILE_BYTES && (IS_MOBILE || (navigator.deviceMemory && navigator.deviceMemory <= 4));
  $('#estimate').textContent = `${fmt(secs)} clip · up to about ${mb(bytes)}` + (risky ? '. Large for this device, so it may fail. Try 540p or a shorter clip.' : '');
  $('#estimate').dataset.kind = risky ? 'warn' : 'info';
}
async function refreshSupport() {
  const sz = SIZES[$('#size').value];
  const c = S.caps = await probeCapabilities(sz.width, sz.height, 30, S.src, { forceWebm: DEBUG && QUERY.get('force') === 'webm' });
  const el = $('#supportNote'), names = { avc: 'H.264', vp9: 'VP9', av1: 'AV1', vp8: 'VP8', aac: 'AAC', opus: 'Opus' };
  $('#exportBtn').disabled = c.mode === 'none';
  if (c.mode === 'none') { el.textContent = 'This browser cannot export video. Use a current Chrome, Edge or Safari. You can still preview.'; el.dataset.kind = 'error'; return; }
  let text, kind = 'info';
  if (c.mode === 'webcodecs' && c.container === 'mp4') {
    text = `Encoding: H.264 video, ${names[c.audio]} audio, saved as MP4.`;
    if (c.audio !== 'aac') { text += ' This browser has no AAC encoder, so the audio is Opus. If an app rejects the file, export from Chrome on a computer.'; kind = 'warn'; }
  } else if (c.mode === 'webcodecs') {
    text = `This browser cannot make H.264, so your video will be a WebM file (${names[c.video]}, Opus). TikTok and Instagram often reject WebM. For an MP4, export from Chrome or Edge.`; kind = 'warn';
  } else {
    text = `This browser cannot use the fast exporter, so it records in real time: a 30 second clip takes 30 seconds. Keep this tab open and in front.` + (c.ext === 'webm' ? ' The file will be WebM, which TikTok and Instagram often reject.' : '');
    kind = 'warn';
  }
  el.textContent = text; el.dataset.kind = kind;
}
function setPreset(seconds) {
  if (!S.duration) return;
  const first = S.entries.map(e => e.t).filter(t => t != null).sort((a, b) => a - b)[0] ?? 0;
  const start = seconds ? Math.max(0, first - 1) : 0, end = seconds ? Math.min(S.duration, start + seconds) : S.duration;
  $('#rangeStart').value = fmt(start); $('#rangeEnd').value = fmt(end); updateExportEstimate();
}

function friendlyError(err) {
  const m = String((err && err.message) || err || '');
  if (err instanceof RangeError || /memory|allocation|quota/i.test(m)) return 'The device ran out of memory. Try 540p, a shorter clip, or close other tabs.';
  return m || 'Export failed. Try 540p or a shorter clip.';
}

async function doExport() {
  if (S.exporting) return;
  if (!S.src) return say('Add a song first.', 'error');
  if (!S.timeline.length) return say('Sync at least one line of lyrics before exporting.', 'error');
  const { start, end } = clipRange(); if (end - start < 1) return say('The clip must be at least 1 second long.', 'error');
  const sizeKey = $('#size').value, sz = SIZES[sizeKey];
  stopTapSession(); const ctrl = new AbortController(); S.exporting = ctrl; S.audio.pause();
  $('#exportBtn').hidden = true; $('#cancelBtn').hidden = false; $('#progressBox').hidden = false; $('#result').hidden = true;
  setBusy(true); say('');
  try {
    const res = await exportAny({
      audio: S.src, timeline: S.timeline, look: S.look, width: sz.width, height: sz.height, fps: 30,
      start, end, bgImage: S.bg, watermark: true, signal: ctrl.signal, forceWebm: DEBUG && QUERY.get('force') === 'webm',
      onProgress: p => {
        $('#bar').style.width = `${(p.frame / p.frames) * 100}%`;
        $('#progText').textContent = `${res_mode_label()} ${Math.round((p.frame / p.frames) * 100)}% · ` + (p.fps ? `${p.fps.toFixed(0)} fps · about ${Math.ceil(p.eta)} s left` : `about ${Math.ceil(p.eta)} s left`);
      },
    });
    showResult(res);
    track('lyric_export', { look: S.look, seconds: Math.round(res.seconds), size: sizeKey, mode: res.mode, container: res.container, vcodec: res.videoCodec, acodec: res.audioCodec, ms: Math.round(res.elapsed * 1000), bg: S.bg ? 1 : 0 });
  } catch (err) {
    if (err && err.name === 'AbortError') say('Export cancelled.');
    else { say(friendlyError(err), 'error'); track('lyric_export_error', { code: (err && (err.code || err.name)) || 'unknown' }); }
  } finally {
    S.exporting = null; setBusy(false); updateSyncButtons();
    $('#exportBtn').hidden = false; $('#cancelBtn').hidden = true; $('#progressBox').hidden = true;
  }
}
const res_mode_label = () => (S.caps && S.caps.mode === 'recorder' ? 'Recording' : 'Rendering');

function showResult(res) {
  if (S.resultURL) URL.revokeObjectURL(S.resultURL);
  S.resultURL = URL.createObjectURL(res.blob);
  const base = (S.name || 'lyric-video').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'lyric-video';
  const a = $('#download'); a.href = S.resultURL; a.download = `${base}-${S.look}.${res.ext}`;
  a.textContent = `Download ${res.ext.toUpperCase()}`;
  $('#resultVideo').src = S.resultURL;
  $('#resultMeta').textContent = `${mb(res.blob.size)} · ${res.seconds.toFixed(1)} s · ${res.ext.toUpperCase()} · ${res.mode === 'recorder' ? 'recorded' : 'rendered'} in ${res.elapsed.toFixed(1)} s`;
  $('#result').hidden = false; $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function setBusy(b) { document.querySelectorAll('.lock').forEach(el => { el.disabled = b; }); }

/* ------------------------------------------------------------------ wiring */

function wire() {
  const drop = $('#drop');
  $('#file').addEventListener('change', e => loadAudio(e.target.files[0]));
  ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadAudio(f); });

  $('#lyrics').addEventListener('input', onLyricsInput);
  $('#lrcFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; importLrc(f); });   // reset so the same file can be imported again
  $('#spread').addEventListener('click', autoSpread);
  $('#undoBulk').addEventListener('click', undoBulk);
  $('#tapStart').addEventListener('click', startTap);
  $('#tapBtn').addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
  $('#tapUndo').addEventListener('click', undoTap);
  $('#tapCancel').addEventListener('click', cancelTap);
  $('#shiftEarlier').addEventListener('click', e => shiftAll(e.shiftKey ? -0.5 : -0.1));
  $('#shiftLater').addEventListener('click', e => shiftAll(e.shiftKey ? 0.5 : 0.1));
  $('#doneWatch').addEventListener('click', () => { $('#syncDone').hidden = true; $('#stage').scrollIntoView({ behavior: 'smooth', block: 'center' }); S.audio.play(); });
  $('#doneFine').addEventListener('click', () => $('#fineTune').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#doneExport').addEventListener('click', () => $('#h5s').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#copyLrc').addEventListener('click', async () => {
    const text = formatLrc(S.entries); if (!text) return say('Nothing synced yet.', 'error');
    try { await navigator.clipboard.writeText(text); say('LRC copied to your clipboard.'); } catch { say('Could not copy. Select the times manually.', 'error'); }
  });

  $('#play').addEventListener('click', togglePlay);
  const scrub = $('#scrub');
  scrub.addEventListener('input', () => { S.scrubbing = true; invalidate(); if (S.duration) S.audio.currentTime = (Number(scrub.value) / 1000) * S.duration; });
  scrub.addEventListener('change', () => { S.scrubbing = false; });

  $('#bgFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; setBackground(f); });
  $('#useEmbedded').addEventListener('click', () => { if (S.embedded) { $('#lyrics').value = S.embedded; onLyricsInput(); $('#useEmbedded').hidden = true; say('Used the lyrics found in your song file.'); } });
  $('#bgClear').addEventListener('click', clearBackground);
  $('#size').addEventListener('change', () => { updateExportEstimate(); refreshSupport(); });
  ['#rangeStart', '#rangeEnd'].forEach(s => $(s).addEventListener('change', updateExportEstimate));
  $('#presetFull').addEventListener('click', () => setPreset(0));
  $('#preset30').addEventListener('click', () => setPreset(30));
  $('#preset60').addEventListener('click', () => setPreset(60));
  $('#exportBtn').addEventListener('click', doExport);
  $('#cancelBtn').addEventListener('click', () => { if (S.exporting) S.exporting.abort(); });

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (S.tapIdx >= 0) { e.preventDefault(); if (e.repeat) return; tap(); }
      else if (e.code === 'Space' && tag !== 'button') { e.preventDefault(); togglePlay(); }
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
}

async function init() {
  if (navigator.deviceMemory && navigator.deviceMemory <= 2) $('#size').value = '540';
  renderChips(); wire(); rebuild(); renderTapUI();
  try { await loadFonts(); } catch (e) { say('Some caption fonts failed to load. Previews may look different.', 'error'); }
  invalidate(); refreshSupport();
  loop();
  if (DEBUG) window.__lyric = { S, rebuild, loadAudio, onLyricsInput, autoSpread, doExport };
}
init();
