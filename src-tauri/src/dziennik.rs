//! Lokalny dziennik błędów (plik w katalogu danych, max ~1 MB, jedna kopia zapasowa)
//! i „raport” do skopiowania: wersje, system, ostatnie wpisy. Bez ścieżek prywatnych
//! folderów (katalog domowy → `~`, nazwa użytkownika w `C:\Users\…` ukryta). Nic nie
//! jest nigdzie wysyłane: użytkownik sam wkleja raport, gdzie chce.

use std::io::Write;
use std::path::Path;

pub const PLIK: &str = "dziennik.log";
const MAKS: u64 = 1024 * 1024;

/// Dopisuje wpis (z czasem UNIX). Przy przekroczeniu rozmiaru: `dziennik.log.1`.
pub fn zapisz(katalog: &Path, wpis: &str) {
    let _ = std::fs::create_dir_all(katalog);
    let p = katalog.join(PLIK);
    if std::fs::metadata(&p).map(|m| m.len() > MAKS).unwrap_or(false) {
        let _ = std::fs::rename(&p, katalog.join(format!("{PLIK}.1")));
    }
    let czas = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "[{czas}] {}", wpis.trim_end());
    }
}

/// Ostatnie `n` linii dziennika.
pub fn ogon(katalog: &Path, n: usize) -> Vec<String> {
    let t = std::fs::read_to_string(katalog.join(PLIK)).unwrap_or_default();
    let linie: Vec<&str> = t.lines().collect();
    linie[linie.len().saturating_sub(n)..].iter().map(|s| s.to_string()).collect()
}

/// Usuwa z tekstu ścieżki prywatnych folderów: katalog domowy → `~`,
/// `C:\Users\Jan\…` i `/home/jan/…` → nazwa użytkownika ukryta.
pub fn anonimizuj(tekst: &str, dom: Option<&Path>) -> String {
    let mut t = tekst.to_string();
    if let Some(d) = dom.map(|d| d.to_string_lossy().into_owned()).filter(|d| d.len() > 1) {
        t = t.replace(&d, "~");
        let ukosniki = d.replace('\\', "/");
        t = t.replace(&ukosniki, "~");
    }
    for prefiks in ["C:\\Users\\", "C:/Users/", "/home/", "/Users/"] {
        let mut wynik = String::with_capacity(t.len());
        let mut reszta = t.as_str();
        while let Some(i) = reszta.find(prefiks) {
            wynik.push_str(&reszta[..i + prefiks.len()]);
            let po = &reszta[i + prefiks.len()..];
            let koniec = po.find(['\\', '/', '"', '\'', ' ', '\n']).unwrap_or(po.len());
            wynik.push('…');
            reszta = &po[koniec..];
        }
        wynik.push_str(reszta);
        t = wynik;
    }
    t
}

/// Raport do schowka: wersja apki, system, wersje narzędzi, ostatnie wpisy dziennika.
pub fn raport(wersja_apki: &str, wersje_narzedzi: &[(String, String)], wpisy: &[String]) -> String {
    let mut r = format!("SoraFlux {wersja_apki}\nSystem: {} {}\n", std::env::consts::OS, std::env::consts::ARCH);
    for (n, w) in wersje_narzedzi {
        r.push_str(&format!("{n}: {w}\n"));
    }
    r.push_str("\nOstatnie wpisy dziennika:\n");
    if wpisy.is_empty() {
        r.push_str("(brak)\n");
    }
    for w in wpisy {
        r.push_str(w);
        r.push('\n');
    }
    anonimizuj(&r, dirs::home_dir().as_deref())
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn e29_anonimizacja() {
        let t = "ffmpeg -i C:\\Users\\Maisa\\Wideo\\film.mp4 /home/jan/x.mp4 /Users/ola/a.mov";
        let a = anonimizuj(t, None);
        assert!(!a.contains("Maisa") && !a.contains("jan") && !a.contains("ola"), "{a}");
        assert!(a.contains("C:\\Users\\…\\Wideo\\film.mp4"), "{a}");
        let d = std::path::Path::new("/srv/dom/kasia");
        assert_eq!(anonimizuj("blad w /srv/dom/kasia/film.mp4", Some(d)), "blad w ~/film.mp4");
    }

    #[test]
    fn e29_dziennik_i_raport() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..5 {
            zapisz(tmp.path(), &format!("blad {i}"));
        }
        let o = ogon(tmp.path(), 2);
        assert_eq!(o.len(), 2);
        assert!(o[1].ends_with("blad 4"));
        let r = raport("1.1.0", &[("ffmpeg".into(), "7.1".into())], &o);
        assert!(r.starts_with("SoraFlux 1.1.0"));
        assert!(r.contains("ffmpeg: 7.1") && r.contains("blad 4"));
    }
}
