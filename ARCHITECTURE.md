# SoraFlux: architecture (as built, v1.2)

Identifiers and code comments are in Polish; the UI is Polish and English (`src/i18n`). Polish original of this document: [docs/pl/ARCHITEKTURA.md](docs/pl/ARCHITEKTURA.md). Hardening checklist: [HARDENING.md](HARDENING.md).

| Polish name | Meaning |
|---|---|
| `budowniczy/` | argument builder (pure functions that produce ffmpeg arguments) |
| `kolejka.rs` | job queue and dispatcher |
| `sonda.rs` | ffprobe probe, produces `Media` |
| `pobieracz/` | downloader (yt-dlp) |
| `narzedzia/` | external tools (ffmpeg, ffprobe, yt-dlp, deno, whisper.cpp) |
| `napisy/` | subtitles from speech (whisper.cpp): cues, SRT/VTT/ASS, arguments |
| `szacunek.rs` | output size estimate |
| `dziennik.rs` | local error log and report |
| `konfig.rs` | app configuration |
| `ustawienia/` | settings types (`Profil`, ...) |
| `postep.rs` | progress parsing |
| `procesy.rs` | process handling |
| `blad.rs` | bilingual error messages |
| `Profil` / `Plan` / `Media` | conversion profile / execution plan / probed media description |
| `zadanie`, `wejscie`, `wyjscie` | job, input, output |

## Core principle
One lightweight desktop app (Tauri 2): a video, audio, image and GIF converter plus downloading through yt-dlp. All work happens on the user's computer. The frontend (TypeScript) only draws the UI and collects settings; Rust builds the ffmpeg/yt-dlp arguments with pure functions, runs the tools and reports progress through events. No server, no telemetry.

```
┌──────────────────────── Frontend (Vite + TS) ──────────────────────┐
│ tabs: Convert | Download | Images | Queue | Settings               │
│ PanelUstawien (ONE component: Convert, Images, "after download")   │
│ motywy.ts: 6 themes x light/dark + custom (stored in the config)   │
│ state: sklep.ts (simple store) i18n: pl.json/en.json               │
└───────────────▲──────────────── invoke / listen ───────────────────┘
                │ Tauri commands (JSON)       events: zadanie://postep, zadanie://stan, pliki://otworz
┌───────────────┴──────────────── Rust (src-tauri) ──────────────────┐
│ komendy.rs   → thin #[tauri::command] layer                        │
│ ustawienia/  → types: Profil, ProfilWideo, ProfilAudio…            │
│ budowniczy/  → PURE functions (Media, Profil, Kontekst) → Plan     │
│   (arg builder) + frame preview chain, 5 s audio preview plan      │
│ sonda.rs     → ffprobe → Media (tracks, subtitles, HDR, bits, turn)│
│   (probe)                                                          │
│ kolejka.rs   → N jobs (separate video limit), `.part`, in-progress │
│   (queue)       journal, MB correction, hardware-encoder fallback, │
│                 skipping                                           │
│ postep.rs    → `-progress pipe:1` parser → % / ETA / indeterminate │
│                + yt-dlp progress template (bytes, B/s, ETA, file)  │
│ pobieracz/   → yt-dlp -J (info), download arguments, human errors  │
│   (downloader)                                                     │
│ procesy.rs   → processes: CREATE_NO_WINDOW, Job Object / group,    │
│                priority, free disk space                           │
│ narzedzia/   → ffmpeg/ffprobe/yt-dlp/deno, SHA256, yt-dlp age,     │
│   (tools)       own yt-dlp copy instead of a stale one from PATH,  │
│                 encoders, filters, hardware encoder probe          │
│ blad.rs      → bilingual errors: i18n key + params (frontend:      │
│                `tlumaczBlad`)                                      │
│ dziennik.rs  → local error log, report without private paths       │
│   (log)                                                            │
│ szacunek.rs  → predicted output size (size estimate)               │
│ presety.rs   → built-in + user presets (presety.json)              │
│ konfig.rs    → app settings (system dir or `portable` folder)      │
│   (config)                                                         │
│ lib.rs       → plugins: single-instance, updater, notifications    │
└────────────────────────────────────────────────────────────────────┘
          │ OsString arguments, no shell; Job Object (Windows) / process group (Unix)
     ffmpeg / ffprobe / yt-dlp / deno  (external binaries, not in the repo or the installer)
```

## Data model (Rust, serde; same shape in `src/typy.ts`)
```rust
struct NoweZadanie { rodzaj: RodzajZadania, katalog: Option<PathBuf>, pomin_istniejace: bool }
enum RodzajZadania { Konwersja { wejscie: PathBuf, profil: Profil },
                    Pobranie { url: String, opcje: OpcjePobrania, potem: Option<Profil> } }
enum Stan { Oczekuje, Trwa, Gotowe { wyjscie }, Blad { komunikat }, Anulowane, Pominiete { wyjscie } }
// InfoZadania.ostrzezenie: Option<OstrzezenieWyniku::Uciete { zrodlo_konczy_s, wynik_s, oczekiwane_s }> = "done with a warning"
struct Media { czas_s, rozmiar_b, kbps, format, wideo: Option<StrumienWideo /* indeks, w, h, fps, bity, hdr, obrot, vfr */>,
               audio, sciezki_audio: Vec<StrumienAudio>, napisy: Vec<StrumienNapisow>, okladka, obraz }
struct Profil {
  kontener: Kontener,                 // mp4 mkv webm mov avi gif mp3 m4a aac opus ogg flac wav webp png jpg avif bmp ico
  wideo: Option<ProfilWideo>,         // None = no picture (e.g. MP4→MP3)
  audio: Option<ProfilAudio>,         // None = no sound
  obraz: Option<ProfilObrazu>,
  gif: Option<ProfilGif>,             // also animated WebP
  ciecie: Option<Ciecie { od, koniec }>, obrot, odbicie, przyciecie: Ramka, deinterlace, predkosc,
  sciezki_audio: WyborAudio /* pierwsza | wszystkie | numer */, napisy: bool,
}
struct ProfilWideo { kodek, rozdzielczosc, dopasowanie, nie_powiekszaj, skaler, fps, jakosc, sprzet, dziesiec_bit }
enum JakoscWideo { Crf { crf }, Bitrate { kbps }, RozmiarMb { mb } }   // RozmiarMb → 2 passes
```
Enums with data are tagged with a `typ` field (plain unions in TS). The container↔codec compatibility map lives in one place: `Kontener::kodeki_wideo/kodeki_audio` (mirrored in `logika.ts`).

## Argument builder (the heart, 100% testable)
- `budowniczy::plan_z(&Media, &Profil, wejscie, wyjscie, &Kontekst) -> Result<Plan, BladProfilu>`; `Plan { przebiegi: Vec<Vec<OsString>>, podpowiedzi, tymczasowe }` (1 or 2 passes: target size in MB, GIF with a palette). `Kontekst { zscale, katalog_tmp }` carries the ffmpeg capabilities and the job directory (2-pass logs, palette). `plan()` uses the default context.
- The filter chain has a fixed order: crop → deinterlace → rotate/flip → HDR→SDR (zscale+tonemap) → scale (+bars/blur) → speed → fps; audio: speed → loudnorm → aresample.
- Explicit mapping: `-map` for the picture (without cover art), the selected audio tracks and subtitles compatible with the container; 8-bit `yuv420p` by default, `-fps_mode` for "keep", `+faststart` for MP4/MOV/M4A, `-avoid_negative_ts` when cutting with stream copy.
- Preview: `lancuch_podgladu` (preview chain) = the same `-vf` as the conversion (GIF: the palette of a single frame), `argumenty_klatki` (frame arguments, JPEG ≤ 960 px), `plan_odsluchu` (listening plan: 5 s of audio with the same settings).
- Validation instead of silent errors (`BladProfilu`), non-blocking hints (`Podpowiedz`, e.g. AAC < 32 kb/s → mono + 16 kHz).
- Always `-hide_banner -nostdin -y -progress pipe:1 -nostats`.

## Queue and progress
- A dispatcher with counters: a limit on all jobs (default 2) and on video jobs (default 1; images may overtake waiting video jobs), adjustable on the fly. Each job: ffprobe → free space check → plan → ffmpeg passes in a unique temporary directory; stdout goes through `postep.rs`, stderr: the last 50 lines go into the error message (and into the log).
- The result is written as `nazwa.part.ext` (recorded in `w_toku.json`) and renamed on success; cancelling kills the process tree and deletes the `.part`; after an app crash, incomplete files listed in the journal are removed at startup. A name collision gives `nazwa (1).ext`, and the source is never overwritten (also when compared by canonical path).
- After a conversion ffprobe measures the duration of the result; < 97% of the expected value → "done with a warning" (truncated source).
- Download: yt-dlp runs in the same process tree (Job Object / group), progress comes from `--progress-template`, the path from `--print after_move:`; `potem` (afterwards) = a new conversion job after the download. Downloads do not take up the video limit.
- Target size in MB: after encoding the size is checked and, if exceeded, the file is re-encoded with a corrected bitrate (at most 2 times). If a hardware encoder fails, the same job is rerun in software (`awaria_sprzetu`, hardware failure).
- `RunEvent::Exit` cancels everything; on Windows a Job Object with `KILL_ON_JOB_CLOSE` kills the tree even if the app crashes.
- Error messages (`blad.rs`) are bilingual: Rust sends an i18n key plus parameters and the frontend translates them with `tlumaczBlad`. Format: `@i18n {"k":…,"a":{…}}` followed by the raw stderr tail.

## Subtitles mode (S5, whisper.cpp)
- `RodzajZadania::Napisy { wejscie, opcje: OpcjeNapisow }` is a queue job like a conversion (counts against the video limit). Steps, each cancellable (process tree killed, `*.part.*` removed): ffprobe → no audio track = error `napisy_brak_audio` → free space check (WAV of the longest chunk in the temp dir; burned video in the output folder) → ffmpeg extracts the first audio track to WAV 16 kHz mono s16 → `whisper-cli -oj -pp` writes JSON → `napisy::format` builds cues → `name.srt` / `name.vtt` (written as `.part`, renamed) → optionally `name (subtitled).mp4` with the `ass` filter.
- Long files (> 15 min) are split into 10-minute chunks (one WAV and one whisper run each, timestamps shifted by the chunk start). No overlap: a word on a chunk boundary can be split.
- Cues: at most 2 lines, max 24 characters per line for vertical videos and 42 for horizontal ones; long segments are split into several cues with time proportional to characters; no overlaps; at most 7 s per cue. `[BLANK_AUDIO]`, `[Music]`, `(music)` etc. are dropped; nothing left = error `napisy_cisza`, no file written.
- Burned-in styles (`Rolki` = reels, `Srodek`, `Klasyczny`) are an ASS file with `PlayResX/Y` = video size, sizes computed from the shorter side, reels text above the bottom ~22 % of the frame. ffmpeg and whisper run with the job temp dir as the working directory and get relative ASCII names (`audio-000.wav`, `napisy.ass`): no escaping of Windows paths in the filter and no narrow-`argv` problem with non-ASCII paths; the model path is passed relative when that makes it ASCII.
- Progress: `Postep.etap` = `dzwiek` / `rozpoznawanie` / `wypalanie`, `przebieg/przebiegi` = chunk, ETA from the elapsed time.
- Outputs never overwrite anything: the same reservation as conversions (`name (1).srt`); `InfoZadania.napisy` lists the files, the detected language and `zmieniona_nazwa`.
- Models (`napisy::ModelNapisow`: base, small, medium, large-v3-turbo) live in `<app data>/modele/`. `napisy_pobierz_model` needs `zgoda: true` (sent only from the consent card in the GUI), refuses a model without a SHA-256 pinned in code (`model_bez_sumy`), resumes `*.pobieranie` with `Range`, verifies SHA-256 before renaming. A model file put into the folder by hand is used as is. RAM warning (`napisy::ostrzezenie_ram`) is shown before start, not enforced.

## External tools
- ffmpeg, ffprobe, yt-dlp, Deno, whisper.cpp (`whisper-cli`, detected or picked manually, no automatic download yet). Lookup order: path from the config → the app's tools directory (app data or `portable/`, next to the `.exe`) → PATH.
- yt-dlp: version = date `YYYY.MM.DD` → age in days. A yt-dlp from PATH (pip) older than 30 days with no own copy → when the user opens Download, the app downloads its own copy (official GitHub release, `SHA2-256SUMS`), which takes precedence over PATH. "Update yt-dlp" updates only the own copy and never touches pip. Error 403 / "Sign in to confirm" / nsig → "The site blocked the download. Click Update yt-dlp and try again."
- First-run wizard: what is present, what is missing, "download" (Windows: gyan.dev *release essentials*, optionally *full*, `.sha256` checksum from the same release). Links live in a single file, `narzedzia/zrodla.rs` (sources).
- `ffmpeg -encoders` (codecs without an encoder are greyed out in the GUI), `ffmpeg -filters` (`zscale` → HDR tonemapping) and a trial encode of 1 frame with the hardware encoders; the result is cached per ffmpeg path.

## Frontend
- Vite + TS, no framework. `widoki/*.ts` (views), `komponenty/PanelUstawien.ts` (the single settings panel), `komponenty/podglad.ts` (before/after, audio preview), `komponenty/info.ts` (file card), `sklep.ts` (store), `api.ts` (the only place with `invoke`/`listen`; the mock `atrapa.ts` is used for tests and screenshots), `aktualizacje.ts` (updates), `i18n/`.
- Pure logic lives in `logika.ts` (profiles, quick actions, info card, formatting) and is tested with vitest.
- `tokeny.css` (tokens): spacing, radii, fonts (offline fonts from `@fontsource`, `fonty.ts`), starting colors; `motywy.ts` (themes) applies the colors of the selected theme (`data-wariant` a/b/c, `data-theme`). The theme choice, custom themes and recent folders are stored in `konfig.json` (Rust), not in localStorage (portable mode). WCAG AA contrast of every theme in both modes is checked by a test.
- Keyboard: tabs with arrow keys (ARIA tablist), Ctrl+1…5, Ctrl+O; the theme tiles are a radiogroup, arrows only move focus.
- Migration from the old program name (v1.0): on first start `konfig.json` and `presety.json` are copied, the old directory stays.

## Windows: installer and Explorer
- NSIS with the WebView2 bootstrapper; `src-tauri/nsis/hooks.nsh` adds (HKCU) and removes the "Convert with SoraFlux" entry for video, audio and image files.
- Files passed as arguments at startup (`pliki_startowe`); a second launch → `tauri-plugin-single-instance` → a `pliki://otworz` event to the open window.
- Updates: `tauri-plugin-updater` (GitHub Releases, `latest.json`, signature), checked manually; workflow `.github/workflows/release.yml` (SignPath optional).

## Repo structure
```
src-tauri/src/{lib.rs,main.rs,komendy.rs,kolejka.rs,postep.rs,procesy.rs,sonda.rs,szacunek.rs,presety.rs,konfig.rs,dziennik.rs,blad.rs}
src-tauri/src/{ustawienia,budowniczy,narzedzia,pobieracz}/   src-tauri/nsis/hooks.nsh
src-tauri/tests/{budowniczy.rs,integracja_ffmpeg.rs,kolejka.rs,komendy.rs,podglad.rs,pobieracz.rs}   tests/fixtures/ (yt-dlp -J, made-up data)
src/{main.ts,api.ts,atrapa.ts,aktualizacje.ts,sklep.ts,logika.ts,typy.ts,motywy.ts,fonty.ts,tokeny.css,style.css,widoki/,komponenty/,i18n/}
scripts/{bramka.sh,zrzuty.mjs,latest-json.mjs}  .github/workflows/{release.yml,test.yml}  .github/ISSUE_TEMPLATE/
docs/{SIGNING.md,UPDATES.md,pl/}   zrzuty/ (screenshots)
README.md (EN)  README.pl.md  ARCHITECTURE.md  HARDENING.md  CONTRIBUTING.md  SECURITY.md  THIRD_PARTY.md  LICENSE (MIT)
```

## Gate
`npm run bramka` (gate): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (unit tests + integration against a real ffmpeg with ffprobe verification), `npm run build`, `vitest`, Playwright screenshots with the `api.ts` mock. `#[cfg(windows)]` code is additionally checked with `cargo clippy --target x86_64-pc-windows-gnu`.

