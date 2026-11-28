import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('the page references the CURRENT bundle hash (run `npm run build:lyric` after changing src/lyric)', () => {
  const hash = createHash('sha256').update(readFileSync('assets/lyric/lyric.js')).digest('hex').slice(0, 10);
  const html = readFileSync('tools/lyric-video.html', 'utf8');
  assert.ok(html.includes(`/assets/lyric/lyric.js?v=${hash}"`), `tools/lyric-video.html should reference lyric.js?v=${hash}`);
});

test('no debug hook is exposed unless ?lyricdebug is present', () => {
  const src = readFileSync('src/lyric/main.js', 'utf8');
  assert.match(src, /if \(DEBUG\) window\.__lyric/);
  assert.equal((src.match(/window\.__lyric/g) || []).length, 1);
});
