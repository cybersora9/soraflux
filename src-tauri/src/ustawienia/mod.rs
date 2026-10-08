//! Typy ustawień konwersji. Ten sam kształt JSON ma front (`src/typy.ts`).
//! Enumy z danymi są tagowane polem `typ`, żeby w TS były zwykłymi unią.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Kontener {
    Mp4,
    Mkv,
    Webm,
    Mov,
    Avi,
    Gif,
    Mp3,
    M4a,
    Aac,
    Opus,
    Ogg,
    Flac,
    Wav,
    Webp,
    Png,
    Jpg,
    Avif,
    Bmp,
    Ico,
}

impl Kontener {
    pub const WSZYSTKIE: [Kontener; 19] = [
        Kontener::Mp4,
        Kontener::Mkv,
        Kontener::Webm,
        Kontener::Mov,
        Kontener::Avi,
        Kontener::Gif,
        Kontener::Mp3,
        Kontener::M4a,
        Kontener::Aac,
        Kontener::Opus,
        Kontener::Ogg,
        Kontener::Flac,
        Kontener::Wav,
        Kontener::Webp,
        Kontener::Png,
        Kontener::Jpg,
        Kontener::Avif,
        Kontener::Bmp,
        Kontener::Ico,
    ];

    pub fn rozszerzenie(self) -> &'static str {
        match self {
            Kontener::Mp4 => "mp4",
            Kontener::Mkv => "mkv",
            Kontener::Webm => "webm",
            Kontener::Mov => "mov",
            Kontener::Avi => "avi",
            Kontener::Gif => "gif",
            Kontener::Mp3 => "mp3",
            Kontener::M4a => "m4a",
            Kontener::Aac => "aac",
            Kontener::Opus => "opus",
            Kontener::Ogg => "ogg",
            Kontener::Flac => "flac",
            Kontener::Wav => "wav",
            Kontener::Webp => "webp",
            Kontener::Png => "png",
            Kontener::Jpg => "jpg",
            Kontener::Avif => "avif",
            Kontener::Bmp => "bmp",
            Kontener::Ico => "ico",
        }
    }

    pub fn z_rozszerzenia(ext: &str) -> Option<Kontener> {
        let ext = ext.to_ascii_lowercase();
        let ext = if ext == "jpeg" { "jpg".to_string() } else { ext };
        Kontener::WSZYSTKIE.into_iter().find(|k| k.rozszerzenie() == ext)
    }

    /// Kontener z samym dźwiękiem (wideo zawsze pomijane).
    pub fn tylko_audio(self) -> bool {
        matches!(
            self,
            Kontener::Mp3
                | Kontener::M4a
                | Kontener::Aac
                | Kontener::Opus
                | Kontener::Ogg
                | Kontener::Flac
                | Kontener::Wav
        )
    }

    /// Format obrazu (pojedyncza klatka). GIF i WebP mogą też być animacją.
    pub fn obraz(self) -> bool {
        matches!(
            self,
            Kontener::Webp
                | Kontener::Png
                | Kontener::Jpg
                | Kontener::Avif
                | Kontener::Bmp
                | Kontener::Ico
                | Kontener::Gif
        )
    }

    /// Kodeki wideo, które ten kontener przyjmuje. Jedyne źródło prawdy o zgodności.
    pub fn kodeki_wideo(self) -> &'static [KodekWideo] {
        use KodekWideo::*;
        match self {
            Kontener::Mp4 => &[H264, H265, Av1, Vp9, Mpeg4, Kopiuj],
            Kontener::Mkv => &[H264, H265, Av1, Vp9, Mpeg4, Kopiuj],
            Kontener::Webm => &[Vp9, Av1, Kopiuj],
            Kontener::Mov => &[H264, H265, Mpeg4, Kopiuj],
            Kontener::Avi => &[H264, Mpeg4, Kopiuj],
            _ => &[],
        }
    }

    pub fn kodeki_audio(self) -> &'static [KodekAudio] {
        use KodekAudio::*;
        match self {
            Kontener::Mp4 => &[Aac, Mp3, Opus, Flac, Kopiuj],
            Kontener::Mkv => &[Aac, Mp3, Opus, Vorbis, Flac, Pcm, Kopiuj],
            Kontener::Webm => &[Opus, Vorbis, Kopiuj],
            Kontener::Mov => &[Aac, Mp3, Pcm, Kopiuj],
            Kontener::Avi => &[Mp3, Pcm, Aac, Kopiuj],
            Kontener::Mp3 => &[Mp3, Kopiuj],
            Kontener::M4a => &[Aac, Flac, Kopiuj],
            Kontener::Aac => &[Aac, Kopiuj],
            Kontener::Opus => &[Opus, Kopiuj],
            Kontener::Ogg => &[Vorbis, Opus, Flac, Kopiuj],
            Kontener::Flac => &[Flac, Kopiuj],
            Kontener::Wav => &[Pcm, Kopiuj],
            _ => &[],
        }
    }

    pub fn domyslny_kodek_wideo(self) -> Option<KodekWideo> {
        match self {
            Kontener::Webm => Some(KodekWideo::Vp9),
            Kontener::Avi => Some(KodekWideo::Mpeg4),
            k if !k.kodeki_wideo().is_empty() => Some(KodekWideo::H264),
            _ => None,
        }
    }

    pub fn domyslny_kodek_audio(self) -> Option<KodekAudio> {
        match self {
            Kontener::Mp4 | Kontener::Mkv | Kontener::Mov | Kontener::M4a | Kontener::Aac => Some(KodekAudio::Aac),
            Kontener::Webm | Kontener::Opus => Some(KodekAudio::Opus),
            Kontener::Avi | Kontener::Mp3 => Some(KodekAudio::Mp3),
            Kontener::Ogg => Some(KodekAudio::Vorbis),
            Kontener::Flac => Some(KodekAudio::Flac),
            Kontener::Wav => Some(KodekAudio::Pcm),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum KodekWideo {
    H264,
    H265,
    Av1,
    Vp9,
    Mpeg4,
    Kopiuj,
}

impl KodekWideo {
    /// Czy koder wymaga parzystych wymiarów (yuv420p).
    pub fn parzyste_wymiary(self) -> bool {
        !matches!(self, KodekWideo::Kopiuj)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum KodekAudio {
    Aac,
    Mp3,
    Opus,
    Vorbis,
    Flac,
    Pcm,
    Kopiuj,
}

/// Enkoder sprzętowy (wykrywany z `ffmpeg -encoders`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Sprzet {
    Nvenc,
    Qsv,
    Amf,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Rozdzielczosc {
    Zachowaj,
    Wysokosc { h: u32 },
    Wlasna { w: u32, h: u32 },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Dopasowanie {
    /// Zmieść w ramce, zachowując proporcje (wynik może być mniejszy niż ramka).
    Proporcje,
    Rozciagnij,
    /// Zmieść i dopełnij pasami w kolorze (np. `black`, `white`, `#202020`).
    Pasy {
        kolor: String,
    },
    /// Zmieść, tło z rozmytego obrazu zamiast pasów.
    Rozmycie,
    /// Wypełnij ramkę i przytnij nadmiar.
    Przytnij,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Skaler {
    Lanczos,
    Bicubic,
    Bilinear,
    Neighbor,
}

impl Skaler {
    pub fn flaga(self) -> &'static str {
        match self {
            Skaler::Lanczos => "lanczos",
            Skaler::Bicubic => "bicubic",
            Skaler::Bilinear => "bilinear",
            Skaler::Neighbor => "neighbor",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Fps {
    Zachowaj,
    Wartosc { fps: f32 },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum JakoscWideo {
    /// 0–51 (niżej = lepiej). Dla AV1 skala 0–63.
    Crf {
        crf: u8,
    },
    Bitrate {
        kbps: u32,
    },
    /// Docelowy rozmiar pliku w MB → bitrate liczony z czasu, 2 przebiegi.
    RozmiarMb {
        mb: f32,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfilWideo {
    pub kodek: KodekWideo,
    pub rozdzielczosc: Rozdzielczosc,
    pub dopasowanie: Dopasowanie,
    #[serde(default)]
    pub nie_powiekszaj: bool,
    pub skaler: Skaler,
    pub fps: Fps,
    pub jakosc: JakoscWideo,
    #[serde(default)]
    pub sprzet: Option<Sprzet>,
    /// 10 bitów tylko świadomie (H.265/AV1/VP9); domyślnie 8 bitów yuv420p,
    /// bo 10 bitów nie gra na wielu telefonach i w komunikatorach.
    #[serde(default)]
    pub dziesiec_bit: bool,
}

impl Default for ProfilWideo {
    fn default() -> Self {
        ProfilWideo {
            kodek: KodekWideo::H264,
            rozdzielczosc: Rozdzielczosc::Zachowaj,
            dopasowanie: Dopasowanie::Proporcje,
            nie_powiekszaj: false,
            skaler: Skaler::Lanczos,
            fps: Fps::Zachowaj,
            jakosc: JakoscWideo::Crf { crf: 23 },
            sprzet: None,
            dziesiec_bit: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfilAudio {
    pub kodek: KodekAudio,
    /// 8..=320 kb/s (ignorowane dla FLAC/PCM/kopii).
    pub kbps: u32,
    #[serde(default)]
    pub hz: Option<u32>,
    #[serde(default)]
    pub kanaly: Option<u8>,
    #[serde(default)]
    pub normalizacja: bool,
}

impl Default for ProfilAudio {
    fn default() -> Self {
        ProfilAudio { kodek: KodekAudio::Aac, kbps: 160, hz: None, kanaly: None, normalizacja: false }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Petla {
    Nieskonczona,
    Razy { n: u32 },
    Brak,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Dithering {
    /// Mały plik, regularny wzór. Skala 0–5.
    Bayer {
        skala: u8,
    },
    FloydSteinberg,
    Sierra2_4a,
    Brak,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfilGif {
    pub fps: f32,
    pub szerokosc: u32,
    pub petla: Petla,
    pub dithering: Dithering,
}

impl Default for ProfilGif {
    fn default() -> Self {
        ProfilGif { fps: 15.0, szerokosc: 480, petla: Petla::Nieskonczona, dithering: Dithering::Sierra2_4a }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum RozmiarObrazu {
    Zachowaj,
    /// Brak jednego wymiaru = liczony z proporcji.
    Wymiary {
        w: Option<u32>,
        h: Option<u32>,
    },
    Procent {
        p: f32,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfilObrazu {
    pub rozmiar: RozmiarObrazu,
    pub dopasowanie: Dopasowanie,
    /// 1–100 dla JPG/WebP/AVIF.
    pub jakosc: u8,
    #[serde(default)]
    pub nie_powiekszaj: bool,
    #[serde(default = "skaler_domyslny")]
    pub skaler: Skaler,
}

fn skaler_domyslny() -> Skaler {
    Skaler::Lanczos
}

impl Default for ProfilObrazu {
    fn default() -> Self {
        ProfilObrazu {
            rozmiar: RozmiarObrazu::Zachowaj,
            dopasowanie: Dopasowanie::Proporcje,
            jakosc: 85,
            nie_powiekszaj: true,
            skaler: Skaler::Lanczos,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Ciecie {
    /// Sekundy od początku.
    pub od: f64,
    /// Sekundy od początku; `None` = do końca.
    #[serde(default)]
    pub koniec: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Obrot {
    #[default]
    Brak,
    O90,
    O180,
    O270,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Odbicie {
    #[serde(default)]
    pub poziomo: bool,
    #[serde(default)]
    pub pionowo: bool,
}

/// Przycięcie w pikselach z każdej strony.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Ramka {
    #[serde(default)]
    pub gora: u32,
    #[serde(default)]
    pub dol: u32,
    #[serde(default)]
    pub lewo: u32,
    #[serde(default)]
    pub prawo: u32,
}

impl Ramka {
    pub fn pusta(&self) -> bool {
        self.gora == 0 && self.dol == 0 && self.lewo == 0 && self.prawo == 0
    }
}

fn jeden() -> f32 {
    1.0
}

fn tak() -> bool {
    true
}

/// Które ścieżki dźwięku zabrać, gdy plik ma ich kilka.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum WyborAudio {
    #[default]
    Pierwsza,
    Wszystkie,
    /// Numer ścieżki dźwięku (0 = pierwsza), nie indeks strumienia.
    Numer {
        n: u32,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Profil {
    pub kontener: Kontener,
    /// `None` = bez obrazu (np. MP4→MP3).
    #[serde(default)]
    pub wideo: Option<ProfilWideo>,
    /// `None` = bez dźwięku.
    #[serde(default)]
    pub audio: Option<ProfilAudio>,
    #[serde(default)]
    pub obraz: Option<ProfilObrazu>,
    #[serde(default)]
    pub gif: Option<ProfilGif>,
    #[serde(default)]
    pub ciecie: Option<Ciecie>,
    #[serde(default)]
    pub obrot: Obrot,
    #[serde(default)]
    pub odbicie: Odbicie,
    #[serde(default)]
    pub przyciecie: Ramka,
    #[serde(default)]
    pub deinterlace: bool,
    #[serde(default = "jeden")]
    pub predkosc: f32,
    #[serde(default)]
    pub sciezki_audio: WyborAudio,
    /// Zachowaj napisy, jeśli kontener je przyjmuje (mp4/mov: mov_text, mkv: kopia, webm: WebVTT).
    #[serde(default = "tak")]
    pub napisy: bool,
}

impl Profil {
    /// Rozsądny profil startowy dla kontenera.
    pub fn dla(kontener: Kontener) -> Profil {
        let wideo = kontener.domyslny_kodek_wideo().map(|kodek| ProfilWideo { kodek, ..Default::default() });
        let audio = kontener.domyslny_kodek_audio().map(|kodek| ProfilAudio {
            kodek,
            kbps: if kodek == KodekAudio::Mp3 { 192 } else { 160 },
            ..Default::default()
        });
        let gif = (kontener == Kontener::Gif).then(ProfilGif::default);
        let obraz = (kontener.obraz() && kontener != Kontener::Gif).then(ProfilObrazu::default);
        Profil {
            kontener,
            wideo,
            audio,
            obraz,
            gif,
            ciecie: None,
            obrot: Obrot::Brak,
            odbicie: Odbicie::default(),
            przyciecie: Ramka::default(),
            deinterlace: false,
            predkosc: 1.0,
            sciezki_audio: WyborAudio::Pierwsza,
            napisy: true,
        }
    }
}
