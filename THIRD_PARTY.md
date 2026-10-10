# Oprogramowanie zewnętrzne / Third-party software

Kod SoraFlux jest na licencji MIT (`LICENSE`). Poniższe narzędzia i biblioteki
mają własne licencje.

SoraFlux code is MIT-licensed (`LICENSE`). The tools and libraries below have
their own licenses.

## Narzędzia uruchamiane jako osobne programy (NIE w repozytorium, NIE w instalatorze)

SoraFlux nie zawiera tych programów. Wykrywa je w systemie (PATH), pozwala
wskazać ręcznie albo, na prośbę użytkownika, pobiera je z oficjalnych wydań
i sprawdza sumę SHA256 opublikowaną w tym samym wydaniu. Uruchamia je jako
osobne procesy (bez linkowania).

SoraFlux does not ship these programs. It detects them on the system (PATH),
lets the user pick them, or downloads them on request from official releases,
verifying the SHA256 published with the same release. They run as separate
processes (no linking).

| Narzędzie / Tool | Licencja / License | Źródło pobierania / Download source |
|---|---|---|
| **FFmpeg** (ffmpeg, ffprobe) | LGPL-2.1+; buildy z x264/x265 itd. jako całość GPL-3.0 / builds with x264/x265 etc. are GPL-3.0 as a whole | Windows: <https://www.gyan.dev/ffmpeg/builds/> (`ffmpeg-release-essentials.zip` domyślnie albo `ffmpeg-release-full.zip`, suma w pliku `.zip.sha256` obok), build GPL-3.0. Linux/macOS: menedżer pakietów / package manager. Kod źródłowy / source: <https://ffmpeg.org/download.html> |
| **yt-dlp** | Unlicense | <https://github.com/yt-dlp/yt-dlp/releases> (`SHA2-256SUMS`). Własna kopia w katalogu narzędzi apki; yt-dlp z pipa/PATH nie jest aktualizowany ani zmieniany / own copy in the app's tools folder, a pip/PATH copy is never touched |
| **Deno** | MIT | <https://github.com/denoland/deno/releases> (`*.zip.sha256sum`) |
| **whisper.cpp** (`whisper-cli`, tryb Napisy / Subtitles mode) | MIT | <https://github.com/ggml-org/whisper.cpp>. Na razie tylko wykrywany albo wskazany ręcznie (bez automatycznego pobierania) / for now only detected or picked manually (no automatic download) |
| **Modele whisper.cpp** (`ggml-*.bin`, wagi OpenAI Whisper / OpenAI Whisper weights) | MIT | <https://huggingface.co/ggerganov/whisper.cpp>. Pobierane tylko po zgodzie użytkownika, z sumą SHA-256 przypiętą w kodzie (`src-tauri/src/napisy/mod.rs`), ze wznawianiem / downloaded only after user consent, with a SHA-256 pinned in code, resumable |

Kodeki w buildach FFmpeg (m.in. x264, x265, SVT-AV1, libvpx, libaom, LAME,
Opus, Vorbis, libwebp) mają własne licencje; ich wykaz jest w dokumentacji
danego buildu. Enkodery sprzętowe (NVENC, Quick Sync, AMF) wymagają
sterowników producenta karty.

## Biblioteki wbudowane w aplikację / Libraries compiled into the app

### Rust (src-tauri/Cargo.toml)

| Crate | Licencja / License |
|---|---|
| tauri, tauri-build, tauri-plugin-dialog, tauri-plugin-opener, tauri-plugin-clipboard-manager, tauri-plugin-notification, tauri-plugin-updater, tauri-plugin-process, tauri-plugin-single-instance | MIT OR Apache-2.0 |
| libc (Unix), windows-sys (Windows) | MIT OR Apache-2.0 |
| base64 | MIT OR Apache-2.0 |
| serde, serde_json | MIT OR Apache-2.0 |
| tokio | MIT |
| thiserror | MIT OR Apache-2.0 |
| dirs | MIT OR Apache-2.0 |
| ureq (+ rustls, rustls-native-certs) | MIT OR Apache-2.0 (rustls: Apache-2.0 OR ISC OR MIT) |
| sha2 | MIT OR Apache-2.0 |
| zip | MIT |

Full list of transitive dependencies: `cargo tree` in `src-tauri/`
(all under permissive licenses: MIT, Apache-2.0, ISC, BSD, Zlib, Unicode-3.0).
/ Pełna lista zależności przechodnich: `cargo tree` w `src-tauri/`.

### JavaScript (package.json)

| Pakiet / Package | Licencja / License |
|---|---|
| @tauri-apps/api, @tauri-apps/plugin-dialog, @tauri-apps/plugin-opener, @tauri-apps/plugin-clipboard-manager, @tauri-apps/plugin-notification, @tauri-apps/plugin-updater, @tauri-apps/plugin-process | MIT OR Apache-2.0 |

Narzędzia deweloperskie (nie trafiają do aplikacji / dev-only): Vite (MIT),
TypeScript (Apache-2.0), Vitest (MIT), jsdom (MIT), playwright-core
(Apache-2.0), @tauri-apps/cli (MIT OR Apache-2.0).

## Środowisko uruchomieniowe / Runtime

- Windows: Microsoft Edge WebView2 (systemowy / system component).
- Linux: WebKitGTK (LGPL-2.1).

## Fonts / Fonty (bundled in the app, SIL Open Font License 1.1)
- **M PLUS Rounded 1c**, The Rounded M+ Project Authors, via the package `@fontsource/m-plus-rounded-1c`
- **Dela Gothic One**, artakana, via the package `@fontsource/dela-gothic-one`
- **M PLUS 1 Code**, The M+ Project Authors, via the package `@fontsource/m-plus-1-code`

Only the latin and latin-ext subsets are included (covers Polish characters), and nothing is loaded from Google Fonts, so the app works offline. License text: https://openfontlicense.org

Dołączamy tylko podzbiory latin i latin-ext (polskie znaki), bez Google Fonts: program działa offline.
