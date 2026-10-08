//! yt-dlp: `-J` (info), argumenty pobrania, błędy po ludzku.
//! Tylko treści, do których użytkownik ma prawa; zero obchodzenia DRM.
//! Argumenty jako `OsString` (D25): ścieżki z polskimi znakami i spoza UTF-8 bez strat.

use crate::blad;
use crate::narzedzia::Sciezki;
use crate::postep::{SZABLON_PLIKU_YTDLP, SZABLON_POSTEPU_YTDLP};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Wybor {
    Najlepsza,
    Wysokosc {
        h: u32,
    },
    /// Konkretny format z listy; `z_audio` = format ma już dźwięk.
    Format {
        id: String,
        z_audio: bool,
    },
    /// `format`: mp3 | m4a | opus | flac | wav | best
    TylkoAudio {
        format: String,
    },
}

fn domyslne_jezyki() -> String {
    "pl,en".into()
}
fn domyslny_kontener() -> String {
    "mp4".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OpcjePobrania {
    pub wybor: Wybor,
    /// Kontener po scaleniu: mp4 | mkv | webm.
    #[serde(default = "domyslny_kontener")]
    pub kontener: String,
    #[serde(default)]
    pub napisy: bool,
    #[serde(default = "domyslne_jezyki")]
    pub jezyki_napisow: String,
    #[serde(default)]
    pub miniatura: bool,
    #[serde(default)]
    pub metadane: bool,
    #[serde(default)]
    pub rozdzialy: bool,
    #[serde(default)]
    pub playlista: bool,
    /// Tylko do wyświetlenia w kolejce.
    #[serde(default)]
    pub tytul: Option<String>,
}

impl Default for OpcjePobrania {
    fn default() -> Self {
        OpcjePobrania {
            wybor: Wybor::Najlepsza,
            kontener: domyslny_kontener(),
            napisy: false,
            jezyki_napisow: domyslne_jezyki(),
            miniatura: true,
            metadane: true,
            rozdzialy: true,
            playlista: false,
            tytul: None,
        }
    }
}

pub fn katalog_domyslny() -> PathBuf {
    dirs::download_dir().or_else(dirs::home_dir).unwrap_or_else(|| PathBuf::from("."))
}

fn s(x: &str) -> OsString {
    OsString::from(x)
}

fn wspolne_narzedzia(a: &mut Vec<OsString>, sc: &Sciezki) {
    if let Some(f) = &sc.ffmpeg {
        a.extend([s("--ffmpeg-location"), f.as_os_str().to_os_string()]);
    }
    if let Some(d) = &sc.deno {
        let mut r = s("deno:");
        r.push(d.as_os_str());
        a.extend([s("--js-runtimes"), r]);
    }
}

/// Argumenty `yt-dlp -J` (bez pobierania).
pub fn argumenty_info(url: &str, playlista: bool, sc: &Sciezki) -> Vec<OsString> {
    let mut a = vec![s("-J"), s("--no-warnings"), s("--no-colors")];
    if playlista {
        a.extend([s("--yes-playlist"), s("--flat-playlist")]);
    } else {
        a.push(s("--no-playlist"));
    }
    wspolne_narzedzia(&mut a, sc);
    a.extend([s("--"), s(url)]);
    a
}

/// Nazwa pliku: tytuł + „ [id]” (puste dla bezpośrednich linków, patrz `argumenty_pobrania`).
pub const SZABLON_NAZWY: &str = "%(title).150B%(sf_id|)s.%(ext)s";

/// Sortowanie formatów dla MP4: najpierw kodek H.264 + AAC (odtworzy każdy sprzęt), dopiero potem
/// rozdzielczość. Odwrotnie (`res` pierwsze) 4K w VP9/AV1 wygrywało i lądowało w .mp4.
pub const SORTOWANIE_MP4: &str = "vcodec:h264,res,fps,acodec:m4a";

pub fn argumenty_pobrania(url: &str, o: &OpcjePobrania, katalog: &Path, sc: &Sciezki) -> Vec<OsString> {
    let mut a = vec![
        s("--newline"),
        s("--no-colors"),
        s("--progress"),
        s("--progress-template"),
        s(SZABLON_POSTEPU_YTDLP),
        s("--print"),
        s(SZABLON_PLIKU_YTDLP),
        s("--no-simulate"),
        s("--no-mtime"),
        s("-o"),
        katalog.join(SZABLON_NAZWY).into_os_string(),
    ];
    // Bezpośredni link (extractor Generic): id = nazwa pliku z adresu, więc „[id]” tylko dubluje
    // tytuł („do-pobrania [do-pobrania].mp4”). Szablony `-o TYP:` są per rodzaj pliku, nie per
    // extractor, więc pole `sf_id` ustawiamy przez --parse-metadata: „ [id]”, a dla Generic pusto.
    a.extend([
        s("--parse-metadata"),
        s(" [%(id)s]:(?P<sf_id>.*)"),
        s("--parse-metadata"),
        s("%(extractor_key)s:^Generic$(?P<sf_id>)"),
    ]);
    a.push(s(if o.playlista { "--yes-playlist" } else { "--no-playlist" }));
    let kontener = match o.kontener.as_str() {
        "mkv" | "webm" => o.kontener.as_str(),
        _ => "mp4",
    };
    let audio = matches!(o.wybor, Wybor::TylkoAudio { .. });
    match &o.wybor {
        Wybor::Najlepsza => {
            a.extend([s("-f"), s("bv*+ba/b")]);
        }
        Wybor::Wysokosc { h } => {
            a.extend([s("-f"), format!("bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b").into()]);
        }
        Wybor::Format { id, z_audio } => {
            let f = if *z_audio { id.clone() } else { format!("{id}+ba/{id}") };
            a.extend([s("-f"), f.into()]);
        }
        Wybor::TylkoAudio { format } => {
            a.extend([s("-f"), s("ba/b"), s("-x")]);
            if format != "best" {
                a.extend([s("--audio-format"), s(format)]);
            }
            a.extend([s("--audio-quality"), s("0")]);
        }
    }
    if !audio {
        if kontener == "mp4" {
            // Serwis bez H.264: scalone VP9/AV1 + Opus idzie do MKV zamiast do .mp4, którego
            // część odtwarzaczy nie otworzy.
            a.extend([s("--merge-output-format"), s("mp4/mkv")]);
            if !matches!(o.wybor, Wybor::Format { .. }) {
                a.extend([s("-S"), s(SORTOWANIE_MP4)]);
            }
        } else {
            a.extend([s("--merge-output-format"), s(kontener)]);
        }
        if o.napisy {
            a.extend([s("--write-subs"), s("--sub-langs"), s(&o.jezyki_napisow), s("--embed-subs")]);
        }
    }
    if o.miniatura {
        let wav = matches!(&o.wybor, Wybor::TylkoAudio { format } if format == "wav");
        if !wav {
            a.push(s("--embed-thumbnail"));
        }
    }
    if o.metadane {
        a.push(s("--embed-metadata"));
    }
    if o.rozdzialy && !audio {
        a.push(s("--embed-chapters"));
    }
    wspolne_narzedzia(&mut a, sc);
    a.extend([s("--"), s(url)]);
    a
}

// ---------- info ----------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct FormatFilmu {
    pub id: String,
    pub ext: String,
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub fps: Option<f64>,
    pub vkodek: Option<String>,
    pub akodek: Option<String>,
    pub rozmiar_b: Option<u64>,
    pub kbps: Option<f64>,
    pub opis: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct InfoFilmu {
    pub id: String,
    pub tytul: String,
    pub url: String,
    pub miniatura: Option<String>,
    pub czas_s: Option<f64>,
    pub autor: Option<String>,
    pub formaty: Vec<FormatFilmu>,
    /// Dostępne wysokości (malejąco), do szybkiego wyboru.
    pub wysokosci: Vec<u32>,
    pub napisy: Vec<String>,
    pub rozdzialy: usize,
    pub na_zywo: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct WpisPlaylisty {
    pub id: String,
    pub tytul: String,
    pub url: String,
    pub czas_s: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Info {
    Film(InfoFilmu),
    Playlista { tytul: String, url: String, wpisy: Vec<WpisPlaylisty> },
}

fn tekst(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from)
}
fn liczba(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}
fn kodek(v: &Value, k: &str) -> Option<String> {
    tekst(v, k).filter(|c| c != "none")
}

/// Parsuje `yt-dlp -J`. Tolerancyjne: brakujące pola to `None`, nie błąd.
pub fn info_z_json(json: &str) -> Result<Info, String> {
    let v: Value =
        serde_json::from_str(json).map_err(|e| blad::kod("zly_json", &[("program", &"yt-dlp"), ("blad", &e)]))?;
    if v.get("_type").and_then(Value::as_str) == Some("playlist") {
        let wpisy = v
            .get("entries")
            .and_then(Value::as_array)
            .map(|l| {
                l.iter()
                    .filter(|e| !e.is_null())
                    .map(|e| WpisPlaylisty {
                        id: tekst(e, "id").unwrap_or_default(),
                        tytul: tekst(e, "title").unwrap_or_else(|| tekst(e, "id").unwrap_or_default()),
                        url: tekst(e, "webpage_url").or_else(|| tekst(e, "url")).unwrap_or_default(),
                        czas_s: liczba(e, "duration"),
                    })
                    .collect()
            })
            .unwrap_or_default();
        return Ok(Info::Playlista {
            tytul: tekst(&v, "title").unwrap_or_default(),
            url: tekst(&v, "webpage_url").unwrap_or_default(),
            wpisy,
        });
    }
    let formaty: Vec<FormatFilmu> = v
        .get("formats")
        .and_then(Value::as_array)
        .map(|l| {
            l.iter()
                .filter(|f| {
                    // Pomijamy podglądy (storyboard) i formaty bez obrazu i dźwięku.
                    kodek(f, "vcodec").is_some() || kodek(f, "acodec").is_some()
                })
                .map(|f| FormatFilmu {
                    id: tekst(f, "format_id").unwrap_or_default(),
                    ext: tekst(f, "ext").unwrap_or_default(),
                    w: liczba(f, "width").map(|x| x as u32),
                    h: liczba(f, "height").map(|x| x as u32),
                    fps: liczba(f, "fps"),
                    vkodek: kodek(f, "vcodec"),
                    akodek: kodek(f, "acodec"),
                    rozmiar_b: liczba(f, "filesize").or_else(|| liczba(f, "filesize_approx")).map(|x| x as u64),
                    kbps: liczba(f, "tbr"),
                    opis: tekst(f, "format_note").or_else(|| tekst(f, "format")).unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    let mut wysokosci: Vec<u32> = formaty.iter().filter(|f| f.vkodek.is_some()).filter_map(|f| f.h).collect();
    wysokosci.sort_unstable_by(|a, b| b.cmp(a));
    wysokosci.dedup();
    let mut napisy: Vec<String> = v
        .get("subtitles")
        .and_then(Value::as_object)
        .map(|m| m.keys().filter(|k| *k != "live_chat").cloned().collect())
        .unwrap_or_default();
    napisy.sort();
    Ok(Info::Film(InfoFilmu {
        id: tekst(&v, "id").unwrap_or_default(),
        tytul: tekst(&v, "title").unwrap_or_default(),
        url: tekst(&v, "webpage_url").or_else(|| tekst(&v, "original_url")).unwrap_or_default(),
        miniatura: tekst(&v, "thumbnail"),
        czas_s: liczba(&v, "duration"),
        autor: tekst(&v, "uploader").or_else(|| tekst(&v, "channel")),
        formaty,
        wysokosci,
        napisy,
        rozdzialy: v.get("chapters").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        na_zywo: v.get("is_live").and_then(Value::as_bool).unwrap_or(false),
    }))
}

pub async fn info(ytdlp: &Path, url: &str, playlista: bool, sc: &Sciezki) -> Result<Info, String> {
    let w = crate::procesy::komenda(ytdlp)
        .args(argumenty_info(url, playlista, sc))
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| blad::kod("uruchomienie", &[("program", &"yt-dlp"), ("blad", &e)]))?;
    if !w.status.success() {
        return Err(komunikat_bledu(&String::from_utf8_lossy(&w.stderr)));
    }
    info_z_json(&String::from_utf8_lossy(&w.stdout))
}

/// Komunikat, gdy serwis odmawia (stary yt-dlp, zmiany po stronie YouTube).
/// Klucz komunikatu „serwis zablokował pobieranie, zaktualizuj yt-dlp” (`rust.yt.blokada`).
pub const BLOKADA: &str = "yt.blokada";

/// Błąd yt-dlp po ludzku (klucz i18n, patrz [`crate::blad`]). 403 / „Sign in to confirm” / nsig /
/// „Requested format is not available” przy YouTube to prawie zawsze za stary yt-dlp → [`BLOKADA`].
/// Surowy ogon zostaje pod spodem (do raportu), żeby dało się zgłosić błąd.
pub fn komunikat_bledu(stderr: &str) -> String {
    let surowy = stderr.trim();
    let m = surowy.to_lowercase();
    let blokada = m.contains("http error 403")
        || m.contains("403: forbidden")
        || m.contains("sign in to confirm")
        || m.contains("nsig")
        || m.contains("n challenge")
        || m.contains("unable to extract")
        || m.contains("precondition check failed");
    // Najpierw przypadki, których aktualizacja nie naprawi (YouTube pisze też „Sign in to confirm your age”).
    let klucz = if m.contains("private video") {
        "yt.prywatny"
    } else if m.contains("confirm your age")
        || m.contains("age-restricted")
        || m.contains("inappropriate for some users")
    {
        "yt.wiek"
    } else if m.contains("members-only") || m.contains("join this channel") {
        "yt.czlonkowie"
    } else if m.contains("available in your country") || m.contains("geo restrict") {
        "yt.kraj"
    } else if m.contains("live event will begin") || m.contains("premieres in") {
        "yt.transmisja"
    } else if blokada {
        BLOKADA
    } else if m.contains("only images are available") || m.contains("requested format is not available") {
        "yt.brak_formatu"
    } else if m.contains("unsupported url") {
        "yt.nieobslugiwany"
    } else if m.contains("drm") {
        "yt.drm"
    } else if surowy.is_empty() {
        "yt.bez_opisu"
    } else {
        return surowy.to_string();
    };
    blad::z_ogonem(klucz, &[], surowy)
}

/// Czy tekst wygląda na link do filmu (do wykrywania w schowku).
pub fn wyglada_na_url(t: &str) -> bool {
    let t = t.trim();
    (t.starts_with("https://") || t.starts_with("http://")) && !t.contains(char::is_whitespace) && t.len() < 2048
}

/// Tylko do testów i podglądu: argumenty jako jeden tekst.
pub fn jako_tekst(a: &[OsString]) -> String {
    a.iter().map(|x| x.to_string_lossy()).collect::<Vec<_>>().join(" ")
}

/// Pierwszy argument równy `x` (pomocnik testów).
pub fn zawiera(a: &[OsString], x: impl AsRef<OsStr>) -> bool {
    a.iter().any(|y| y == x.as_ref())
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn argumenty_audio_mp3() {
        let o = OpcjePobrania { wybor: Wybor::TylkoAudio { format: "mp3".into() }, ..Default::default() };
        let sc = Sciezki { ffmpeg: Some("/opt/ffmpeg".into()), deno: Some("/opt/deno".into()), ..Default::default() };
        let a = argumenty_pobrania("https://x.y/v", &o, Path::new("/tmp"), &sc);
        let j = jako_tekst(&a);
        assert!(j.contains("-f ba/b -x --audio-format mp3 --audio-quality 0"));
        assert!(j.contains("--ffmpeg-location /opt/ffmpeg"));
        assert!(j.contains("--js-runtimes deno:/opt/deno"));
        assert!(!j.contains("--merge-output-format"));
        assert!(j.ends_with("-- https://x.y/v"));
    }

    #[test]
    fn argumenty_wysokosc_z_napisami() {
        let o = OpcjePobrania { wybor: Wybor::Wysokosc { h: 720 }, napisy: true, ..Default::default() };
        let a = argumenty_pobrania("u", &o, Path::new("/tmp"), &Sciezki::default());
        let j = jako_tekst(&a);
        assert!(j.contains("-f bv*[height<=720]+ba/b[height<=720]/bv*+ba/b"));
        assert!(j.contains("--merge-output-format mp4/mkv"));
        assert!(j.contains("-S vcodec:h264,res,fps,acodec:m4a"));
        assert!(j.contains("--write-subs --sub-langs pl,en --embed-subs"));
        assert!(j.contains("--no-playlist"));
    }

    #[test]
    fn mkv_bez_preferencji_h264() {
        let o = OpcjePobrania { kontener: "mkv".into(), ..Default::default() };
        let j = jako_tekst(&argumenty_pobrania("u", &o, Path::new("/tmp"), &Sciezki::default()));
        assert!(j.contains("--merge-output-format mkv"));
        assert!(!j.contains("-S "), "w MKV najwyższa jakość, dowolny kodek");
    }

    #[test]
    fn nazwa_pliku_bez_id_dla_bezposredniego_linku() {
        let a = argumenty_pobrania("u", &OpcjePobrania::default(), Path::new("/tmp"), &Sciezki::default());
        let j = jako_tekst(&a);
        assert!(j.contains("%(title).150B%(sf_id|)s.%(ext)s"));
        assert!(j.contains("--parse-metadata  [%(id)s]:(?P<sf_id>.*)"));
        assert!(j.contains("--parse-metadata %(extractor_key)s:^Generic$(?P<sf_id>)"));
    }

    /// yt-dlp do testów na prawdziwym programie: `SORAFLUX_YTDLP` albo kopia apki w %APPDATA%.
    /// Brak = test pomijany (CI nie ma yt-dlp), lokalnie w bramce jest.
    fn ytdlp_testowy() -> Option<PathBuf> {
        std::env::var_os("SORAFLUX_YTDLP")
            .map(PathBuf::from)
            .or_else(|| dirs::config_dir().map(|k| k.join("SoraConverter/narzedzia/yt-dlp.exe")))
            .filter(|p| p.is_file())
    }

    /// Prawdziwy wybór formatu przez yt-dlp na fixture (H.264 do 1080p, VP9/AV1 w 4K).
    fn wybrany_format(o: &OpcjePobrania) -> Option<String> {
        let y = ytdlp_testowy()?;
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/ytdlp_film.json");
        let mut a = argumenty_pobrania("u", o, Path::new("."), &Sciezki::default());
        a.truncate(a.len() - 2); // bez „-- url”
        a.retain(|x| x != "--no-simulate");
        let mut c = std::process::Command::new(y);
        c.args(&a)
            .args(["--simulate", "--no-warnings", "--print", "%(vcodec)s|%(acodec)s|%(ext)s", "--load-info-json"])
            .arg(fixture);
        let wy = c.output().ok()?;
        let tekst = String::from_utf8_lossy(&wy.stdout);
        tekst.lines().find(|l| l.matches('|').count() == 2).map(String::from)
    }

    #[test]
    fn najlepsza_w_mp4_to_h264_na_prawdziwym_ytdlp() {
        let Some(w) = wybrany_format(&OpcjePobrania::default()) else {
            eprintln!("pominięte: brak yt-dlp (SORAFLUX_YTDLP)");
            return;
        };
        assert_eq!(w, "avc1.64002A|mp4a.40.2|mp4", "Najlepsza w MP4 = H.264 + AAC");
        let o = OpcjePobrania { wybor: Wybor::Wysokosc { h: 2160 }, ..Default::default() };
        assert!(wybrany_format(&o).unwrap().starts_with("avc1"), "4K w MP4 też H.264 (1080p)");
        let o = OpcjePobrania { kontener: "mkv".into(), ..Default::default() };
        let w = wybrany_format(&o).unwrap();
        assert!(w.ends_with("|mkv") && !w.starts_with("avc1"), "MKV = najwyższa jakość: {w}");
    }

    #[test]
    fn a7_bledy_po_ludzku() {
        let klucz = |e: &str| blad::klucz(&komunikat_bledu(e)).unwrap_or_default();
        for e in [
            "ERROR: unable to download video data: HTTP Error 403: Forbidden",
            "ERROR: [youtube] abc: Sign in to confirm you're not a bot",
            "WARNING: [youtube] nsig extraction failed: Some formats may be missing",
        ] {
            let k = komunikat_bledu(e);
            assert_eq!(blad::klucz(&k).as_deref(), Some(BLOKADA), "{k}");
            assert!(k.ends_with(e), "surowy błąd zostaje do raportu");
        }
        assert_eq!(klucz("ERROR: Unsupported URL: https://example.com/"), "yt.nieobslugiwany");
        assert_eq!(klucz("ERROR: [youtube] x: Sign in to confirm your age"), "yt.wiek");
        assert_eq!(klucz("ERROR: [youtube] x: Private video"), "yt.prywatny");
        assert_eq!(klucz("ERROR: x: Join this channel to get access to members-only content"), "yt.czlonkowie");
        assert_eq!(klucz("ERROR: The uploader has not made this video available in your country"), "yt.kraj");
        assert_eq!(klucz("ERROR: This live event will begin in 2 hours"), "yt.transmisja");
        assert_eq!(klucz("ERROR: Requested format is not available"), "yt.brak_formatu");
        assert_eq!(klucz("ERROR: this is DRM protected"), "yt.drm");
        assert_eq!(klucz("  "), "yt.bez_opisu");
        assert_eq!(komunikat_bledu("ERROR: coś innego"), "ERROR: coś innego");
    }

    #[cfg(unix)]
    #[test]
    fn d25_katalog_spoza_utf8_bez_strat() {
        use std::os::unix::ffi::OsStrExt;
        let k = Path::new(OsStr::from_bytes(b"/tmp/pobrane-\xff"));
        let a = argumenty_pobrania("u", &OpcjePobrania::default(), k, &Sciezki::default());
        let wy = a.iter().find(|x| x.as_bytes().starts_with(b"/tmp/pobrane-")).unwrap();
        assert!(wy.as_bytes().starts_with(b"/tmp/pobrane-\xff/"), "bez to_string_lossy");
    }

    #[test]
    fn url_ze_schowka() {
        assert!(wyglada_na_url("https://example.com/watch?v=abc"));
        assert!(!wyglada_na_url("zwykły tekst"));
        assert!(!wyglada_na_url("https://a b"));
    }
}
