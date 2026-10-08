# Pancerz SoraFlux (v1.1 konwerter, v1.2 pobieranie i motywy)

Realizacja punktów **B10, B11, C12–C22, D23–D27, E28–E31** z `RESEARCH_PANCERZ.md` (v1.1). Sekcja A i B9 (pobieranie) wróciły w v1.2, patrz niżej.
Status: **zrobione** = kod + test zielony na Linuksie; **Windows** = kod pod `#[cfg(windows)]` skompilowany i sprawdzony clippy dla `x86_64-pc-windows-gnu`, logika przetestowana, działanie do sprawdzenia u maisy na Windowsie.

| Punkt | Co robimy | Plik(i) | Test(y) | Status |
|---|---|---|---|---|
| **B10** SmartScreen, podpis | Workflow wydania z krokiem SignPath wyłączonym zmienną `SIGNPATH_WLACZONE`, sumy SHA256, tylko szkic wydania; instrukcja wniosku | `.github/workflows/release.yml`, `docs/PODPIS.md` | `src/wydanie.test.ts` „B10” | zrobione; wniosek SignPath: maisa (po upublicznieniu repo) |
| **B11** brak WebView2 | Instalator NSIS z bootstrapperem WebView2 (`downloadBootstrapper`, cichy) | `src-tauri/tauri.conf.json` | `src/wydanie.test.ts` „B11” | zrobione; instalator do sprawdzenia u maisy na Windowsie |
| **C12** nieparzyste wymiary | `scale=-2`, `force_divisible_by=2`, `trunc(iw/2)*2` także bez skalowania | `src-tauri/src/budowniczy/mod.rs` | `integracja_ffmpeg::c12_nieparzyste_853x481_na_480p_h264`, `budowniczy::nieparzyste_*` | zrobione |
| **C13** 10 bit | Domyślnie `yuv420p` 8 bit dla każdego kodeka; 10 bit tylko świadomie (przełącznik, H.265/AV1/VP9), H.264 10 bit → podpowiedź | `budowniczy/mod.rs`, `ustawienia/mod.rs`, `PanelUstawien.ts` | `budowniczy::c13_*`, `integracja_ffmpeg::c13_c14_hdr_pq_10bit_na_h264_sdr`, `panel.test.ts` „C13/C19/C17” | zrobione |
| **C14** HDR z telefonu | ffprobe `color_transfer` smpte2084/arib-std-b67 → `Media.wideo.hdr`; SDR: `zscale`+`tonemap=hable`, znaczniki BT.709; bez `zscale` podpowiedź; 10 bit H.265 może zachować HDR; GIF/obrazy też tonemapowane | `sonda.rs`, `budowniczy/mod.rs`, `kolejka.rs` (wykrycie filtrów) | `sonda::hdr_10bit_*`, `budowniczy::c14_*`, `integracja_ffmpeg::c13_c14_*` (ffprobe: `yuv420p`, `bt709`×3) | zrobione |
| **C15** zmienny FPS | Ustawiony FPS: filtr `fps`; „zachowaj”: `-fps_mode vfr` (AVI: `cfr`); sonda wykrywa VFR | `budowniczy/mod.rs`, `sonda.rs` | `budowniczy::c15_*`, `integracja_ffmpeg::c15_vfr_na_25fps_synchronizacja` (rozjazd 16 ms < 100 ms) | zrobione |
| **C16** obrót z metadanych | Obrót z display matrix / tagu `rotate` (stopnie w prawo), wymiary „jak widać”; ffmpeg autorotuje, obrót użytkownika dokładany, w wyniku brak starego obrotu | `sonda.rs`, `szacunek.rs` | `sonda::obrot_tag_i_macierz`, `integracja_ffmpeg::c16_obrot_z_metadanych_i_uzytkownika` (porównanie pikseli rogów) | zrobione |
| **C17** zgodność kontener↔kodek | Mapa w `Kontener::kodeki_*` (+ lustro w `logika.ts`); webm tylko VP9/AV1 + Opus/Vorbis; gif bez audio; Opus w MP4 → ostrzeżenie; napisy: mp4/mov `mov_text`, mkv kopia (mov_text→srt), webm WebVTT, PGS do mp4 pominięte z informacją | `ustawienia/mod.rs`, `budowniczy/mod.rs`, `wspolne.ts` | `budowniczy::c17_*`, `niezgodny_kodek`, `panel.test.ts` | zrobione |
| **C18** faststart | `-movflags +faststart` dla MP4/MOV/M4A | `budowniczy/mod.rs` | `budowniczy::c18_faststart_w_mp4_mov_m4a` | zrobione |
| **C19** wiele ścieżek, okładka | Jawne `-map`: obraz bez okładki, ścieżka 1 / wybrana / wszystkie; MP3 z okładką → tylko audio, `-vn` | `budowniczy/mod.rs`, `sonda.rs`, `PanelUstawien.ts` | `budowniczy::c19_*`, `sonda::hdr_10bit_sciezki_napisy_okladka`, `panel.test.ts` | zrobione |
| **C20** 2-pass równolegle | Unikalny katalog tymczasowy zadania (pid + licznik + id) na `-passlogfile` i paletę GIF, sprzątany po zadaniu | `kolejka.rs`, `budowniczy/mod.rs` (`Kontekst`) | `budowniczy::c20_*`, `kolejka::c20_dwa_rownolegle_zadania_docelowy_rozmiar` (1 MB −2,8%, 2 MB −3,5%) | zrobione |
| **C21** enkoder sprzętowy pada | Próbne kodowanie 1 klatki przy starcie (wynik w pamięci podręcznej), w trakcie błąd → automatycznie programowo + informacja w kolejce | `narzedzia/mod.rs`, `komendy.rs`, `kolejka.rs`, `kolejka.ts` | `kolejka::c21_sprzetowy_padl_powrot_do_programowego` (NVENC bez GPU → H.264 programowo) | zrobione; prawdziwe NVENC/QSV/AMF: do sprawdzenia u maisy na Windowsie |
| **C22** nieznany czas | `out_time=N/A`, czas `None`/0: bez dzielenia przez zero, bez ETA; pasek nieokreślony | `postep.rs`, `kolejka.rs`, `kolejka.ts`, `style.css` | `postep::c22_nieznany_czas_bez_dzielenia_przez_zero` | zrobione |
| **D23** okno konsoli | `CREATE_NO_WINDOW` dla każdego procesu (async i sync) | `src-tauri/src/procesy.rs` | `procesy::d23_flagi_windows` (logika), clippy Windows | Windows: do sprawdzenia u maisy |
| **D24** ffmpeg w tle po zamknięciu | Windows: każde dziecko w Job Object z `KILL_ON_JOB_CLOSE`, anulowanie = `TerminateJobObject`; Unix: własna grupa procesów, `kill(-pgid)`; `RunEvent::Exit` anuluje wszystko | `procesy.rs`, `kolejka.rs`, `lib.rs` | `procesy::d24_d27_grupa_niski_priorytet_i_zabicie_drzewa` (wnuk ginie), `kolejka::anulowanie_zabija_i_sprzata` (brak procesu ffmpeg i `.part`) | Linux zrobione; Job Object: do sprawdzenia u maisy na Windowsie |
| **D25** polskie znaki, długie ścieżki | Argumenty `OsString` bez powłoki i bez `to_string_lossy` (także nazwy wyników) | `budowniczy/mod.rs`, `sonda.rs`, `kolejka.rs` | `budowniczy::d25_sciezka_spoza_utf8_bez_strat`, `kolejka::d25_polskie_znaki_cjk_i_dluga_sciezka` (`zażółć 日本 film.mp4`, ścieżka > 260 B) | Linux zrobione; > 260 znaków na Windows (ffmpeg + `\\?\`): do sprawdzenia u maisy |
| **D26** nadpisanie, miejsce, `.part` | Nigdy wynik = źródło (także po ścieżce kanonicznej), kolizja → „ (1)”; wolne miejsce vs szacunek (+10% i 50 MB); dziennik `w_toku.json` i sprzątanie `*.part.*` po awarii przy starcie (tylko nasze pliki) | `kolejka.rs`, `procesy.rs`, `lib.rs` | `kolejka::trzy_zadania_dwa_rownolegle`, `kolejka::testy::czesc_i_sprzatanie_po_awarii`, `procesy::d26_miejsce` | zrobione (statvfs; Windows `GetDiskFreeSpaceExW` do sprawdzenia) |
| **D27** słaby procesor | Osobny limit zadań wideo, domyślnie 1 (obrazy obok); „Nie zamulaj komputera”: nice 10 / `BELOW_NORMAL_PRIORITY_CLASS` | `konfig.rs`, `kolejka.rs`, `procesy.rs`, `ustawienia.ts` | `kolejka::d27_jedno_wideo_naraz_obrazy_obok`, `konfig::domyslne_i_zapis`, `procesy::d24_d27_*` (nice = 10) | Linux zrobione; priorytet Windows: do sprawdzenia |
| **E28** aktualizacje apki | Wtyczka updatera, `latest.json` z GitHub Releases, podpis; prawdziwy klucz publiczny (1.3.0), przy błędzie przycisk do strony wydań; sprawdzenie ręczne w Ustawieniach | `tauri.conf.json`, `lib.rs`, `src/aktualizacje.ts`, `scripts/latest-json.mjs`, `docs/AKTUALIZACJE.md` | `src/wydanie.test.ts` „E28” (klucz to prawdziwy klucz minisign) i „wydanie z CI” | zrobione; klucz u opiekuna, sekrety w repo |
| **E29** dziennik i raport | `dziennik.log` (1 MB + kopia) w katalogu danych, błędy zadań; „Kopiuj raport”: wersje, system, ostatnie wpisy, bez prywatnych ścieżek | `dziennik.rs`, `komendy.rs`, `ustawienia.ts` | `dziennik::e29_anonimizacja`, `dziennik::e29_dziennik_i_raport` | zrobione |
| **E30** przenośna, klawiatura, kontrast | Folder `portable` obok `.exe` = wszystko w nim; zakładki strzałkami (ARIA tablist), Ctrl+1…4, Ctrl+O; tokeny poprawione do WCAG AA w obu motywach | `konfig.rs`, `main.ts`, `tokeny.css` | `konfig::e30_tryb_przenosny`, `src/kontrast.test.ts` | zrobione |
| **E31** licencje, buildy | Kod MIT; ffmpeg pobierany, nie dołączany: gyan.dev *release essentials* (domyślnie) albo *full*, suma `.sha256` z tego samego wydania; `-filters` i `-encoders` sprawdzane (brak `zscale` → podpowiedź HDR, kodek bez enkodera wyszarzony) | `narzedzia/zrodla.rs`, `narzedzia/mod.rs`, `PanelUstawien.ts`, `THIRD_PARTY.md` | `zrodla::e31_*`, `narzedzia::e31_parsuje_filtry`, `pobieranie::sumy_formaty`, `panel.test.ts` „E31” | zrobione; pobranie z gyan.dev na Windows do sprawdzenia |

## Obowiązkowe testy integracyjne (źródła z `lavfi`, bez sieci)
| Przypadek | Test | Wynik |
|---|---|---|
| 853×481 → 480p h264, wymiary parzyste | `integracja_ffmpeg::c12_nieparzyste_853x481_na_480p_h264` | 852×480 |
| 10-bit HDR PQ → h264 8-bit SDR | `integracja_ffmpeg::c13_c14_hdr_pq_10bit_na_h264_sdr` | `yuv420p bt709 bt709 bt709` |
| VFR → 25 fps, rozjazd A/V < 100 ms | `integracja_ffmpeg::c15_vfr_na_25fps_synchronizacja` | 25/1, wideo 6,000 s, audio 6,016 s |
| rotate=90 + obrót użytkownika 90 | `integracja_ffmpeg::c16_obrot_z_metadanych_i_uzytkownika` | 320×240, kwadrat w prawym dolnym rogu, obrót 0 |
| 2 równoległe zadania „rozmiar MB” ±5% | `kolejka::c20_dwa_rownolegle_zadania_docelowy_rozmiar` | −2,8% i −3,5% |
| `zażółć 日本 film.mp4` w długim katalogu | `kolejka::d25_polskie_znaki_cjk_i_dluga_sciezka` | ścieżka > 260 B, wynik `zażółć 日本 film.mp3` |
| anulowanie: brak ffmpeg i `.part` | `kolejka::anulowanie_zabija_i_sprzata` | OK |
| AAC 8 kb/s mono 16 kHz | `integracja_ffmpeg::p480_25fps_aac_8k_mono` | AAC 16000 Hz, 1 kan., ~8 kb/s |
| Opus 8 kb/s | `integracja_ffmpeg::opus_8kbps` | OK |
| MP4 → MP3 320 | `integracja_ffmpeg::mp4_na_mp3_320` | MP3 320 kb/s |
| wideo → GIF 480 px 15 fps z paletą | `integracja_ffmpeg::wideo_na_gif_480px_15fps_z_paleta` | 480×270, 15/1, palettegen+paletteuse |
| PNG → WebP 50% | `integracja_ffmpeg::obraz_50_procent_webp` | 500×400 |

## v1.2: pobieranie (A1–A9), motywy, usterki z testów na żywo 07.10

### Pobieranie: punkty A i B9 z `RESEARCH_PANCERZ.md`
| Punkt | Co robimy | Plik(i) | Test(y) | Status |
|---|---|---|---|---|
| **A1** serwisy psują stary yt-dlp | Wersja = data → wiek w dniach; yt-dlp z PATH (pip) > 30 dni bez własnej kopii → apka pobiera własną kopię (pierwszeństwo przed PATH); Pobierz pokazuje wersję i „yt-dlp ma N dni, YouTube może odmawiać” z przyciskiem Aktualizuj (tylko własna kopia, pipa nie ruszamy); 403 / „Sign in to confirm” / nsig → „Serwis zablokował pobieranie. Kliknij Aktualizuj yt-dlp i spróbuj jeszcze raz.” | `narzedzia/mod.rs`, `komendy.rs` (`ytdlp_zapewnij`, `ytdlp_aktualizuj`, `info_ytdlp`), `pobieracz/mod.rs`, `widoki/pobierz.ts` | `narzedzia::wiek_ytdlp_z_wersji`, `narzedzia::decyzja_wlasnej_kopii_ytdlp`, `narzedzia::wlasna_kopia_przed_path`, `komendy::a1_info_ytdlp_wiek_i_pochodzenie`, `kolejka::a7_pobranie_403_po_ludzku` (atrapa yt-dlp z 403) | zrobione; kanał nightly: nie (nie było potrzeby po teście na żywo) |
| **A2** runtime JS | Deno wykrywane i pobierane (oficjalne wydanie + `.sha256sum`), `--js-runtimes deno:ŚCIEŻKA` (OsString) | `narzedzia/zrodla.rs`, `pobieracz/mod.rs` | `zrodla::a1_ytdlp_i_deno_z_oficjalnych_wydan`, `pobieracz::argumenty_audio_mp3` | zrobione |
| **A3** „Sign in to confirm you're not a bot” | Komunikat z przyciskiem Aktualizuj; „Sign in to confirm your age” osobno (ograniczenie wiekowe) | `pobieracz/mod.rs` | `pobieracz::a7_bledy_po_ludzku` | częściowo: ciasteczka z przeglądarki nie (świadomie, na później) |
| **A4** brak formatów | „Only images available” / „Requested format is not available” → podpowiedź Aktualizuj | `pobieracz/mod.rs` | `pobieracz::a7_bledy_po_ludzku` | zrobione |
| **A5** limity zapytań | Pobrania idą przez kolejkę (limit zadań, domyślnie 2), nie zajmują limitu wideo | `kolejka.rs` | `kolejka::pobranie_i_potem_konwersja` | częściowo: bez `--sleep-requests` i backoffu |
| **A6** prywatny / 18+ / członkowie / geo / live | Osobny komunikat dla każdego przypadku, surowy błąd pod spodem (raport) | `pobieracz/mod.rs` | `pobieracz::a7_bledy_po_ludzku` | zrobione (live: komunikat, bez „pobierz od początku”) |
| **A7** nazwy plików | Szablon `%(title).150B [%(id)s].%(ext)s`, yt-dlp sam czyści znaki zakazane na Windows; katalog jako OsString (D25) | `pobieracz/mod.rs` | `pobieracz::d25_katalog_spoza_utf8_bez_strat`, `pobieracz::argumenty_info_i_pobrania` | zrobione; CON/NUL na Windows do sprawdzenia |
| **A8** lekcja DMCA youtube-dl | Zero linków do cudzych utworów: fixtures `yt-dlp -J` ze zmyślonymi danymi (`example.com`), atrapa yt-dlp, test prawdziwego yt-dlp tylko z lokalnego serwera z plikiem z `lavfi`; zrzuty z `example.com`; „pobieraj tylko treści, do których masz prawa” | `tests/fixtures/ytdlp_*.json`, `tests/kolejka.rs`, `scripts/zrzuty.mjs` | `pobieracz::film_z_json`, `kolejka::pobranie_prawdziwym_ytdlp_z_lokalnego_serwera` | zrobione |
| **B9** Defender i yt-dlp.exe | Własna kopia z oficjalnego wydania, SHA256 z `SHA2-256SUMS` | `narzedzia/zrodla.rs`, `narzedzia/pobieranie.rs` | `pobieranie::sumy_formaty` | częściowo: komunikat o kwarantannie nie; do sprawdzenia u maisy |
| **D24** drzewo procesów yt-dlp | yt-dlp (bootloader + dziecko + ffmpeg) w Job Object / grupie procesów, anulowanie zabija całe drzewo | `kolejka.rs` (`pobierz`) | `procesy::d24_d27_*` (mechanizm), clippy Windows | Linux zrobione; Windows do sprawdzenia |

### Motywy i konfig
| Punkt | Co robimy | Plik(i) | Test(y) | Status |
|---|---|---|---|---|
| 6 motywów × jasny/ciemny, WCAG | Kolory poprawione w `motywy.ts` tak, by każdy motyw w obu trybach przeszedł test (tekst, tekst-2, tekst-3, akcent, ok, ostrzeżenie, błąd ≥ 4,5:1 na tle i kartach; tekst na akcencie ≥ 4,5:1) | `src/motywy.ts` | `src/kontrast.test.ts` (12 przypadków) | zrobione |
| Wygląd w konfigu (E30) | `motyw_wyglad`, `wlasne_motywy`, `ostatnie_foldery` w `konfig.json` z `#[serde(default)]`, nie w localStorage (tryb przenośny, zmiana identyfikatora apki); domyślnie Kissaten · cybersora, ciemny | `konfig.rs`, `motywy.ts`, `komponenty/wyglad.ts`, `komponenty/wspolne.ts` | `konfig::wyglad_w_konfigu_z_domyslnymi`, `komendy::konfig_presety_i_sciezki`, `wyglad.test.ts` | zrobione |
| Migracja ze starej nazwy (v1.0) | Pierwszy start: kopia `konfig.json` i `presety.json` ze starego katalogu, stary zostaje; drugi start nic nie nadpisuje | `konfig.rs`, `lib.rs` | `konfig::migracja_ze_starej_nazwy_tylko_kopia` | zrobione; `%APPDATA%` do sprawdzenia u maisy |
| Folder zapisu tworzy się sam | `upewnij_katalog()` dla konwersji i pobierania, czytelny błąd | `kolejka.rs` | `kolejka::wybrany_folder_tworzy_sie_sam` | zrobione |

### Usterki z testów na żywo 07.10
| # | Usterka | Naprawa | Plik(i) | Test(y) | Status |
|---|---|---|---|---|---|
| 1 | Ucięty plik jako „Gotowe” (nagłówek 2:59, dane do 0:32) | Po konwersji ffprobe mierzy wynik; < 97% → „Gotowe z ostrzeżeniem: Źródło urywa się w 0:32, wynik jest krótszy” | `kolejka.rs`, `widoki/kolejka.ts` | `kolejka::testy::uciecie_ponizej_97_procent`, `kolejka::uciety_plik_gotowe_z_ostrzezeniem` (MKV ucięty `head -c`) | zrobione |
| 2 | Podgląd komendy z folderem źródła | `plan_komendy` bierze `katalog_wyjscia` z konfigu jak `dodaj_zadania` | `komendy.rs` | `komendy::plan_komendy_bierze_folder_z_konfigu` | zrobione |
| 3 | Mieszane ukośniki w kolejce | Rust: `normalizuj()` (components) dla katalogu i wejścia; GUI: `sciezkaDoPokazania()` | `komendy.rs`, `logika.ts`, `kolejka.ts`, `wspolne.ts` | `komendy::normalizacja_sciezek` (wariant Windows pod `cfg`), `logika.test.ts` „usterka 3” | zrobione; na Windows do sprawdzenia |
| 4a | Szacunek przy bitrate ponad źródło (21,4 MB zamiast 7,7) | `min(docelowy, źródłowy)` + „Źródło ma tylko N kb/s, wyższy bitrate nie poprawi jakości” | `szacunek.rs`, `plikowy.ts`, `atrapa.ts` | `szacunek::bitrate_ponad_zrodlo_liczony_ze_zrodla` | zrobione |
| 4b | Szacunek GIF (43 MB zamiast 11) | Współczynnik 0,13 → 0,045 B/piksel/klatkę, kalibracja na klipach z `lavfi` przez ten sam łańcuch palety | `szacunek.rs` | `kolejka::gif_szacunek_skalibrowany` (szacunek w ×2) | zrobione; materiał z kamery może odbiegać |
| 5 | Motyw sam przeskoczył na „City Pop · japoński” | Nieodtworzone. Zabezpieczenia: kafle jako radiogroup, strzałki tylko przesuwają fokus, przy zmianie zakładki fokus ze schowanej zakładki jest zdejmowany, jedno źródło prawdy (konfig) | `komponenty/wyglad.ts`, `main.ts` | `wyglad.test.ts` | zabezpieczone, do obserwacji u maisy |
| 6 | Lista plików czyści się po Konwertuj | Zostaje; dymek „Dodano 2 zadania do kolejki · Pokaż” (odmiana 1/2–4/5+) | `sklep.ts`, `main.ts`, `plikowy.ts`, `pobierz.ts` | `sklep.test.ts` | zrobione |

## Do sprawdzenia u maisy na Windowsie
Bramka (`npm run bramka` w Git Bash), brak okna konsoli przy konwersji (D23), zamknięcie apki w trakcie konwersji → brak `ffmpeg.exe` w Menedżerze zadań (D24), plik w ścieżce > 260 znaków (D25), „Nie zamulaj komputera” = priorytet „Poniżej normalnego” (D27), enkodery NVENC/QSV/AMF i powrót do programowego (C21), instalator z WebView2 (B11), menu kontekstowe Eksploratora, pobranie ffmpeg z gyan.dev (E31).

v1.2 dodatkowo: pobieranie z serwisów po aktualizacji yt-dlp (własna kopia obok pipa 2026.07.04: ostrzeżenie „ma N dni”, przy wejściu na Pobierz pobranie własnej kopii, potem SoundCloud → MP3 z okładką i film → MP4), anulowanie pobierania (brak `yt-dlp.exe` i `ffmpeg.exe` w Menedżerze zadań), motyw nie przeskakuje sam (usterka 5: obserwacja), ucięty plik daje „Gotowe z ostrzeżeniem”, ścieżki w kolejce z samymi `\`, migracja ustawień ze starego katalogu v1.0 w `%APPDATA%`, wybór motywu przetrwa restart i tryb przenośny.
