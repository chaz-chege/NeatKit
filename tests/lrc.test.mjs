import test from 'node:test';
import assert from 'node:assert/strict';
import { isLrc, parseLrc, formatLrc, splitLyrics, spreadLines, buildTimeline, lineIndexAt, parseTime, formatTime, fillMissingTimes } from '../src/lyric/lrc.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('isLrc detects timestamped text only', () => {
  assert.equal(isLrc('[00:01.00]a\n[00:03.00]b'), true);
  assert.equal(isLrc('just words\nmore words'), false);
  assert.equal(isLrc('[Verse 1]\nhello'), false);
  assert.equal(isLrc('[00:01.00]only one line'), false);
});

test('parseLrc: stamps, fractions, multiple stamps per line, metadata ignored', () => {
  const { entries } = parseLrc('[ar:Someone]\n[ti:Song]\n[00:01.5]one\n[00:03.25][00:09.00]two\n');
  assert.deepEqual(entries.map(e => [e.t, e.text]), [[1.5, 'one'], [3.25, 'two'], [9, 'two']]);
});

test('parseLrc: fraction digits mean decimals (5 -> .5, 05 -> .05, 500 -> .5)', () => {
  const { entries } = parseLrc('[00:01.5]a\n[00:02.05]b\n[00:03.500]c');
  near(entries[0].t, 1.5); near(entries[1].t, 2.05); near(entries[2].t, 3.5);
});

test('parseLrc: offset tag shifts lyrics earlier for positive values and clamps at zero', () => {
  const { entries, offset } = parseLrc('[offset:500]\n[00:00.20]a\n[00:02.00]b');
  assert.equal(offset, 0.5);
  near(entries[0].t, 0); near(entries[1].t, 1.5);
});

test('parseLrc: empty text lines are kept as gap markers; CRLF and BOM handled', () => {
  const { entries } = parseLrc('\uFEFF[00:01.00]hi\r\n[00:03.00]\r\n[00:05.00]yo');
  assert.deepEqual(entries.map(e => e.text), ['hi', '', 'yo']);
});

test('parseLrc: enhanced word stamps', () => {
  const { entries } = parseLrc('[00:10.00]<00:10.00>Hello <00:10.50>big <00:11.00>world');
  assert.equal(entries[0].text, 'Hello big world');
  assert.deepEqual(entries[0].words.map(w => [w.text, w.t]), [['Hello', 10], ['big', 10.5], ['world', 11]]);
});

test('formatLrc round trips', () => {
  const src = [{ t: 1.5, text: 'one' }, { t: 62.25, text: 'two' }];
  const text = formatLrc(src);
  assert.equal(text, '[00:01.50]one\n[01:02.25]two');
  const back = parseLrc(text).entries;
  near(back[1].t, 62.25);
});

test('splitLyrics strips section tags, blanks and zero-width characters', () => {
  const out = splitLyrics('[Verse 1]\nHello   there\n\n\u200BSecond line\n[Chorus]\n(oh oh)\n');
  assert.deepEqual(out, ['Hello there', 'Second line', '(oh oh)']);
});

test('spreadLines is monotonic, starts at start, stays inside the range', () => {
  const s = spreadLines(['a short one', 'a much much longer line of lyrics here', 'mid length line'], 2, 62);
  near(s[0].t, 2);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].t > s[i - 1].t);
  assert.ok(s[s.length - 1].t < 62);
  assert.deepEqual(spreadLines([], 0, 10), []);
});

test('buildTimeline: lines last until the next one, capped by a hold limit', () => {
  const tl = buildTimeline([{ t: 1, text: 'one two' }, { t: 3, text: 'three' }, { t: 60, text: 'later words' }], 70);
  near(tl[0].end, 3);
  assert.ok(tl[1].end < 20, 'hold cap must stop a line freezing over a long instrumental gap');
  near(tl[2].end, 60 + 2.6);
});

test('buildTimeline: gap marker ends the previous line', () => {
  const tl = buildTimeline([{ t: 1, text: 'hello world' }, { t: 2.2, text: '' }, { t: 8, text: 'next' }], 20);
  assert.equal(tl.length, 2);
  near(tl[0].end, 2.2);
});

test('buildTimeline: word times are ordered, inside the line, and weighted by length', () => {
  const [line] = buildTimeline([{ t: 10, text: 'a unbelievable b' }, { t: 14, text: 'x' }], 30);
  for (let i = 0; i < line.words.length; i++) {
    assert.ok(line.words[i].start >= line.start && line.words[i].end <= line.end + 1e-9);
    assert.ok(line.words[i].end >= line.words[i].start);
    if (i) near(line.words[i].start, line.words[i - 1].end);
  }
  const d = line.words.map(w => w.end - w.start);
  assert.ok(d[1] > d[0] && d[1] > d[2], 'long word gets more time');
});

test('buildTimeline: enhanced word stamps are used verbatim', () => {
  const { entries } = parseLrc('[00:10.00]<00:10.00>Hello <00:10.50>big <00:11.00>world\n[00:13.00]next');
  const tl = buildTimeline(entries, 30);
  assert.deepEqual(tl[0].words.map(w => w.start), [10, 10.5, 11]);
  near(tl[0].words[2].end, tl[0].end);
});

test('buildTimeline: unsynced entries (t = null) are ignored, never crash', () => {
  assert.deepEqual(buildTimeline([{ t: null, text: 'x' }], 10), []);
});

test('lineIndexAt: before first line, inside a line, in a gap, after the end', () => {
  const tl = buildTimeline([{ t: 2, text: 'a b c d e f' }, { t: 5, text: 'c d' }, { t: 100, text: 'e f' }], 120);
  assert.equal(lineIndexAt(tl, 1), -1);
  assert.equal(lineIndexAt(tl, 2), 0);
  assert.equal(lineIndexAt(tl, 4.99), 0);
  assert.equal(lineIndexAt(tl, 5), 1);
  assert.equal(lineIndexAt(tl, 50), -1);
  assert.equal(lineIndexAt(tl, 101), 2);
  assert.equal(lineIndexAt([], 3), -1);
});

test('parseTime / formatTime', () => {
  assert.equal(parseTime('1:23.4'), 83.4);
  assert.equal(parseTime('83'), 83);
  assert.equal(parseTime('0:05'), 5);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
  assert.equal(formatTime(83.44), '1:23.4');
  assert.equal(formatTime(5), '0:05.0');
  assert.equal(formatTime(3.5, 2, true), '00:03.50');
});

test('fillMissingTimes: never changes a line that already has a time, never mutates its input', () => {
  const entries = [{ t: 5, text: 'aaaa aaaa' }, { t: null, text: 'bbbb bbbb' }, { t: 20, text: 'cccc cccc' }, { t: null, text: 'dddd dddd' }];
  const copy = JSON.parse(JSON.stringify(entries));
  const out = fillMissingTimes(entries, 60);
  assert.deepEqual(entries, copy);
  assert.equal(out[0], 5); assert.equal(out[2], 20);
  assert.ok(out[1] > 5 && out[1] < 20, 'gap line sits between its neighbours');
  assert.ok(out[3] > 20 && out[3] < 60, 'trailing line sits after the last anchor');
});

test('fillMissingTimes: all synced is a no-op; none synced spreads over the whole song', () => {
  const all = [{ t: 1, text: 'a b' }, { t: 4, text: 'c d' }];
  assert.deepEqual(fillMissingTimes(all, 30), [1, 4]);
  const none = fillMissingTimes([{ t: null, text: 'one line here' }, { t: null, text: 'two line here' }, { t: null, text: 'three line here' }], 90);
  for (let i = 1; i < none.length; i++) assert.ok(none[i] > none[i - 1]);
  assert.ok(none[0] <= 5 && none[2] < 90);
  assert.deepEqual(fillMissingTimes([], 10), []);
});

test('fillMissingTimes: leading unsynced lines go before the first anchor, results stay monotonic', () => {
  const out = fillMissingTimes([{ t: null, text: 'intro words' }, { t: null, text: 'more words' }, { t: 30, text: 'anchor line' }, { t: null, text: 'after' }], 120);
  assert.ok(out[0] < out[1] && out[1] < 30 && out[2] === 30 && out[3] > 30);
});

test('fillMissingTimes: out-of-order or too-close anchors still give increasing times', () => {
  const out = fillMissingTimes([{ t: 10, text: 'a' }, { t: null, text: 'b' }, { t: null, text: 'c' }, { t: 10.1, text: 'd' }], 60);
  assert.ok(out[1] > out[0] && out[2] > out[1]);
});

test('buildTimeline marks only lines with REAL word times as real (so looks never animate guesses)', () => {
  const { entries } = parseLrc('[00:10.00]<00:10.00>Hello <00:10.50>big <00:11.00>world\n[00:13.00]plain line only\n');
  const tl = buildTimeline(entries, 30);
  assert.equal(tl[0].real, true);
  assert.equal(tl[1].real, false);
  assert.equal(buildTimeline([{ t: 1, text: 'a b' }], 10)[0].real, false);
});
