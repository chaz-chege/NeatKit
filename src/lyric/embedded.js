/**
 * embedded.js
 * Reads lyrics and cover art that are stored INSIDE the audio file (ID3 USLT/APIC in MP3, the equivalents in
 * M4A, FLAC and OGG). Suno MP3s carry both, which is what HookCut used to pre-fill the lyrics and the background.
 * Runs entirely in the browser. Never throws: when nothing is found, or the file cannot be parsed, every field is null.
 */
import { Input, BlobSource, MP3, WAVE, OGG, FLAC, MP4, ADTS, MATROSKA } from 'mediabunny';

const NOTHING = Object.freeze({ lyrics: null, title: null, artist: null, cover: null });

/** @param {Blob} blob @returns {Promise<{lyrics:string|null,title:string|null,artist:string|null,cover:Blob|null}>} */
export async function readEmbedded(blob) {
  let input;
  try {
    input = new Input({ source: new BlobSource(blob), formats: [MP3, WAVE, OGG, FLAC, MP4, ADTS, MATROSKA] });
    const tags = await input.getMetadataTags();
    const lyrics = typeof tags.lyrics === 'string' ? tags.lyrics.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim() : '';
    const images = Array.isArray(tags.images) ? tags.images : [];
    const img = images.find(i => i.kind === 'coverFront') || images[0];
    const cover = img && img.data && img.data.length ? new Blob([img.data], { type: img.mimeType || 'image/jpeg' }) : null;
    return { lyrics: lyrics || null, title: tags.title || null, artist: tags.artist || null, cover };
  } catch {
    return { ...NOTHING };
  } finally {
    try { if (input) input.dispose(); } catch { /* already closed */ }
  }
}
