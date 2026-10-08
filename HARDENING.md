# SoraFlux hardening (v1.1 converter, v1.2 downloads and themes)

Polish original: [docs/pl/PANCERZ.md](docs/pl/PANCERZ.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Identifiers, file paths and test names below are in Polish on purpose ("pancerz" = hardening).

This is the list of known pitfalls, each with the file that handles it, the test that covers it and its status. Items **B10, B11, C12-C22, D23-D27, E28-E31** come from `RESEARCH_PANCERZ.md` (v1.1), an internal research document that is not part of this repository. Section A and B9 (downloading) came back in v1.2, see below.

Status: **done** = code + test green on Linux; **Windows** = code under `#[cfg(windows)]` compiled and checked with clippy for `x86_64-pc-windows-gnu`, logic tested, behavior still to be verified manually on Windows.

| Item | What we do | File(s) | Test(s) | Status |
|---|---|---|---|---|
| **B10** SmartScreen, signing | Release workflow with the SignPath step disabled by the variable `SIGNPATH_WLACZONE`, SHA256 sums, draft releases only; application instructions | `.github/workflows/release.yml`, `docs/SIGNING.md` | `src/wydanie.test.ts` "B10" | done; SignPath application: maintainer (after the repo goes public) |
| **B11** missing WebView2 | NSIS installer with the WebView2 bootstrapper (`downloadBootstrapper`, silent) | `src-tauri/tauri.conf.json` | `src/wydanie.test.ts` "B11" | done; installer to verify manually on Windows |
| **C12** odd dimensions | `scale=-2`, `force_divisible_by=2`, `trunc(iw/2)*2` also when not scaling | `src-tauri/src/budowniczy/mod.rs` (argument builder) | `integracja_ffmpeg::c12_nieparzyste_853x481_na_480p_h264`, `budowniczy::nieparzyste_*` | done |
| **C13** 10-bit | 8-bit `yuv420p` by default for every codec; 10-bit only deliberately (toggle, H.265/AV1/VP9), H.264 10-bit → hint | `budowniczy/mod.rs`, `ustawienia/mod.rs`, `PanelUstawien.ts` | `budowniczy::c13_*`, `integracja_ffmpeg::c13_c14_hdr_pq_10bit_na_h264_sdr`, `panel.test.ts` "C13/C19/C17" | done |
| **C14** HDR from phones | ffprobe `color_transfer` smpte2084/arib-std-b67 → `Media.wideo.hdr`; SDR output: `zscale`+`tonemap=hable`, BT.709 tags; without `zscale` a hint is shown; 10-bit H.265 may keep HDR; GIF/images are tonemapped too | `sonda.rs` (ffprobe probe), `budowniczy/mod.rs`, `kolejka.rs` (filter detection) | `sonda::hdr_10bit_*`, `budowniczy::c14_*`, `integracja_ffmpeg::c13_c14_*` (ffprobe: `yuv420p`, `bt709` x3) | done |
| **C15** variable FPS | FPS set: `fps` filter; "keep": `-fps_mode vfr` (AVI: `cfr`); the probe detects VFR | `budowniczy/mod.rs`, `sonda.rs` | `budowniczy::c15_*`, `integracja_ffmpeg::c15_vfr_na_25fps_synchronizacja` (drift 16 ms < 100 ms) | done |
| **C16** rotation from metadata | Rotation from the display matrix / `rotate` tag (degrees clockwise), dimensions "as displayed"; ffmpeg autorotates, the user's rotation is added on top, the output carries no old rotation | `sonda.rs`, `szacunek.rs` (size estimate) | `sonda::obrot_tag_i_macierz`, `integracja_ffmpeg::c16_obrot_z_metadanych_i_uzytkownika` (corner pixel comparison) | done |
| **C17** container↔codec compatibility | Map in `Kontener::kodeki_*` (+ mirror in `logika.ts`); webm only VP9/AV1 + Opus/Vorbis; gif without audio; Opus in MP4 → warning; subtitles: mp4/mov `mov_text`, mkv copy (mov_text→srt), webm WebVTT, PGS to mp4 skipped with a notice | `ustawienia/mod.rs`, `budowniczy/mod.rs`, `wspolne.ts` | `budowniczy::c17_*`, `niezgodny_kodek`, `panel.test.ts` | done |
| **C18** faststart | `-movflags +faststart` for MP4/MOV/M4A | `budowniczy/mod.rs` | `budowniczy::c18_faststart_w_mp4_mov_m4a` | done |
| **C19** multiple tracks, cover art | Explicit `-map`: picture without cover art, track 1 / selected / all; MP3 with cover art → audio only, `-vn` | `budowniczy/mod.rs`, `sonda.rs`, `PanelUstawien.ts` | `budowniczy::c19_*`, `sonda::hdr_10bit_sciezki_napisy_okladka`, `panel.test.ts` | done |
| **C20** parallel 2-pass | A unique temporary directory per job (pid + counter + id) for `-passlogfile` and the GIF palette, cleaned up after the job | `kolejka.rs` (queue), `budowniczy/mod.rs` (`Kontekst`) | `budowniczy::c20_*`, `kolejka::c20_dwa_rownolegle_zadania_docelowy_rozmiar` (1 MB -2.8%, 2 MB -3.5%) | done |
| **C21** hardware encoder fails | Trial encode of 1 frame at startup (result cached); on a mid-job error → automatically in software + a notice in the queue | `narzedzia/mod.rs`, `komendy.rs`, `kolejka.rs`, `kolejka.ts` | `kolejka::c21_sprzetowy_padl_powrot_do_programowego` (NVENC without a GPU → H.264 in software) | done; real NVENC/QSV/AMF: to verify manually on Windows |
| **C22** unknown duration | `out_time=N/A`, duration `None`/0: no division by zero, no ETA; indeterminate progress bar | `postep.rs`, `kolejka.rs`, `kolejka.ts`, `style.css` | `postep::c22_nieznany_czas_bez_dzielenia_przez_zero` | done |
| **D23** console window | `CREATE_NO_WINDOW` for every process (async and sync) | `src-tauri/src/procesy.rs` | `procesy::d23_flagi_windows` (logic), Windows clippy | Windows: to verify manually |
| **D24** ffmpeg lingering after close | Windows: every child in a Job Object with `KILL_ON_JOB_CLOSE`, cancel = `TerminateJobObject`; Unix: own process group, `kill(-pgid)`; `RunEvent::Exit` cancels everything | `procesy.rs`, `kolejka.rs`, `lib.rs` | `procesy::d24_d27_grupa_niski_priorytet_i_zabicie_drzewa` (the grandchild dies), `kolejka::anulowanie_zabija_i_sprzata` (no ffmpeg process and no `.part` left) | Linux done; Job Object: to verify manually on Windows |
| **D25** Polish characters, long paths | `OsString` arguments, no shell and no `to_string_lossy` (output names too) | `budowniczy/mod.rs`, `sonda.rs`, `kolejka.rs` | `budowniczy::d25_sciezka_spoza_utf8_bez_strat`, `kolejka::d25_polskie_znaki_cjk_i_dluga_sciezka` (`zażółć 日本 film.mp4`, path > 260 B) | Linux done; > 260 characters on Windows (ffmpeg + `\\?\`): to verify manually |
| **D26** overwriting, free space, `.part` | Output never equals the source (also by canonical path), collision → " (1)"; free space vs estimate (+10% and 50 MB); journal `w_toku.json` and cleanup of `*.part.*` after a crash at startup (our files only) | `kolejka.rs`, `procesy.rs`, `lib.rs` | `kolejka::trzy_zadania_dwa_rownolegle`, `kolejka::testy::czesc_i_sprzatanie_po_awarii`, `procesy::d26_miejsce` | done (statvfs; Windows `GetDiskFreeSpaceExW` to verify) |
| **D27** weak CPU | Separate limit for video jobs, default 1 (images run alongside); "Keep the computer responsive": nice 10 / `BELOW_NORMAL_PRIORITY_CLASS` | `konfig.rs` (config), `kolejka.rs`, `procesy.rs`, `ustawienia.ts` | `kolejka::d27_jedno_wideo_naraz_obrazy_obok`, `konfig::domyslne_i_zapis`, `procesy::d24_d27_*` (nice = 10) | Linux done; Windows priority: to verify |
| **E28** app updates | Updater plugin, `latest.json` from GitHub Releases, signature; public key = placeholder; manual check in Settings | `tauri.conf.json`, `lib.rs`, `src/aktualizacje.ts`, `scripts/latest-json.mjs`, `docs/UPDATES.md` | `src/wydanie.test.ts` "E28"; the app starts with the placeholder (Xvfb) | done; key: maintainer, locally |
| **E29** log and report | `dziennik.log` (1 MB + a backup copy) in the data directory, job errors; "Copy report": versions, system, last entries, no private paths | `dziennik.rs` (log), `komendy.rs`, `ustawienia.ts` | `dziennik::e29_anonimizacja`, `dziennik::e29_dziennik_i_raport` | done |
| **E30** portable mode, keyboard, contrast | A `portable` folder next to the `.exe` = everything lives in it; tabs with arrow keys (ARIA tablist), Ctrl+1…4, Ctrl+O; tokens fixed to WCAG AA in both themes | `konfig.rs`, `main.ts`, `tokeny.css` | `konfig::e30_tryb_przenosny`, `src/kontrast.test.ts` | done |
| **E31** licenses, builds | Code is MIT; ffmpeg is downloaded, not bundled: gyan.dev *release essentials* (default) or *full*, `.sha256` sum from the same release; `-filters` and `-encoders` are checked (no `zscale` → HDR hint, codec without an encoder greyed out) | `narzedzia/zrodla.rs`, `narzedzia/mod.rs`, `PanelUstawien.ts`, `THIRD_PARTY.md` | `zrodla::e31_*`, `narzedzia::e31_parsuje_filtry`, `pobieranie::sumy_formaty`, `panel.test.ts` "E31" | done; download from gyan.dev on Windows to verify |

## Mandatory integration tests (`lavfi` sources, no network)
| Case | Test | Result |
|---|---|---|
| 853×481 → 480p h264, even dimensions | `integracja_ffmpeg::c12_nieparzyste_853x481_na_480p_h264` | 852×480 |
| 10-bit HDR PQ → h264 8-bit SDR | `integracja_ffmpeg::c13_c14_hdr_pq_10bit_na_h264_sdr` | `yuv420p bt709 bt709 bt709` |
| VFR → 25 fps, A/V drift < 100 ms | `integracja_ffmpeg::c15_vfr_na_25fps_synchronizacja` | 25/1, video 6.000 s, audio 6.016 s |
| rotate=90 + user rotation 90 | `integracja_ffmpeg::c16_obrot_z_metadanych_i_uzytkownika` | 320×240, square in the bottom right corner, rotation 0 |
| 2 parallel "size in MB" jobs ±5% | `kolejka::c20_dwa_rownolegle_zadania_docelowy_rozmiar` | -2.8% and -3.5% |
| `zażółć 日本 film.mp4` in a long directory | `kolejka::d25_polskie_znaki_cjk_i_dluga_sciezka` | path > 260 B, output `zażółć 日本 film.mp3` |
| cancel: no ffmpeg and no `.part` left | `kolejka::anulowanie_zabija_i_sprzata` | OK |
| AAC 8 kb/s mono 16 kHz | `integracja_ffmpeg::p480_25fps_aac_8k_mono` | AAC 16000 Hz, 1 channel, ~8 kb/s |
| Opus 8 kb/s | `integracja_ffmpeg::opus_8kbps` | OK |
| MP4 → MP3 320 | `integracja_ffmpeg::mp4_na_mp3_320` | MP3 320 kb/s |
| video → GIF 480 px 15 fps with a palette | `integracja_ffmpeg::wideo_na_gif_480px_15fps_z_paleta` | 480×270, 15/1, palettegen+paletteuse |
| PNG → WebP 50% | `integracja_ffmpeg::obraz_50_procent_webp` | 500×400 |

## v1.2: downloads (A1-A9), themes, defects from live testing on 07.10

### Downloads: items A and B9 from `RESEARCH_PANCERZ.md`
| Item | What we do | File(s) | Test(s) | Status |
|---|---|---|---|---|
| **A1** sites break an old yt-dlp | Version = date → age in days; a yt-dlp from PATH (pip) > 30 days old with no own copy → the app downloads its own copy (it takes precedence over PATH); Download shows the version and "yt-dlp is N days old, sites may refuse downloads" with an Update button (own copy only, pip is never touched); 403 / "Sign in to confirm" / nsig → "The site blocked the download. Click Update yt-dlp and try again." | `narzedzia/mod.rs`, `komendy.rs` (`ytdlp_zapewnij`, `ytdlp_aktualizuj`, `info_ytdlp`), `pobieracz/mod.rs` (downloader), `widoki/pobierz.ts` | `narzedzia::wiek_ytdlp_z_wersji`, `narzedzia::decyzja_wlasnej_kopii_ytdlp`, `narzedzia::wlasna_kopia_przed_path`, `komendy::a1_info_ytdlp_wiek_i_pochodzenie`, `kolejka::a7_pobranie_403_po_ludzku` (yt-dlp mock returning 403) | done; nightly channel: no (not needed after a live test) |
| **A2** JS runtime | Deno detected and downloaded (official release + `.sha256sum`), `--js-runtimes deno:PATH` (OsString) | `narzedzia/zrodla.rs`, `pobieracz/mod.rs` | `zrodla::a1_ytdlp_i_deno_z_oficjalnych_wydan`, `pobieracz::argumenty_audio_mp3` | done |
| **A3** "Sign in to confirm you're not a bot" | Message with an Update button; "Sign in to confirm your age" handled separately (age restriction) | `pobieracz/mod.rs` | `pobieracz::a7_bledy_po_ludzku` | partial: browser cookies not supported (deliberately, for later) |
| **A4** missing formats | "Only images available" / "Requested format is not available" → Update hint | `pobieracz/mod.rs` | `pobieracz::a7_bledy_po_ludzku` | done |
| **A5** rate limits | Downloads go through the queue (job limit, default 2) and do not take up the video limit | `kolejka.rs` | `kolejka::pobranie_i_potem_konwersja` | partial: no `--sleep-requests` and no backoff |
| **A6** private / 18+ / members-only / geo / live | A separate message for each case, the raw error underneath (for the report) | `pobieracz/mod.rs` | `pobieracz::a7_bledy_po_ludzku` | done (live: message only, no "download from the start") |
| **A7** file names | Template `%(title).150B [%(id)s].%(ext)s`, yt-dlp strips characters forbidden on Windows itself; directory as OsString (D25) | `pobieracz/mod.rs` | `pobieracz::d25_katalog_spoza_utf8_bez_strat`, `pobieracz::argumenty_info_i_pobrania` | done; CON/NUL on Windows to verify |
| **A8** the youtube-dl DMCA lesson | Zero links to third-party works: `yt-dlp -J` fixtures with made-up data (`example.com`), a yt-dlp mock, the real yt-dlp is tested only against a local server serving a `lavfi` file; screenshots use `example.com`; "download only content you have rights to" | `tests/fixtures/ytdlp_*.json`, `tests/kolejka.rs`, `scripts/zrzuty.mjs` | `pobieracz::film_z_json`, `kolejka::pobranie_prawdziwym_ytdlp_z_lokalnego_serwera` | done |
| **B9** Defender and yt-dlp.exe | Own copy from the official release, SHA256 from `SHA2-256SUMS` | `narzedzia/zrodla.rs`, `narzedzia/pobieranie.rs` | `pobieranie::sumy_formaty` | partial: no quarantine message; to verify manually |
| **D24** yt-dlp process tree | yt-dlp (bootloader + child + ffmpeg) in a Job Object / process group, cancel kills the whole tree | `kolejka.rs` (`pobierz`) | `procesy::d24_d27_*` (mechanism), Windows clippy | Linux done; Windows to verify |

### Themes and config
| Item | What we do | File(s) | Test(s) | Status |
|---|---|---|---|---|
| 6 themes × light/dark, WCAG | Colors fixed in `motywy.ts` so that every theme passes in both modes (text, text-2, text-3, accent, ok, warning, error ≥ 4.5:1 on the background and cards; text on accent ≥ 4.5:1) | `src/motywy.ts` | `src/kontrast.test.ts` (12 cases) | done |
| Appearance in the config (E30) | `motyw_wyglad`, `wlasne_motywy`, `ostatnie_foldery` in `konfig.json` with `#[serde(default)]`, not in localStorage (portable mode, app identifier change); default Kissaten · cybersora, dark | `konfig.rs`, `motywy.ts`, `komponenty/wyglad.ts`, `komponenty/wspolne.ts` | `konfig::wyglad_w_konfigu_z_domyslnymi`, `komendy::konfig_presety_i_sciezki`, `wyglad.test.ts` | done |
| Migration from the old name (v1.0) | First start: copy `konfig.json` and `presety.json` from the old directory, the old one stays; a second start overwrites nothing | `konfig.rs`, `lib.rs` | `konfig::migracja_ze_starej_nazwy_tylko_kopia` | done; `%APPDATA%` to verify manually |
| Output folder is created automatically | `upewnij_katalog()` for conversion and downloads, readable error | `kolejka.rs` | `kolejka::wybrany_folder_tworzy_sie_sam` | done |

### Defects from live testing on 07.10
| # | Defect | Fix | File(s) | Test(s) | Status |
|---|---|---|---|---|---|
| 1 | Truncated file reported as "Done" (header says 2:59, data ends at 0:32) | After conversion ffprobe measures the result; < 97% → "Done with a warning: The source stops at 0:32, the result is shorter" | `kolejka.rs`, `widoki/kolejka.ts` | `kolejka::testy::uciecie_ponizej_97_procent`, `kolejka::uciety_plik_gotowe_z_ostrzezeniem` (MKV truncated with `head -c`) | done |
| 2 | Command preview with the source folder | `plan_komendy` takes `katalog_wyjscia` from the config like `dodaj_zadania` | `komendy.rs` | `komendy::plan_komendy_bierze_folder_z_konfigu` | done |
| 3 | Mixed slashes in the queue | Rust: `normalizuj()` (components) for the directory and input; GUI: `sciezkaDoPokazania()` | `komendy.rs`, `logika.ts`, `kolejka.ts`, `wspolne.ts` | `komendy::normalizacja_sciezek` (Windows variant under `cfg`), `logika.test.ts` "usterka 3" | done; to verify on Windows |
| 4a | Estimate with a bitrate above the source (21.4 MB instead of 7.7) | `min(target, source)` + "The source has only N kb/s, a higher bitrate will not improve quality." | `szacunek.rs`, `plikowy.ts`, `atrapa.ts` | `szacunek::bitrate_ponad_zrodlo_liczony_ze_zrodla` | done |
| 4b | GIF estimate (43 MB instead of 11) | Factor 0.13 → 0.045 B/pixel/frame, calibrated on `lavfi` clips through the same palette chain | `szacunek.rs` | `kolejka::gif_szacunek_skalibrowany` (estimate within ×2) | done; camera footage may deviate |
| 5 | The theme switched by itself to "City Pop · Japanese" | Not reproduced. Safeguards: tiles as a radiogroup, arrows only move focus, focus is removed from a hidden tab on tab change, a single source of truth (the config) | `komponenty/wyglad.ts`, `main.ts` | `wyglad.test.ts` | safeguarded, still to observe |
| 6 | The file list clears after Convert | It stays that way; a toast "Added 2 tasks to the queue · Show" (Polish plural forms 1/2-4/5+) | `sklep.ts`, `main.ts`, `plikowy.ts`, `pobierz.ts` | `sklep.test.ts` | done |

## To verify manually on Windows
The gate (`npm run bramka` in Git Bash), no console window during conversion (D23), closing the app mid-conversion leaves no `ffmpeg.exe` in Task Manager (D24), a file in a path > 260 characters (D25), "Keep the computer responsive" = "Below normal" priority (D27), NVENC/QSV/AMF encoders and the fallback to software (C21), the installer with WebView2 (B11), the Explorer context menu, the ffmpeg download from gyan.dev (E31).

v1.2 additionally: downloads from sites after a yt-dlp update (own copy next to pip 2026.07.04: the "is N days old" warning, downloading the own copy when opening Download, then SoundCloud → MP3 with cover art and a video → MP4), cancelling a download (no `yt-dlp.exe` and `ffmpeg.exe` in Task Manager), the theme does not switch by itself (defect 5: observation), a truncated file gives "Done with a warning", queue paths with `\` only, migration of settings from the old v1.0 directory in `%APPDATA%`, the theme choice survives a restart and portable mode.
