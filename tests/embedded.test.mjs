import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readEmbedded } from '../src/lyric/embedded.js';
import { splitLyrics } from '../src/lyric/lrc.js';

const blob = name => new Blob([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))]);
const cover = readFileSync(new URL('./fixtures/cover.jpg', import.meta.url));
const EXPECT = ['Kiburi ni mzigo', 'Weka chini usimame', 'Bure umepewa \u2014 na\u00ef\u00f1\u00e9'];

for (const name of ['emb.mp3', 'emb.m4a', 'emb.flac', 'emb.ogg']) {
  test(`${name}: embedded lyrics are found, with unicode intact`, async () => {
    const r = await readEmbedded(blob(name));
    assert.ok(r.lyrics, 'lyrics should be found');
    assert.deepEqual(splitLyrics(r.lyrics), EXPECT);
  });
}

for (const name of ['emb.mp3', 'emb.m4a', 'emb.flac']) {
  test(`${name}: cover art is returned byte for byte`, async () => {
    const r = await readEmbedded(blob(name));
    assert.ok(r.cover, 'cover should be found');
    assert.equal(r.cover.type, 'image/jpeg');
    assert.deepEqual(new Uint8Array(await r.cover.arrayBuffer()), new Uint8Array(cover));
  });
}

test('emb.mp3: title and artist are read too', async () => {
  const r = await readEmbedded(blob('emb.mp3'));
  assert.equal(r.title, 'Test Song'); assert.equal(r.artist, 'Test Artist');
});

test('a file with no tags gives nulls, never throws', async () => {
  const r = await readEmbedded(blob('plain.mp3'));
  assert.deepEqual({ lyrics: r.lyrics, cover: r.cover }, { lyrics: null, cover: null });
});

test('garbage input gives nulls, never throws', async () => {
  const r = await readEmbedded(new Blob([new Uint8Array(2000).map((_, i) => (i * 37) & 255)]));
  assert.deepEqual({ lyrics: r.lyrics, cover: r.cover }, { lyrics: null, cover: null });
  const e = await readEmbedded(new Blob([]));
  assert.equal(e.lyrics, null);
});
