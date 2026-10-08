//! Serce SoraConverter: czyste funkcje `Profil → argumenty ffmpeg`.
//! Bez I/O, bez procesów; wszystko testowalne tabelą przypadków.
//! Argumenty to `OsString`: ścieżki idą do procesu bez przeróbek i bez powłoki.
//!
//! Łańcuch filtrów wideo w stałej kolejności:
//! przycięcie → deinterlace → obrót/odbicie → HDR→SDR → skala (+pasy/rozmycie) → prędkość → fps.
//! (Prędkość przed fps, żeby wynik miał dokładnie żądane fps także przy przyspieszeniu.)
//! Audio: prędkość → loudnorm → aresample.

use crate::sonda::{Hdr, Media};
use crate::ustawienia::*;
use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum BladProfilu {
    #[error("kodek wideo {kodek:?} nie pasuje do kontenera {kontener:?}")]
    NiezgodnyKodekWideo { kodek: KodekWideo, kontener: Kontener },
    #[error("kodek audio {kodek:?} nie pasuje do kontenera {kontener:?}")]
    NiezgodnyKodekAudio { kodek: KodekAudio, kontener: Kontener },
    #[error("docelowy rozmiar za mały: wychodzi {kbps} kb/s wideo (minimum 50)")]
    ZaMalyRozmiar { kbps: i64 },
    #[error("nie znam długości pliku, nie da się policzyć bitrate z rozmiaru")]
    BrakCzasu,
    #[error("kopiowanie strumienia nie łączy się z filtrami (skala, fps, obrót, prędkość...)")]
    KopiaZFiltrami,
    #[error("plik nie ma obrazu")]
    BrakWideo,
    #[error("plik nie ma ani obrazu, ani dźwięku do zapisania")]
    PustyWynik,
    #[error("prędkość poza zakresem 0,25–4")]
    ZlaPredkosc,
    #[error("złe cięcie: koniec musi być po początku")]
    ZleCiecie,
    #[error("bitrate audio poza zakresem 8–320 kb/s")]
    ZlyBitrateAudio,
    #[error("wymiary muszą być większe od zera")]
    ZleWymiary,
}

/// Podpowiedzi dla frontu: nie blokują, tylko informują (albo proponują zmianę).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Podpowiedz {
    /// AAC < 32 kb/s: zaproponuj mono + 16 kHz; Opus brzmi przy tym lepiej.
    MonoNiskiHz { kanaly: u8, hz: u32 },
    /// Koder bez 2 przebiegów: rozmiar MB liczony jednym przebiegiem (mniej dokładnie).
    JedenPrzebieg,
    /// Wymiary zaokrąglone do parzystych (wymóg kodera).
    WymiaryParzyste { w: u32, h: u32 },
    /// Opus przyjmuje tylko 8/12/16/24/48 kHz.
    OpusHz { hz: u32 },
    /// MP3 poniżej 32 kb/s wymaga ≤ 24 kHz.
    Mp3NiskiHz { hz: u32 },
    /// ICO ma najwyżej 256×256.
    IcoMaks256,
    /// HDR zamieniony na SDR (tonemapping), żeby kolory nie wyblakły.
    HdrNaSdr,
    /// Źródło HDR, ale ten build ffmpeg nie ma filtra `zscale`: kolory mogą wyblaknąć.
    HdrBezTonemapowania,
    /// 10 bitów zostaje (świadomy wybór); źródło HDR zachowuje metadane HDR.
    DziesiecBit { hdr: bool },
    /// H.264 i MPEG-4 robimy w 8 bitach (10-bit H.264 prawie nic nie odtwarza).
    DziesiecBitNiedostepne,
    /// Opus w MP4: działa w przeglądarkach i VLC, ale stare odtwarzacze/telefony mogą go nie zagrać.
    Mp4Opus,
    /// Napisy obrazkowe (PGS/VobSub) nie wejdą do tego kontenera: pominięte.
    NapisyPominiete { n: u32 },
    /// Ten kontener nie przyjmuje napisów: pominięte.
    NapisyNieobslugiwane,
    /// Cięcie bez ponownego kodowania: start na najbliższej klatce kluczowej.
    CiecieKlatkaKluczowa,
}

/// Środowisko, w którym plan będzie wykonany: możliwości ffmpeg i katalog na pliki pomocnicze.
#[derive(Debug, Clone, PartialEq)]
pub struct Kontekst {
    /// Build ffmpeg ma filtr `zscale` (zimg), potrzebny do tonemappingu HDR.
    pub zscale: bool,
    /// Katalog tymczasowy zadania (logi 2 przebiegów, paleta GIF). `None` = obok wyniku.
    pub katalog_tmp: Option<PathBuf>,
}

impl Default for Kontekst {
    fn default() -> Self {
        Kontekst { zscale: true, katalog_tmp: None }
    }
}

/// Pełny plan: przebiegi + podpowiedzi + pliki tymczasowe do sprzątnięcia.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub przebiegi: Vec<Vec<OsString>>,
    pub podpowiedzi: Vec<Podpowiedz>,
    pub tymczasowe: Vec<PathBuf>,
}

impl Plan {
    /// Przebiegi jako tekst (podgląd komendy w GUI, testy).
    pub fn jako_tekst(&self) -> Vec<Vec<String>> {
        self.przebiegi.iter().map(|p| p.iter().map(|a| a.to_string_lossy().into_owned()).collect()).collect()
    }
}

/// Interfejs z architektury: lista przebiegów (1 albo 2).
pub fn ffmpeg(
    media: &Media,
    profil: &Profil,
    wejscie: &Path,
    wyjscie: &Path,
) -> Result<Vec<Vec<OsString>>, BladProfilu> {
    plan(media, profil, wejscie, wyjscie).map(|p| p.przebiegi)
}

type Args = Vec<OsString>;

fn os<I: IntoIterator<Item = S>, S: AsRef<OsStr>>(x: I) -> Args {
    x.into_iter().map(|s| s.as_ref().to_os_string()).collect()
}

const OPUS_HZ: [u32; 5] = [8000, 12000, 16000, 24000, 48000];

/// Liczba bez zbędnych zer: 25.0 → "25", 29.97 → "29.97".
pub fn liczba(x: f64) -> String {
    let s = format!("{x:.4}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

fn sciezka(p: &Path) -> OsString {
    p.as_os_str().to_os_string()
}

fn z_dopiskiem(wyjscie: &Path, dopisek: &str) -> PathBuf {
    let mut s = wyjscie.as_os_str().to_os_string();
    s.push(dopisek);
    PathBuf::from(s)
}

/// Ścieżki plików pomocniczych (log 2 przebiegów, paleta GIF). W katalogu tymczasowym
/// zadania, jeśli jest (równoległe zadania 2-pass nie nadpisują sobie `ffmpeg2pass-0.log`).
pub fn plik_logu(wyjscie: &Path, k: &Kontekst) -> PathBuf {
    match &k.katalog_tmp {
        Some(t) => t.join("2pass"),
        None => z_dopiskiem(wyjscie, ".2pass"),
    }
}
pub fn plik_palety(wyjscie: &Path, k: &Kontekst) -> PathBuf {
    match &k.katalog_tmp {
        Some(t) => t.join("paleta.png"),
        None => z_dopiskiem(wyjscie, ".paleta.png"),
    }
}

fn poczatek() -> Args {
    os(["-hide_banner", "-nostdin", "-y", "-loglevel", "warning", "-progress", "pipe:1", "-nostats"])
}

fn wejscie_z_cieciem(arg: &mut Args, profil: &Profil, wejscie: &Path) {
    if let Some(c) = &profil.ciecie {
        if c.od > 0.0 {
            arg.extend(os(["-ss".to_string(), liczba(c.od)]));
        }
        if let Some(k) = c.koniec {
            arg.extend(os(["-t".to_string(), liczba(k - c.od)]));
        }
    }
    arg.extend(["-i".into(), sciezka(wejscie)]);
}

fn sprawdz_wspolne(profil: &Profil) -> Result<(), BladProfilu> {
    if !(0.25..=4.0).contains(&profil.predkosc) {
        return Err(BladProfilu::ZlaPredkosc);
    }
    if let Some(c) = &profil.ciecie {
        if c.od < 0.0 || c.koniec.is_some_and(|k| k <= c.od) {
            return Err(BladProfilu::ZleCiecie);
        }
    }
    Ok(())
}

// ---------- filtry wspólne ----------

fn filtry_geometrii(profil: &Profil) -> Vec<String> {
    let mut f = Vec::new();
    let r = profil.przyciecie;
    if !r.pusta() {
        f.push(format!("crop=w=iw-{}:h=ih-{}:x={}:y={}", r.lewo + r.prawo, r.gora + r.dol, r.lewo, r.gora));
    }
    if profil.deinterlace {
        f.push("bwdif".into());
    }
    match profil.obrot {
        Obrot::Brak => {}
        Obrot::O90 => f.push("transpose=clock".into()),
        Obrot::O180 => f.push("hflip,vflip".into()),
        Obrot::O270 => f.push("transpose=cclock".into()),
    }
    if profil.odbicie.poziomo {
        f.push("hflip".into());
    }
    if profil.odbicie.pionowo {
        f.push("vflip".into());
    }
    f
}

/// Skalowanie do ramki W×H z danym dopasowaniem. `ogranicz` = nie powiększaj.
fn skala_ramki(w: u32, h: u32, dop: &Dopasowanie, skaler: Skaler, ogranicz: bool, parzyste: bool) -> String {
    let fl = skaler.flaga();
    let (ew, eh) =
        if ogranicz { (format!("'min({w},iw)'"), format!("'min({h},ih)'")) } else { (w.to_string(), h.to_string()) };
    let podziel = if parzyste { ":force_divisible_by=2" } else { "" };
    let zmniejsz = format!("scale=w={ew}:h={eh}:force_original_aspect_ratio=decrease{podziel}:flags={fl}");
    match dop {
        Dopasowanie::Proporcje => zmniejsz,
        Dopasowanie::Rozciagnij => format!("scale=w={w}:h={h}:flags={fl}"),
        Dopasowanie::Pasy { kolor } => {
            let kolor = if kolor.trim().is_empty() { "black" } else { kolor.trim() };
            format!("scale=w={w}:h={h}:force_original_aspect_ratio=decrease{podziel}:flags={fl},pad=w={w}:h={h}:x=(ow-iw)/2:y=(oh-ih)/2:color={kolor}")
        }
        Dopasowanie::Przytnij => {
            format!("scale=w={w}:h={h}:force_original_aspect_ratio=increase:flags={fl},crop=w={w}:h={h}")
        }
        Dopasowanie::Rozmycie => format!(
            "split[sf_a][sf_b];[sf_a]scale=w={w}:h={h}:force_original_aspect_ratio=increase:flags=bilinear,crop=w={w}:h={h},boxblur=luma_radius=20:luma_power=2[sf_tlo];\
             [sf_b]scale=w={w}:h={h}:force_original_aspect_ratio=decrease{podziel}:flags={fl}[sf_przod];[sf_tlo][sf_przod]overlay=x=(W-w)/2:y=(H-h)/2"
        ),
    }
}

fn atempo(predkosc: f32) -> Vec<String> {
    let mut t = predkosc as f64;
    let mut f = Vec::new();
    while t > 2.0 {
        f.push("atempo=2".to_string());
        t /= 2.0;
    }
    while t < 0.5 {
        f.push("atempo=0.5".to_string());
        t /= 0.5;
    }
    if (t - 1.0).abs() > 1e-6 {
        f.push(format!("atempo={}", liczba(t)));
    }
    f
}

/// HDR (PQ/HLG) → SDR BT.709: linearyzacja, tonemapping (hable), powrót do BT.709 8 bit.
const TONEMAPPING: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

/// Czy zamieniać HDR na SDR; dopisuje podpowiedź. Zwraca filtr albo `None`.
fn filtr_hdr(media: &Media, zachowaj_hdr: bool, k: &Kontekst, podp: &mut Vec<Podpowiedz>) -> Option<&'static str> {
    media.wideo.as_ref()?.hdr?;
    if zachowaj_hdr {
        return None;
    }
    if k.zscale {
        podp.push(Podpowiedz::HdrNaSdr);
        Some(TONEMAPPING)
    } else {
        podp.push(Podpowiedz::HdrBezTonemapowania);
        None
    }
}

fn znaczniki_bt709() -> Args {
    os(["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"])
}

fn parzysta(x: u32) -> u32 {
    (x / 2 * 2).max(2)
}

// ---------- wideo ----------

fn koder_wideo(kodek: KodekWideo, sprzet: Option<Sprzet>) -> &'static str {
    use KodekWideo::*;
    use Sprzet::*;
    match (kodek, sprzet) {
        (H264, None) => "libx264",
        (H264, Some(Nvenc)) => "h264_nvenc",
        (H264, Some(Qsv)) => "h264_qsv",
        (H264, Some(Amf)) => "h264_amf",
        (H265, None) => "libx265",
        (H265, Some(Nvenc)) => "hevc_nvenc",
        (H265, Some(Qsv)) => "hevc_qsv",
        (H265, Some(Amf)) => "hevc_amf",
        (Av1, None) => "libsvtav1",
        (Av1, Some(Nvenc)) => "av1_nvenc",
        (Av1, Some(Qsv)) => "av1_qsv",
        (Av1, Some(Amf)) => "av1_amf",
        (Vp9, _) => "libvpx-vp9",
        (Mpeg4, _) => "mpeg4",
        (Kopiuj, _) => "copy",
    }
}

/// Czy koder robi prawdziwe 2 przebiegi przez ffmpeg.
fn dwa_przebiegi(koder: &str) -> bool {
    matches!(koder, "libx264" | "libx265" | "libvpx-vp9" | "mpeg4")
}

fn crf_na_qscale(crf: u8) -> u32 {
    (2 + (crf as u32) * 29 / 51).clamp(2, 31)
}

pub fn kbps_audio_szac(audio: Option<&ProfilAudio>, media: &Media) -> u32 {
    let Some(a) = audio else { return 0 };
    if media.audio.is_none() {
        return 0;
    }
    let zrodlo = media.audio.as_ref();
    match a.kodek {
        KodekAudio::Kopiuj => zrodlo.and_then(|s| s.kbps).unwrap_or(128),
        KodekAudio::Flac => 700,
        KodekAudio::Pcm => {
            let hz = a.hz.or(zrodlo.and_then(|s| s.hz)).unwrap_or(48000);
            let ch = a.kanaly.or(zrodlo.and_then(|s| s.kanaly)).unwrap_or(2) as u32;
            hz * ch * 16 / 1000
        }
        _ => a.kbps,
    }
}

/// Bitrate wideo dla docelowego rozmiaru: `rozmiar*8192/czas − audio`
/// (z 3% zapasu na narzut kontenera, żeby „10 MB” naprawdę mieściło się w 10 MB).
pub fn bitrate_z_rozmiaru(mb: f32, czas_s: f64, kbps_audio: u32) -> Result<u32, BladProfilu> {
    let calosc = (mb as f64) * 8192.0 * 0.97 / czas_s;
    let wideo = (calosc - kbps_audio as f64).floor() as i64;
    if wideo < 50 {
        return Err(BladProfilu::ZaMalyRozmiar { kbps: wideo });
    }
    Ok(wideo as u32)
}

struct Wideo {
    filtry: String,
    koder: Args,
    /// (bitrate, koder) gdy potrzebne 2 przebiegi.
    dwa: Option<&'static str>,
}

fn plan_wideo(
    media: &Media,
    profil: &Profil,
    pw: &ProfilWideo,
    k: &Kontekst,
    podp: &mut Vec<Podpowiedz>,
) -> Result<Wideo, BladProfilu> {
    let kontener = profil.kontener;
    if !kontener.kodeki_wideo().contains(&pw.kodek) {
        return Err(BladProfilu::NiezgodnyKodekWideo { kodek: pw.kodek, kontener });
    }
    let parzyste = pw.kodek.parzyste_wymiary();
    let kopia = pw.kodek == KodekWideo::Kopiuj;
    let mozna_10bit = matches!(pw.kodek, KodekWideo::H265 | KodekWideo::Av1 | KodekWideo::Vp9);
    let dziesiec = pw.dziesiec_bit && mozna_10bit;
    if pw.dziesiec_bit && !mozna_10bit && !kopia {
        podp.push(Podpowiedz::DziesiecBitNiedostepne);
    }
    let zrodlo_hdr = media.wideo.as_ref().and_then(|w| w.hdr);
    let zachowaj_hdr = dziesiec && zrodlo_hdr.is_some();
    let mut f = filtry_geometrii(profil);
    let mut tonemapping = false;
    if !kopia {
        if let Some(t) = filtr_hdr(media, zachowaj_hdr, k, podp) {
            f.push(t.into());
            tonemapping = true;
        }
    }
    if dziesiec {
        podp.push(Podpowiedz::DziesiecBit { hdr: zachowaj_hdr });
    }
    let mut przeskalowane = false;
    match &pw.rozdzielczosc {
        Rozdzielczosc::Zachowaj => {}
        Rozdzielczosc::Wysokosc { h } => {
            if *h == 0 {
                return Err(BladProfilu::ZleWymiary);
            }
            let eh = if pw.nie_powiekszaj { format!("'trunc(min({h},ih)/2)*2'") } else { parzysta(*h).to_string() };
            f.push(format!("scale=w=-2:h={eh}:flags={}", pw.skaler.flaga()));
            przeskalowane = true;
        }
        Rozdzielczosc::Wlasna { w, h } => {
            if *w == 0 || *h == 0 {
                return Err(BladProfilu::ZleWymiary);
            }
            let (mut w2, mut h2) = (*w, *h);
            if parzyste && (w % 2 == 1 || h % 2 == 1) {
                (w2, h2) = (parzysta(*w), parzysta(*h));
                podp.push(Podpowiedz::WymiaryParzyste { w: w2, h: h2 });
            }
            f.push(skala_ramki(w2, h2, &pw.dopasowanie, pw.skaler, pw.nie_powiekszaj, parzyste));
            // Rozciągnij/Przytnij/Pasy/Rozmycie dają dokładnie W×H; Proporcje ma force_divisible_by.
            przeskalowane = true;
        }
    }
    if parzyste && !przeskalowane {
        let nieparzyste = media.wideo.as_ref().is_none_or(|w| w.w % 2 == 1 || w.h % 2 == 1);
        if nieparzyste || !profil.przyciecie.pusta() {
            f.push("scale=w='trunc(iw/2)*2':h='trunc(ih/2)*2'".into());
        }
    }
    if (profil.predkosc - 1.0).abs() > 1e-6 {
        f.push(format!("setpts=PTS/{}", liczba(profil.predkosc as f64)));
    }
    if let Fps::Wartosc { fps } = pw.fps {
        f.push(format!("fps={}", liczba(fps as f64)));
    }

    let koder = koder_wideo(pw.kodek, pw.sprzet);
    if koder == "copy" {
        if !f.is_empty() {
            return Err(BladProfilu::KopiaZFiltrami);
        }
        return Ok(Wideo { filtry: String::new(), koder: os(["-c:v", "copy"]), dwa: None });
    }

    let mut a: Vec<String> = vec!["-c:v".into(), koder.into()];
    let sprzetowy = pw.sprzet.is_some() && !matches!(pw.kodek, KodekWideo::Vp9 | KodekWideo::Mpeg4);
    let mut dwa = None;
    let kbps_docelowe = match &pw.jakosc {
        JakoscWideo::Crf { crf } => {
            let crf = *crf;
            match koder {
                "libx264" | "libx265" => a.extend(["-crf".into(), crf.to_string(), "-preset".into(), "medium".into()]),
                "libsvtav1" => a.extend(["-crf".into(), crf.min(63).to_string(), "-preset".into(), "8".into()]),
                "libvpx-vp9" => a.extend([
                    "-crf".into(),
                    crf.min(63).to_string(),
                    "-b:v".into(),
                    "0".into(),
                    "-row-mt".into(),
                    "1".into(),
                ]),
                "mpeg4" => a.extend(["-q:v".into(), crf_na_qscale(crf).to_string()]),
                k if k.ends_with("_nvenc") => {
                    a.extend(["-rc".into(), "vbr".into(), "-cq".into(), crf.to_string(), "-b:v".into(), "0".into()])
                }
                k if k.ends_with("_qsv") => a.extend(["-global_quality".into(), crf.to_string()]),
                _ => a.extend([
                    "-rc".into(),
                    "cqp".into(),
                    "-qp_i".into(),
                    crf.to_string(),
                    "-qp_p".into(),
                    crf.to_string(),
                ]),
            }
            None
        }
        JakoscWideo::Bitrate { kbps } => Some(*kbps),
        JakoscWideo::RozmiarMb { mb } => {
            let czas = media.czas_wyniku(profil.ciecie.as_ref(), profil.predkosc).ok_or(BladProfilu::BrakCzasu)?;
            let audio = if kontener.tylko_audio() { None } else { profil.audio.as_ref() };
            let kbps = bitrate_z_rozmiaru(*mb, czas, kbps_audio_szac(audio, media))?;
            if dwa_przebiegi(koder) {
                dwa = Some(koder);
            } else {
                podp.push(Podpowiedz::JedenPrzebieg);
            }
            Some(kbps)
        }
    };
    if let Some(kbps) = kbps_docelowe {
        a.extend(["-b:v".into(), format!("{kbps}k")]);
        if sprzetowy {
            // Sprzętowe kodery trzymamy w ryzach, żeby rozmiar się zgadzał.
            a.extend(["-maxrate".into(), format!("{kbps}k"), "-bufsize".into(), format!("{}k", kbps * 2)]);
        }
        if koder == "libvpx-vp9" {
            a.extend(["-row-mt".into(), "1".into()]);
        }
    }
    // 8 bit yuv420p domyślnie (telefony, WhatsApp); 10 bit tylko świadomie.
    let pix = match (dziesiec, sprzetowy) {
        (true, true) => "p010le",
        (true, false) => "yuv420p10le",
        (false, _) if koder.ends_with("_qsv") => "nv12",
        (false, _) => "yuv420p",
    };
    a.extend(["-pix_fmt".into(), pix.into()]);
    if pw.kodek == KodekWideo::H265 && matches!(kontener, Kontener::Mp4 | Kontener::Mov) {
        a.extend(["-tag:v".into(), "hvc1".into()]);
    }
    // Zmienny FPS z telefonów: przy „zachowaj” jawny tryb (AVI wymaga stałego).
    if pw.fps == Fps::Zachowaj {
        let tryb = if kontener == Kontener::Avi { "cfr" } else { "vfr" };
        a.extend(["-fps_mode".into(), tryb.into()]);
    }
    let mut a = os(a);
    if tonemapping {
        a.extend(znaczniki_bt709());
    } else if let (true, Some(h)) = (zachowaj_hdr, zrodlo_hdr) {
        let trc = if h == Hdr::Pq { "smpte2084" } else { "arib-std-b67" };
        a.extend(os(["-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", trc]));
    }
    Ok(Wideo { filtry: f.join(","), koder: a, dwa })
}

// ---------- audio ----------

fn plan_audio(
    media: &Media,
    profil: &Profil,
    pa: &ProfilAudio,
    podp: &mut Vec<Podpowiedz>,
) -> Result<Args, BladProfilu> {
    let kontener = profil.kontener;
    if !kontener.kodeki_audio().contains(&pa.kodek) {
        return Err(BladProfilu::NiezgodnyKodekAudio { kodek: pa.kodek, kontener });
    }
    let stratny = matches!(pa.kodek, KodekAudio::Aac | KodekAudio::Mp3 | KodekAudio::Opus | KodekAudio::Vorbis);
    if stratny && !(8..=320).contains(&pa.kbps) {
        return Err(BladProfilu::ZlyBitrateAudio);
    }
    let mut filtry = atempo(profil.predkosc);
    let mut hz = pa.hz;
    match pa.kodek {
        KodekAudio::Aac if pa.kbps < 32 => podp.push(Podpowiedz::MonoNiskiHz { kanaly: 1, hz: 16000 }),
        KodekAudio::Opus => {
            if kontener == Kontener::Mp4 {
                podp.push(Podpowiedz::Mp4Opus);
            }
            if let Some(h) = hz.filter(|h| !OPUS_HZ.contains(h)) {
                let blizsze = *OPUS_HZ.iter().min_by_key(|o| (**o as i64 - h as i64).abs()).unwrap();
                hz = Some(blizsze);
                podp.push(Podpowiedz::OpusHz { hz: blizsze });
            }
        }
        KodekAudio::Mp3 if pa.kbps < 32 && hz.is_none_or(|h| h > 24000) => {
            hz = Some(16000);
            podp.push(Podpowiedz::Mp3NiskiHz { hz: 16000 });
        }
        _ => {}
    }
    if pa.normalizacja {
        filtry.push("loudnorm=I=-16:TP=-1.5:LRA=11".into());
        // loudnorm podbija próbkowanie do 192 kHz, więc wracamy do celu.
        let cel = hz.or(media.audio.as_ref().and_then(|a| a.hz)).unwrap_or(48000);
        let cel = if pa.kodek == KodekAudio::Opus && !OPUS_HZ.contains(&cel) { 48000 } else { cel };
        filtry.push(format!("aresample={cel}"));
    }
    if pa.kodek == KodekAudio::Kopiuj {
        if !filtry.is_empty() {
            return Err(BladProfilu::KopiaZFiltrami);
        }
        return Ok(os(["-c:a", "copy"]));
    }
    let koder = match pa.kodek {
        KodekAudio::Aac => "aac",
        KodekAudio::Mp3 => "libmp3lame",
        KodekAudio::Opus => "libopus",
        KodekAudio::Vorbis => "libvorbis",
        KodekAudio::Flac => "flac",
        KodekAudio::Pcm => "pcm_s16le",
        KodekAudio::Kopiuj => unreachable!(),
    };
    let mut a: Vec<String> = Vec::new();
    if !filtry.is_empty() {
        a.extend(["-af".into(), filtry.join(",")]);
    }
    a.extend(["-c:a".into(), koder.into()]);
    if stratny {
        a.extend(["-b:a".into(), format!("{}k", pa.kbps)]);
    }
    if let Some(h) = hz {
        a.extend(["-ar".into(), h.to_string()]);
    }
    if let Some(k) = pa.kanaly {
        a.extend(["-ac".into(), k.to_string()]);
    }
    Ok(os(a))
}

// ---------- główny plan ----------

/// Plan z domyślnym kontekstem (zscale dostępny, pliki pomocnicze obok wyniku).
pub fn plan(media: &Media, profil: &Profil, wejscie: &Path, wyjscie: &Path) -> Result<Plan, BladProfilu> {
    plan_z(media, profil, wejscie, wyjscie, &Kontekst::default())
}

pub fn plan_z(
    media: &Media,
    profil: &Profil,
    wejscie: &Path,
    wyjscie: &Path,
    kt: &Kontekst,
) -> Result<Plan, BladProfilu> {
    sprawdz_wspolne(profil)?;
    let k = profil.kontener;
    if k == Kontener::Gif && profil.gif.is_some() && !media.obraz {
        return plan_gif(media, profil, wejscie, wyjscie, kt);
    }
    if k == Kontener::Webp && profil.gif.is_some() && !media.obraz {
        return plan_webp_anim(media, profil, wejscie, wyjscie, kt);
    }
    if k.obraz() {
        return plan_obrazu(media, profil, wejscie, wyjscie, kt);
    }
    plan_av(media, profil, wejscie, wyjscie, kt)
}

/// Mapowanie strumieni: obraz (bez okładki), wybrane ścieżki dźwięku, napisy zgodne z kontenerem.
fn mapowanie(media: &Media, profil: &Profil, wideo: bool, audio: bool, podp: &mut Vec<Podpowiedz>) -> Args {
    let mut a: Vec<String> = Vec::new();
    if wideo {
        if let Some(w) = &media.wideo {
            a.extend(["-map".into(), format!("0:{}", w.indeks)]);
        }
    }
    if audio {
        let sciezki: Vec<_> = if media.sciezki_audio.is_empty() {
            media.audio.iter().collect()
        } else {
            media.sciezki_audio.iter().collect()
        };
        let wybrane: Vec<_> = match profil.sciezki_audio {
            WyborAudio::Pierwsza => sciezki.into_iter().take(1).collect(),
            WyborAudio::Wszystkie if !profil.kontener.tylko_audio() => sciezki,
            WyborAudio::Wszystkie => sciezki.into_iter().take(1).collect(),
            WyborAudio::Numer { n } => {
                let i = (n as usize).min(sciezki.len().saturating_sub(1));
                sciezki.into_iter().skip(i).take(1).collect()
            }
        };
        for s in wybrane {
            a.extend(["-map".into(), format!("0:{}", s.indeks)]);
        }
    }
    let k = profil.kontener;
    let mut napisy_ok = 0;
    if profil.napisy && wideo && !media.napisy.is_empty() {
        let mut pominiete = 0;
        match k {
            Kontener::Mkv => {
                for n in &media.napisy {
                    // mov_text nie wchodzi do MKV: zamiana na SRT; reszta kopiowana.
                    let kodek = if n.kodek == "mov_text" { "srt" } else { "copy" };
                    a.extend(["-map".into(), format!("0:{}", n.indeks), format!("-c:s:{napisy_ok}"), kodek.into()]);
                    napisy_ok += 1;
                }
            }
            Kontener::Mp4 | Kontener::Mov | Kontener::Webm => {
                let kodek = if k == Kontener::Webm { "webvtt" } else { "mov_text" };
                for n in &media.napisy {
                    if n.tekstowe {
                        a.extend(["-map".into(), format!("0:{}", n.indeks), format!("-c:s:{napisy_ok}"), kodek.into()]);
                        napisy_ok += 1;
                    } else {
                        pominiete += 1;
                    }
                }
            }
            _ => podp.push(Podpowiedz::NapisyNieobslugiwane),
        }
        if pominiete > 0 {
            podp.push(Podpowiedz::NapisyPominiete { n: pominiete });
        }
    }
    if napisy_ok == 0 {
        a.push("-sn".into());
    }
    os(a)
}

fn plan_av(media: &Media, profil: &Profil, wejscie: &Path, wyjscie: &Path, kt: &Kontekst) -> Result<Plan, BladProfilu> {
    let k = profil.kontener;
    let mut podp = Vec::new();
    let wideo = match (&profil.wideo, k.tylko_audio(), &media.wideo) {
        (Some(pw), false, Some(_)) => Some(plan_wideo(media, profil, pw, kt, &mut podp)?),
        _ => None,
    };
    let audio = match (&profil.audio, &media.audio) {
        (Some(pa), Some(_)) => Some(plan_audio(media, profil, pa, &mut podp)?),
        _ => None,
    };
    if wideo.is_none() && audio.is_none() {
        return Err(BladProfilu::PustyWynik);
    }

    let mut baza = poczatek();
    wejscie_z_cieciem(&mut baza, profil, wejscie);
    let mut wspolne_wideo: Args = Vec::new();
    if let Some(w) = &wideo {
        if !w.filtry.is_empty() {
            wspolne_wideo.extend(os(["-vf", w.filtry.as_str()]));
        }
        wspolne_wideo.extend(w.koder.iter().cloned());
    }
    let mapa_wideo: Args = match (&wideo, &media.wideo) {
        (Some(_), Some(w)) => os(["-map".to_string(), format!("0:{}", w.indeks)]),
        _ => vec![],
    };

    let kopia_wideo = profil.wideo.as_ref().is_some_and(|w| w.kodek == KodekWideo::Kopiuj) || wideo.is_none();
    let kopia_audio = profil.audio.as_ref().is_none_or(|a| a.kodek == KodekAudio::Kopiuj);
    let tylko_kopia = kopia_wideo && kopia_audio && (wideo.is_some() || audio.is_some());
    let mut drugi = baza.clone();
    drugi.extend(mapowanie(media, profil, wideo.is_some(), audio.is_some(), &mut podp));
    if tylko_kopia && profil.ciecie.is_some() {
        // Szybkie cięcie: stream copy zaczyna od klatki kluczowej; znaczniki czasu od zera.
        podp.push(Podpowiedz::CiecieKlatkaKluczowa);
        drugi.extend(os(["-avoid_negative_ts", "make_zero"]));
    }
    drugi.extend(wspolne_wideo.iter().cloned());
    if wideo.is_none() {
        drugi.push("-vn".into());
    }
    match &audio {
        Some(a) => drugi.extend(a.iter().cloned()),
        None => drugi.push("-an".into()),
    }
    drugi.extend(os(["-dn", "-map_metadata", "0"]));
    // MP4/MOV zawsze z faststart: odtwarzanie w przeglądarce i komunikatorach zanim plik się ściągnie.
    if matches!(k, Kontener::Mp4 | Kontener::Mov | Kontener::M4a) {
        drugi.extend(os(["-movflags", "+faststart"]));
    }

    let mut przebiegi = Vec::new();
    let mut tymczasowe = Vec::new();
    if let Some(koder) = wideo.as_ref().and_then(|w| w.dwa) {
        let log = plik_logu(wyjscie, kt);
        let (p1, p2) = flagi_przebiegu(koder, &log);
        let mut pierwszy = baza.clone();
        pierwszy.extend(mapa_wideo);
        pierwszy.extend(wspolne_wideo.iter().cloned());
        pierwszy.extend(p1);
        pierwszy.extend(os(["-an", "-sn", "-dn", "-f", "null", "-"]));
        przebiegi.push(pierwszy);
        // flagi drugiego przebiegu tuż po koderze wideo
        drugi.extend(p2);
        tymczasowe.extend(pliki_logu(koder, &log));
    }
    drugi.push(sciezka(wyjscie));
    przebiegi.push(drugi);
    Ok(Plan { przebiegi, podpowiedzi: podp, tymczasowe })
}

/// Ucieczka ścieżki w `-x265-params` (separatory `:` i `\`, np. `C:\…`), bez utraty
/// znaków spoza UTF-8 (OsString składany z kawałków).
fn ucieczka_x265(s: &OsStr) -> OsString {
    match s.to_str() {
        Some(t) => t.replace('\\', "\\\\").replace(':', "\\:").into(),
        None => s.to_os_string(),
    }
}

fn flagi_przebiegu(koder: &str, log: &Path) -> (Args, Args) {
    let l = sciezka(log);
    if koder == "libx265" {
        let p = |n: u8| {
            let mut v = OsString::from(format!("pass={n}:stats="));
            v.push(ucieczka_x265(&l));
            vec![OsString::from("-x265-params"), v]
        };
        (p(1), p(2))
    } else {
        let p = |n: u8| vec!["-pass".into(), n.to_string().into(), "-passlogfile".into(), l.clone()];
        (p(1), p(2))
    }
}

fn pliki_logu(koder: &str, log: &Path) -> Vec<PathBuf> {
    if koder == "libx265" {
        vec![log.to_path_buf(), z_dopiskiem(log, ".cutree")]
    } else {
        vec![z_dopiskiem(log, "-0.log"), z_dopiskiem(log, "-0.log.mbtree")]
    }
}

fn petla(p: &Petla) -> String {
    match p {
        Petla::Nieskonczona => "0".into(),
        Petla::Brak => "-1".into(),
        Petla::Razy { n } => n.to_string(),
    }
}

fn filtry_animacji(media: &Media, profil: &Profil, g: &ProfilGif, kt: &Kontekst, podp: &mut Vec<Podpowiedz>) -> String {
    let mut f = filtry_geometrii(profil);
    if let Some(t) = filtr_hdr(media, false, kt, podp) {
        f.push(t.into());
    }
    if (profil.predkosc - 1.0).abs() > 1e-6 {
        f.push(format!("setpts=PTS/{}", liczba(profil.predkosc as f64)));
    }
    f.push(format!("fps={}", liczba(g.fps as f64)));
    if g.szerokosc > 0 {
        f.push(format!("scale=w='min({},iw)':h=-1:flags=lanczos", g.szerokosc));
    }
    f.join(",")
}

fn plan_gif(
    media: &Media,
    profil: &Profil,
    wejscie: &Path,
    wyjscie: &Path,
    kt: &Kontekst,
) -> Result<Plan, BladProfilu> {
    if media.wideo.is_none() {
        return Err(BladProfilu::BrakWideo);
    }
    let g = profil.gif.clone().unwrap_or_default();
    let mut podp = Vec::new();
    let lancuch = filtry_animacji(media, profil, &g, kt, &mut podp);
    let paleta = plik_palety(wyjscie, kt);

    let mut p1 = poczatek();
    wejscie_z_cieciem(&mut p1, profil, wejscie);
    p1.extend(os(["-vf".to_string(), format!("{lancuch},palettegen=stats_mode=diff")]));
    p1.extend(os(["-an", "-frames:v", "1", "-update", "1"]));
    p1.push(sciezka(&paleta));

    let dither = match &g.dithering {
        Dithering::Bayer { skala } => format!("bayer:bayer_scale={}", skala.min(&5)),
        Dithering::FloydSteinberg => "floyd_steinberg".into(),
        Dithering::Sierra2_4a => "sierra2_4a".into(),
        Dithering::Brak => "none".into(),
    };
    let mut p2 = poczatek();
    wejscie_z_cieciem(&mut p2, profil, wejscie);
    p2.extend(["-i".into(), sciezka(&paleta)]);
    p2.extend(os([
        "-lavfi".to_string(),
        format!("[0:v]{lancuch}[sf_x];[sf_x][1:v]paletteuse=dither={dither}:diff_mode=rectangle"),
        "-an".into(),
        "-loop".into(),
        petla(&g.petla),
    ]));
    p2.push(sciezka(wyjscie));
    Ok(Plan { przebiegi: vec![p1, p2], podpowiedzi: podp, tymczasowe: vec![paleta] })
}

fn plan_webp_anim(
    media: &Media,
    profil: &Profil,
    wejscie: &Path,
    wyjscie: &Path,
    kt: &Kontekst,
) -> Result<Plan, BladProfilu> {
    if media.wideo.is_none() {
        return Err(BladProfilu::BrakWideo);
    }
    let g = profil.gif.clone().unwrap_or_default();
    let jakosc = profil.obraz.as_ref().map(|o| o.jakosc).unwrap_or(75).clamp(1, 100);
    let mut podp = Vec::new();
    let mut a = poczatek();
    wejscie_z_cieciem(&mut a, profil, wejscie);
    a.extend(os([
        "-vf".into(),
        filtry_animacji(media, profil, &g, kt, &mut podp),
        "-c:v".into(),
        "libwebp_anim".into(),
        "-quality".into(),
        jakosc.to_string(),
        "-loop".into(),
        match g.petla {
            Petla::Nieskonczona => "0".into(),
            Petla::Brak => "1".into(),
            Petla::Razy { n } => n.max(1).to_string(),
        },
        "-an".into(),
    ]));
    a.push(sciezka(wyjscie));
    Ok(Plan { przebiegi: vec![a], podpowiedzi: podp, tymczasowe: vec![] })
}

// ---------- obrazy ----------

fn skala_obrazu(po: &ProfilObrazu, ico: bool, podp: &mut Vec<Podpowiedz>) -> Result<Option<String>, BladProfilu> {
    let fl = po.skaler.flaga();
    let s = match &po.rozmiar {
        RozmiarObrazu::Zachowaj => None,
        RozmiarObrazu::Procent { p } => {
            if *p <= 0.0 {
                return Err(BladProfilu::ZleWymiary);
            }
            let p = if po.nie_powiekszaj { p.min(100.0) } else { *p };
            if (p - 100.0).abs() < 1e-6 {
                None
            } else {
                let p = liczba(p as f64);
                Some(format!("scale=w='max(1,trunc(iw*{p}/100))':h='max(1,trunc(ih*{p}/100))':flags={fl}"))
            }
        }
        RozmiarObrazu::Wymiary { w, h } => match (w, h) {
            (Some(0), _) | (_, Some(0)) => return Err(BladProfilu::ZleWymiary),
            (None, None) => None,
            (Some(w), None) => {
                let ew = if po.nie_powiekszaj { format!("'min({w},iw)'") } else { w.to_string() };
                Some(format!("scale=w={ew}:h=-1:flags={fl}"))
            }
            (None, Some(h)) => {
                let eh = if po.nie_powiekszaj { format!("'min({h},ih)'") } else { h.to_string() };
                Some(format!("scale=w=-1:h={eh}:flags={fl}"))
            }
            (Some(w), Some(h)) => Some(skala_ramki(*w, *h, &po.dopasowanie, po.skaler, po.nie_powiekszaj, false)),
        },
    };
    if !ico {
        return Ok(s);
    }
    let ogranicz = format!("scale=w='min(256,iw)':h='min(256,ih)':force_original_aspect_ratio=decrease:flags={fl}");
    let za_duze = match &po.rozmiar {
        RozmiarObrazu::Wymiary { w, h } => w.unwrap_or(0) > 256 || h.unwrap_or(0) > 256,
        _ => true,
    };
    if za_duze {
        podp.push(Podpowiedz::IcoMaks256);
    }
    Ok(Some(match s {
        Some(s) => format!("{s},{ogranicz}"),
        None => ogranicz,
    }))
}

fn plan_obrazu(
    media: &Media,
    profil: &Profil,
    wejscie: &Path,
    wyjscie: &Path,
    kt: &Kontekst,
) -> Result<Plan, BladProfilu> {
    if media.wideo.is_none() {
        return Err(BladProfilu::BrakWideo);
    }
    let k = profil.kontener;
    let po = profil.obraz.clone().unwrap_or_default();
    let mut podp = Vec::new();
    let mut f = filtry_geometrii(profil);
    if let Some(t) = filtr_hdr(media, false, kt, &mut podp) {
        f.push(t.into());
    }
    if let Some(s) = skala_obrazu(&po, k == Kontener::Ico, &mut podp)? {
        f.push(s);
    }
    let q = po.jakosc.clamp(1, 100) as u32;
    let mut kodek: Vec<String> = match k {
        Kontener::Jpg => {
            f.push("format=yuvj420p".into());
            vec!["-c:v".into(), "mjpeg".into(), "-q:v".into(), (2 + (100 - q) * 29 / 99).to_string()]
        }
        Kontener::Png => vec!["-c:v".into(), "png".into()],
        Kontener::Webp if q >= 100 => vec!["-c:v".into(), "libwebp".into(), "-lossless".into(), "1".into()],
        Kontener::Webp => vec!["-c:v".into(), "libwebp".into(), "-quality".into(), q.to_string()],
        Kontener::Avif => {
            f.push("format=yuv420p".into());
            let crf = (63.0 - q as f64 * 0.55).round().clamp(0.0, 63.0) as u32;
            vec![
                "-c:v".into(),
                "libaom-av1".into(),
                "-still-picture".into(),
                "1".into(),
                "-crf".into(),
                crf.to_string(),
                "-b:v".into(),
                "0".into(),
                "-cpu-used".into(),
                "6".into(),
            ]
        }
        Kontener::Bmp => vec!["-c:v".into(), "bmp".into()],
        Kontener::Ico => {
            f.push("format=rgba".into());
            vec!["-c:v".into(), "png".into()]
        }
        Kontener::Gif => {
            f.push("split[sf_a][sf_b];[sf_a]palettegen[sf_p];[sf_b][sf_p]paletteuse".into());
            vec!["-c:v".into(), "gif".into()]
        }
        _ => unreachable!("plan_obrazu tylko dla formatów obrazów"),
    };
    let mut a = poczatek();
    // Dla obrazów cięcie czasu wybiera klatkę z filmu (np. kadr z 00:01:05).
    if let Some(c) = &profil.ciecie {
        if c.od > 0.0 {
            a.extend(os(["-ss".to_string(), liczba(c.od)]));
        }
    }
    a.extend(["-i".into(), sciezka(wejscie)]);
    if !f.is_empty() {
        a.extend(os(["-vf".to_string(), f.join(",")]));
    }
    a.append(&mut os(kodek.drain(..)));
    a.extend(os(["-an", "-frames:v", "1", "-update", "1"]));
    a.push(sciezka(wyjscie));
    Ok(Plan { przebiegi: vec![a], podpowiedzi: podp, tymczasowe: vec![] })
}

// ---------- podgląd (punkt 4.1) ----------

/// Łańcuch filtrów wideo, którego użyje konwersja (do podglądu jednej klatki).
/// `None` = bez filtrów (obraz jak w źródle). Dla GIF: paleta z tej jednej klatki,
/// żeby było widać dithering. Błąd profilu = ten sam co przy konwersji.
pub fn lancuch_podgladu(media: &Media, profil: &Profil, kt: &Kontekst) -> Result<Option<String>, BladProfilu> {
    if media.wideo.is_none() || (profil.kontener.tylko_audio()) {
        return Err(BladProfilu::BrakWideo);
    }
    if profil.kontener == Kontener::Gif && profil.gif.is_some() && !media.obraz {
        let g = profil.gif.clone().unwrap_or_default();
        let mut podp = Vec::new();
        let lancuch = filtry_animacji(media, profil, &g, kt, &mut podp);
        let dither = match &g.dithering {
            Dithering::Bayer { skala } => format!("bayer:bayer_scale={}", skala.min(&5)),
            Dithering::FloydSteinberg => "floyd_steinberg".into(),
            Dithering::Sierra2_4a => "sierra2_4a".into(),
            Dithering::Brak => "none".into(),
        };
        return Ok(Some(format!(
            "{lancuch},split[sf_p1][sf_p2];[sf_p1]palettegen=stats_mode=single[sf_pal];[sf_p2][sf_pal]paletteuse=dither={dither}"
        )));
    }
    let plan = plan_z(media, profil, Path::new("we"), Path::new("wy"), kt)?;
    let ostatni = plan.przebiegi.last().cloned().unwrap_or_default();
    let vf = ostatni
        .iter()
        .position(|a| a == "-vf")
        .and_then(|i| ostatni.get(i + 1))
        .map(|a| a.to_string_lossy().into_owned());
    Ok(vf)
}

/// Argumenty podglądu jednej klatki z momentu `czas_s`: JPEG ≤ 960 px szerokości.
/// `lancuch = None` = klatka „przed” (tylko autorotacja ffmpeg jak w odtwarzaczu).
pub fn argumenty_klatki(wejscie: &Path, czas_s: Option<f64>, lancuch: Option<&str>, wyjscie: &Path) -> Vec<OsString> {
    let mut a = os(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"]);
    if let Some(t) = czas_s.filter(|t| *t > 0.0) {
        a.extend(os(["-ss".to_string(), liczba(t)]));
    }
    a.extend(["-i".into(), sciezka(wejscie)]);
    let skala = "scale=w='min(960,iw)':h=-2:flags=bicubic,format=yuvj420p";
    let vf = match lancuch {
        Some(l) => format!("{l},{skala}"),
        None => skala.to_string(),
    };
    a.extend(os(["-vf".to_string(), vf]));
    a.extend(os(["-frames:v", "1", "-an", "-sn", "-c:v", "mjpeg", "-q:v", "3", "-f", "image2"]));
    a.push(sciezka(wyjscie));
    a
}

/// Kontener do odsłuchu w przeglądarce (WebView) dla danego kodeku audio.
pub fn kontener_odsluchu(kodek: KodekAudio) -> Kontener {
    match kodek {
        KodekAudio::Aac | KodekAudio::Kopiuj => Kontener::M4a,
        KodekAudio::Mp3 => Kontener::Mp3,
        KodekAudio::Opus => Kontener::Opus,
        KodekAudio::Vorbis => Kontener::Ogg,
        KodekAudio::Flac => Kontener::Flac,
        KodekAudio::Pcm => Kontener::Wav,
    }
}

/// Plan odsłuchu: 5 s dźwięku od `od_s` z dokładnie tymi ustawieniami audio (kodek, bitrate, Hz, kanały).
pub fn plan_odsluchu(
    media: &Media,
    profil: &Profil,
    wejscie: &Path,
    wyjscie: &Path,
    od_s: f64,
    kt: &Kontekst,
) -> Result<Plan, BladProfilu> {
    let mut a = profil.audio.clone().ok_or(BladProfilu::PustyWynik)?;
    if a.kodek == KodekAudio::Kopiuj {
        a = ProfilAudio { kodek: KodekAudio::Aac, kbps: 192, ..a };
    }
    let k = kontener_odsluchu(a.kodek);
    let od = od_s.max(0.0);
    let p = Profil {
        kontener: k,
        wideo: None,
        audio: Some(a),
        obraz: None,
        gif: None,
        ciecie: Some(Ciecie { od, koniec: Some(od + 5.0) }),
        napisy: false,
        sciezki_audio: match profil.sciezki_audio {
            WyborAudio::Wszystkie => WyborAudio::Pierwsza,
            w => w,
        },
        ..profil.clone()
    };
    plan_z(media, &p, wejscie, wyjscie, kt)
}

/// Same podpowiedzi (dla frontu, bez ścieżek).
pub fn podpowiedzi(media: &Media, profil: &Profil) -> Result<Vec<Podpowiedz>, BladProfilu> {
    plan(media, profil, Path::new("wejscie"), Path::new("wyjscie")).map(|p| p.podpowiedzi)
}
