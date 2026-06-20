<div align="center">

<br>

<img src="https://img.shields.io/badge/-%F0%9F%94%A7%20Neatkit-0f0f12?style=for-the-badge&labelColor=0f0f12&color=0f0f12" alt="" />

# Neat*kit*

### Free browser-based tools that respect your privacy.
### No signup. No uploads. No limits.

<br>

[![Live Site](https://img.shields.io/badge/neatkitapp.com-Live%20Site-c8f04a?style=flat-square&logo=cloudflare&logoColor=0c0c0c&labelColor=0c0c0c)](https://neatkitapp.com)
&nbsp;
[![Tools](https://img.shields.io/badge/15-Tools-c8f04a?style=flat-square&labelColor=0c0c0c&color=0c0c0c)](https://neatkitapp.com)
&nbsp;
[![Made in Nairobi](https://img.shields.io/badge/Made%20in-Nairobi%20%F0%9F%87%B0%F0%9F%87%AA-c8f04a?style=flat-square&labelColor=0c0c0c&color=0c0c0c)](https://neatkitapp.com/about)
&nbsp;
[![License](https://img.shields.io/badge/License-Open-c8f04a?style=flat-square&labelColor=0c0c0c&color=0c0c0c)](https://neatkitapp.com)

<br>

```
No backend. No API. No file leaves your device. Ever.
```

<br>

</div>

---

## Why this exists

Most "free" online utility tools work the same broken way. You upload your file to a server, wait for it to process somewhere you can't see, then download the result. For a brief window your file sits on infrastructure you don't control. Many then gate basic functionality behind signup walls or daily caps — even though the computation required is trivial for a modern browser.

**None of that round trip is necessary.**

Browsers can already compress images, manipulate PDFs, parse JSON, and convert formats using nothing but JavaScript, the Canvas API, and WebAssembly. So that's what Neatkit does — every tool runs entirely on your device. Nothing is uploaded. Nothing is stored. Nothing is tracked beyond standard page analytics.

> **Want to verify?** Open DevTools → Network tab → use any tool → watch that your file never appears in an outgoing request.

---

## Tools

<div align="center">

| &nbsp; | Tool | What it does |
|--------|------|-------------|
| 🗜️ | **[Image Compressor](https://neatkitapp.com/tools/image-compress.html)** | Adjustable quality JPG / PNG / WebP compression with live before/after preview |
| ↔️ | **[Image Resizer](https://neatkitapp.com/tools/image-resize.html)** | Exact pixel dimensions, percentage scaling, aspect ratio lock, social media presets |
| 🖼️ | **[Images to PDF](https://neatkitapp.com/tools/images-to-pdf.html)** | Combine multiple images into a single PDF, drag to reorder pages |
| 🔗 | **[PDF Merge & Split](https://neatkitapp.com/tools/pdf-merge.html)** | Combine PDFs or extract page ranges, reorder by drag |
| 🪪 | **[ID Card to PDF](https://neatkitapp.com/tools/id-card-to-pdf.html)** | Format front/back ID scans into a clean single or double-sided PDF |
| 📷 | **[Photo to Scanned PDF](https://neatkitapp.com/tools/photo-to-pdf.html)** | Turn a phone photo of a document into something that looks properly scanned |
| 📝 | **[Word Counter](https://neatkitapp.com/tools/word-counter.html)** | Words, characters, sentences, reading time, speaking time, lexical density |
| 🔤 | **[Case Converter](https://neatkitapp.com/tools/case-converter.html)** | UPPERCASE, lowercase, Title Case, camelCase, snake_case, PascalCase, kebab-case |
| 🤖 | **[AI Text Detector](https://neatkitapp.com/tools/ai-detector.html)** | Sentence-level perplexity and burstiness analysis — flags specific sentences, not a black-box score |
| 📐 | **[Unit Converter](https://neatkitapp.com/tools/unit-converter.html)** | Length, weight, temperature, speed, area, volume, data — 200+ combinations |
| 🎨 | **[Color Converter](https://neatkitapp.com/tools/color-converter.html)** | HEX / RGB / HSL / HSV / CMYK with visual picker and shade palette generation |
| 🔐 | **[Base64 Encoder](https://neatkitapp.com/tools/base64.html)** | Encode/decode text and files, URL-safe mode, live mode |
| 📋 | **[JSON Formatter](https://neatkitapp.com/tools/json-formatter.html)** | Pretty-print, minify, validate, collapsible tree view |
| ⬛ | **[QR Generator](https://neatkitapp.com/tools/qr-generator.html)** | URLs, WiFi credentials, vCards, SMS — PNG and SVG download |
| 📷 | **[QR Scanner](https://neatkitapp.com/tools/qr-scanner.html)** | Camera-based or upload-based decoding, auto-detects content type |

</div>

---

## Tech stack

```
Vanilla JS + HTML + CSS    →  deliberately framework-free
pdf-lib                    →  PDF read/write, client-side
Canvas API                 →  image processing and color math
qrcode.js + ZXing          →  QR generation and scanning
No backend. No database.   →  fully static, deploys anywhere
```

No framework was added because these are self-contained utility pages. A framework would add load weight without adding capability — and slower tools are worse tools.

---

## Project structure

```
NeatKit/
├── index.html                   # Homepage and tool directory
├── about.html                   # About page
├── contact.html                 # Contact
├── privacy.html                 # Privacy policy
├── terms.html                   # Terms of service
├── sitemap.xml                  # Sitemap
├── tools/                       # 15 individual tool pages
│   ├── image-compress.html
│   ├── image-resize.html
│   ├── images-to-pdf.html
│   ├── pdf-merge.html
│   ├── id-card-to-pdf.html
│   ├── photo-to-pdf.html
│   ├── word-counter.html
│   ├── case-converter.html
│   ├── ai-detector.html
│   ├── unit-converter.html
│   ├── color-converter.html
│   ├── base64.html
│   ├── json-formatter.html
│   ├── qr-generator.html
│   └── qr-scanner.html
├── assets/                      # Shared CSS and JS
├── locales/                     # Language files
└── start-local-tunnel.ps1       # Local dev server + Cloudflare tunnel
```

---

## Running locally

Neatkit is fully static — any local server works. A PowerShell script handles spinning up a local server plus a public Cloudflare tunnel for quick sharing during development:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local-tunnel.ps1
```

Starts a local server on `http://localhost:8000`, launches a Cloudflare quick tunnel, and prints a public `trycloudflare.com` URL.

```powershell
# Verify the launcher resolves tools correctly without starting anything
powershell -ExecutionPolicy Bypass -File .\start-local-tunnel.ps1 -DryRun

# Stop background processes
Stop-Process -Id (Get-Content .\python-server.pid) -Force
Stop-Process -Id (Get-Content .\cloudflared.pid) -Force
```

**Requirements:** Windows PowerShell · Python 3 · [cloudflared](https://github.com/cloudflare/cloudflared)

```powershell
# Install cloudflared via Chocolatey
choco install cloudflared -y
```

---

## Contributing

```powershell
git clone https://github.com/chaz-chege/NeatKit.git
cd NeatKit

# If contributing via fork — add upstream
git remote add upstream https://github.com/chaz-chege/NeatKit.git

# Sync before starting new work
git checkout main
git pull upstream main

# Work on a feature
git checkout -b my-feature
git push -u origin my-feature

# Typical commit flow
git add .
git commit -m "Describe your change"
git pull --rebase
git push
```

### Guidelines

- **Open an issue first** for anything beyond a small fix — larger changes or new tools should be discussed before work starts
- **Keep PRs scoped** — one feature, fix, or content update at a time
- **Write commit messages** that describe what changed and why, not just "update"
- **Rebase against** `upstream/main` before opening a PR to avoid merge conflicts
- **Test locally** before pushing — there's no CI pipeline yet

---

## Roadmap

<div align="center">

| Status | Item |
|--------|------|
| 🔲 | Batch processing for image and PDF tools |
| 🔲 | PDF compressor |
| 🔲 | Additional developer tools — UUID generator, regex tester, diff checker |
| 🔲 | API access for programmatic use of select tools |
| 🔲 | Lightweight pro tier — removes ads |

</div>

Open to suggestions — [open an issue](https://github.com/Neat-Kit/NeatKit/issues) or [get in touch](https://neatkitapp.com/contact.html).

---

<div align="center">

**[neatkitapp.com](https://neatkitapp.com)** &nbsp;·&nbsp; **[About](https://neatkitapp.com/about.html)** &nbsp;·&nbsp; **[Contact](https://neatkitapp.com/contact.html)** &nbsp;·&nbsp; **[Privacy](https://neatkitapp.com/privacy.html)**

<br>

Built in Nairobi 🇰🇪 &nbsp;·&nbsp; Open for contributions

</div>
