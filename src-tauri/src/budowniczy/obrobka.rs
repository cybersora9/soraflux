//! Narzędzia P1 (GUI 2.0) jako czyste funkcje: wyodrębnianie ścieżek bez kodowania, łączenie klipów
//! (bez kodowania, gdy się da; inaczej filtr `concat`), porównanie przed/po (SSIM, VMAF, głośność).
//! Zmiana kontenera, wyrównanie głośności i kadrowanie to zwykły `Profil` (kopia strumieni,
//! `normalizacja` z pomiarem, `przyciecie`/`obrot`/`odbicie`), więc idą przez `plan_z`.

use super::{liczba, os, poczatek, sciezka, Args};
use crate::sonda::Media;
use crate::ustawienia::{KodekAudio, KodekWideo, Kontener};
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

// ---------- wyodrębnij ścieżki ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RodzajStrumienia {
    Wideo,
    Audio,
    Napisy,
}

/// Jeden strumień do osobnego pliku.
#[derive(Debug, Clone, PartialEq)]
pub struct StrumienDoPliku {
    pub indeks: u32,
    pub rodzaj: RodzajStrumienia,
    pub kodek: String,
    pub jezyk: Option<String>,
    /// Dopisek do nazwy, np. `a1-pl` → `film.a1-pl.m4a`.
    pub dopisek: String,
    pub rozszerzenie: &'static str,
    /// Dodatkowe argumenty kodeka (np. `mov_text` → `srt`); puste = kopia.
    pub kodek_wyjscia: &'static str,
}

/// Rozszerzenie pliku, które przyjmie strumień bez kodowania.
pub fn rozszerzenie_strumienia(rodzaj: RodzajStrumienia, kodek: &str) -> &'static str {
    let k = kodek.to_ascii_lowercase();
    match rodzaj {
        RodzajStrumienia::Wideo => match k.as_str() {
            "h264" | "hevc" | "mpeg4" | "av1" => "mp4",
            "vp8" | "vp9" => "webm",
            _ => "mkv",
        },
        RodzajStrumienia::Audio => match k.as_str() {
            "aac" | "alac" => "m4a",
            "mp3" => "mp3",
            "opus" => "opus",
            "vorbis" => "ogg",
            "flac" => "flac",
            "ac3" => "ac3",
            "eac3" => "eac3",
            k if k.starts_with("pcm_") => "wav",
            _ => "mka",
        },
        RodzajStrumienia::Napisy => match k.as_str() {
            "subrip" | "srt" | "mov_text" | "text" => "srt",
            "ass" | "ssa" => "ass",
            "webvtt" => "vtt",
            "hdmv_pgs_subtitle" => "sup",
            _ => "mks",
        },
    }
}

fn jezyk_do_nazwy(j: Option<&str>) -> Option<String> {
    let j = j?.trim();
    (!j.is_empty() && j != "und" && j.len() <= 8 && j.chars().all(|c| c.is_ascii_alphanumeric()))
        .then(|| j.to_ascii_lowercase())
}

/// Strumienie pliku do wyodrębnienia: obraz (bez okładki), każda ścieżka dźwięku, każde napisy.
pub fn strumienie_do_wyodrebnienia(media: &Media) -> Vec<StrumienDoPliku> {
    let mut wynik = Vec::new();
    if let Some(w) = media.wideo.as_ref().filter(|_| !media.obraz) {
        wynik.push(StrumienDoPliku {
            indeks: w.indeks,
            rodzaj: RodzajStrumienia::Wideo,
            kodek: w.kodek.clone(),
            jezyk: None,
            dopisek: "v1".into(),
            rozszerzenie: rozszerzenie_strumienia(RodzajStrumienia::Wideo, &w.kodek),
            kodek_wyjscia: "",
        });
    }
    let audio: Vec<_> = if media.sciezki_audio.is_empty() {
        media.audio.iter().collect()
    } else {
        media.sciezki_audio.iter().collect()
    };
    for (i, a) in audio.into_iter().enumerate() {
        let j = jezyk_do_nazwy(a.jezyk.as_deref());
        wynik.push(StrumienDoPliku {
            indeks: a.indeks,
            rodzaj: RodzajStrumienia::Audio,
            kodek: a.kodek.clone(),
            dopisek: match &j {
                Some(j) => format!("a{}-{j}", i + 1),
                None => format!("a{}", i + 1),
            },
            jezyk: j,
            rozszerzenie: rozszerzenie_strumienia(RodzajStrumienia::Audio, &a.kodek),
            kodek_wyjscia: "",
        });
    }
    for (i, n) in media.napisy.iter().enumerate() {
        let j = jezyk_do_nazwy(n.jezyk.as_deref());
        wynik.push(StrumienDoPliku {
            indeks: n.indeks,
            rodzaj: RodzajStrumienia::Napisy,
            kodek: n.kodek.clone(),
            dopisek: match &j {
                Some(j) => format!("s{}-{j}", i + 1),
                None => format!("s{}", i + 1),
            },
            jezyk: j,
            rozszerzenie: rozszerzenie_strumienia(RodzajStrumienia::Napisy, &n.kodek),
            // mov_text (MP4) nie wejdzie do .srt jako kopia: zamiana tekstu, bez strat
            kodek_wyjscia: if n.kodek == "mov_text" || n.kodek == "text" { "srt" } else { "" },
        });
    }
    wynik
}

/// Jeden przebieg ffmpeg, wiele wyjść: każdy strumień do swojego pliku, bez kodowania.
pub fn plan_sciezek(wejscie: &Path, wyjscia: &[(StrumienDoPliku, PathBuf)]) -> Vec<OsString> {
    let mut a = poczatek();
    a.extend(["-i".into(), sciezka(wejscie)]);
    for (s, plik) in wyjscia {
        a.extend(os(["-map".to_string(), format!("0:{}", s.indeks)]));
        let kodek = if s.kodek_wyjscia.is_empty() { "copy" } else { s.kodek_wyjscia };
        a.extend(os(["-c", kodek, "-map_metadata", "0"]));
        if s.rozszerzenie == "mp4" || s.rozszerzenie == "m4a" {
            a.extend(os(["-movflags", "+faststart"]));
        }
        a.push(sciezka(plik));
    }
    a
}

// ---------- połącz klipy ----------

/// Kodek wideo z nazwy ffprobe (do sprawdzenia zgodności z kontenerem przy kopii).
pub fn kodek_wideo_z_nazwy(n: &str) -> Option<KodekWideo> {
    Some(match n {
        "h264" => KodekWideo::H264,
        "hevc" => KodekWideo::H265,
        "av1" => KodekWideo::Av1,
        "vp9" => KodekWideo::Vp9,
        "mpeg4" => KodekWideo::Mpeg4,
        _ => return None,
    })
}

pub fn kodek_audio_z_nazwy(n: &str) -> Option<KodekAudio> {
    Some(match n {
        "aac" => KodekAudio::Aac,
        "mp3" => KodekAudio::Mp3,
        "opus" => KodekAudio::Opus,
        "vorbis" => KodekAudio::Vorbis,
        "flac" => KodekAudio::Flac,
        n if n.starts_with("pcm_") => KodekAudio::Pcm,
        _ => return None,
    })
}

/// Czy źródło da się przenieść do kontenera bez kodowania (zmiana kontenera, łączenie kopią).
/// Napisy nie blokują (pominięte albo zamienione przez `mapowanie`).
pub fn kopia_mozliwa(media: &Media, kontener: Kontener) -> bool {
    let wideo_ok = match media.wideo.as_ref().filter(|_| !media.obraz) {
        None => true,
        Some(_) if kontener.tylko_audio() => true,
        Some(w) => kodek_wideo_z_nazwy(&w.kodek).is_some_and(|k| kontener.kodeki_wideo().contains(&k)),
    };
    let audio_ok = media
        .audio
        .as_ref()
        .is_none_or(|a| kodek_audio_z_nazwy(&a.kodek).is_some_and(|k| kontener.kodeki_audio().contains(&k)));
    let cokolwiek = media.audio.is_some() || (media.wideo.is_some() && !kontener.tylko_audio());
    wideo_ok && audio_ok && cokolwiek
}

/// Klipy łączą się bez kodowania (concat demuxer): ten sam kodek, wymiary, piksele, fps obrazu
/// i ten sam kodek, częstotliwość, kanały dźwięku, a kontener przyjmuje te kodeki.
pub fn polacz_bez_kodowania(media: &[Media], kontener: Kontener) -> bool {
    let Some(p) = media.first() else { return false };
    let wideo =
        |m: &Media| m.wideo.as_ref().filter(|_| !m.obraz).map(|w| (w.kodek.clone(), w.w, w.h, w.piksele.clone()));
    let fps = |m: &Media| m.wideo.as_ref().and_then(|w| w.fps);
    let audio = |m: &Media| m.audio.as_ref().map(|a| (a.kodek.clone(), a.hz, a.kanaly));
    media.iter().all(|m| {
        wideo(m) == wideo(p)
            && audio(m) == audio(p)
            && match (fps(m), fps(p)) {
                (Some(a), Some(b)) => (a - b).abs() < 0.01,
                (a, b) => a.is_none() && b.is_none(),
            }
            && kopia_mozliwa(m, kontener)
    })
}

/// Treść listy dla concat demuxera: `file '…'` z ucieczką apostrofu.
pub fn lista_concat(wejscia: &[PathBuf]) -> String {
    wejscia.iter().map(|p| format!("file '{}'\n", p.to_string_lossy().replace('\'', "'\\''"))).collect()
}

/// Łączenie kopią: lista w pliku (`-f concat -safe 0`), wszystko `-c copy`.
pub fn plan_polaczenia_kopia(lista: &Path, wyjscie: &Path, kontener: Kontener) -> Vec<OsString> {
    let mut a = poczatek();
    a.extend(os(["-f", "concat", "-safe", "0", "-i"]));
    a.push(sciezka(lista));
    a.extend(os(["-map", "0:v?", "-map", "0:a?", "-c", "copy", "-map_metadata", "0"]));
    if kontener.tylko_audio() {
        a.push("-vn".into());
    }
    if matches!(kontener, Kontener::Mp4 | Kontener::Mov | Kontener::M4a) {
        a.extend(os(["-movflags", "+faststart"]));
    }
    a.push(sciezka(wyjscie));
    a
}

/// Błąd łączenia z kodowaniem.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum BladLaczenia {
    #[error("potrzeba co najmniej dwóch plików")]
    ZaMaloPlikow,
    #[error("nie znam długości pliku {nr}, nie da się dodać ciszy")]
    BrakCzasu { nr: usize },
    #[error("pliki nie mają ani obrazu, ani dźwięku")]
    PustyWynik,
}

fn koder_audio(k: Kontener) -> (&'static str, Option<&'static str>) {
    match k {
        Kontener::Webm | Kontener::Opus => ("libopus", Some("128k")),
        Kontener::Ogg => ("libvorbis", Some("192k")),
        Kontener::Mp3 | Kontener::Avi => ("libmp3lame", Some("192k")),
        Kontener::Flac => ("flac", None),
        Kontener::Wav => ("pcm_s16le", None),
        _ => ("aac", Some("192k")),
    }
}

/// Łączenie z kodowaniem (różne kodeki, wymiary albo fps): filtr `concat`. Obraz skalowany do ramki
/// pierwszego klipu z pasami, fps pierwszego klipu; brak dźwięku w klipie = cisza tej samej długości.
pub fn plan_polaczenia_kodowanie(
    media: &[Media],
    wejscia: &[PathBuf],
    wyjscie: &Path,
    kontener: Kontener,
) -> Result<Vec<OsString>, BladLaczenia> {
    if media.len() < 2 || media.len() != wejscia.len() {
        return Err(BladLaczenia::ZaMaloPlikow);
    }
    let pierwszy_obraz = media.iter().find_map(|m| m.wideo.as_ref().filter(|_| !m.obraz));
    let z_obrazem = !kontener.tylko_audio() && pierwszy_obraz.is_some();
    let z_dzwiekiem = media.iter().any(|m| m.audio.is_some());
    if !z_obrazem && !z_dzwiekiem {
        return Err(BladLaczenia::PustyWynik);
    }
    let (w, h) = pierwszy_obraz.map(|v| (v.w.max(2) / 2 * 2, v.h.max(2) / 2 * 2)).unwrap_or((1280, 720));
    let fps = pierwszy_obraz.and_then(|v| v.fps).filter(|f| *f > 0.0 && *f <= 240.0).unwrap_or(30.0);
    let mut a = poczatek();
    for p in wejscia {
        a.extend(["-i".into(), sciezka(p)]);
    }
    let mut graf = Vec::new();
    let mut wejscia_concat = String::new();
    for (i, m) in media.iter().enumerate() {
        if z_obrazem {
            if m.wideo.is_some() && !m.obraz {
                graf.push(format!(
                    "[{i}:v:0]scale=w={w}:h={h}:force_original_aspect_ratio=decrease,pad=w={w}:h={h}:x=(ow-iw)/2:y=(oh-ih)/2,setsar=1,fps={},format=yuv420p[v{i}]",
                    liczba(fps)
                ));
            } else {
                let d = m.czas_s.ok_or(BladLaczenia::BrakCzasu { nr: i + 1 })?;
                graf.push(format!("color=c=black:s={w}x{h}:r={}:d={},format=yuv420p[v{i}]", liczba(fps), liczba(d)));
            }
            wejscia_concat.push_str(&format!("[v{i}]"));
        }
        if z_dzwiekiem {
            if m.audio.is_some() {
                graf.push(format!("[{i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}]"));
            } else {
                let d = m.czas_s.ok_or(BladLaczenia::BrakCzasu { nr: i + 1 })?;
                graf.push(format!(
                    "anullsrc=r=48000:cl=stereo,atrim=duration={},aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}]",
                    liczba(d)
                ));
            }
            wejscia_concat.push_str(&format!("[a{i}]"));
        }
    }
    let (v, au) = (u8::from(z_obrazem), u8::from(z_dzwiekiem));
    let mut wyj = String::new();
    if z_obrazem {
        wyj.push_str("[v]");
    }
    if z_dzwiekiem {
        wyj.push_str("[a]");
    }
    graf.push(format!("{wejscia_concat}concat=n={}:v={v}:a={au}{wyj}", media.len()));
    a.extend(os(["-filter_complex".to_string(), graf.join(";")]));
    if z_obrazem {
        a.extend(os(["-map", "[v]"]));
        if kontener == Kontener::Webm {
            a.extend(os(["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1"]));
        } else {
            a.extend(os(["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p"]));
        }
    }
    if z_dzwiekiem {
        a.extend(os(["-map", "[a]"]));
        let (koder, kbps) = koder_audio(kontener);
        a.extend(os(["-c:a", koder]));
        if let Some(b) = kbps {
            a.extend(os(["-b:a", b]));
        }
    }
    if matches!(kontener, Kontener::Mp4 | Kontener::Mov | Kontener::M4a) {
        a.extend(os(["-movflags", "+faststart"]));
    }
    a.push(sciezka(wyjscie));
    Ok(a)
}

// ---------- porównanie przed / po ----------

/// Ile sekund analizujemy przy porównaniu (SSIM/VMAF/głośność): dłuższe pliki tylko na początku.
pub const ANALIZA_S: f64 = 60.0;

fn wejscie_z_limitem(a: &mut Args, p: &Path) {
    a.extend(os(["-t".to_string(), liczba(ANALIZA_S)]));
    a.extend(["-i".into(), sciezka(p)]);
}

/// SSIM (`ssim`) albo VMAF (`libvmaf`): wynik skalowany do wymiarów oryginału, obie klatki yuv420p.
pub fn argumenty_jakosci(oryginal: &Path, wynik: &Path, w: u32, h: u32, vmaf: bool) -> Vec<OsString> {
    let mut a = os(["-hide_banner", "-nostdin", "-loglevel", "info", "-nostats"]);
    wejscie_z_limitem(&mut a, wynik);
    wejscie_z_limitem(&mut a, oryginal);
    let filtr = if vmaf { "libvmaf=n_threads=4" } else { "ssim" };
    let (w, h) = (w.max(2) / 2 * 2, h.max(2) / 2 * 2);
    a.extend(os([
        "-lavfi".to_string(),
        format!(
            "[0:v:0]scale=w={w}:h={h}:flags=bicubic,setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[d];\
             [1:v:0]scale=w={w}:h={h}:flags=bicubic,setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[r];[d][r]{filtr}"
        ),
    ]));
    a.extend(os(["-an", "-sn", "-f", "null", "-"]));
    a
}

/// Pomiar głośności zintegrowanej (LUFS) pliku: `loudnorm` z wydrukiem JSON.
pub fn argumenty_glosnosci(plik: &Path) -> Vec<OsString> {
    let mut a = os(["-hide_banner", "-nostdin", "-loglevel", "info", "-nostats"]);
    wejscie_z_limitem(&mut a, plik);
    a.extend(os(["-map", "0:a:0", "-af", "loudnorm=print_format=json", "-vn", "-sn", "-f", "null", "-"]));
    a
}

fn liczba_po(tekst: &str, znacznik: &str) -> Option<f64> {
    let i = tekst.rfind(znacznik)? + znacznik.len();
    let reszta = tekst[i..].trim_start();
    let koniec = reszta.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-')).unwrap_or(reszta.len());
    reszta[..koniec].parse().ok().filter(|x: &f64| x.is_finite())
}

/// `SSIM Y:… U:… V:… All:0.981234 (17.26)` → 0.981234.
pub fn ssim_z_tekstu(stderr: &str) -> Option<f64> {
    liczba_po(stderr, "All:").filter(|x| (0.0..=1.0).contains(x))
}

/// `VMAF score: 93.123456` → 93.12.
pub fn vmaf_z_tekstu(stderr: &str) -> Option<f64> {
    liczba_po(stderr, "VMAF score:").or_else(|| liczba_po(stderr, "VMAF score =")).filter(|x| (0.0..=100.0).contains(x))
}

#[cfg(test)]
mod testy {
    use super::*;
    use crate::sonda::{StrumienAudio, StrumienNapisow, StrumienWideo};

    fn film(kodek: &str, w: u32, h: u32, fps: f64, audio: Option<&str>) -> Media {
        let a = audio.map(|k| StrumienAudio {
            indeks: 1,
            kodek: k.into(),
            hz: Some(48000),
            kanaly: Some(2),
            ..Default::default()
        });
        Media {
            czas_s: Some(10.0),
            wideo: Some(StrumienWideo {
                indeks: 0,
                kodek: kodek.into(),
                w,
                h,
                fps: Some(fps),
                piksele: Some("yuv420p".into()),
                ..Default::default()
            }),
            sciezki_audio: a.iter().cloned().collect(),
            audio: a,
            ..Default::default()
        }
    }

    #[test]
    fn rozszerzenia_strumieni() {
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Wideo, "h264"), "mp4");
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Wideo, "vp9"), "webm");
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Wideo, "prores"), "mkv");
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Audio, "aac"), "m4a");
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Audio, "pcm_s24le"), "wav");
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Audio, "dts"), "mka");
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Napisy, "mov_text"), "srt");
        assert_eq!(rozszerzenie_strumienia(RodzajStrumienia::Napisy, "hdmv_pgs_subtitle"), "sup");
    }

    #[test]
    fn strumienie_z_jezykami() {
        let mut m = film("h264", 1920, 1080, 25.0, Some("aac"));
        m.sciezki_audio.push(StrumienAudio {
            indeks: 2,
            kodek: "ac3".into(),
            jezyk: Some("pol".into()),
            ..Default::default()
        });
        m.napisy.push(StrumienNapisow {
            indeks: 3,
            kodek: "mov_text".into(),
            jezyk: Some("eng".into()),
            tekstowe: true,
        });
        let s = strumienie_do_wyodrebnienia(&m);
        let d: Vec<_> = s.iter().map(|x| (x.dopisek.as_str(), x.rozszerzenie, x.kodek_wyjscia)).collect();
        assert_eq!(d, vec![("v1", "mp4", ""), ("a1", "m4a", ""), ("a2-pol", "ac3", ""), ("s1-eng", "srt", "srt")]);
        let a = plan_sciezek(
            Path::new("/x/f.mp4"),
            &[(s[0].clone(), "/o/f.v1.part.mp4".into()), (s[3].clone(), "/o/f.s1.srt".into())],
        );
        let t: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        let j = t.join(" ");
        assert!(j.contains("-map 0:0 -c copy -map_metadata 0 -movflags +faststart /o/f.v1.part.mp4"), "{j}");
        assert!(j.contains("-map 0:3 -c srt -map_metadata 0 /o/f.s1.srt"), "{j}");
    }

    #[test]
    fn jezyk_w_nazwie_bezpieczny() {
        assert_eq!(jezyk_do_nazwy(Some("und")), None);
        assert_eq!(jezyk_do_nazwy(Some("../x")), None);
        assert_eq!(jezyk_do_nazwy(Some("PL")), Some("pl".into()));
    }

    #[test]
    fn kopia_i_kontener() {
        let m = film("h264", 1280, 720, 30.0, Some("aac"));
        assert!(kopia_mozliwa(&m, Kontener::Mp4));
        assert!(kopia_mozliwa(&m, Kontener::Mkv));
        assert!(!kopia_mozliwa(&m, Kontener::Webm), "H.264 nie wejdzie do WebM bez kodowania");
        let v = film("vp9", 1280, 720, 30.0, Some("opus"));
        assert!(kopia_mozliwa(&v, Kontener::Webm));
        assert!(!kopia_mozliwa(&v, Kontener::Mov));
    }

    #[test]
    fn laczenie_kopia_tylko_przy_zgodnych() {
        let a = film("h264", 1280, 720, 30.0, Some("aac"));
        assert!(polacz_bez_kodowania(&[a.clone(), a.clone()], Kontener::Mp4));
        let b = film("h264", 1920, 1080, 30.0, Some("aac"));
        assert!(!polacz_bez_kodowania(&[a.clone(), b], Kontener::Mp4));
        let c = film("h264", 1280, 720, 25.0, Some("aac"));
        assert!(!polacz_bez_kodowania(&[a.clone(), c], Kontener::Mp4));
        let d = film("h264", 1280, 720, 30.0, None);
        assert!(!polacz_bez_kodowania(&[a, d], Kontener::Mp4));
    }

    #[test]
    fn lista_concat_z_apostrofem() {
        let l = lista_concat(&["/a/it's.mp4".into(), "/b/zażółć.mp4".into()]);
        assert_eq!(l, "file '/a/it'\\''s.mp4'\nfile '/b/zażółć.mp4'\n");
    }

    #[test]
    fn laczenie_z_kodowaniem_cisza_dla_niemego() {
        let a = film("h264", 1281, 721, 30.0, Some("aac"));
        let b = film("vp9", 640, 480, 25.0, None);
        let args =
            plan_polaczenia_kodowanie(&[a, b], &["a.mp4".into(), "b.webm".into()], Path::new("w.mp4"), Kontener::Mp4)
                .unwrap();
        let j: Vec<String> = args.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        let graf = &j[j.iter().position(|x| x == "-filter_complex").unwrap() + 1];
        assert!(graf.contains("[0:v:0]scale=w=1280:h=720"), "{graf}");
        assert!(graf.contains("[1:v:0]scale=w=1280:h=720"), "{graf}");
        assert!(graf.contains("anullsrc=r=48000:cl=stereo,atrim=duration=10"), "{graf}");
        assert!(graf.ends_with("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"), "{graf}");
        assert!(j.join(" ").contains("-c:v libx264"));
        assert_eq!(
            plan_polaczenia_kodowanie(&[Media::default()], &["a".into()], Path::new("w"), Kontener::Mp4),
            Err(BladLaczenia::ZaMaloPlikow)
        );
    }

    #[test]
    fn parsuje_metryki() {
        assert_eq!(
            ssim_z_tekstu("[Parsed_ssim_4 @ 0x1] SSIM Y:0.98 (17) U:0.99 V:0.99 All:0.981234 (17.26)"),
            Some(0.981234)
        );
        assert_eq!(vmaf_z_tekstu("[libvmaf @ 0x5] VMAF score: 93.123456\n"), Some(93.123456));
        assert_eq!(vmaf_z_tekstu("nic"), None);
        let a = argumenty_jakosci(Path::new("o.mp4"), Path::new("w.mp4"), 1921, 1080, true);
        let j = a.iter().map(|x| x.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");
        assert!(j.contains("-t 60 -i w.mp4 -t 60 -i o.mp4"), "{j}");
        assert!(j.contains("scale=w=1920:h=1080") && j.contains("libvmaf"), "{j}");
    }
}
