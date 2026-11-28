/**
 * looks.js
 * Canvas renderer for the four caption looks. A look is a pure function of time:
 * the same draw(ctx, t) call powers the live preview AND every exported frame, so what you see is
 * exactly what you get. All sizes scale from the canvas width (u = width / 360).
 *
 * Looks (layout x theme, ported in spirit from HookCut's engines):
 *   karaoke  phrase layout, editorial theme   (Anton, white with a red active word)
 *   neon     phrase layout, neon theme        (Bungee + Pacifico, glow)
 *   street   verse layout, street theme       (Marker, zigzag stack, lime active line)
 *   pop      cards layout, pop-art theme      (Bangers, one word per card on a burst)
 */
import { lineIndexAt } from './lrc.js';

export const LOOKS = [
  { id: 'karaoke', name: 'Clean Karaoke' },
  { id: 'neon', name: 'Neon Night' },
  { id: 'street', name: 'Street Verse' },
  { id: 'pop', name: 'Pop Art' },
];

const FONT_FILES = [
  ['NK Anton', 'Anton.woff2'],
  ['NK Bungee', 'Bungee.woff2'],
  ['NK Pacifico', 'Pacifico.woff2'],
  ['NK Marker', 'Marker.woff2'],
  ['NK Bangers', 'Bangers.woff2'],
];

/** Load the caption fonts so canvas text uses them (canvas silently falls back otherwise). */
export async function loadFonts(base = '/assets/lyric/fonts/') {
  await Promise.all(FONT_FILES.map(async ([family, file]) => {
    if ([...document.fonts].some(f => f.family === family && f.status === 'loaded')) return;
    const face = new FontFace(family, `url(${base}${file})`);
    await face.load();
    document.fonts.add(face);
  }));
  try { await document.fonts.load('600 12px Outfit'); } catch { /* UI font is optional for the canvas */ }
}

const clamp01 = v => Math.min(1, Math.max(0, v));
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

/** Index of the most recently started word in a line, or -1. */
function currentWord(line, t) {
  let k = -1;
  for (let i = 0; i < line.words.length; i++) if (t >= line.words[i].start) k = i; else break;
  return k;
}

/* ------------------------------------------------------------------ text layout */

/** Measure items ({text,font}) and wrap into rows no wider than maxW, balanced so rows have similar width. */
function layoutRows(ctx, items, spaceFont, maxW) {
  ctx.font = spaceFont;
  const space = ctx.measureText(' ').width;
  for (const it of items) { ctx.font = it.font; it.w = ctx.measureText(it.text).width; }
  const wrap = width => {
    const rows = [[]]; let rw = 0;
    for (const it of items) {
      const add = (rows[rows.length - 1].length ? space : 0) + it.w;
      if (rows[rows.length - 1].length && rw + add > width) { rows.push([it]); rw = it.w; }
      else { rows[rows.length - 1].push(it); rw += add; }
    }
    return rows;
  };
  let rows = wrap(maxW);
  if (rows.length > 1) {                       // balance: shrink the width while the row count stays the same
    let lo = Math.max(...items.map(i => i.w)), hi = maxW;
    for (let n = 0; n < 14 && hi - lo > 1; n++) {
      const mid = (lo + hi) / 2;
      if (wrap(mid).length === rows.length) hi = mid; else lo = mid;
    }
    rows = wrap(hi + 1);
  }
  return rows.map(r => ({ items: r, width: r.reduce((a, i) => a + i.w, 0) + space * (r.length - 1) }));
}

function drawCover(ctx, img, W, H) {
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight;
  const s = Math.max(W / iw, H / ih);
  ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}

/* ------------------------------------------------------------------ backgrounds */

function makeDotPattern(ctx, u) {
  const size = Math.round(13 * u);
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath(); g.arc(size / 2, size / 2, 1.6 * u, 0, Math.PI * 2); g.fill();
  return { pattern: ctx.createPattern(c, 'repeat'), size };
}

function drawBackground(ctx, W, H, t, look, img, extra) {
  const u = W / 360;
  if (img) {                                    // user cover art: dim it so text stays readable
    drawCover(ctx, img, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    return;
  }
  if (look === 'karaoke') {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, '#13213d'); g.addColorStop(1, '#07080f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const cx = W * (0.3 + Math.sin(t * 0.3) * 0.06), cy = H * (0.2 + Math.cos(t * 0.25) * 0.03);
    const r = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.95); r.addColorStop(0, 'rgba(42,79,134,0.95)'); r.addColorStop(1, 'rgba(42,79,134,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  } else if (look === 'neon') {
    ctx.fillStyle = '#07031a'; ctx.fillRect(0, 0, W, H);
    const glow = (x, y, rad, rgb) => { const r = ctx.createRadialGradient(x, y, 0, x, y, rad); r.addColorStop(0, `rgba(${rgb},0.85)`); r.addColorStop(1, `rgba(${rgb},0)`); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H); };
    glow(W * (0.72 + Math.sin(t * 0.4) * 0.05), H * 0.25, W * 0.9, '106,27,168');
    glow(W * 0.2, H * (0.85 + Math.cos(t * 0.35) * 0.03), W * 0.85, '10,108,143');
  } else if (look === 'street') {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#303030'); g.addColorStop(1, '#141414');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2, H * 0.88); ctx.rotate(-7 * Math.PI / 180);
    ctx.fillStyle = '#ff4fa3'; ctx.fillRect(-W * 0.7, -17 * u, W * 1.4, 34 * u); ctx.restore();
  } else {                                      // pop
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, '#2f7bff'); g.addColorStop(1, '#1a3fbf');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!extra.dots) extra.dots = makeDotPattern(ctx, u);
    const off = (t * 5 * u) % extra.dots.size;
    ctx.save(); ctx.translate(off, off); ctx.fillStyle = extra.dots.pattern;
    ctx.fillRect(-extra.dots.size, -extra.dots.size, W + extra.dots.size * 2, H + extra.dots.size * 2); ctx.restore();
  }
}

function drawWatermark(ctx, W, H) {
  const u = W / 360;
  ctx.save();
  ctx.font = `600 ${Math.round(10.5 * u)}px Outfit, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(1.4 * u).toFixed(1)}px`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('MADE WITH NEATKITAPP.COM', W / 2, H - 16 * u);
  ctx.restore();
}

/* ------------------------------------------------------------------ looks */

function fadeAlpha(line, t) {
  return easeOut(clamp01((t - line.start) / 0.14)) * (1 - clamp01((t - (line.end - 0.16)) / 0.16));
}

function drawKaraoke(ctx, W, H, t, line, cache, idx) {
  const u = W / 360, S = Math.round(W * 0.13);
  const font = `${S}px "NK Anton", Impact, sans-serif`;
  let L = cache.get(idx);
  if (!L) {
    const rows = layoutRows(ctx, line.words.map(w => ({ text: w.text.toUpperCase(), font })), font, W * 0.84);
    L = { rows, lh: S * 1.12 }; cache.set(idx, L);
  }
  const real = line.real !== false;
  const a = fadeAlpha(line, t), cur = real ? currentWord(line, t) : -1;
  const top = H * 0.5 - (L.rows.length * L.lh) / 2 + (1 - easeOut(clamp01((t - line.start) / 0.14))) * 14 * u;
  let k = 0;
  ctx.save(); ctx.globalAlpha = a; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (!real) {                                      // line-level timing: the whole line lands together with a small pop
    const ls = 1 + 0.07 * (1 - easeOut(clamp01((t - line.start) / 0.22)));
    ctx.translate(W / 2, H / 2); ctx.scale(ls, ls); ctx.translate(-W / 2, -H / 2);
  }
  const space = (() => { ctx.font = font; return ctx.measureText(' ').width; })();
  L.rows.forEach((row, r) => {
    let x = (W - row.width) / 2; const base = top + r * L.lh + S * 0.86;
    for (const it of row.items) {
      const w = line.words[k], isCur = k === cur;
      const pop = isCur ? 1 + 0.12 * easeOutBack(clamp01((t - w.start) / 0.14)) : 1;
      ctx.save(); ctx.translate(x + it.w / 2, base - S * 0.35); ctx.scale(pop, pop);
      ctx.font = font; ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowOffsetY = 3 * u;
      ctx.fillStyle = isCur ? '#ff4b3e' : (!real || k < cur ? '#ffffff' : 'rgba(255,255,255,0.28)');
      ctx.fillText(it.text, -it.w / 2, S * 0.35); ctx.restore();
      x += it.w + space; k++;
    }
  });
  ctx.restore();
}

function drawNeon(ctx, W, H, t, line, cache, idx) {
  const u = W / 360, S = Math.round(W * 0.1);
  const base = `${S}px "NK Bungee", sans-serif`, hero = `${Math.round(S * 1.45)}px "NK Pacifico", cursive`;
  let L = cache.get(idx);
  if (!L) {
    let heroK = -1, best = 5;
    line.words.forEach((w, i) => { if (w.text.length > best) { best = w.text.length; heroK = i; } });
    const items = line.words.map((w, i) => i === heroK ? { text: w.text.toLowerCase(), font: hero, size: S * 1.45, hero: true } : { text: w.text.toUpperCase(), font: base, size: S });
    const rows = layoutRows(ctx, items, base, W * 0.86);
    L = { rows, lh: S * 1.5 }; cache.set(idx, L);
  }
  const real = line.real !== false;
  const a = fadeAlpha(line, t), cur = real ? currentWord(line, t) : -1;
  const top = H * 0.5 - (L.rows.length * L.lh) / 2;
  const space = (() => { ctx.font = base; return ctx.measureText(' ').width * 1.25; })();
  let k = 0;
  ctx.save(); ctx.globalAlpha = a; ctx.textBaseline = 'alphabetic';
  L.rows.forEach((row, r) => {
    const rowW = row.items.reduce((a, i) => a + i.w, 0) + (row.items.length - 1) * space;
    let x = (W - rowW) / 2; const baseY = top + r * L.lh + S * 1.05;
    for (const it of row.items) {
      const w = line.words[k], wStart = real ? w.start : line.start + k * 0.07;     // estimated timing: quick stagger, not a per-word guess
      if (t >= wStart) {
        const p = clamp01((t - wStart) / 0.18), isCur = k === cur;
        const sc = (0.7 + 0.3 * easeOutBack(p)) * (isCur ? 1.1 : 1);
        ctx.save(); ctx.globalAlpha = a * easeOut(p); ctx.translate(x + it.w / 2, baseY - it.size * 0.3); ctx.scale(sc, sc);
        ctx.font = it.font; ctx.fillStyle = '#fff';
        ctx.shadowColor = isCur ? '#1ee6ff' : '#ff2bd6'; ctx.shadowBlur = (isCur ? 34 : 22) * u;
        ctx.fillText(it.text, -it.w / 2, it.size * 0.3); ctx.shadowBlur = 8 * u; ctx.fillText(it.text, -it.w / 2, it.size * 0.3);
        ctx.restore();
      }
      x += it.w + space; k++;
    }
  });
  ctx.restore();
}

function streetBlock(ctx, W, H, t, line, idx, cache, isCurrent) {
  const u = W / 360, S = Math.round(W * 0.095);
  const font = `${S}px "NK Marker", sans-serif`;
  let L = cache.get(idx);
  if (!L) { L = { rows: layoutRows(ctx, line.words.map(w => ({ text: w.text.toUpperCase(), font })), font, W * 0.8), lh: S * 1.2 }; cache.set(idx, L); }
  const odd = idx % 2 === 1, cy = H * (odd ? 0.60 : 0.36);
  const space = (() => { ctx.font = font; return ctx.measureText(' ').width; })();
  const blockH = L.rows.length * L.lh, maxRow = Math.max(...L.rows.map(r => r.width));
  const left = odd ? W * 0.9 - maxRow : W * 0.1;
  ctx.save(); ctx.translate(W / 2, cy); ctx.rotate((odd ? 3 : -4) * Math.PI / 180); ctx.translate(-W / 2, -blockH / 2);
  const enter = isCurrent ? easeOut(clamp01((t - line.start) / 0.14)) : 1;
  const fade = isCurrent ? 1 - clamp01((t - (line.end - 0.16)) / 0.16) : 1;
  let k = 0;
  L.rows.forEach((row, r) => {
    let x = odd ? left + (maxRow - row.width) : left; const baseY = r * L.lh + S * 0.9;
    for (const it of row.items) {
      const w = line.words[k]; let p = 1;
      if (isCurrent) p = clamp01((t - (line.real !== false ? w.start : line.start + k * 0.06)) / 0.16);
      if (p > 0) {
        ctx.save(); ctx.globalAlpha = (isCurrent ? easeOut(p) * fade : 0.38) * (isCurrent ? enter : 1);
        ctx.font = font; ctx.fillStyle = isCurrent ? '#c6ff00' : '#ffffff';
        if (isCurrent) { ctx.shadowColor = '#000'; ctx.shadowOffsetY = 3 * u; }
        ctx.fillText(it.text, x, baseY + (isCurrent ? (1 - easeOut(p)) * 10 * u : 0)); ctx.restore();
      }
      x += it.w + space; k++;
    }
  });
  ctx.restore();
}

function drawStreet(ctx, W, H, t, line, cache, idx, timeline) {
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (idx > 0 && line.start - timeline[idx - 1].end < 4) streetBlock(ctx, W, H, t, timeline[idx - 1], idx - 1, cache, false);
  streetBlock(ctx, W, H, t, line, idx, cache, true);
}

const BURST = [[50,0],[61,22],[86,12],[78,36],[100,50],[78,62],[88,88],[62,78],[50,100],[38,78],[12,88],[22,62],[0,50],[22,36],[14,12],[39,22]];

function drawPopLine(ctx, W, H, t, line, cache, idx) {
  const u = W / 360, S = Math.round(W * 0.115), font = `${S}px "NK Bangers", sans-serif`;
  let L = cache.get(idx);
  if (!L) { L = { rows: layoutRows(ctx, line.words.map(w => ({ text: w.text.toUpperCase(), font })), font, W * 0.62), lh: S * 1.05 }; cache.set(idx, L); }
  const maxRow = Math.max(...L.rows.map(r => r.width)), cw = maxRow + S * 1.0, ch = L.rows.length * L.lh + S * 0.2;
  const px = S * 0.9, py = S * 0.7, bw = cw + px * 2, bh = ch + py * 2;
  const p = clamp01((t - line.start) / 0.24), sc = easeOutBack(p) * (1 - clamp01((t - (line.end - 0.14)) / 0.14));
  const rot = (idx % 2 ? 3 : -3) * Math.PI / 180;
  ctx.save(); ctx.translate(W / 2, H * 0.47); ctx.rotate(rot); ctx.scale(Math.max(0.001, sc), Math.max(0.001, sc));
  ctx.beginPath(); BURST.forEach(([x, y], i) => { const X = (x / 100 - 0.5) * bw, Y = (y / 100 - 0.5) * bh; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.closePath(); ctx.fillStyle = '#ff2d95'; ctx.fill();
  ctx.fillStyle = '#000'; ctx.fillRect(-cw / 2 + 6 * u, -ch / 2 + 6 * u, cw, ch);
  ctx.fillStyle = '#ffd60a'; ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
  ctx.lineWidth = 4.5 * u; ctx.strokeStyle = '#000'; ctx.strokeRect(-cw / 2, -ch / 2, cw, ch);
  ctx.fillStyle = '#101010'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'; ctx.font = font;
  L.rows.forEach((row, r) => ctx.fillText(row.items.map(i => i.text).join(' '), 0, -ch / 2 + S * 0.1 + r * L.lh + S * 0.82));
  ctx.restore();
}

function drawPop(ctx, W, H, t, line, cache, idx) {
  if (line.real === false) return drawPopLine(ctx, W, H, t, line, cache, idx);
  const u = W / 360, S = Math.round(W * 0.19), cur = currentWord(line, t);
  if (cur < 0 || t >= line.end) return;
  const w = line.words[cur], font = `${S}px "NK Bangers", sans-serif`, text = w.text.toUpperCase().replace(/[,.;:!?]+$/, m => m.slice(-1) === '!' || m.slice(-1) === '?' ? m.slice(-1) : '');
  ctx.font = font; const tw = ctx.measureText(text).width;
  const cw = tw + S * 1.0, ch = S * 1.08, px = S * 0.8, py = S * 0.62;
  const p = clamp01((t - w.start) / 0.22), sc = easeOutBack(p);
  const rot = ((idx * 3 + cur) % 2 ? 3 : -3) * Math.PI / 180;
  ctx.save(); ctx.translate(W / 2, H * 0.47); ctx.rotate(rot); ctx.scale(sc, sc);
  const bw = cw + px * 2, bh = ch + py * 2;
  ctx.beginPath(); BURST.forEach(([x, y], i) => { const X = (x / 100 - 0.5) * bw, Y = (y / 100 - 0.5) * bh; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.closePath(); ctx.fillStyle = '#ff2d95'; ctx.fill();
  ctx.fillStyle = '#000'; ctx.fillRect(-cw / 2 + 7 * u, -ch / 2 + 7 * u, cw, ch);          // hard shadow
  ctx.fillStyle = '#ffd60a'; ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
  ctx.lineWidth = 5 * u; ctx.strokeStyle = '#000'; ctx.strokeRect(-cw / 2, -ch / 2, cw, ch);
  ctx.fillStyle = '#101010'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'; ctx.font = font;
  ctx.fillText(text, 0, S * 0.3); ctx.restore();
}

/* ------------------------------------------------------------------ renderer */

/**
 * @param {{width:number,height:number,look:string,timeline:object[],bgImage?:CanvasImageSource|null,watermark?:boolean}} o
 * @returns {{draw:(ctx:CanvasRenderingContext2D,t:number)=>void}}
 */
export function createRenderer({ width: W, height: H, look, timeline, bgImage = null, watermark = true }) {
  const cache = new Map(), extra = {};
  return {
    draw(ctx, t) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
      drawBackground(ctx, W, H, t, look, bgImage, extra);
      const idx = lineIndexAt(timeline, t);
      if (idx >= 0) {
        const line = timeline[idx];
        if (look === 'karaoke') drawKaraoke(ctx, W, H, t, line, cache, idx);
        else if (look === 'neon') drawNeon(ctx, W, H, t, line, cache, idx);
        else if (look === 'street') drawStreet(ctx, W, H, t, line, cache, idx, timeline);
        else drawPop(ctx, W, H, t, line, cache, idx);
      }
      if (watermark) drawWatermark(ctx, W, H);
      ctx.restore();
    },
  };
}
