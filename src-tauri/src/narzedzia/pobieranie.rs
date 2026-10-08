//! Pobieranie narzędzi z oficjalnych źródeł z weryfikacją SHA256.
//! Blokujące (ureq): wołać przez `spawn_blocking`.

use super::zrodla::{Archiwum, Zrodlo};
use super::Narzedzie;
use crate::blad;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Wyciąga sumę dla `nazwa` z pliku sum. Obsługuje `HASH  plik`, `HASH *plik`
/// i format PowerShell (`Hash : HASH`) z jednym wpisem.
pub fn suma_z_tekstu(tekst: &str, nazwa: &str) -> Option<String> {
    let hex = |t: &str| t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit());
    for l in tekst.lines() {
        let tokeny: Vec<&str> = l.split_whitespace().collect();
        if tokeny.iter().any(|t| t.trim_start_matches('*').rsplit(['/', '\\']).next() == Some(nazwa)) {
            if let Some(h) = tokeny.iter().find(|t| hex(t)) {
                return Some(h.to_ascii_lowercase());
            }
        }
    }
    let wszystkie: Vec<&str> = tekst.split(|c: char| !c.is_ascii_hexdigit()).filter(|t| hex(t)).collect();
    (wszystkie.len() == 1).then(|| wszystkie[0].to_ascii_lowercase())
}

pub fn sha256_pliku(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .user_agent(concat!("SoraConverter/", env!("CARGO_PKG_VERSION")))
        .timeout_connect(std::time::Duration::from_secs(20))
        // HTTPS_PROXY z systemu (sieci firmowe); certyfikaty z magazynu systemu.
        .try_proxy_from_env(true)
        .build()
}

/// Pobiera plik ze strumieniowaniem i raportem postępu (pobrane, całość).
fn pobierz_do(url: &str, cel: &Path, mut postep: impl FnMut(u64, Option<u64>)) -> Result<(), String> {
    let odp = agent().get(url).call().map_err(|e| blad::kod("pobieranie", &[("url", &url), ("blad", &e)]))?;
    let calosc = odp.header("Content-Length").and_then(|v| v.parse().ok());
    let mut r = odp.into_reader();
    let mut f = std::fs::File::create(cel).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 1 << 16];
    let mut pobrane = 0u64;
    loop {
        let n = r.read(&mut buf).map_err(|e| blad::kod("pobieranie_przerwane", &[("blad", &e)]))?;
        if n == 0 {
            break;
        }
        f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        pobrane += n as u64;
        postep(pobrane, calosc);
    }
    Ok(())
}

fn ustaw_wykonywalny(_p: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(_p, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Wypakowuje wskazane pliki z ZIP-a do `katalog`.
pub fn wypakuj(zip: &Path, pliki: &[(Narzedzie, &str)], katalog: &Path) -> Result<Vec<(Narzedzie, PathBuf)>, String> {
    let f = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut arch = zip::ZipArchive::new(f).map_err(|e| blad::kod("zly_zip", &[("blad", &e)]))?;
    let mut wynik = Vec::new();
    for (n, koncowka) in pliki {
        let indeks = (0..arch.len())
            .find(|i| arch.by_index(*i).map(|e| e.name().ends_with(koncowka)).unwrap_or(false))
            .ok_or_else(|| blad::kod("brak_w_archiwum", &[("plik", koncowka)]))?;
        let mut wpis = arch.by_index(indeks).map_err(|e| e.to_string())?;
        let cel = katalog.join(n.plik());
        let tymczasowy = katalog.join(format!("{}.nowy", n.plik()));
        let mut wy = std::fs::File::create(&tymczasowy).map_err(|e| e.to_string())?;
        std::io::copy(&mut wpis, &mut wy).map_err(|e| e.to_string())?;
        drop(wy);
        ustaw_wykonywalny(&tymczasowy)?;
        std::fs::rename(&tymczasowy, &cel).map_err(|e| e.to_string())?;
        wynik.push((*n, cel));
    }
    Ok(wynik)
}

/// Pobiera pakiet, sprawdza SHA256, instaluje do `katalog`. Zwraca zainstalowane narzędzia.
pub fn zainstaluj(
    z: &Zrodlo,
    katalog: &Path,
    postep: impl FnMut(u64, Option<u64>),
) -> Result<Vec<(Narzedzie, PathBuf)>, String> {
    std::fs::create_dir_all(katalog).map_err(|e| e.to_string())?;
    let sumy = agent()
        .get(z.url_sum)
        .call()
        .map_err(|e| blad::kod("pobieranie_sum", &[("blad", &e)]))?
        .into_string()
        .map_err(|e| e.to_string())?;
    let oczekiwana = suma_z_tekstu(&sumy, z.nazwa).ok_or_else(|| blad::kod("brak_sumy", &[("nazwa", &z.nazwa)]))?;

    let pobrany = katalog.join(format!("{}.pobieranie", z.nazwa));
    let wynik = (|| {
        pobierz_do(z.url, &pobrany, postep)?;
        let jest = sha256_pliku(&pobrany).map_err(|e| e.to_string())?;
        if jest != oczekiwana {
            return Err(blad::kod("zla_suma", &[("nazwa", &z.nazwa), ("jest", &jest), ("oczekiwana", &oczekiwana)]));
        }
        match z.archiwum {
            Archiwum::Zip => wypakuj(&pobrany, z.pliki, katalog),
            Archiwum::Plik => {
                let (n, _) = z.pliki[0];
                let cel = katalog.join(n.plik());
                ustaw_wykonywalny(&pobrany)?;
                std::fs::rename(&pobrany, &cel).map_err(|e| e.to_string())?;
                Ok(vec![(n, cel)])
            }
        }
    })();
    let _ = std::fs::remove_file(&pobrany);
    wynik
}

#[cfg(test)]
mod testy {
    use super::*;

    const H: &str = "8c1f4c3c2a3d6b4f0e2a1c9b7d5e3f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e";

    #[test]
    fn sumy_formaty() {
        let gnu = format!("{H}  ffmpeg-a.zip\n{}  ffmpeg-b.zip\n", "a".repeat(64));
        assert_eq!(suma_z_tekstu(&gnu, "ffmpeg-a.zip").as_deref(), Some(H));
        assert_eq!(suma_z_tekstu(&gnu, "ffmpeg-b.zip"), Some("a".repeat(64)));
        let gwiazdka = format!("{H} *ffmpeg-master-latest-win64-gpl.zip\n");
        assert_eq!(suma_z_tekstu(&gwiazdka, "ffmpeg-master-latest-win64-gpl.zip").as_deref(), Some(H));
        let ps = format!("\nAlgorithm : SHA256\nHash      : {}\nPath      : D:\\a\\ffmpeg.zip\n", H.to_uppercase());
        assert_eq!(suma_z_tekstu(&ps, "ffmpeg-release-essentials.zip").as_deref(), Some(H));
        assert_eq!(suma_z_tekstu(&gnu, "inny.zip"), None);
        let ytdlp = format!("{H}  yt-dlp.exe\n{}  yt-dlp_linux\n", "b".repeat(64));
        assert_eq!(suma_z_tekstu(&ytdlp, "yt-dlp.exe").as_deref(), Some(H));
        assert_eq!(suma_z_tekstu(&ytdlp, "yt-dlp_linux"), Some("b".repeat(64)));
        // gyan.dev: plik .sha256 zawiera samą sumę
        assert_eq!(suma_z_tekstu(&format!("{H}\n"), "ffmpeg-release-essentials.zip").as_deref(), Some(H));
    }

    #[test]
    fn sha256_i_wypakowanie() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_sciezka = tmp.path().join("a.zip");
        {
            let f = std::fs::File::create(&zip_sciezka).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("ffmpeg-x/bin/ffmpeg.exe", o).unwrap();
            z.write_all(b"binarka").unwrap();
            z.finish().unwrap();
        }
        let wynik = wypakuj(&zip_sciezka, &[(Narzedzie::Ffmpeg, "bin/ffmpeg.exe")], tmp.path()).unwrap();
        assert_eq!(std::fs::read(&wynik[0].1).unwrap(), b"binarka");
        let p = tmp.path().join("x");
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_pliku(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
