/**
 * timings.js
 * Reads a timings file produced by another tool and turns it into lyric entries the tool can use.
 * Accepted shapes:
 *   HookCut export   {"lines":[{"start","end","text","words":[{"text","start","end"}]}]}
 *   Whisper-style    {"segments":[{"start","end","text","words":[{"word","start","end"}]}]}
 *   Plain array      [{"start","text","words":[...]}]
 *   HookCut taps     {"lines":["text", ...],"taps":[seconds, ...]}
 * Word times are only used when a line's word count matches its timings exactly; otherwise the line keeps its
 * start time and the words are spread by length like any other line.
 */

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const wordText = w => String(w.text ?? w.word ?? '').trim();

/**
 * @param {string} text file contents
 * @returns {{entries:{t:number|null,text:string,words?:{t:number,text:string}[]}[], kind:string, wordLevel:boolean}}
 * @throws {Error} with a message that is safe to show to the user
 */
export function parseTimingsJson(text) {
  let data;
  try { data = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
  catch { throw new Error('That file is not valid JSON.'); }

  const rows = Array.isArray(data) ? data : (data && (data.lines || data.segments));
  if (!Array.isArray(rows) || !rows.length) throw new Error('No lyric lines were found in that timings file.');

  if (typeof rows[0] === 'string') {                                  // HookCut tap payload
    const taps = Array.isArray(data.taps) ? data.taps : [];
    const entries = rows.map((txt, i) => ({ text: String(txt).trim(), t: num(taps[i]) })).filter(e => e.text);
    if (!entries.length) throw new Error('No lyric lines were found in that timings file.');
    return { entries, kind: 'taps', wordLevel: false };
  }

  const entries = [];
  let wordLevel = false;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rawWords = Array.isArray(row.words) ? row.words : [];
    const words = rawWords.map(w => ({ t: num(w.start ?? w.t), text: wordText(w) })).filter(w => w.text);
    const wordsText = words.map(w => w.text).join(' ');
    const lineText = (typeof row.text === 'string' && row.text.trim()) ? row.text.trim().replace(/\s+/g, ' ') : wordsText;
    if (!lineText) continue;
    let t = num(row.start ?? row.t);
    if (t == null && words.length && words[0].t != null) t = words[0].t;
    if (t == null) continue;
    const entry = { t, text: lineText };
    const tokens = lineText.split(' ');
    if (words.length && words.length === tokens.length && words.every(w => w.t != null)) {
      entry.words = words.map(w => ({ t: w.t, text: w.text }));
      entry.text = wordsText;                                         // keep text and word timings consistent
      wordLevel = true;
    }
    entries.push(entry);
  }
  if (!entries.length) throw new Error('No usable lines with start times were found in that file.');
  entries.sort((a, b) => a.t - b.t);
  const kind = Array.isArray(data) ? 'lines' : (data.source === 'hookcut' ? 'hookcut' : data.segments ? 'segments' : 'lines');
  return { entries, kind, wordLevel };
}

/**
 * Is this text a JSON document (object or array)? Used to tell a timings file from lyrics or LRC.
 * It must really parse: an LRC file also starts with "[", so a first-character check would misroute it.
 */
export function looksLikeJson(text) {
  const s = String(text).replace(/^\uFEFF/, '').trimStart();
  if (!(s.startsWith('{') || s.startsWith('['))) return false;
  try { const v = JSON.parse(s); return v !== null && typeof v === 'object'; } catch { return false; }
}
