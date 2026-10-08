# SoraFlux: architektura (stan faktyczny, v1.2)

## Zasada główna
Jedna lekka apka desktop (Tauri 2): konwerter wideo, audio, obrazów i GIF plus pobieranie przez yt-dlp. Cała praca na komputerze użytkownika. Front (TypeScript) tylko rysuje i zbiera ustawienia; Rust buduje argumenty ffmpeg/yt-dlp czystymi funkcjami, uruchamia narzędzia i raportuje postęp zdarzeniami. Żadnego serwera, żadnej telemetrii.

```
┌──────────────────────── Front (Vite + TS) ────────────────────────┐
│ zakładki: Konwertuj | Pobierz | Obrazy | Kolejka | Ustawienia      │
│ PanelUstawien (JEDEN komponent: Konwertuj, Obrazy, „po pobraniu”)  │
│ motywy.ts: 6 motywów × jasny/ciemny + własne (zapis w konfigu)     │
│ stan: sklep.ts (prosty store + subskrypcje)   i18n: pl.json/en.json│
└───────────────▲──────────────── invoke / listen ───────────────────┘
                │ komendy Tauri (JSON)        zdarzenia: zadanie://postep, zadanie://stan, pliki://otworz
┌───────────────┴──────────────── Rust (src-tauri) ──────────────────┐
│ komendy.rs   → cienka warstwa #[tauri::command]                     │
│ ustawienia/  → typy: Profil, ProfilWideo, ProfilAudio, ProfilObrazu…│
│ budowniczy/  → CZYSTE funkcje (Media, Profil, Kontekst) → Plan      │
│               + łańcuch podglądu klatki, plan odsłuchu 5 s          │
│ sonda.rs     → ffprobe → Media (ścieżki, napisy, HDR, bity, obrót)  │
│ kolejka.rs   → N zadań (osobny limit wideo), `.part`, dziennik w toku,│
│               korekta MB, powrót z enkodera sprzętowego, pomijanie  │
│ postep.rs    → parser `-progress pipe:1` → % / ETA / nieokreślony   │
│               + szablon postępu yt-dlp (bajty, B/s, ETA, plik)      │
│ pobieracz/   → yt-dlp -J (info), argumenty pobrania, błędy po ludzku│
│ procesy.rs   → procesy: CREATE_NO_WINDOW, Job Object / grupa,       │
│               priorytet, wolne miejsce                              │
│ narzedzia/   → ffmpeg/ffprobe/yt-dlp/deno, SHA256, wiek yt-dlp,    │
│               własna kopia yt-dlp zamiast starej z PATH, enkodery, │
│               filtry, próba enkoderów sprzętowych                   │
│ dziennik.rs  → lokalny dziennik błędów, raport bez prywatnych ścieżek│
│ szacunek.rs  → przewidywany rozmiar wyniku                          │
│ presety.rs   → wbudowane + użytkownika (presety.json)               │
│ konfig.rs    → ustawienia apki (system albo folder `portable`)      │
│ lib.rs       → wtyczki: single-instance, updater, powiadomienia     │
└────────────────────────────────────────────────────────────────────┘
          │ argumenty OsString, bez powłoki; Job Object (Windows) / grupa procesów (Unix)
     ffmpeg / ffprobe / yt-dlp / deno  (zewnętrzne binarki, nie w repo i nie w instalatorze)
```

## Model danych (Rust, serde; ten sam kształt w `src/typy.ts`)
```rust
struct NoweZadanie { rodzaj: RodzajZadania, katalog: Option<PathBuf>, pomin_istniejace: bool }
enum RodzajZadania { Konwersja { wejscie: PathBuf, profil: Profil },
                    Pobranie { url: String, opcje: OpcjePobrania, potem: Option<Profil> } }
enum Stan { Oczekuje, Trwa, Gotowe { wyjscie }, Blad { komunikat }, Anulowane, Pominiete { wyjscie } }
// InfoZadania.ostrzezenie: Option<OstrzezenieWyniku::Uciete { zrodlo_konczy_s, wynik_s, oczekiwane_s }> = „gotowe z ostrzeżeniem”
struct Media { czas_s, rozmiar_b, kbps, format, wideo: Option<StrumienWideo /* indeks, w, h, fps, bity, hdr, obrot, vfr */>,
               audio, sciezki_audio: Vec<StrumienAudio>, napisy: Vec<StrumienNapisow>, okladka, obraz }
struct Profil {
  kontener: Kontener,                 // mp4 mkv webm mov avi gif mp3 m4a aac opus ogg flac wav webp png jpg avif bmp ico
  wideo: Option<ProfilWideo>,         // None = bez obrazu (np. MP4→MP3)
  audio: Option<ProfilAudio>,         // None = bez dźwięku
  obraz: Option<ProfilObrazu>,
  gif: Option<ProfilGif>,             // też animowany WebP
  ciecie: Option<Ciecie { od, koniec }>, obrot, odbicie, przyciecie: Ramka, deinterlace, predkosc,
  sciezki_audio: WyborAudio /* pierwsza | wszystkie | numer */, napisy: bool,
}
struct ProfilWideo { kodek, rozdzielczosc, dopasowanie, nie_powiekszaj, skaler, fps, jakosc, sprzet, dziesiec_bit }
enum JakoscWideo { Crf { crf }, Bitrate { kbps }, RozmiarMb { mb } }   // RozmiarMb → 2 przebiegi
```
Enumy z danymi są tagowane polem `typ` (w TS zwykłe unie). Mapa zgodności kontener↔kodek jest w jednym miejscu: `Kontener::kodeki_wideo/kodeki_audio` (lustro w `logika.ts`).

## Budowniczy argumentów (serce, 100% testowalne)
- `budowniczy::plan_z(&Media, &Profil, wejscie, wyjscie, &Kontekst) -> Result<Plan, BladProfilu>`; `Plan { przebiegi: Vec<Vec<OsString>>, podpowiedzi, tymczasowe }` (1 albo 2 przebiegi: rozmiar MB, GIF z paletą). `Kontekst { zscale, katalog_tmp }`: możliwości ffmpeg i katalog zadania (logi 2-pass, paleta). `plan()` = domyślny kontekst.
- Łańcuch filtrów w stałej kolejności: przycięcie → deinterlace → obrót/odbicie → HDR→SDR (zscale+tonemap) → skala (+pasy/rozmycie) → prędkość → fps; audio: prędkość → loudnorm → aresample.
- Jawne mapowanie: `-map` obrazu (bez okładki), wybranych ścieżek audio i napisów zgodnych z kontenerem; 8 bit `yuv420p` domyślnie, `-fps_mode` przy „zachowaj”, `+faststart` dla MP4/MOV/M4A, `-avoid_negative_ts` przy cięciu kopią.
- Podgląd: `lancuch_podgladu` = ten sam `-vf` co konwersja (GIF: paleta jednej klatki), `argumenty_klatki` (JPEG ≤ 960 px), `plan_odsluchu` (5 s audio z tymi samymi ustawieniami).
- Walidacja zamiast cichych błędów (`BladProfilu`), podpowiedzi nieblokujące (`Podpowiedz`, np. AAC < 32 kb/s → mono + 16 kHz).
- Zawsze `-hide_banner -nostdin -y -progress pipe:1 -nostats`.

## Kolejka i postęp
- Dyspozytor z licznikami: limit wszystkich zadań (domyślnie 2) i wideo (domyślnie 1; obrazy mogą wyprzedzić czekające wideo), zmiana w locie. Każde zadanie: ffprobe → sprawdzenie wolnego miejsca → plan → przebiegi ffmpeg w unikalnym katalogu tymczasowym; stdout przez `postep.rs`, stderr: ostatnie 50 linii do komunikatu błędu (i do dziennika).
- Wynik powstaje jako `nazwa.part.ext` (zapisany w `w_toku.json`), rename po sukcesie; anulowanie zabija drzewo procesów i usuwa `.part`; po awarii apki niepełne pliki z dziennika są usuwane przy starcie. Kolizja nazw → `nazwa (1).ext`, nigdy nadpisanie źródła (także po ścieżce kanonicznej).
- Po konwersji ffprobe mierzy czas wyniku; < 97% oczekiwanego → „gotowe z ostrzeżeniem” (ucięte źródło).
- Pobranie: yt-dlp w tym samym drzewie procesów (Job Object / grupa), postęp z `--progress-template`, ścieżka z `--print after_move:`; `potem` = nowe zadanie konwersji po pobraniu. Pobrania nie zajmują limitu wideo.
- Docelowy rozmiar MB: po zakodowaniu sprawdzenie rozmiaru, w razie przekroczenia ponowne kodowanie z poprawionym bitrate (maks. 2 razy). Enkoder sprzętowy padł → to samo zadanie programowo (`awaria_sprzetu`).
- `RunEvent::Exit` anuluje wszystko; na Windows Job Object z `KILL_ON_JOB_CLOSE` zabija drzewo nawet przy awarii apki.

## Narzędzia zewnętrzne
- ffmpeg, ffprobe, yt-dlp, Deno. Kolejność wyszukiwania: ścieżka z konfigu → katalog narzędzi apki (dane apki albo `portable/`, obok `.exe`) → PATH.
- yt-dlp: wersja = data `RRRR.MM.DD` → wiek w dniach. yt-dlp z PATH (pip) starszy niż 30 dni i brak własnej kopii → przy wejściu na Pobierz apka pobiera własną kopię (oficjalne wydanie z GitHuba, `SHA2-256SUMS`), która ma pierwszeństwo przed PATH. „Aktualizuj yt-dlp” pobiera tylko własną kopię, pipa nie rusza. Błąd 403 / „Sign in to confirm” / nsig → „Serwis zablokował pobieranie. Kliknij Aktualizuj yt-dlp i spróbuj jeszcze raz.”
- Kreator pierwszego uruchomienia: co jest, czego brakuje, „pobierz” (Windows: gyan.dev *release essentials*, opcjonalnie *full*, suma `.sha256` z tego samego wydania). Linki w jednym pliku `narzedzia/zrodla.rs`.
- `ffmpeg -encoders` (kodeki bez enkodera wyszarzone w GUI), `ffmpeg -filters` (`zscale` → tonemapping HDR) i próbne zakodowanie 1 klatki enkoderami sprzętowymi; wynik w pamięci podręcznej dla danej ścieżki ffmpeg.

## Front
- Vite + TS bez frameworka. `widoki/*.ts`, `komponenty/PanelUstawien.ts` (jeden panel), `komponenty/podglad.ts` (przed/po, odsłuch), `komponenty/info.ts` (karta pliku), `sklep.ts`, `api.ts` (jedyne miejsce z `invoke`/`listen`; atrapa `atrapa.ts` do testów i zrzutów), `aktualizacje.ts`, `i18n/`.
- Czysta logika w `logika.ts` (profile, szybkie akcje, karta informacji, formatowanie), testowana vitestem.
- `tokeny.css`: odstępy, promienie, czcionki (fonty offline z `@fontsource`, `fonty.ts`), kolory startowe; `motywy.ts` nakłada kolory wybranego motywu (`data-wariant` a/b/c, `data-theme`). Wybór motywu, własne motywy i ostatnie foldery są w `konfig.json` (Rust), nie w localStorage (tryb przenośny). Kontrast WCAG AA każdego motywu w obu trybach sprawdzany testem.
- Klawiatura: zakładki strzałkami (ARIA tablist), Ctrl+1…5, Ctrl+O; kafle motywów to radiogroup, strzałki tylko przesuwają fokus.
- Migracja ze starej nazwy programu (v1.0): przy pierwszym starcie kopia `konfig.json` i `presety.json`, stary katalog zostaje.

## Windows: instalator i Eksplorator
- NSIS z bootstrapperem WebView2; `src-tauri/nsis/hooks.nsh` dopisuje (HKCU) i usuwa wpis „Konwertuj w SoraFlux” dla plików wideo, audio i obrazów.
- Pliki z argumentów przy starcie (`pliki_startowe`), drugie uruchomienie → `tauri-plugin-single-instance` → zdarzenie `pliki://otworz` do otwartego okna.
- Aktualizacje: `tauri-plugin-updater` (GitHub Releases, `latest.json`, podpis), sprawdzane ręcznie; workflow `.github/workflows/release.yml` (SignPath opcjonalny).

## Struktura repo
```
src-tauri/src/{lib.rs,main.rs,komendy.rs,kolejka.rs,postep.rs,procesy.rs,sonda.rs,szacunek.rs,presety.rs,konfig.rs,dziennik.rs}
src-tauri/src/{ustawienia,budowniczy,narzedzia,pobieracz}/   src-tauri/nsis/hooks.nsh
src-tauri/tests/{budowniczy.rs,integracja_ffmpeg.rs,kolejka.rs,komendy.rs,podglad.rs,pobieracz.rs}   tests/fixtures/ (yt-dlp -J, dane zmyślone)
src/{main.ts,api.ts,atrapa.ts,aktualizacje.ts,sklep.ts,logika.ts,typy.ts,motywy.ts,fonty.ts,tokeny.css,style.css,widoki/,komponenty/,i18n/}
scripts/{bramka.sh,zrzuty.mjs,latest-json.mjs}  .github/workflows/{release.yml,test.yml}  docs/{PODPIS.md,AKTUALIZACJE.md}
zrzuty/  README.md README.en.md PANCERZ.md THIRD_PARTY.md LICENSE (MIT)
```

## Bramka
`npm run bramka`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (jednostkowe + integracja z prawdziwym ffmpeg i weryfikacją ffprobe), `npm run build`, `vitest`, zrzuty Playwright z atrapą `api.ts`. Kod `#[cfg(windows)]` sprawdzany dodatkowo `cargo clippy --target x86_64-pc-windows-gnu`.
