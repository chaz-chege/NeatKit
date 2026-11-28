import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTimingsJson, looksLikeJson } from '../src/lyric/timings.js';
import { buildTimeline, parseLrc } from '../src/lyric/lrc.js';

const fx = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('HookCut export (written by the Python exporter): word-level timings survive the round trip', () => {
  const r = parseTimingsJson(fx('hookcut_timings.json'));
  assert.equal(r.kind, 'hookcut'); assert.equal(r.wordLevel, true);
  assert.deepEqual(r.entries.map(e => e.text), ['Kiburi ni mzigo', 'Weka chini']);
  assert.deepEqual(r.entries[0].words.map(w => w.t), [2, 2.8, 3.1]);
  const tl = buildTimeline(r.entries, 30);
  assert.deepEqual(tl[0].words.map(w => w.start), [2, 2.8, 3.1], 'timeline uses the imported word times verbatim');
  assert.equal(tl[1].start, 6);
});

test('HookCut real tap payload (with a BOM) becomes line-level entries', () => {
  const r = parseTimingsJson(fx('hookcut_tap_payload.json'));
  assert.equal(r.kind, 'taps'); assert.equal(r.wordLevel, false);
  assert.deepEqual(r.entries.map(e => [e.t, e.text]), [[10.2, 'Kiburi ni mzigo'], [13.5, 'Weka chini usimame'], [16.8, 'Bure umepewa']]);
});

test('Whisper-style segments with spaced "word" keys', () => {
  const r = parseTimingsJson(JSON.stringify({ text: 'x', segments: [
    { start: 1, end: 3, text: ' Hello there', words: [{ word: ' Hello', start: 1, end: 1.6 }, { word: ' there', start: 1.6, end: 2.9 }] },
    { start: 4, end: 6, text: ' Second line', words: [] }] }));
  assert.equal(r.kind, 'segments');
  assert.deepEqual(r.entries[0].words.map(w => [w.text, w.t]), [['Hello', 1], ['there', 1.6]]);
  assert.equal(r.entries[1].words, undefined);
});

test('a word count that does not match the text falls back to line-level timing', () => {
  const r = parseTimingsJson(JSON.stringify({ lines: [{ start: 2, text: 'one two three', words: [{ text: 'one', start: 2 }, { text: 'two', start: 3 }] }] }));
  assert.equal(r.entries[0].words, undefined); assert.equal(r.wordLevel, false);
  assert.equal(r.entries[0].t, 2);
});

test('missing text is rebuilt from the words; missing start is taken from the first word', () => {
  const r = parseTimingsJson(JSON.stringify([{ words: [{ text: 'a', start: 5 }, { text: 'b', start: 5.5 }] }]));
  assert.equal(r.entries[0].text, 'a b'); assert.equal(r.entries[0].t, 5);
});

test('lines are sorted by time and unusable rows are dropped', () => {
  const r = parseTimingsJson(JSON.stringify({ lines: [{ start: 9, text: 'late' }, null, { text: 'no time' }, { start: 1, text: 'early' }, { start: 2, text: '   ' }] }));
  assert.deepEqual(r.entries.map(e => e.text), ['early', 'late']);
});

test('clear, user-safe errors for bad files', () => {
  assert.throws(() => parseTimingsJson('{ not json'), /not valid JSON/);
  assert.throws(() => parseTimingsJson('{"foo": 1}'), /No lyric lines/);
  assert.throws(() => parseTimingsJson('{"lines": []}'), /No lyric lines/);
  assert.throws(() => parseTimingsJson('{"lines": [{"text": "x"}]}'), /No usable lines/);
});

test('looksLikeJson tells timings files from lyrics and LRC (LRC also starts with "[")', () => {
  assert.equal(looksLikeJson('{"lines":[]}'), true);
  assert.equal(looksLikeJson('\uFEFF  [1,2]'), true);
  assert.equal(looksLikeJson('[00:01.00]hello\n[00:03.00]world'), false);
  assert.equal(looksLikeJson('[Verse 1]\nplain lyrics'), false);
  assert.equal(looksLikeJson('plain lyrics'), false);
  assert.equal(looksLikeJson('{ broken'), false);
  assert.equal(looksLikeJson(''), false);
});

test('HookCut enhanced LRC (what the backend serves at /timings.lrc) parses with word times', () => {
  const lrc = '[01:00.00]<01:00.00>one <01:01.25>two\n[01:05.00]<01:05.00>three <01:05.50>four\n';
  const { entries } = parseLrc(lrc);
  assert.deepEqual(entries[0].words.map(w => w.t), [60, 61.25]);
});
