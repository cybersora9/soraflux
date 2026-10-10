//! Tryb Napisy (S5): lokalna zamiana mowy na tekst przez whisper.cpp (MIT), uruchamiany jako
//! osobny proces jak ffmpeg i yt-dlp. Bez sieci poza pobraniem modelu za wyraźną zgodą użytkownika.
//!
//! Przebieg zadania (wykonuje `kolejka.rs`): ffprobe → ffmpeg wycina dźwięk do WAV 16 kHz mono
//! (długie pliki we fragmentach, patrz [`plan::fragmenty`]) → whisper-cli zapisuje JSON →
//! [`format`] składa kwestie (maks. znaków w linii, maks. 2 linie) → SRT / VTT, opcjonalnie
//! wypalenie w obraz przez ffmpeg (`ass`, style dla pionowych filmów).
//!
//! Tu są tylko typy i czyste funkcje (testowane bez whispera); procesy uruchamia kolejka.

pub mod format;
pub mod plan;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Język mowy: wykrywany przez whisper albo wskazany (najpierw polski i angielski).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum JezykNapisow {
    #[default]
    Auto,
    Pl,
    En,
}

impl JezykNapisow {
    /// Wartość dla `whisper-cli -l`.
    pub fn kod(self) -> &'static str {
        match self {
            JezykNapisow::Auto => "auto",
            JezykNapisow::Pl => "pl",
            JezykNapisow::En => "en",
        }
    }
}

/// Model whisper.cpp (format ggml). Pobierany na żądanie do katalogu modeli apki.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ModelNapisow {
    #[default]
    Base,
    Small,
    Medium,
    LargeV3Turbo,
}

/// Opis modelu: plik, źródło, przypięta suma SHA-256, przybliżone rozmiary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpisModelu {
    pub plik: &'static str,
    pub url: &'static str,
    /// Przypięta suma SHA-256 pliku (małe litery). Pusta = suma niezweryfikowana: apka odmawia
    /// pobrania (`model_bez_sumy`), plik można tylko położyć ręcznie w katalogu modeli.
    /// Uzupełnia się ją skryptem `scripts/sumy-modeli.mjs` (czyta API Hugging Face).
    pub sha256: &'static str,
    /// Rozmiar pliku w MiB (do sprawdzenia miejsca i opisu w GUI; dokładny rozmiar podaje serwer).
    pub rozmiar_mb: u64,
    /// Przybliżona pamięć RAM potrzebna do pracy w MiB (tabela whisper.cpp z zapasem).
    pub ram_mb: u64,
}

/// Źródło modeli: oficjalne repozytorium modeli whisper.cpp na Hugging Face (jedyne miejsce z linkami).
macro_rules! url_modelu {
    ($plik:literal) => {
        concat!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/", $plik)
    };
}
#[cfg(test)]
const URL_MODELI: &str = url_modelu!("");

impl ModelNapisow {
    pub const WSZYSTKIE: [ModelNapisow; 4] =
        [ModelNapisow::Base, ModelNapisow::Small, ModelNapisow::Medium, ModelNapisow::LargeV3Turbo];

    pub fn opis(self) -> OpisModelu {
        // Sumy SHA-256 do uzupełnienia przed wydaniem (patrz `OpisModelu::sha256`): w tej sesji nie było
        // dostępu do Hugging Face, a wpisanie sumy z pamięci byłoby zgadywaniem.
        match self {
            ModelNapisow::Base => OpisModelu {
                plik: "ggml-base.bin",
                url: url_modelu!("ggml-base.bin"),
                sha256: "",
                rozmiar_mb: 142,
                ram_mb: 500,
            },
            ModelNapisow::Small => OpisModelu {
                plik: "ggml-small.bin",
                url: url_modelu!("ggml-small.bin"),
                sha256: "",
                rozmiar_mb: 466,
                ram_mb: 1000,
            },
            ModelNapisow::Medium => OpisModelu {
                plik: "ggml-medium.bin",
                url: url_modelu!("ggml-medium.bin"),
                sha256: "",
                rozmiar_mb: 1463,
                ram_mb: 2300,
            },
            ModelNapisow::LargeV3Turbo => OpisModelu {
                plik: "ggml-large-v3-turbo.bin",
                url: url_modelu!("ggml-large-v3-turbo.bin"),
                sha256: "",
                rozmiar_mb: 1549,
                ram_mb: 2600,
            },
        }
    }

    /// Plik modelu w katalogu modeli apki.
    pub fn sciezka(self, katalog_modeli: &Path) -> PathBuf {
        katalog_modeli.join(self.opis().plik)
    }
}

/// Czy suma ma postać 64 znaków szesnastkowych (małe litery).
pub fn suma_poprawna(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// Ostrzeżenie o pamięci przed startem (nie blokuje: użytkownik może spróbować).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OstrzezenieRam {
    /// Komputer ma mniej RAM-u niż model potrzebuje: prawie na pewno się nie uda.
    ZaMalo,
    /// Wolnej pamięci teraz jest mniej niż potrzeba: system zacznie używać dysku, będzie bardzo wolno.
    Ciasno,
}

/// Porównanie potrzeb modelu z pamięcią komputera (`None` = brak danych albo wystarczy).
pub fn ostrzezenie_ram(
    model: ModelNapisow,
    calkowita_mb: Option<u64>,
    dostepna_mb: Option<u64>,
) -> Option<OstrzezenieRam> {
    let potrzeba = model.opis().ram_mb;
    if calkowita_mb.is_some_and(|c| c < potrzeba) {
        return Some(OstrzezenieRam::ZaMalo);
    }
    if dostepna_mb.is_some_and(|d| d < potrzeba) {
        return Some(OstrzezenieRam::Ciasno);
    }
    None
}

/// Ułożenie napisów: decyduje o długości linii (krótsze dla pionowych filmów).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Uklad {
    Pionowy,
    Poziomy,
}

impl Uklad {
    /// Maks. znaków w linii pliku SRT/VTT (wypalanie liczy własny limit z szerokości obrazu).
    pub fn max_znakow(self) -> usize {
        match self {
            Uklad::Pionowy => 24,
            Uklad::Poziomy => 42,
        }
    }

    /// Z wymiarów obrazu (po obrocie z metadanych); dźwięk bez obrazu = poziomy.
    pub fn z_wymiarow(w: Option<u32>, h: Option<u32>) -> Uklad {
        match (w, h) {
            (Some(w), Some(h)) if h > w => Uklad::Pionowy,
            _ => Uklad::Poziomy,
        }
    }
}

/// Styl wypalonych napisów.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StylNapisow {
    /// Pionowe rolki: duży pogrubiony tekst z obrysem, nad dolną strefą przycisków aplikacji.
    Rolki,
    /// Duży tekst na środku kadru.
    Srodek,
    /// Klasyczne, mniejsze napisy na dole.
    Klasyczny,
}

/// Ustawienia zadania napisów (z frontu).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OpcjeNapisow {
    #[serde(default)]
    pub jezyk: JezykNapisow,
    #[serde(default)]
    pub model: ModelNapisow,
    #[serde(default = "prawda")]
    pub srt: bool,
    #[serde(default)]
    pub vtt: bool,
    /// `Some` = dodatkowo film z wypalonymi napisami (MP4).
    #[serde(default)]
    pub wypal: Option<StylNapisow>,
    /// `None` = z wymiarów filmu.
    #[serde(default)]
    pub uklad: Option<Uklad>,
}

fn prawda() -> bool {
    true
}

impl Default for OpcjeNapisow {
    fn default() -> Self {
        OpcjeNapisow {
            jezyk: JezykNapisow::Auto,
            model: ModelNapisow::Base,
            srt: true,
            vtt: false,
            wypal: None,
            uklad: None,
        }
    }
}

impl OpcjeNapisow {
    /// Czy zadanie cokolwiek zapisze.
    pub fn cokolwiek(&self) -> bool {
        self.srt || self.vtt || self.wypal.is_some()
    }
}

/// Wynik zadania napisów (karta „gotowe”).
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct WynikNapisow {
    /// Język rozpoznany (albo wskazany) przez whisper, np. `pl`.
    pub jezyk: Option<String>,
    /// Liczba kwestii w pliku SRT/VTT.
    pub kwestie: usize,
    /// Wszystkie zapisane pliki (SRT, VTT, film z napisami).
    pub pliki: Vec<PathBuf>,
    /// Plik o domyślnej nazwie już był, więc nowy dostał „ (1)” (nic nie zostało nadpisane).
    pub zmieniona_nazwa: bool,
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn modele_z_oficjalnego_zrodla_i_sumy_puste_albo_poprawne() {
        for m in ModelNapisow::WSZYSTKIE {
            let o = m.opis();
            assert!(o.url.starts_with(URL_MODELI), "{m:?}");
            assert!(o.url.ends_with(o.plik));
            assert!(o.plik.starts_with("ggml-") && o.plik.ends_with(".bin"));
            assert!(o.sha256.is_empty() || suma_poprawna(o.sha256), "{m:?}: zła postać sumy");
            assert!(o.ram_mb > o.rozmiar_mb);
        }
        assert!(suma_poprawna(&"a".repeat(64)));
        assert!(!suma_poprawna(&"A".repeat(64)));
        assert!(!suma_poprawna("abc"));
    }

    #[test]
    fn ostrzezenia_ram() {
        assert_eq!(ostrzezenie_ram(ModelNapisow::Medium, Some(2000), Some(1500)), Some(OstrzezenieRam::ZaMalo));
        assert_eq!(ostrzezenie_ram(ModelNapisow::Medium, Some(16000), Some(1500)), Some(OstrzezenieRam::Ciasno));
        assert_eq!(ostrzezenie_ram(ModelNapisow::Base, Some(16000), Some(8000)), None);
        assert_eq!(ostrzezenie_ram(ModelNapisow::LargeV3Turbo, None, None), None, "brak danych: bez ostrzeżenia");
    }

    #[test]
    fn opcje_domyslne_i_z_jsona() {
        let o: OpcjeNapisow = serde_json::from_str("{}").unwrap_or_default();
        assert_eq!(o, OpcjeNapisow::default());
        assert!(o.srt && o.cokolwiek());
        let o: OpcjeNapisow =
            serde_json::from_str(r#"{"jezyk":"pl","model":"large_v3_turbo","srt":false,"vtt":false,"wypal":"rolki"}"#)
                .unwrap_or_default();
        assert_eq!(o.jezyk.kod(), "pl");
        assert_eq!(o.model, ModelNapisow::LargeV3Turbo);
        assert_eq!(o.wypal, Some(StylNapisow::Rolki));
        assert!(o.cokolwiek());
        assert!(!OpcjeNapisow { srt: false, ..Default::default() }.cokolwiek());
    }

    #[test]
    fn uklad_z_wymiarow() {
        assert_eq!(Uklad::z_wymiarow(Some(1080), Some(1920)), Uklad::Pionowy);
        assert_eq!(Uklad::z_wymiarow(Some(1920), Some(1080)), Uklad::Poziomy);
        assert_eq!(Uklad::z_wymiarow(None, None), Uklad::Poziomy);
        assert!(Uklad::Pionowy.max_znakow() < Uklad::Poziomy.max_znakow());
    }
}
