//! ffprobe → `Media`: czas, strumienie, wymiary. Parser jest czystą funkcją
//! (testowalną na zapisanym JSON), uruchamianie procesu jest osobno.

use crate::blad;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::path::Path;

/// Charakterystyka przenoszenia HDR (z `color_transfer`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Hdr {
    /// smpte2084 (HDR10, Dolby Vision profil 8.1, iPhone w trybie HDR10)
    Pq,
    /// arib-std-b67 (HLG: iPhone, Android)
    Hlg,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct StrumienWideo {
    /// Indeks strumienia w pliku (do `-map 0:N`).
    #[serde(default)]
    pub indeks: u32,
    pub kodek: String,
    /// Wymiary po uwzględnieniu obrotu z metadanych (tak, jak widać film).
    pub w: u32,
    pub h: u32,
    pub fps: Option<f64>,
    pub kbps: Option<u32>,
    #[serde(default)]
    pub piksele: Option<String>,
    /// Bity na składową (8, 10, 12).
    #[serde(default)]
    pub bity: Option<u8>,
    #[serde(default)]
    pub hdr: Option<Hdr>,
    /// Obrót z metadanych (display matrix / tag rotate), w stopniach zgodnie z ruchem wskazówek: 0/90/180/270.
    #[serde(default)]
    pub obrot: u16,
    /// Zmienna liczba klatek (r_frame_rate wyraźnie różne od avg_frame_rate).
    #[serde(default)]
    pub vfr: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct StrumienAudio {
    #[serde(default)]
    pub indeks: u32,
    pub kodek: String,
    pub hz: Option<u32>,
    pub kanaly: Option<u8>,
    pub kbps: Option<u32>,
    #[serde(default)]
    pub jezyk: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct StrumienNapisow {
    pub indeks: u32,
    pub kodek: String,
    #[serde(default)]
    pub jezyk: Option<String>,
    /// Tekstowe (SRT, ASS, mov_text, WebVTT) da się przerobić; obrazkowe (PGS, VobSub) nie.
    pub tekstowe: bool,
}

pub const NAPISY_TEKSTOWE: &[&str] = &["subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Media {
    pub czas_s: Option<f64>,
    pub rozmiar_b: Option<u64>,
    pub kbps: Option<u32>,
    pub format: Option<String>,
    pub wideo: Option<StrumienWideo>,
    /// Pierwsza ścieżka dźwięku (skrót do `sciezki_audio[0]`).
    pub audio: Option<StrumienAudio>,
    /// Wszystkie ścieżki dźwięku w kolejności z pliku.
    #[serde(default)]
    pub sciezki_audio: Vec<StrumienAudio>,
    #[serde(default)]
    pub napisy: Vec<StrumienNapisow>,
    /// Plik audio z okładką (attached_pic), np. MP3 z obrazkiem.
    #[serde(default)]
    pub okladka: bool,
    /// Pojedyncza klatka (PNG, JPG, WebP...), nie film.
    #[serde(default)]
    pub obraz: bool,
}

impl Media {
    /// Czas wyniku po cięciu i zmianie prędkości.
    pub fn czas_wyniku(&self, ciecie: Option<&crate::ustawienia::Ciecie>, predkosc: f32) -> Option<f64> {
        let calosc = self.czas_s;
        let czas = match ciecie {
            Some(c) => match (c.koniec, calosc) {
                (Some(k), Some(cal)) => Some(k.min(cal) - c.od),
                (Some(k), None) => Some(k - c.od),
                (None, Some(cal)) => Some(cal - c.od),
                (None, None) => None,
            },
            None => calosc,
        }?;
        let p = if predkosc > 0.0 { predkosc as f64 } else { 1.0 };
        (czas > 0.0).then_some(czas / p)
    }
}

fn liczba(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn ulamek(s: Option<&Value>) -> Option<f64> {
    let s = s?.as_str()?;
    let (a, b) = s.split_once('/')?;
    let (a, b): (f64, f64) = (a.parse().ok()?, b.parse().ok()?);
    (a > 0.0 && b > 0.0).then_some(a / b)
}

/// Obrót do wyświetlenia w stopniach zgodnie z ruchem wskazówek (0/90/180/270).
/// Tag `rotate=90` (stare ffmpeg, telefony) = 90° w prawo; display matrix w ffprobe
/// podaje `rotation` przeciwnie do ruchu wskazówek (np. -90 dla tego samego pliku).
pub fn obrot_strumienia(s: &Value) -> u16 {
    let stopnie = if let Some(r) = s.pointer("/tags/rotate").and_then(|v| liczba(Some(v))) {
        r as i64
    } else {
        s.get("side_data_list")
            .and_then(Value::as_array)
            .and_then(|l| l.iter().find_map(|d| liczba(d.get("rotation"))))
            .map(|r| -(r as i64))
            .unwrap_or(0)
    };
    // zaokrąglenie do wielokrotności 90
    (((stopnie as f64 / 90.0).round() as i64 * 90).rem_euclid(360)) as u16
}

/// Bity na składową z nazwy formatu pikseli: `yuv420p10le` → 10, `p010le` → 10, `yuv420p` → 8.
pub fn bity_z_formatu(pix: &str) -> u8 {
    if pix.starts_with("p010") || pix.contains("p10") || pix.ends_with("10le") || pix.ends_with("10be") {
        10
    } else if pix.contains("p12") || pix.ends_with("12le") || pix.ends_with("12be") || pix.starts_with("p012") {
        12
    } else if pix.contains("p16") || pix.ends_with("16le") || pix.ends_with("16be") {
        16
    } else {
        8
    }
}

fn tekst(s: &Value, klucz: &str) -> Option<String> {
    s.get(klucz).and_then(Value::as_str).filter(|t| !t.is_empty() && *t != "unknown").map(String::from)
}

/// Parsuje wynik `ffprobe -print_format json -show_format -show_streams`.
pub fn media_z_json(json: &str) -> Result<Media, String> {
    let v: Value =
        serde_json::from_str(json).map_err(|e| blad::kod("zly_json", &[("program", &"ffprobe"), ("blad", &e)]))?;
    let format = v.get("format");
    let strumienie = v.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut media = Media {
        czas_s: format.and_then(|f| liczba(f.get("duration"))).filter(|c| *c > 0.0),
        rozmiar_b: format.and_then(|f| liczba(f.get("size"))).map(|x| x as u64),
        kbps: format.and_then(|f| liczba(f.get("bit_rate"))).map(|b| (b / 1000.0).round() as u32),
        format: format.and_then(|f| f.get("format_name")).and_then(Value::as_str).map(String::from),
        ..Default::default()
    };

    for (pozycja, s) in strumienie.iter().enumerate() {
        let typ = s.get("codec_type").and_then(Value::as_str).unwrap_or("");
        let kodek = s.get("codec_name").and_then(Value::as_str).unwrap_or("?").to_string();
        let indeks = liczba(s.get("index")).map(|i| i as u32).unwrap_or(pozycja as u32);
        let jezyk = s.pointer("/tags/language").and_then(Value::as_str).filter(|j| *j != "und").map(String::from);
        let okladka = s.pointer("/disposition/attached_pic").and_then(Value::as_i64) == Some(1);
        match typ {
            "video" if okladka => media.okladka = true,
            "video" if media.wideo.is_none() => {
                let mut w = liczba(s.get("width")).unwrap_or(0.0) as u32;
                let mut h = liczba(s.get("height")).unwrap_or(0.0) as u32;
                let obrot = obrot_strumienia(s);
                if obrot % 180 == 90 {
                    std::mem::swap(&mut w, &mut h);
                }
                let srednie = ulamek(s.get("avg_frame_rate"));
                let bazowe = ulamek(s.get("r_frame_rate"));
                let fps = srednie.or(bazowe);
                let vfr = match (srednie, bazowe) {
                    (Some(a), Some(r)) => (a - r).abs() / r > 0.01,
                    _ => false,
                };
                let piksele = tekst(s, "pix_fmt");
                let bity = liczba(s.get("bits_per_raw_sample"))
                    .map(|b| b as u8)
                    .filter(|b| *b > 0)
                    .or_else(|| piksele.as_deref().map(bity_z_formatu));
                let hdr = match tekst(s, "color_transfer").as_deref() {
                    Some("smpte2084") => Some(Hdr::Pq),
                    Some("arib-std-b67") => Some(Hdr::Hlg),
                    _ => None,
                };
                media.wideo = Some(StrumienWideo {
                    indeks,
                    kodek,
                    w,
                    h,
                    fps: fps.filter(|f| *f < 1000.0),
                    kbps: liczba(s.get("bit_rate")).map(|b| (b / 1000.0).round() as u32),
                    piksele,
                    bity,
                    hdr,
                    obrot,
                    vfr,
                });
            }
            "audio" => {
                media.sciezki_audio.push(StrumienAudio {
                    indeks,
                    kodek,
                    hz: liczba(s.get("sample_rate")).map(|x| x as u32),
                    kanaly: liczba(s.get("channels")).map(|x| x as u8),
                    kbps: liczba(s.get("bit_rate")).map(|b| (b / 1000.0).round() as u32),
                    jezyk,
                });
            }
            "subtitle" => {
                let tekstowe = NAPISY_TEKSTOWE.contains(&kodek.as_str());
                media.napisy.push(StrumienNapisow { indeks, kodek, jezyk, tekstowe });
            }
            _ => {}
        }
    }
    media.audio = media.sciezki_audio.first().cloned();

    let nazwa_formatu = media.format.clone().unwrap_or_default();
    let format_obrazu = nazwa_formatu.contains("image2")
        || nazwa_formatu.ends_with("_pipe")
        || nazwa_formatu == "ico"
        || nazwa_formatu == "bmp";
    media.obraz = media.wideo.is_some() && media.audio.is_none() && format_obrazu;
    if media.obraz {
        media.czas_s = None;
    }
    Ok(media)
}

/// Argumenty jako OsString: ścieżka trafia do procesu bez przeróbek (polskie znaki,
/// CJK, emoji), nigdy przez powłokę.
pub fn argumenty_ffprobe(plik: &Path) -> Vec<OsString> {
    let mut a: Vec<OsString> =
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams"].map(OsString::from).to_vec();
    a.push(plik.as_os_str().to_os_string());
    a
}

/// Uruchamia ffprobe i zwraca `Media`.
pub async fn sonduj(ffprobe: &Path, plik: &Path) -> Result<Media, String> {
    let wynik = crate::procesy::komenda(ffprobe)
        .args(argumenty_ffprobe(plik))
        .output()
        .await
        .map_err(|e| blad::kod("uruchomienie", &[("program", &"ffprobe"), ("blad", &e)]))?;
    if !wynik.status.success() {
        let blad = String::from_utf8_lossy(&wynik.stderr);
        return Err(format!("ffprobe: {}", blad.trim()));
    }
    media_z_json(&String::from_utf8_lossy(&wynik.stdout))
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn parsuje_film_z_obrotem() {
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"30000/1001",
             "side_data_list":[{"rotation":-90}]},
            {"codec_type":"audio","codec_name":"aac","sample_rate":"48000","channels":2,"bit_rate":"128000"}],
            "format":{"duration":"12.5","size":"1000000","bit_rate":"640000","format_name":"mov,mp4,m4a,3gp,3g2,mj2"}}"#;
        let m = media_z_json(json).unwrap();
        let w = m.wideo.unwrap();
        assert_eq!((w.w, w.h), (1080, 1920));
        assert_eq!(w.obrot, 90);
        assert!((w.fps.unwrap() - 29.97).abs() < 0.01);
        assert_eq!(m.audio.unwrap().kbps, Some(128));
        assert_eq!(m.czas_s, Some(12.5));
        assert!(!m.obraz);
    }

    #[test]
    fn rozpoznaje_obraz() {
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"png","width":640,"height":480,
            "avg_frame_rate":"0/0"}],"format":{"format_name":"png_pipe","duration":"0.04"}}"#;
        let m = media_z_json(json).unwrap();
        assert!(m.obraz);
        assert_eq!(m.czas_s, None);
    }

    #[test]
    fn czas_wyniku_uwzglednia_ciecie_i_predkosc() {
        let m = Media { czas_s: Some(100.0), ..Default::default() };
        let c = crate::ustawienia::Ciecie { od: 10.0, koniec: Some(30.0) };
        assert_eq!(m.czas_wyniku(Some(&c), 2.0), Some(10.0));
        assert_eq!(m.czas_wyniku(None, 1.0), Some(100.0));
    }

    #[test]
    fn hdr_10bit_sciezki_napisy_okladka() {
        let json = r#"{"streams":[
            {"index":0,"codec_type":"video","codec_name":"hevc","width":3840,"height":2160,"pix_fmt":"yuv420p10le",
             "color_transfer":"arib-std-b67","avg_frame_rate":"30/1","r_frame_rate":"60/1"},
            {"index":1,"codec_type":"audio","codec_name":"aac","sample_rate":"48000","channels":2,"tags":{"language":"pol"}},
            {"index":2,"codec_type":"audio","codec_name":"ac3","sample_rate":"48000","channels":6,"tags":{"language":"eng"}},
            {"index":3,"codec_type":"subtitle","codec_name":"subrip"},
            {"index":4,"codec_type":"subtitle","codec_name":"hdmv_pgs_subtitle"}],
            "format":{"duration":"5","format_name":"matroska,webm"}}"#;
        let m = media_z_json(json).unwrap();
        let w = m.wideo.as_ref().unwrap();
        assert_eq!(w.hdr, Some(Hdr::Hlg));
        assert_eq!(w.bity, Some(10));
        assert!(w.vfr);
        assert_eq!(m.sciezki_audio.len(), 2);
        assert_eq!(m.audio.as_ref().unwrap().indeks, 1);
        assert_eq!(m.sciezki_audio[1].jezyk.as_deref(), Some("eng"));
        assert_eq!(m.napisy.iter().map(|n| n.tekstowe).collect::<Vec<_>>(), vec![true, false]);

        let mp3 = r#"{"streams":[{"index":0,"codec_type":"audio","codec_name":"mp3","sample_rate":"44100","channels":2},
            {"index":1,"codec_type":"video","codec_name":"mjpeg","width":500,"height":500,"disposition":{"attached_pic":1}}],
            "format":{"duration":"200","format_name":"mp3"}}"#;
        let m = media_z_json(mp3).unwrap();
        assert!(m.okladka);
        assert!(m.wideo.is_none());
        assert!(!m.obraz);
    }

    #[test]
    fn obrot_tag_i_macierz() {
        let tag: Value = serde_json::from_str(r#"{"tags":{"rotate":"90"}}"#).unwrap();
        let macierz: Value = serde_json::from_str(r#"{"side_data_list":[{"rotation":-90}]}"#).unwrap();
        let w_lewo: Value = serde_json::from_str(r#"{"side_data_list":[{"rotation":90}]}"#).unwrap();
        assert_eq!(obrot_strumienia(&tag), 90);
        assert_eq!(obrot_strumienia(&macierz), 90);
        assert_eq!(obrot_strumienia(&w_lewo), 270);
        assert_eq!(bity_z_formatu("yuv420p"), 8);
        assert_eq!(bity_z_formatu("p010le"), 10);
        assert_eq!(bity_z_formatu("yuv422p12le"), 12);
    }
}
