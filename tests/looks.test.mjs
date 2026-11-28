import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal canvas stand-ins so the renderer can run in Node. Text width = 9 px per character.
function stubCtx(log = []) {
  const target = {
    measureText: s => ({ width: String(s).length * 9 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
  };
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { log.push(String(k)); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return stubCtx(); } };

const { LOOKS, createRenderer } = await import('../src/lyric/looks.js');
const { buildTimeline, parseLrc } = await import('../src/lyric/lrc.js');

const estimated = buildTimeline([{ t: 1, text: "Midnight in the city lights" }, { t: 5, text: "Singing like nobody's listening" }], 12);
const real = buildTimeline(parseLrc('[00:01.00]<00:01.00>Midnight <00:02.00>in <00:02.40>the <00:02.90>city <00:03.60>lights\n[00:05.00]<00:05.00>Singing <00:05.80>like <00:06.40>nobody\'s <00:07.20>listening').entries, 12);

test('the module exposes the four looks', () => {
  assert.deepEqual(LOOKS.map(l => l.id), ['karaoke', 'neon', 'street', 'pop']);
  assert.equal(typeof createRenderer, 'function');
});

for (const look of LOOKS) for (const [name, tl] of [['estimated', estimated], ['real', real]]) {
  test(`${look.id} (${name} word timing) draws every moment without throwing, and actually draws text`, () => {
    const log = [];
    const r = createRenderer({ width: 540, height: 960, look: look.id, timeline: tl });
    for (let t = 0; t <= 12; t += 0.1) r.draw(stubCtx(log), t);
    assert.ok(log.filter(c => c === 'fillText').length > 20, 'text must be drawn while lines are active');
  });
}

test('estimated timing never animates per word: the line is fully visible from its first moments', () => {
  const log = [];
  const ctx = stubCtx(log);
  createRenderer({ width: 540, height: 960, look: 'karaoke', timeline: estimated }).draw(ctx, 1.3);
  const texts = [];
  const spy = new Proxy(ctx, { get(t, k) { if (k === 'fillText') return (s) => texts.push(s); return t[k]; }, set(t, k, v) { t[k] = v; return true; } });
  createRenderer({ width: 540, height: 960, look: 'karaoke', timeline: estimated }).draw(spy, 1.3);
  assert.deepEqual(texts, ['MIDNIGHT', 'IN', 'THE', 'CITY', 'LIGHTS', 'MADE WITH NEATKITAPP.COM'], 'all five words drawn right after the line starts');
});

test('before the first line and in gaps nothing but the background and watermark is drawn', () => {
  const texts = [];
  const base = stubCtx();
  const spy = new Proxy(base, { get(t, k) { if (k === 'fillText') return (s) => texts.push(s); return t[k]; }, set(t, k, v) { t[k] = v; return true; } });
  createRenderer({ width: 540, height: 960, look: 'neon', timeline: estimated }).draw(spy, 0.2);
  assert.deepEqual(texts, ['MADE WITH NEATKITAPP.COM']);
});
