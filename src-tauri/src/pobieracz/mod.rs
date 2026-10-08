//! yt-dlp: `-J` (info), argumenty pobrania, błędy po ludzku.
//! Tylko treści, do których użytkownik ma prawa; zero obchodzenia DRM.
//! Argumenty jako `OsString` (D25): ścieżki z polskimi znakami i spoza UTF-8 bez strat.

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
        katalog.join("%(title).150B [%(id)s].%(ext)s").into_os_string(),
    ];
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
        a.extend([s("--merge-output-format"), s(kontener)]);
        if kontener == "mp4" && !matches!(o.wybor, Wybor::Format { .. }) {
            // W MP4 wolimy H.264 + AAC (odtworzy każdy sprzęt), przy tej samej rozdzielczości.
            a.extend([s("-S"), s("res,fps,vcodec:h264,acodec:m4a")]);
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
    let v: Value = serde_json::from_str(json).map_err(|e| format!("yt-dlp: zły JSON: {e}"))?;
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
        .map_err(|e| format!("nie można uruchomić yt-dlp: {e}"))?;
    if !w.status.success() {
        return Err(komunikat_bledu(&String::from_utf8_lossy(&w.stderr)));
    }
    info_z_json(&String::from_utf8_lossy(&w.stdout))
}

/// Komunikat, gdy serwis odmawia (stary yt-dlp, zmiany po stronie YouTube).
pub const BLOKADA: &str = "Serwis zablokował pobieranie. Kliknij Aktualizuj yt-dlp i spróbuj jeszcze raz.";

/// Błąd yt-dlp po ludzku. 403 / „Sign in to confirm” / nsig / „Requested format is not available”
/// przy YouTube to prawie zawsze za stary yt-dlp → [`BLOKADA`]. Surowy ogon zostaje pod spodem
/// (do raportu), żeby dało się zgłosić błąd.
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
    if m.contains("private video") {
        format!("To prywatny film: bez dostępu u autora nie da się go pobrać.\n\n{surowy}")
    } else if m.contains("confirm your age")
        || m.contains("age-restricted")
        || m.contains("inappropriate for some users")
    {
        format!("Film z ograniczeniem wiekowym: serwis wymaga zalogowania.\n\n{surowy}")
    } else if m.contains("members-only") || m.contains("join this channel") {
        format!("Film tylko dla członków kanału.\n\n{surowy}")
    } else if m.contains("available in your country") || m.contains("geo restrict") {
        format!("Film niedostępny w Twoim kraju.\n\n{surowy}")
    } else if m.contains("live event will begin") || m.contains("premieres in") {
        format!("Transmisja jeszcze się nie zaczęła. Spróbuj, gdy będzie dostępna.\n\n{surowy}")
    } else if blokada {
        format!("{BLOKADA}\n\n{surowy}")
    } else if m.contains("only images are available") || m.contains("requested format is not available") {
        format!("Serwis nie podał żadnego formatu do pobrania. Kliknij Aktualizuj yt-dlp i spróbuj jeszcze raz.\n\n{surowy}")
    } else if m.contains("unsupported url") {
        format!("Ten adres nie jest obsługiwany przez yt-dlp.\n\n{surowy}")
    } else if m.contains("drm") {
        format!("Ten materiał jest chroniony DRM, nie pobieramy go.\n\n{surowy}")
    } else if surowy.is_empty() {
        "yt-dlp zakończył się błędem bez opisu".into()
    } else {
        surowy.to_string()
    }
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
        assert!(j.contains("--merge-output-format mp4"));
        assert!(j.contains("--write-subs --sub-langs pl,en --embed-subs"));
        assert!(j.contains("--no-playlist"));
    }

    #[test]
    fn a7_bledy_po_ludzku() {
        for e in [
            "ERROR: unable to download video data: HTTP Error 403: Forbidden",
            "ERROR: [youtube] abc: Sign in to confirm you're not a bot",
            "WARNING: [youtube] nsig extraction failed: Some formats may be missing",
        ] {
            let k = komunikat_bledu(e);
            assert!(k.starts_with(BLOKADA), "{k}");
            assert!(k.ends_with(e), "surowy błąd zostaje do raportu");
        }
        assert!(komunikat_bledu("ERROR: Unsupported URL: https://example.com/").starts_with("Ten adres"));
        assert!(komunikat_bledu("ERROR: [youtube] x: Sign in to confirm your age").starts_with("Film z ograniczeniem"));
        assert!(komunikat_bledu("ERROR: [youtube] x: Private video").starts_with("To prywatny film"));
        assert!(komunikat_bledu("ERROR: x: Join this channel to get access to members-only content")
            .starts_with("Film tylko dla"));
        assert!(komunikat_bledu("ERROR: The uploader has not made this video available in your country")
            .starts_with("Film niedostępny"));
        assert!(komunikat_bledu("ERROR: This live event will begin in 2 hours").starts_with("Transmisja"));
        assert!(komunikat_bledu("ERROR: Requested format is not available").starts_with("Serwis nie podał"));
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
