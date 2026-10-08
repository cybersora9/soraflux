//! Ustawienia apki: jeden plik JSON w katalogu konfiguracji systemu
//! (Windows: %APPDATA%\SoraConverter\konfig.json). Zero telemetrii.

use crate::narzedzia::Sciezki;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

fn dwa() -> usize {
    2
}
fn jeden() -> usize {
    1
}
fn tak() -> bool {
    true
}
fn ciemny() -> String {
    "dark".into()
}
fn motyw_domyslny() -> String {
    "sora-a".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Konfig {
    /// "pl" | "en"; `None` = wg systemu.
    #[serde(default)]
    pub jezyk: Option<String>,
    /// "dark" | "light" | "system"
    #[serde(default = "ciemny")]
    pub motyw: String,
    #[serde(default = "dwa")]
    pub rownolegle: usize,
    /// Ile zadań wideo naraz (słaby procesor: 1). Obrazy się nie liczą.
    #[serde(default = "jeden")]
    pub rownolegle_wideo: usize,
    /// „Nie zamulaj komputera”: ffmpeg z priorytetem poniżej normalnego.
    #[serde(default)]
    pub niski_priorytet: bool,
    /// `None` = obok pliku źródłowego.
    #[serde(default)]
    pub katalog_wyjscia: Option<PathBuf>,
    /// `None` = systemowy katalog Pobrane.
    #[serde(default)]
    pub katalog_pobierania: Option<PathBuf>,
    /// Wykrywanie linku w schowku przy powrocie do okna.
    #[serde(default = "tak")]
    pub schowek: bool,
    /// Ręcznie wskazane ścieżki narzędzi.
    #[serde(default)]
    pub sciezki: Sciezki,
    /// Kreator pierwszego uruchomienia już pokazany.
    #[serde(default)]
    pub kreator_zakonczony: bool,
    /// Motyw wyglądu (id z `motywy.ts` albo własnego); domyślnie Kissaten · cybersora.
    /// W konfigu, nie w localStorage: działa w trybie przenośnym (E30) i przy zmianie identyfikatora apki.
    #[serde(default = "motyw_domyslny")]
    pub motyw_wyglad: String,
    /// Własne motywy (kształt `MotywWlasny` z frontu; Rust ich nie interpretuje).
    #[serde(default)]
    pub wlasne_motywy: Vec<serde_json::Value>,
    /// Ostatnio wybrane foldery zapisu (najnowszy pierwszy, maks. 6).
    #[serde(default)]
    pub ostatnie_foldery: Vec<PathBuf>,
}

impl Default for Konfig {
    fn default() -> Self {
        serde_json::from_str("{}").expect("domyślny konfig")
    }
}

pub const PLIK: &str = "konfig.json";

/// Tryb przenośny: folder `portable` obok pliku `.exe` → konfig, presety, dziennik
/// i pobrane narzędzia lądują w nim (np. na pendrivie), nic w profilu użytkownika.
pub fn katalog_przenosny(katalog_exe: Option<&Path>) -> Option<PathBuf> {
    katalog_exe.map(|k| k.join("portable")).filter(|p| p.is_dir())
}

fn katalog_exe() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf))
}

/// (konfiguracja, dane) dla danego katalogu programu. Czysta logika, testowalna.
pub fn katalogi_dla(katalog_exe: Option<&Path>) -> (PathBuf, PathBuf) {
    if let Some(p) = katalog_przenosny(katalog_exe) {
        return (p.clone(), p);
    }
    (
        dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("SoraConverter"),
        dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("SoraConverter"),
    )
}

pub fn przenosny() -> bool {
    katalog_przenosny(katalog_exe().as_deref()).is_some()
}

pub fn katalog_konfiguracji() -> PathBuf {
    katalogi_dla(katalog_exe().as_deref()).0
}

/// Katalog danych apki (tu lądują pobrane narzędzia, presety i dziennik).
pub fn katalog_danych() -> PathBuf {
    katalogi_dla(katalog_exe().as_deref()).1
}

/// Stara nazwa programu (v1.0): katalog konfiguracji i danych. Sklejana, bo test
/// `nazwa.test.ts` pilnuje, żeby starej nazwy nie było w repo poza historią.
pub const STARA_NAZWA: &str = concat!("Sora", "Flux");

/// Migracja ze starej nazwy (v1.0) przy pierwszym starcie SoraConverter: jeśli nowy katalog nie ma
/// jeszcze konfigu, a stary ma, kopiujemy `konfig.json` i `presety.json` (tylko kopia,
/// stary katalog zostaje nietknięty). Zwraca skopiowane pliki.
pub fn migruj_ze_starej_nazwy(
    stary_konfig: &Path,
    stary_dane: &Path,
    nowy_konfig: &Path,
    nowy_dane: &Path,
) -> Vec<PathBuf> {
    let mut skopiowane = Vec::new();
    if nowy_konfig.join(PLIK).exists() || !stary_konfig.join(PLIK).is_file() {
        return skopiowane;
    }
    let mut kopiuj = |z: PathBuf, do_: PathBuf| {
        if z.is_file() && !do_.exists() {
            if let Some(k) = do_.parent() {
                let _ = std::fs::create_dir_all(k);
            }
            if std::fs::copy(&z, &do_).is_ok() {
                skopiowane.push(do_);
            }
        }
    };
    kopiuj(stary_konfig.join(PLIK), nowy_konfig.join(PLIK));
    kopiuj(stary_dane.join(crate::presety::PLIK), nowy_dane.join(crate::presety::PLIK));
    skopiowane
}

/// Migracja dla bieżącego systemu (pomijana w trybie przenośnym).
pub fn migruj_ze_starej() -> Vec<PathBuf> {
    if przenosny() {
        return vec![];
    }
    let (Some(konf), Some(dane)) = (dirs::config_dir(), dirs::data_dir()) else { return vec![] };
    migruj_ze_starej_nazwy(&konf.join(STARA_NAZWA), &dane.join(STARA_NAZWA), &katalog_konfiguracji(), &katalog_danych())
}

/// Wczytuje konfig; uszkodzony albo brak pliku = domyślne ustawienia.
pub fn wczytaj(katalog: &Path) -> Konfig {
    std::fs::read_to_string(katalog.join(PLIK)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Zapis atomowy: najpierw plik tymczasowy, potem rename.
pub fn zapisz(katalog: &Path, k: &Konfig) -> Result<(), String> {
    std::fs::create_dir_all(katalog).map_err(|e| e.to_string())?;
    let tmp = katalog.join(format!("{PLIK}.tmp"));
    let json = serde_json::to_string_pretty(k).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, katalog.join(PLIK)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn domyslne_i_zapis() {
        let tmp = tempfile::tempdir().unwrap();
        let k = wczytaj(tmp.path());
        assert_eq!(k.rownolegle, 2);
        assert_eq!(k.rownolegle_wideo, 1, "D27: domyślnie jedno wideo naraz");
        assert!(!k.niski_priorytet);
        assert_eq!(k.motyw, "dark");
        assert!(k.schowek);
        assert_eq!(k.katalog_pobierania, None);
        let mut k2 = k.clone();
        k2.rownolegle = 4;
        k2.jezyk = Some("en".into());
        zapisz(tmp.path(), &k2).unwrap();
        assert_eq!(wczytaj(tmp.path()), k2);
    }

    #[test]
    fn e30_tryb_przenosny() {
        let tmp = tempfile::tempdir().unwrap();
        let (k, d) = katalogi_dla(Some(tmp.path()));
        assert!(k.ends_with("SoraConverter") && d.ends_with("SoraConverter"));
        std::fs::create_dir(tmp.path().join("portable")).unwrap();
        let (k, d) = katalogi_dla(Some(tmp.path()));
        assert_eq!(k, tmp.path().join("portable"));
        assert_eq!(d, tmp.path().join("portable"));
    }

    #[test]
    fn wyglad_w_konfigu_z_domyslnymi() {
        // stary konfig (v1.1) bez pól wyglądu: domyślnie Kissaten · cybersora, ciemny
        let k: Konfig = serde_json::from_str(r#"{"motyw":"dark","rownolegle":2}"#).unwrap();
        assert_eq!(k.motyw_wyglad, "sora-a");
        assert_eq!(k.motyw, "dark");
        assert!(k.wlasne_motywy.is_empty() && k.ostatnie_foldery.is_empty());
        let tmp = tempfile::tempdir().unwrap();
        let mut k2 = k.clone();
        k2.motyw_wyglad = "wlasny-x".into();
        k2.wlasne_motywy =
            vec![serde_json::json!({"id": "wlasny-x", "nazwa": "Mój", "baza": "jp-b", "jasny": {}, "ciemny": {}})];
        k2.ostatnie_foldery = vec![PathBuf::from("C:/Wideo/Gotowe")];
        zapisz(tmp.path(), &k2).unwrap();
        assert_eq!(wczytaj(tmp.path()), k2);
    }

    #[test]
    fn migracja_ze_starej_nazwy_tylko_kopia() {
        let tmp = tempfile::tempdir().unwrap();
        let (sk, sd) = (tmp.path().join("Roaming").join(STARA_NAZWA), tmp.path().join("Roaming").join(STARA_NAZWA));
        let (nk, nd) = (tmp.path().join("Roaming/SoraConverter"), tmp.path().join("Roaming/SoraConverter"));
        std::fs::create_dir_all(&sk).unwrap();
        std::fs::write(sk.join(PLIK), r#"{"jezyk":"en","rownolegle":3}"#).unwrap();
        std::fs::write(sd.join(crate::presety::PLIK), "[]").unwrap();
        let w = migruj_ze_starej_nazwy(&sk, &sd, &nk, &nd);
        assert_eq!(w, vec![nk.join(PLIK), nd.join(crate::presety::PLIK)]);
        assert_eq!(wczytaj(&nk).jezyk.as_deref(), Some("en"));
        assert_eq!(wczytaj(&nk).rownolegle, 3);
        assert!(sk.join(PLIK).is_file(), "stary katalog zostaje");
        // drugi start: nic nie nadpisujemy
        std::fs::write(sk.join(PLIK), r#"{"jezyk":"pl"}"#).unwrap();
        assert!(migruj_ze_starej_nazwy(&sk, &sd, &nk, &nd).is_empty());
        assert_eq!(wczytaj(&nk).jezyk.as_deref(), Some("en"));
        // brak starego katalogu: nic
        let pusty = tmp.path().join("inny");
        assert!(migruj_ze_starej_nazwy(&pusty, &pusty, &pusty.join("a"), &pusty.join("b")).is_empty());
    }

    #[test]
    fn uszkodzony_plik_to_domyslne() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join(PLIK), "{zepsute").unwrap();
        assert_eq!(wczytaj(tmp.path()), Konfig::default());
    }
}
