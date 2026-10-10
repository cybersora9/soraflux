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

pub fn agent() -> ureq::Agent {
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

/// Plik częściowy obok celu (`model.bin.pobieranie`): zostaje po przerwaniu, żeby wznowić.
pub fn sciezka_pobierania(cel: &Path) -> PathBuf {
    let mut n = cel.file_name().map(std::ffi::OsStr::to_os_string).unwrap_or_default();
    n.push(".pobieranie");
    cel.with_file_name(n)
}

/// Pobiera duży plik (model napisów) z wznawianiem i przypiętą sumą SHA-256.
///
/// - Suma musi być znana z góry (`oczekiwana`, 64 znaki hex); bez niej nic nie pobieramy.
/// - Po przerwaniu (sieć, anulowanie, zamknięcie apki) zostaje `*.pobieranie`; kolejne wywołanie
///   wysyła `Range: bytes=N-` i dopisuje resztę. Serwer bez obsługi zakresów (200) = od zera.
/// - Po pobraniu suma: zgodna → zmiana nazwy na `cel`; niezgodna → plik częściowy usunięty, błąd.
/// - `przerwij` sprawdzane po każdym kawałku (anulowanie z GUI).
pub fn pobierz_wznawialnie(
    agent: &ureq::Agent,
    url: &str,
    cel: &Path,
    oczekiwana: &str,
    przerwij: &std::sync::atomic::AtomicBool,
    mut postep: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if !crate::napisy::suma_poprawna(oczekiwana) {
        return Err(blad::kod(
            "model_bez_sumy",
            &[("nazwa", &cel.file_name().map(|n| n.to_string_lossy()).unwrap_or_default())],
        ));
    }
    if let Some(k) = cel.parent() {
        std::fs::create_dir_all(k)
            .map_err(|e| blad::kod("folder_zapisu", &[("folder", &k.display()), ("blad", &e)]))?;
    }
    let czesc = sciezka_pobierania(cel);
    let mut start = std::fs::metadata(&czesc).map(|m| m.len()).unwrap_or(0);
    let mut zadanie = agent.get(url);
    if start > 0 {
        zadanie = zadanie.set("Range", &format!("bytes={start}-"));
    }
    let odp = match zadanie.call() {
        Ok(o) => Some(o),
        // 416: mamy już cały plik (przerwane tuż przed sprawdzeniem sumy)
        Err(ureq::Error::Status(416, _)) if start > 0 => None,
        Err(e) => return Err(blad::kod("pobieranie", &[("url", &url), ("blad", &e)])),
    };
    if let Some(odp) = odp {
        let dlugosc: Option<u64> = odp.header("Content-Length").and_then(|v| v.parse().ok());
        let wznowione = odp.status() == 206 && start > 0;
        if !wznowione {
            start = 0;
        }
        let calosc = dlugosc.map(|d| d + start);
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(wznowione)
            .truncate(!wznowione)
            .open(&czesc)
            .map_err(|e| blad::kod("zapis_wyniku", &[("blad", &e)]))?;
        let mut r = odp.into_reader();
        let mut buf = vec![0u8; 1 << 16];
        let mut pobrane = start;
        postep(pobrane, calosc);
        loop {
            if przerwij.load(Ordering::Relaxed) {
                return Err(blad::kod("pobieranie_anulowane", &[]));
            }
            let n = r.read(&mut buf).map_err(|e| blad::kod("pobieranie_przerwane", &[("blad", &e)]))?;
            if n == 0 {
                break;
            }
            f.write_all(&buf[..n]).map_err(|e| blad::kod("zapis_wyniku", &[("blad", &e)]))?;
            pobrane += n as u64;
            postep(pobrane, calosc);
        }
        f.flush().map_err(|e| blad::kod("zapis_wyniku", &[("blad", &e)]))?;
        if calosc.is_some_and(|c| pobrane < c) {
            return Err(blad::kod("pobieranie_przerwane", &[("blad", &format!("{pobrane}/{}", calosc.unwrap_or(0)))]));
        }
    }
    let jest = sha256_pliku(&czesc).map_err(|e| e.to_string())?;
    if jest != oczekiwana {
        let _ = std::fs::remove_file(&czesc);
        let nazwa = cel.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Err(blad::kod("zla_suma", &[("nazwa", &nazwa), ("jest", &jest), ("oczekiwana", &oczekiwana)]));
    }
    std::fs::rename(&czesc, cel).map_err(|e| blad::kod("zapis_wyniku", &[("blad", &e)]))
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

    /// Serwer HTTP na jedno połączenie na odpowiedź: `ile` = ile bajtów treści wysłać naprawdę
    /// (mniej niż Content-Length = zerwane połączenie), `zakresy` = czy obsługuje `Range`.
    fn serwer(dane: Vec<u8>, odpowiedzi: Vec<(usize, bool)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::BufRead;
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/ggml-test.bin", l.local_addr().unwrap());
        let w = std::thread::spawn(move || {
            let mut zakresy_widziane = Vec::new();
            for (ile, zakresy) in odpowiedzi {
                let (mut s, _) = l.accept().unwrap();
                let mut r = std::io::BufReader::new(s.try_clone().unwrap());
                let mut od = 0usize;
                loop {
                    let mut linia = String::new();
                    r.read_line(&mut linia).unwrap();
                    if let Some(v) = linia.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        zakresy_widziane.push(v.trim().to_string());
                        od = v.trim().trim_end_matches('-').parse().unwrap();
                    }
                    if linia == "\r\n" || linia.is_empty() {
                        break;
                    }
                }
                let od = if zakresy { od } else { 0 };
                let tresc = &dane[od..];
                let status = if od > 0 { "206 Partial Content" } else { "200 OK" };
                let naglowek =
                    format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", tresc.len());
                s.write_all(naglowek.as_bytes()).unwrap();
                let _ = s.write_all(&tresc[..ile.min(tresc.len())]);
            }
            zakresy_widziane
        });
        (url, w)
    }

    fn agent_testowy() -> ureq::Agent {
        ureq::AgentBuilder::new().build()
    }

    #[test]
    fn s5_wznawia_po_zerwaniu_i_sprawdza_sume() {
        use std::sync::atomic::AtomicBool;
        let dane: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        let suma = format!("{:x}", Sha256::digest(&dane));
        let tmp = tempfile::tempdir().unwrap();
        let cel = tmp.path().join("modele zażółć").join("ggml-test.bin");
        let (url, w) = serwer(dane.clone(), vec![(100_000, true), (usize::MAX, true)]);
        let nie = AtomicBool::new(false);
        let e = pobierz_wznawialnie(&agent_testowy(), &url, &cel, &suma, &nie, |_, _| {}).unwrap_err();
        assert_eq!(blad::klucz(&e).as_deref(), Some("pobieranie_przerwane"), "{e}");
        assert_eq!(std::fs::metadata(sciezka_pobierania(&cel)).unwrap().len(), 100_000, "część zostaje");
        let mut ostatni = (0, None);
        pobierz_wznawialnie(&agent_testowy(), &url, &cel, &suma, &nie, |p, c| ostatni = (p, c)).unwrap();
        assert_eq!(ostatni, (300_000, Some(300_000)));
        assert_eq!(std::fs::read(&cel).unwrap(), dane);
        assert!(!sciezka_pobierania(&cel).exists());
        assert_eq!(w.join().unwrap(), vec!["100000-".to_string()]);
    }

    #[test]
    fn s5_serwer_bez_zakresow_zla_suma_anulowanie_i_brak_sumy() {
        use std::sync::atomic::AtomicBool;
        let dane = vec![7u8; 50_000];
        let suma = format!("{:x}", Sha256::digest(&dane));
        let tmp = tempfile::tempdir().unwrap();
        let cel = tmp.path().join("m.bin");
        let nie = AtomicBool::new(false);
        // stary częściowy plik + serwer bez Range: zaczynamy od zera, wynik poprawny
        std::fs::write(sciezka_pobierania(&cel), b"smieci").unwrap();
        let (url, w) = serwer(dane.clone(), vec![(usize::MAX, false)]);
        pobierz_wznawialnie(&agent_testowy(), &url, &cel, &suma, &nie, |_, _| {}).unwrap();
        assert_eq!(std::fs::read(&cel).unwrap(), dane);
        w.join().unwrap();
        // zła suma: plik częściowy usunięty, cel nie powstaje
        let cel2 = tmp.path().join("m2.bin");
        let (url, w) = serwer(dane.clone(), vec![(usize::MAX, true)]);
        let e = pobierz_wznawialnie(&agent_testowy(), &url, &cel2, &"0".repeat(64), &nie, |_, _| {}).unwrap_err();
        assert_eq!(blad::klucz(&e).as_deref(), Some("zla_suma"));
        assert!(!cel2.exists() && !sciezka_pobierania(&cel2).exists());
        w.join().unwrap();
        // anulowanie: błąd, część zostaje do wznowienia
        let (url, w) = serwer(dane.clone(), vec![(usize::MAX, true)]);
        let tak = AtomicBool::new(true);
        let e = pobierz_wznawialnie(&agent_testowy(), &url, &cel2, &suma, &tak, |_, _| {}).unwrap_err();
        assert_eq!(blad::klucz(&e).as_deref(), Some("pobieranie_anulowane"));
        assert!(!cel2.exists());
        w.join().unwrap();
        // brak przypiętej sumy: żadnego połączenia
        let e = pobierz_wznawialnie(&agent_testowy(), "http://127.0.0.1:9/x", &cel2, "", &nie, |_, _| {}).unwrap_err();
        assert_eq!(blad::klucz(&e).as_deref(), Some("model_bez_sumy"));
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
