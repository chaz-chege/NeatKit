// Bundles src/lyric/main.js (+ mediabunny) into one minified file the site can serve, then stamps the
// content hash into the page's <script src="...lyric.js?v=HASH">. A new bundle therefore always gets a
// new URL, so a browser or the service worker can never pair a new page with an old script.
// Run:  npm install && npm run build:lyric
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

await build({
  entryPoints: ['src/lyric/main.js'],
  bundle: true, format: 'esm', minify: true, target: ['es2022'],
  outfile: 'assets/lyric/lyric.js', legalComments: 'linked', logLevel: 'info',
});

const hash = createHash('sha256').update(readFileSync('assets/lyric/lyric.js')).digest('hex').slice(0, 10);
const page = 'tools/lyric-video.html';
const html = readFileSync(page, 'utf8');
const next = html.replace(/\/assets\/lyric\/lyric\.js(\?v=[0-9a-f]+)?"/, `/assets/lyric/lyric.js?v=${hash}"`);
if (next === html && !html.includes(`?v=${hash}`)) throw new Error('Could not find the lyric.js script tag in ' + page);
writeFileSync(page, next);
console.log(`stamped ${page} with v=${hash}`);
