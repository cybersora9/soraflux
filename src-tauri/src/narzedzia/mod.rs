//! Zewnętrzne narzędzia: ffmpeg, ffprobe, yt-dlp, deno, whisper.cpp (`whisper-cli`, tryb Napisy).
//! Kolejność wyszukiwania: ścieżka z konfigu → katalog narzędzi apki → PATH.
//! yt-dlp z PATH (np. pip) bywa stary i YouTube odpowiada 403: gdy ma więcej niż
//! [`MAKS_WIEK_YTDLP`] dni, a apka nie ma własnej kopii, pobieramy własną (patrz `ytdlp_decyzja`).

pub mod pobieranie;
pub mod zrodla;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Sciezki {
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    #[serde(default)]
    pub ytdlp: Option<PathBuf>,
    /// Deno: środowisko JS dla yt-dlp (wyzwania YouTube).
    #[serde(default)]
    pub deno: Option<PathBuf>,
    /// whisper.cpp (`whisper-cli`): mowa na tekst w trybie Napisy.
    #[serde(default)]
    pub whisper: Option<PathBuf>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Narzedzie {
    Ffmpeg,
    Ffprobe,
    Ytdlp,
    Deno,
    Whisper,
}

impl Narzedzie {
    pub const WSZYSTKIE: [Narzedzie; 5] =
        [Narzedzie::Ffmpeg, Narzedzie::Ffprobe, Narzedzie::Ytdlp, Narzedzie::Deno, Narzedzie::Whisper];

    pub fn plik(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Narzedzie::Ffmpeg, true) => "ffmpeg.exe",
            (Narzedzie::Ffprobe, true) => "ffprobe.exe",
            (Narzedzie::Ytdlp, true) => "yt-dlp.exe",
            (Narzedzie::Deno, true) => "deno.exe",
            (Narzedzie::Whisper, true) => "whisper-cli.exe",
            (Narzedzie::Ffmpeg, false) => "ffmpeg",
            (Narzedzie::Ffprobe, false) => "ffprobe",
            (Narzedzie::Ytdlp, false) => "yt-dlp",
            (Narzedzie::Deno, false) => "deno",
            (Narzedzie::Whisper, false) => "whisper-cli",
        }
    }

    fn argument_wersji(self) -> &'static [&'static str] {
        match self {
            Narzedzie::Ffmpeg | Narzedzie::Ffprobe => &["-hide_banner", "-version"],
            Narzedzie::Ytdlp | Narzedzie::Deno | Narzedzie::Whisper => &["--version"],
        }
    }
}

impl Sciezki {
    pub fn get(&self, n: Narzedzie) -> Option<&PathBuf> {
        match n {
            Narzedzie::Ffmpeg => self.ffmpeg.as_ref(),
            Narzedzie::Ffprobe => self.ffprobe.as_ref(),
            Narzedzie::Ytdlp => self.ytdlp.as_ref(),
            Narzedzie::Deno => self.deno.as_ref(),
            Narzedzie::Whisper => self.whisper.as_ref(),
        }
    }
    pub fn ustaw(&mut self, n: Narzedzie, p: Option<PathBuf>) {
        match n {
            Narzedzie::Ffmpeg => self.ffmpeg = p,
            Narzedzie::Ffprobe => self.ffprobe = p,
            Narzedzie::Ytdlp => self.ytdlp = p,
            Narzedzie::Deno => self.deno = p,
            Narzedzie::Whisper => self.whisper = p,
        }
    }
}

/// Szuka pliku wykonywalnego w PATH.
pub fn w_path(plik: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(plik)).find(|p| p.is_file())
}

/// Wykrywa narzędzia. `reczne` = ścieżki wskazane przez użytkownika (konfig),
/// `katalogi` = katalogi narzędzi apki (dane apki, obok .exe dla wersji przenośnej).
pub fn wykryj(reczne: &Sciezki, katalogi: &[PathBuf]) -> Sciezki {
    let mut wynik = Sciezki::default();
    for n in Narzedzie::WSZYSTKIE {
        let znalezione = reczne
            .get(n)
            .filter(|p| p.is_file())
            .cloned()
            .or_else(|| katalogi.iter().map(|k| k.join(n.plik())).find(|p| p.is_file()))
            .or_else(|| w_path(n.plik()));
        wynik.ustaw(n, znalezione);
    }
    wynik
}

/// Pierwsza linia `--version` / `-version`, skrócona do samego numeru tam, gdzie się da.
pub fn wersja(n: Narzedzie, sciezka: &Path) -> Option<String> {
    let w = crate::procesy::komenda_sync(sciezka).args(n.argument_wersji()).output().ok()?;
    if !w.status.success() {
        return None;
    }
    Some(wersja_z_tekstu(n, &String::from_utf8_lossy(&w.stdout)))
}

pub fn wersja_z_tekstu(n: Narzedzie, tekst: &str) -> String {
    let pierwsza = tekst.lines().next().unwrap_or("").trim();
    match n {
        // "ffmpeg version 7.1-full_build-www.gyan.dev Copyright…" → "7.1-full_build-www.gyan.dev"
        Narzedzie::Ffmpeg | Narzedzie::Ffprobe => pierwsza.split_whitespace().nth(2).unwrap_or(pierwsza).to_string(),
        // "deno 2.5.1 (stable, release, x86_64-pc-windows-msvc)" → "2.5.1"
        Narzedzie::Deno => pierwsza.split_whitespace().nth(1).unwrap_or(pierwsza).to_string(),
        // "whisper.cpp version: 1.8.2" → "1.8.2"
        Narzedzie::Whisper => pierwsza.rsplit(' ').next().unwrap_or(pierwsza).to_string(),
        // "2026.09.30" (albo "2026.09.30.232839" z kanału nightly)
        Narzedzie::Ytdlp => pierwsza.to_string(),
    }
}

/// Starszy yt-dlp z PATH niż tyle dni → pobieramy własną kopię.
pub const MAKS_WIEK_YTDLP: i64 = 30;

/// Dzień (liczba dni od 1970-01-01) z daty kalendarzowej (algorytm Howarda Hinnanta).
pub fn dzien_z_daty(r: i64, m: u32, d: u32) -> i64 {
    let (r, m) = if m <= 2 { (r - 1, m + 9) } else { (r, m - 3) };
    let era = r.div_euclid(400);
    let rok_ery = r - era * 400;
    let dzien_roku = (153 * m as i64 + 2) / 5 + d as i64 - 1;
    let dzien_ery = rok_ery * 365 + rok_ery / 4 - rok_ery / 100 + dzien_roku;
    era * 146_097 + dzien_ery - 719_468
}

/// Dzisiejszy dzień (UTC) jako liczba dni od 1970-01-01.
pub fn dzis() -> i64 {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    (s / 86_400) as i64
}

/// Wiek yt-dlp w dniach z wersji `RRRR.MM.DD` (`None`, gdy wersja nie jest datą).
pub fn wiek_ytdlp(wersja: &str, dzis: i64) -> Option<i64> {
    let mut cz = wersja.trim().split('.');
    let r: i64 = cz.next()?.parse().ok()?;
    let m: u32 = cz.next()?.parse().ok()?;
    let d: u32 = cz.next()?.parse().ok()?;
    if !(2000..3000).contains(&r) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some((dzis - dzien_z_daty(r, m, d)).max(0))
}

/// Skąd jest wykryty yt-dlp.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Pochodzenie {
    /// Ścieżka wskazana ręcznie w Ustawieniach.
    Reczne,
    /// Własna kopia apki (katalog narzędzi): tylko tę aktualizujemy.
    Apka,
    /// Z PATH (np. pip, winget): nigdy jej nie ruszamy.
    Path,
}

pub fn pochodzenie(sciezka: &Path, reczne: &Sciezki, katalogi: &[PathBuf]) -> Pochodzenie {
    if reczne.ytdlp.as_deref() == Some(sciezka) {
        Pochodzenie::Reczne
    } else if katalogi.iter().any(|k| sciezka.starts_with(k)) {
        Pochodzenie::Apka
    } else {
        Pochodzenie::Path
    }
}

/// Czy pobrać własną kopię yt-dlp: brak żadnego albo z PATH i starszy niż 30 dni
/// (albo z nieczytelną wersją). Własnej kopii i ręcznej ścieżki nie podmieniamy po cichu.
pub fn ytdlp_decyzja(jest: Option<Pochodzenie>, wiek_dni: Option<i64>) -> bool {
    match jest {
        None => true,
        Some(Pochodzenie::Path) => wiek_dni.is_none_or(|w| w > MAKS_WIEK_YTDLP),
        Some(_) => false,
    }
}

/// Enkodery z `ffmpeg -encoders` (nazwy, np. `libx264`, `h264_nvenc`).
pub fn enkodery_z_tekstu(tekst: &str) -> Vec<String> {
    let mut za_naglowkiem = false;
    let mut wynik = Vec::new();
    for l in tekst.lines() {
        let l = l.trim();
        if l.starts_with("------") {
            za_naglowkiem = true;
            continue;
        }
        if !za_naglowkiem {
            continue;
        }
        let mut cz = l.split_whitespace();
        if let (Some(flagi), Some(nazwa)) = (cz.next(), cz.next()) {
            if flagi.len() == 6 && (flagi.starts_with('V') || flagi.starts_with('A')) {
                wynik.push(nazwa.to_string());
            }
        }
    }
    wynik
}

/// Filtry z `ffmpeg -filters` (np. `zscale`, `tonemap`): sprawdzamy, nie zakładamy.
pub fn filtry_z_tekstu(tekst: &str) -> Vec<String> {
    let mut za_naglowkiem = false;
    let mut wynik = Vec::new();
    for l in tekst.lines() {
        let l = l.trim();
        if l.starts_with("------") || l.starts_with("---") && l.len() < 8 {
            za_naglowkiem = true;
            continue;
        }
        if !za_naglowkiem {
            continue;
        }
        let mut cz = l.split_whitespace();
        if let (Some(flagi), Some(nazwa)) = (cz.next(), cz.next()) {
            if flagi.len() == 3 && flagi.chars().all(|c| matches!(c, '.' | 'T' | 'S' | 'C')) {
                wynik.push(nazwa.to_string());
            }
        }
    }
    wynik
}

pub fn filtry(ffmpeg: &Path) -> Vec<String> {
    crate::procesy::komenda_sync(ffmpeg)
        .args(["-hide_banner", "-filters"])
        .output()
        .map(|w| filtry_z_tekstu(&String::from_utf8_lossy(&w.stdout)))
        .unwrap_or_default()
}

pub fn enkodery(ffmpeg: &Path) -> Vec<String> {
    crate::procesy::komenda_sync(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map(|w| enkodery_z_tekstu(&String::from_utf8_lossy(&w.stdout)))
        .unwrap_or_default()
}

/// Enkodery sprzętowe faktycznie działające: wpis w `-encoders` nie wystarcza
/// (build ma nvenc, a karty NVIDIA nie ma), więc próbujemy zakodować 1 klatkę.
pub fn sprzet_dziala(ffmpeg: &Path, enkoder: &str) -> bool {
    crate::procesy::komenda_sync(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:s=256x256:d=0.1",
            "-frames:v",
            "1",
            "-c:v",
            enkoder,
            "-f",
            "null",
            "-",
        ])
        .output()
        .map(|w| w.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn parsuje_enkodery() {
        let t = "Encoders:\n V..... = Video\n ------\n V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA NVENC\n A....D aac                  AAC\n S..... ass                  ASS\n";
        assert_eq!(enkodery_z_tekstu(t), vec!["libx264", "h264_nvenc", "aac"]);
    }

    #[test]
    fn e31_parsuje_filtry() {
        let t = "Filters:\n  T.. = Timeline support\n  ---\n .S. tonemap  V->V  Conversion\n .SC zscale  V->V  Apply\n TSC scale  V->V  Scale\n ... anull A->A Pass\n";
        assert_eq!(filtry_z_tekstu(t), vec!["tonemap", "zscale", "scale", "anull"]);
    }

    #[test]
    fn wersje() {
        assert_eq!(
            wersja_z_tekstu(Narzedzie::Ffmpeg, "ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c)"),
            "7.1-full_build-www.gyan.dev"
        );
        assert_eq!(wersja_z_tekstu(Narzedzie::Ffprobe, "ffprobe version 6.1.1-3ubuntu5 Copyright"), "6.1.1-3ubuntu5");
        assert_eq!(wersja_z_tekstu(Narzedzie::Deno, "deno 2.5.1 (stable, release, x86_64)\nv8 13"), "2.5.1");
        assert_eq!(wersja_z_tekstu(Narzedzie::Ytdlp, "2026.09.30\n"), "2026.09.30");
        assert_eq!(wersja_z_tekstu(Narzedzie::Whisper, "whisper.cpp version: 1.8.2\n"), "1.8.2");
    }

    #[test]
    fn wiek_ytdlp_z_wersji() {
        assert_eq!(dzien_z_daty(1970, 1, 1), 0);
        assert_eq!(dzien_z_daty(2000, 3, 1), 11_017);
        let dzis = dzien_z_daty(2026, 10, 7);
        // test na żywo 07.10: pip miał 2026.07.04 → 95 dni
        assert_eq!(wiek_ytdlp("2026.07.04", dzis), Some(95));
        assert_eq!(wiek_ytdlp("2026.09.30.232839", dzis), Some(7), "nightly z godziną");
        assert_eq!(wiek_ytdlp("2026.10.08", dzis), Some(0), "zegar do tyłu: nie ujemny");
        assert_eq!(wiek_ytdlp("abc", dzis), None);
        assert_eq!(wiek_ytdlp("2026.13.01", dzis), None);
    }

    #[test]
    fn decyzja_wlasnej_kopii_ytdlp() {
        // przyczyna 403 z 07.10: stary yt-dlp z PATH (pip) → własna kopia
        assert!(ytdlp_decyzja(Some(Pochodzenie::Path), Some(95)));
        assert!(!ytdlp_decyzja(Some(Pochodzenie::Path), Some(30)));
        assert!(ytdlp_decyzja(Some(Pochodzenie::Path), None));
        assert!(ytdlp_decyzja(None, None));
        assert!(!ytdlp_decyzja(Some(Pochodzenie::Apka), Some(400)), "własną aktualizuje przycisk");
        assert!(!ytdlp_decyzja(Some(Pochodzenie::Reczne), Some(400)));
    }

    #[test]
    fn wlasna_kopia_przed_path() {
        let tmp = tempfile::tempdir().unwrap();
        let apka = tmp.path().join("narzedzia");
        let path = tmp.path().join("pip-bin");
        std::fs::create_dir_all(&apka).unwrap();
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join(Narzedzie::Ytdlp.plik()), b"").unwrap();
        let reczne = Sciezki::default();
        // tylko PATH: pochodzenie Path
        let z_path = path.join(Narzedzie::Ytdlp.plik());
        assert_eq!(pochodzenie(&z_path, &reczne, std::slice::from_ref(&apka)), Pochodzenie::Path);
        // kopia apki wygrywa z PATH
        std::fs::write(apka.join(Narzedzie::Ytdlp.plik()), b"").unwrap();
        let s = wykryj(&reczne, std::slice::from_ref(&apka));
        assert_eq!(s.ytdlp, Some(apka.join(Narzedzie::Ytdlp.plik())));
        assert_eq!(pochodzenie(s.ytdlp.as_ref().unwrap(), &reczne, &[apka]), Pochodzenie::Apka);
    }

    #[test]
    fn reczna_sciezka_ma_pierwszenstwo() {
        let tmp = tempfile::tempdir().unwrap();
        let reczny = tmp.path().join("moj-ffmpeg");
        std::fs::write(&reczny, b"").unwrap();
        let s = wykryj(&Sciezki { ffmpeg: Some(reczny.clone()), ..Default::default() }, &[tmp.path().to_path_buf()]);
        assert_eq!(s.ffmpeg, Some(reczny));
    }
}
