from pathlib import Path

root = Path('.')
files = sorted(root.rglob('*.html'))

footer_css = '''
.nk-footer{background:var(--white);border-top:1px solid var(--rule2);padding:2.5rem 2rem;margin-top:3rem}
.nk-footer-inner{max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;gap:2rem;justify-content:space-between;align-items:flex-start}
.nk-footer-brand .nk-logo-f{display:flex;align-items:center;gap:8px;text-decoration:none;margin-bottom:0.625rem}
.nk-footer-brand .nk-logo-mark-f{width:22px;height:22px;background:var(--grad);border-radius:5px;position:relative;overflow:hidden;flex-shrink:0}
.nk-footer-brand .nk-logo-mark-f::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.35) 0%,transparent 55%)}
.nk-footer-brand .nk-logo-text-f{font-family:var(--display);font-size:1rem;color:var(--tx1);letter-spacing:-0.01em}
.nk-footer-brand .nk-logo-text-f em{font-style:italic;background:var(--grad);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.nk-footer-brand p{font-size:0.78rem;color:var(--tx3);line-height:1.6;max-width:220px;margin-top:0.25rem}
.nk-footer-links{display:flex;flex-wrap:wrap;gap:3rem}
.nk-footer-col h4{font-family:var(--code);font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--tx3);margin-bottom:0.75rem}
.nk-footer-col a{display:block;font-size:0.8rem;color:var(--tx2);text-decoration:none;margin-bottom:0.45rem;transition:color 0.15s}
.nk-footer-col a:hover{color:var(--tx1)}
.nk-footer-bottom{max-width:1100px;margin:1.25rem auto 0;padding-top:1.125rem;border-top:1px solid var(--rule);display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;align-items:center;font-size:0.75rem;color:var(--tx3)}
@media(max-width:600px){.nk-footer-links{gap:1.5rem}.nk-footer-inner{flex-direction:column;gap:1.5rem}}
'''

for path in files:
    text = path.read_text(encoding='utf-8')
    if '<footer class="nk-footer">' in text:
        continue

    if path.parent == Path('.'):
        prefix = './'
    else:
        prefix = '../'

    footer_html = f'''<footer class="nk-footer">
  <div class="nk-footer-inner">
    <div class="nk-footer-brand">
      <a class="nk-logo-f" href="{prefix}index.html">
        <div class="nk-logo-mark-f"></div>
        <span class="nk-logo-text-f">Neat<em>kit</em></span>
      </a>
      <p>Free browser-based tools.<br>No signup, no uploads, no limits.</p>
    </div>
    <div class="nk-footer-links">
      <div class="nk-footer-col">
        <h4>Tools</h4>
        <a href="{prefix}tools/image-compress.html">Image Compressor</a>
        <a href="{prefix}tools/pdf-merge.html">PDF Merge</a>
        <a href="{prefix}tools/ai-detector.html">AI Detector</a>
        <a href="{prefix}tools/qr-generator.html">QR Generator</a>
        <a href="{prefix}index.html">All tools →</a>
      </div>
      <div class="nk-footer-col">
        <h4>Company</h4>
        <a href="{prefix}about.html">About</a>
        <a href="{prefix}contact.html">Contact</a>
        <a href="{prefix}privacy.html">Privacy Policy</a>
        <a href="{prefix}terms.html">Terms of Service</a>
      </div>
    </div>
  </div>
  <div class="nk-footer-bottom">
    <span>© 2025 Neatkit. All rights reserved.</span>
    <span>Made in Nairobi 🇰🇪</span>
  </div>
</footer>
'''

    if '</style>' in text and footer_css.strip() not in text:
        text = text.replace('</style>', footer_css + '\n</style>', 1)
    if '</body>' in text and footer_html.strip() not in text:
        text = text.replace('</body>', footer_html + '\n</body>', 1)

    path.write_text(text, encoding='utf-8')

print(f'Updated {len(files)} HTML files')
