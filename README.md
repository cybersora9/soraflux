# SoraFlux

**A free, open-source, local video, audio, image and GIF converter with downloads (yt-dlp) and a simple GUI.**
Everything runs on your computer: no uploads, no limits, no ads, no telemetry.

**English** · [Polski](README.pl.md)

### [⬇ Download SoraFlux for Windows](https://github.com/cybersora9/soraflux/releases/latest)
Free, Windows 10/11 (64-bit). [How to install, step by step ↓](#installation)

![Convert tab: quick actions, file list, info card](zrzuty/en/v1_2-konwertuj-sora-a-ciemny.png)

## Features

- **Downloads** (yt-dlp): most popular video and music sites plus direct links; quick actions "Audio only MP3" and "Best quality", subtitles, thumbnail, metadata, chapters, playlists, "convert after download". The app watches yt-dlp's age: an old system copy (e.g. from pip) is replaced by the app's own current copy, and "Update yt-dlp" only ever updates that copy.
- **Themes**: Kissaten, City Pop and MiniDisc in a cybersora or Japanese palette, each light and dark (WCAG AA contrast), plus your own themes with an editor, export and import. Bundled fonts, works offline.
- **One-click quick actions**: "Shrink to X MB", "Extract audio (MP3)", "Make a GIF", "For phones (480p 25 fps)", "Cut a clip without re-encoding" (seconds instead of minutes, no quality loss). Fine-tune everything afterwards in the panel.
- **Before/after preview**: one frame of the result with exactly your settings, at a moment picked with a slider, compared with a split slider. For audio: play 5 s of the result (hear what AAC at 8 kbps really sounds like).
- **Full video quality control**: resolution (2160p…144p or custom W×H), frame rate (keep, 60/50/30/25/24/15/10, custom), CRF slider, bitrate in kbps or a **target size in MB** (2-pass plus automatic correction so the file really fits).
- **Audio**: AAC, MP3, Opus, Vorbis, FLAC, WAV/PCM, copy, none; **8–320 kbps**, 8–96 kHz, mono/stereo, loudness normalization, track choice (or all tracks) when a file has several.
- **Any container**: mp4, mkv, webm, mov, avi, gif, mp3, m4a, aac, opus, ogg, flac, wav. Incompatible codecs are ruled out automatically; subtitles are carried over where possible (MP4: mov_text, MKV: copy, WebM: WebVTT).
- **Proper GIFs**: two-pass palette, selectable dithering, fps, width, loop, trim, size estimate with a warning. Animated WebP as a lighter alternative.
- **Images**: PNG, JPG, WebP, AVIF, GIF, BMP, ICO; W×H or %, keep aspect / stretch / bars / crop, don't upscale, quality, batches.
- **Folder batches**: drop a folder → every matching file, keeping the subfolder structure, with an extension filter and skipping files already converted.
- **Explorer context menu** "Convert with SoraFlux"; more files go to the window that is already open.
- **File info card**: resolution, rotation, frame rate (incl. variable), codecs, bit depth, HDR, audio tracks, subtitles.
- **When done**: system notification, "Show in folder", size comparison ("412 MB → 74 MB (−82%)").
- **Hardened** against common pitfalls: odd dimensions, 10-bit and **phone HDR** (automatic SDR conversion so colors don't wash out), variable frame rate, rotation metadata, paths with non-ASCII characters and longer than 260 characters, several 2-pass jobs at once, hardware encoders that fail (falls back to software), closing the app mid-job (no ffmpeg left running). Details: [HARDENING.md](HARDENING.md).
- Queue (1 video at a time by default with images alongside, "Keep the computer responsive", a warning when the source file is truncated), live size estimate, ffmpeg command preview, built-in and your own presets, Polish and English, dark and light theme (WCAG AA contrast), keyboard navigation, portable mode.

## Screenshots

| | |
|---|---|
| ![City Pop · Japanese palette, light](zrzuty/en/v1_2-konwertuj-jp-b-jasny.png) | ![MiniDisc · cybersora palette, dark](zrzuty/en/v1_2-konwertuj-sora-c-ciemny.png) |
| ![Download](zrzuty/en/v1_2-pobierz-light.png) | ![Queue with a truncated-file warning](zrzuty/en/v1_2-kolejka-dark.png) |
| ![Settings → Appearance](zrzuty/en/v1_2-ustawienia-wyglad-dark.png) | ![Before/after preview](zrzuty/en/v1_2-podglad-przed-po-light.png) |
| ![Images](zrzuty/en/v1_2-obrazy-light.png) | ![First run](zrzuty/en/v1_2-kreator-dark.png) |

All screenshots (6 themes × light/dark and every tab) are in [`zrzuty/en/`](zrzuty/en/) (English UI) and [`zrzuty/`](zrzuty/) (Polish UI). They are generated from a mock backend with made-up data (`npm run zrzuty:en`).

## Installation

SoraFlux is a normal Windows program with an installer. You don't need to know anything about GitHub or code.

1. Open the **[latest release](https://github.com/cybersora9/soraflux/releases/latest)** (or on the repository page, click **Releases** in the right-hand column).
2. Scroll down to **Assets** and click **`SoraFlux_x.y.z_x64-setup.exe`** (x.y.z is the version, e.g. 1.2.2). The browser saves it to your **Downloads** folder.
   Don't download "Source code (zip)" or "Source code (tar.gz)": that's the program's code, not the app.
3. Open the **Downloads** folder (or click the file in your browser's download list) and **double-click** `SoraFlux_…_x64-setup.exe`.
4. Windows may show a blue window **"Windows protected your PC"**. This is because the installer isn't code-signed yet (signing is in progress, [docs/SIGNING.md](docs/SIGNING.md)). Click **More info**, then **Run anyway**.
5. Choose the installer language and click **Next** / **Install**. No administrator rights are needed: it installs for your Windows user only.
6. Start **SoraFlux** from the Start menu (or the desktop shortcut, if you ticked it at the end of the installation).
7. On first run the **Welcome to SoraFlux** window checks for ffmpeg (and yt-dlp for downloads). Click **Get missing tools**: they come from their official releases, with SHA256 verification. Done.

You can also right-click a video, audio or image file in Explorer and pick **Convert with SoraFlux**.

- **Updating:** download the new installer the same way and run it over the old version; settings and presets are kept.
- **Uninstalling:** Windows Settings → Apps → Installed apps → SoraFlux → Uninstall.
- **Checking the file (optional):** each release has `SHA256SUMS.txt`. In PowerShell run `Get-FileHash $HOME\Downloads\SoraFlux_1.2.2_x64-setup.exe` and compare the result with the number in that file.

## How to use

1. **First run**: the wizard checks for ffmpeg and ffprobe. Download what's missing with one click (Windows: the officially recommended gyan.dev build, SHA256 verified) or pick the files yourself.
2. **Convert**: drop files or a folder (or click the drop zone, press Ctrl+O, or use "Convert with SoraFlux" in Explorer). Click a quick action or choose format, resolution, frame rate and quality; everything else is under "Advanced". Click a file in the list to see its info card; "Before / after preview" shows the result before you start.
3. **Download**: paste a link (or several), "Check", pick a quality or a quick action, "Download". Only download what you have the rights to; SoraFlux does not circumvent DRM.
4. **Images**: drop images, choose a format and size (W×H or %), quality.
5. **Queue**: progress, ETA, cancel, "Show in folder", size comparison.

Output goes next to the source (or to a folder you choose) and **never overwrites the original**: a name clash produces `name (1).mp4`. While working the file is called `name.part.mp4` and gets its final name only on success; partial files from a crash are cleaned up on the next start.

## Common problems

| Problem | What to do |
|---|---|
| Download: "The site blocked the download" (403) | Click "Update yt-dlp" on the Download tab and try again. Sites change often and a yt-dlp older than ~30 days stops working. The app uses its own yt-dlp copy, not the one from pip. |
| "ffmpeg is missing" | Settings → Tools → "Download" (Windows) or `sudo apt install ffmpeg` / `brew install ffmpeg`, then "Detect again". You can also pick `ffmpeg.exe` manually. |
| Windows: "Windows protected your PC" | The installer isn't signed yet: "More info" → "Run anyway". Compare the SHA256 with `SHA256SUMS.txt` from the release. Signing: [docs/SIGNING.md](docs/SIGNING.md). |
| Washed-out colors after converting iPhone/Android videos | Those are HDR recordings. The app converts them to SDR when ffmpeg has the `zscale` filter (the gyan.dev build does). Without it you'll see a hint: download ffmpeg from Settings. |
| Video won't play on a phone / in WhatsApp | Use "For phones (480p 25 fps)" or MP4 + H.264 + AAC. Don't enable 10-bit and don't put Opus in MP4. |
| "Target size too small" | At this length the video gets < 50 kbps. Trim it, lower the resolution or raise the MB limit. |
| Output is bigger than the original | The source was already heavily compressed. Use bitrate or target MB instead of CRF, or a lower resolution. |
| A cut without re-encoding starts a bit early | That's how stream copy works: it starts on the nearest keyframe. For frame accuracy, use a normal conversion with trimming. |
| NVENC/QSV/AMF doesn't work | Only encoders that passed a test encode are shown; if one fails mid-job, the app finishes on the CPU (noted in the queue). Update your GPU driver. |
| The computer stutters while converting | Settings → Work: "Videos at once" = 1 and "Keep the computer responsive". |
| Reporting a bug | Settings → "Copy report" (versions, system, recent errors, without your folder paths) and paste it into a [bug report](https://github.com/cybersora9/soraflux/issues/new/choose). |

## Privacy

**Everything is local, zero telemetry.** Files never leave your computer and no statistics are sent. The app only goes online when you ask: downloading tools (ffmpeg, yt-dlp, Deno), downloading videos and their thumbnails, and "Check for updates" (GitHub Releases). Settings (including the theme), presets and the error log are files on this computer (or in the `portable` folder next to the program in portable mode).

## External tools

ffmpeg, ffprobe, yt-dlp and Deno are **not in the repository or the installer**. Search order: path set in Settings → the app's tools folder (`%APPDATA%\SoraConverter\narzedzia`, `portable\narzedzia` in portable mode, or `narzedzia\` next to the `.exe`) → `PATH`. Exception: a yt-dlp from `PATH` older than 30 days (typically pip) with no own copy → the app downloads its own copy and uses it. Links and checksums: [`src-tauri/src/narzedzia/zrodla.rs`](src-tauri/src/narzedzia/zrodla.rs). Licenses: [THIRD_PARTY.md](THIRD_PARTY.md).

`SoraConverter` in folder names and the app identifier `pl.cybersora.soraconverter` is the app's earlier name, kept on purpose: changing it would break existing settings and updates.

## Building

Requirements: [Rust](https://rustup.rs) (stable), Node.js 20+, on Windows: Visual Studio Build Tools (C++). On Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libsoup-3.0-dev`.

```bash
npm install
npm run tauri dev                      # development
npm run tauri build -- --bundles nsis  # Windows installer (src-tauri/target/release/bundle/nsis/)
```

Releases and signing run in GitHub Actions: [`.github/workflows/release.yml`](.github/workflows/release.yml), [docs/SIGNING.md](docs/SIGNING.md), [docs/UPDATES.md](docs/UPDATES.md).
UI-only preview in a browser (with a mock backend): `npm run dev`, then `http://localhost:1420/?demo=1`.

## Tests (the gate)

```bash
npm run bramka   # "bramka" = gate: fmt, clippy, cargo test, build, vitest, screenshots (one at a time)
```

- `cargo test`: the argument builder (table of cases), **integration tests with real ffmpeg** verified by ffprobe (480p/25 fps/AAC 8 kbps, 853×481, HDR PQ → SDR BT.709, VFR → 25 fps, rotation metadata, Opus 8 kbps, MP3 320, GIF 480 px 15 fps, WebP 50%), the queue (parallel jobs, 2 × 2-pass at once, cancel without leftover processes or `.part` files, `zażółć 日本 film.mp4` in a path > 260, hardware encoder fallback, video limit), preview and audio preview, the frontend↔Rust contract over Tauri IPC, downloads against a yt-dlp mock and made-up fixtures (no real copyrighted works in the repo), truncated files, GIF estimate calibration.
- `npm test`: vitest (logic, i18n PL/EN incl. every error key sent from Rust, the panel in jsdom, WCAG AA contrast, release config).
- `npm run zrzuty` / `npm run zrzuty:en`: Playwright screenshots with the mock backend → `zrzuty/` / `zrzuty/en/`.
- CI ([`.github/workflows/test.yml`](.github/workflows/test.yml), Linux + Windows) on every push and pull request.

## Architecture

The frontend (Vite + TypeScript, no framework) only draws and collects settings; Rust builds ffmpeg arguments with pure functions, runs ffmpeg/ffprobe, parses progress and reports it through events. Details: [ARCHITECTURE.md](ARCHITECTURE.md), pitfalls and their tests: [HARDENING.md](HARDENING.md).

**Code language:** identifiers and code comments are in Polish. Translating them would be a huge diff with real risk of regressions and no benefit for users, so they stay; the [glossary in ARCHITECTURE.md](ARCHITECTURE.md) maps the common names. The UI is Polish and English, and so are the error messages coming from Rust (`rust.*` keys in `src/i18n`).

## Contributing and security

Pull requests and issues are welcome in English (or Polish): [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities privately: [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). External tools: [THIRD_PARTY.md](THIRD_PARTY.md).
