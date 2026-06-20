# NeatKit

**Free browser-based tools that respect your privacy.** No signup, no uploads, no limits.

🔗 **Live site:** [neatkitapp.com](https://neatkitapp.com)

NeatKit is a collection of 15 everyday utility tools — image compression, PDF merging, QR generation, text analysis, and more — that run entirely in your browser using JavaScript and WebAssembly. Your files never touch a server. Nothing is uploaded, nothing is stored, nothing is tracked.

## Why browser-side processing

Most "free" online tools route your files through a server. That means upload time, server processing time, download time — and your data sitting somewhere you don't control, even briefly.

NeatKit skips all of that. Every tool processes files on your own device. A 10MB image compresses in seconds with no network round-trip. Your documents stay private by design, not by policy.

## Tools

| Category | Tools |
|---|---|
| **Image** | Image Compressor, Image Resizer, Images to PDF |
| **PDF** | PDF Merge & Split, ID Card to PDF, Photo to Scanned PDF |
| **Text** | Word Counter, Case Converter, AI Text Detector |
| **Conversion** | Unit Converter, Color Converter, Base64 Encoder |
| **Developer** | JSON Formatter, QR Code Generator, QR Scanner |

Each tool lives in its own page under `tools/`, sharing common styling and scripts from `assets/`.

## Tech stack

- Vanilla JavaScript, HTML, CSS — no framework overhead for simple utility pages
- [pdf-lib](https://pdf-lib.js.org/) for in-browser PDF manipulation
- Canvas API for image processing
- Client-side only — no backend, no database, no server-side processing

## Project structure

```
NeatKit/
├── index.html          # Homepage and tool directory
├── about.html           # About page
├── contact.html          # Contact page
├── privacy.html          # Privacy policy
├── terms.html            # Terms of service
├── tools/                # Individual tool pages
├── assets/                # Shared CSS and JavaScript
├── locales/               # Language files
└── start-local-tunnel.ps1 # Local dev server + tunnel launcher
```

## Running locally

NeatKit is a static site — any local server works. The bundled PowerShell script spins up a local server plus a public Cloudflare tunnel for quick sharing:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local-tunnel.ps1
```

This will:
- Start a local HTTP server on `http://localhost:8000`
- Launch a Cloudflare quick tunnel
- Print a public `trycloudflare.com` link you can share

Dry run (verifies tool resolution without starting servers):

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local-tunnel.ps1 -DryRun
```

Stop background processes:

```powershell
Stop-Process -Id (Get-Content .\python-server.pid) -Force
Stop-Process -Id (Get-Content .\cloudflared.pid) -Force
```

### Requirements

- Windows PowerShell
- Python 3 (or the `py` launcher)
- [cloudflared](https://github.com/cloudflare/cloudflared) — install via Chocolatey if missing:

```powershell
choco install cloudflared -y
```

## Contributing

Clone the repo:

```powershell
git clone https://github.com/Neat-Kit/NeatKit.git
cd NeatKit
```

Working from a fork:

```powershell
git remote add upstream https://github.com/Neat-Kit/NeatKit.git
git remote -v
```

Keep your branch current before starting work:

```powershell
git checkout main
git pull upstream main
```

Working on a feature branch:

```powershell
git checkout -b my-feature
git push -u origin my-feature
```

Typical flow:

```powershell
git add .
git commit -m "Describe your change"
git pull --rebase
git push
```

### Guidelines

- Open an issue first for larger changes or new tools
- Keep pull requests focused on one feature, fix, or content update
- Write clear commit messages
- Rebase against `upstream/main` before opening a PR
- Test locally before pushing
- Update this README when tools or structure change

## Notes

- The Cloudflare tunnel is for quick sharing and testing, not permanent hosting
- Keep the PowerShell window open while the tunnel is active
- Restart the launcher after pushing changes so the tunnel serves the latest files

## License

This project is open for contributions. See repository for license details.

---

Built in Nairobi 🇰🇪
