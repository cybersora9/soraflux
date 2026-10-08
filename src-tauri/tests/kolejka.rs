//! Kolejka z prawdziwym ffmpeg: równoległość, zdarzenia postępu, anulowanie,
//! korekta docelowego rozmiaru.

use soraconverter_lib::kolejka::{InfoZadania, Kolejka, Nadajnik, NoweZadanie, RodzajZadania, Stan};
use soraconverter_lib::narzedzia::{self, Sciezki};
use soraconverter_lib::postep::Postep;
use soraconverter_lib::ustawienia::*;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Zbieracz {
    postepy: Mutex<Vec<Postep>>,
    stany: Mutex<Vec<InfoZadania>>,
}

impl Nadajnik for Zbieracz {
    fn postep(&self, p: &Postep) {
        self.postepy.lock().unwrap().push(p.clone());
    }
    fn stan(&self, z: &InfoZadania) {
        self.stany.lock().unwrap().push(z.clone());
    }
}

fn sciezki() -> Sciezki {
    narzedzia::wykryj(&Sciezki::default(), &[])
}

fn film(katalog: &Path, nazwa: &str, sekundy: u32, rozmiar: &str) -> PathBuf {
    let p = katalog.join(nazwa);
    let ok = Command::new("ffmpeg")
        .args(["-hide_banner", "-y", "-loglevel", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc2=size={rozmiar}:rate=30:duration={sekundy}"))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=300:duration={sekundy}"))
        .args(["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])
        .arg(&p)
        .status()
        .unwrap();
    assert!(ok.success());
    p
}

async fn czekaj_na(k: &Kolejka, ids: &[u64], limit: Duration) -> Vec<InfoZadania> {
    let start = Instant::now();
    loop {
        let lista = k.lista();
        let nasze: Vec<_> = lista.into_iter().filter(|z| ids.contains(&z.id)).collect();
        if nasze.len() == ids.len() && nasze.iter().all(|z| z.stan.zakonczony()) {
            return nasze;
        }
        assert!(start.elapsed() < limit, "zadania nie skończyły się w czasie: {nasze:?}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn konwersja(wejscie: &Path, profil: Profil, katalog: Option<&Path>) -> NoweZadanie {
    NoweZadanie {
        rodzaj: RodzajZadania::Konwersja { wejscie: wejscie.to_path_buf(), profil },
        katalog: katalog.map(Path::to_path_buf),
        pomin_istniejace: false,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn trzy_zadania_dwa_rownolegle() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "a.mp4", 4, "640x360");
    let zb = Arc::new(Zbieracz::default());
    let k = Kolejka::nowa(2, zb.clone(), Arc::new(RwLock::new(sciezki())));
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { rozdzielczosc: Rozdzielczosc::Wysokosc { h: 240 }, ..Default::default() });
    let ids = vec![
        k.dodaj(konwersja(&we, p.clone(), None)),
        k.dodaj(konwersja(&we, Profil::dla(Kontener::Mp3), None)),
        k.dodaj(konwersja(&we, p, None)),
    ];
    let wyniki = czekaj_na(&k, &ids, Duration::from_secs(120)).await;
    for z in &wyniki {
        let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
        assert!(wyjscie.exists());
        assert!(!wyjscie.to_string_lossy().contains(".part."));
    }
    // Dwa MP4 z tego samego źródła: druga nazwa dostaje „ (1)”, źródło nietknięte.
    assert!(tmp.path().join("a (1).mp4").exists());
    assert!(tmp.path().join("a (2).mp4").exists());
    assert!(tmp.path().join("a.mp3").exists());
    // Nigdy więcej niż 2 naraz.
    let stany = zb.stany.lock().unwrap().clone();
    let mut trwa = std::collections::HashSet::new();
    let mut maks = 0;
    for s in &stany {
        match s.stan {
            Stan::Trwa => {
                trwa.insert(s.id);
            }
            _ if s.stan.zakonczony() => {
                trwa.remove(&s.id);
            }
            _ => {}
        }
        maks = maks.max(trwa.len());
    }
    assert!(maks <= 2, "równolegle {maks}");
    let postepy = zb.postepy.lock().unwrap();
    assert!(!postepy.is_empty());
    assert!(postepy.iter().all(|p| (0.0..=100.0).contains(&p.procent)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn anulowanie_zabija_i_sprzata() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "dlugi.mp4", 30, "1280x720");
    let zb = Arc::new(Zbieracz::default());
    let k = Kolejka::nowa(1, zb.clone(), Arc::new(RwLock::new(sciezki())));
    let mut p = Profil::dla(Kontener::Mkv);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::H265, jakosc: JakoscWideo::Crf { crf: 20 }, ..Default::default() });
    let wy = tmp.path().join("wyniki");
    std::fs::create_dir(&wy).unwrap();
    let id = k.dodaj(konwersja(&we, p.clone(), Some(&wy)));
    let czekajace = k.dodaj(konwersja(&we, p, Some(&wy)));
    // poczekaj, aż ffmpeg zacznie raportować
    let start = Instant::now();
    while zb.postepy.lock().unwrap().is_empty() {
        assert!(start.elapsed() < Duration::from_secs(30));
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    k.anuluj(czekajace);
    k.anuluj(id);
    let wyniki = czekaj_na(&k, &[id, czekajace], Duration::from_secs(20)).await;
    assert!(wyniki.iter().all(|z| z.stan == Stan::Anulowane), "{wyniki:?}");
    let zostalo: Vec<_> = std::fs::read_dir(&wy).unwrap().flatten().map(|e| e.file_name()).collect();
    assert!(zostalo.is_empty(), "niepełne pliki zostały: {zostalo:?}");
    #[cfg(target_os = "linux")]
    {
        let zostale = dzieci_ffmpeg(&tmp.path().to_string_lossy());
        assert!(zostale.is_empty(), "ffmpeg dalej działa: {zostale:?}");
    }
}

/// Procesy ffmpeg tego testu (rodzic = ten proces, w argumentach `znacznik`), Linux /proc.
#[cfg(target_os = "linux")]
fn dzieci_ffmpeg(znacznik: &str) -> Vec<u32> {
    let my = std::process::id();
    std::fs::read_dir("/proc")
        .unwrap()
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
        .filter(|pid| {
            let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else { return false };
            let komenda = stat.split('(').nth(1).and_then(|r| r.split(')').next()).unwrap_or("");
            let po = stat.rsplit(')').next().unwrap_or("");
            let mut pola = po.split_whitespace();
            let stan = pola.next().unwrap_or("");
            let rodzic: u32 = pola.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            let argumenty = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
            komenda == "ffmpeg" && rodzic == my && stan != "Z" && String::from_utf8_lossy(&argumenty).contains(znacznik)
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn docelowy_rozmiar_z_korekta_miesci_sie() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "r.mp4", 20, "1280x720");
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 1.0 }, ..Default::default() });
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 64, ..Default::default() });
    let id = k.dodaj(konwersja(&we, p, None));
    let w = czekaj_na(&k, &[id], Duration::from_secs(180)).await;
    let Stan::Gotowe { wyjscie } = &w[0].stan else { panic!("{w:?}") };
    let rozmiar = std::fs::metadata(wyjscie).unwrap().len();
    eprintln!("1 MB z korektą → {rozmiar} B");
    assert!(rozmiar <= 1024 * 1024, "{rozmiar} B > 1 MB");
    assert!(rozmiar >= 800 * 1024, "{rozmiar} B: budżet wykorzystany słabo");
    let smieci: Vec<_> = std::fs::read_dir(tmp.path())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("2pass") || n.contains(".part."))
        .collect();
    assert!(smieci.is_empty(), "{smieci:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn blad_ma_komunikat() {
    let tmp = tempfile::tempdir().unwrap();
    let zly = tmp.path().join("to-nie-film.mp4");
    std::fs::write(&zly, b"smieci").unwrap();
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let id = k.dodaj(konwersja(&zly, Profil::dla(Kontener::Mp3), None));
    let w = czekaj_na(&k, &[id], Duration::from_secs(20)).await;
    let Stan::Blad { komunikat } = &w[0].stan else { panic!("{w:?}") };
    assert!(!komunikat.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn obrazy_wsadowo_do_folderu() {
    let tmp = tempfile::tempdir().unwrap();
    let mut wejscia = Vec::new();
    for (i, rozmiar) in ["800x600", "1200x900", "300x200"].iter().enumerate() {
        let p = tmp.path().join(format!("obraz{i}.png"));
        let ok = Command::new("ffmpeg")
            .args(["-hide_banner", "-y", "-loglevel", "error", "-f", "lavfi", "-i"])
            .arg(format!("testsrc2=size={rozmiar}"))
            .args(["-frames:v", "1"])
            .arg(&p)
            .status()
            .unwrap();
        assert!(ok.success());
        wejscia.push(p);
    }
    let wy = tmp.path().join("na-strone");
    std::fs::create_dir(&wy).unwrap();
    let k = Kolejka::nowa(2, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let mut p = Profil::dla(Kontener::Webp);
    p.obraz = Some(ProfilObrazu {
        rozmiar: RozmiarObrazu::Wymiary { w: Some(1000), h: None },
        nie_powiekszaj: true,
        jakosc: 80,
        ..Default::default()
    });
    let ids: Vec<u64> = wejscia.iter().map(|w| k.dodaj(konwersja(w, p.clone(), Some(&wy)))).collect();
    let wyniki = czekaj_na(&k, &ids, Duration::from_secs(60)).await;
    let mut szerokosci = Vec::new();
    for z in &wyniki {
        let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
        assert_eq!(wyjscie.parent().unwrap(), wy);
        let m = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0"])
            .arg(wyjscie)
            .output()
            .unwrap();
        szerokosci.push(String::from_utf8_lossy(&m.stdout).trim().to_string());
    }
    // 800 i 300 bez powiększania, 1200 → 1000
    assert_eq!(szerokosci, vec!["800", "1000", "300"]);
}

// ---------- pancerz v1.1 ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c20_dwa_rownolegle_zadania_docelowy_rozmiar() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "zrodlo.mp4", 12, "1280x720");
    let zb = Arc::new(Zbieracz::default());
    let k = Kolejka::nowa(2, zb.clone(), Arc::new(RwLock::new(sciezki())));
    let profil = |mb: f32| {
        let mut p = Profil::dla(Kontener::Mp4);
        p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb }, ..Default::default() });
        p.audio = Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 64, ..Default::default() });
        p
    };
    // ten sam katalog, ten sam plik źródłowy, różne cele: log 2 przebiegów nie może się mieszać
    let ids = vec![k.dodaj(konwersja(&we, profil(1.0), None)), k.dodaj(konwersja(&we, profil(2.0), None))];
    let wyniki = czekaj_na(&k, &ids, Duration::from_secs(240)).await;
    // oba naprawdę szły naraz
    let stany = zb.stany.lock().unwrap().clone();
    let trwaly: std::collections::HashSet<u64> = stany.iter().filter(|s| s.stan == Stan::Trwa).map(|s| s.id).collect();
    assert_eq!(trwaly.len(), 2);
    for (z, mb) in wyniki.iter().zip([1.0f64, 2.0]) {
        let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
        let r = std::fs::metadata(wyjscie).unwrap().len() as f64;
        let cel = mb * 1024.0 * 1024.0;
        eprintln!("2-pass równolegle: cel {mb} MB → {r} B ({:+.1}%)", (r / cel - 1.0) * 100.0);
        // ta sama umowa co docelowy_rozmiar_z_korekta_miesci_sie: mieści się w limicie i wykorzystuje >= 78% budżetu
        // (08.10: ±5% padało lokalnie, −9,3% na 12-sekundowym testsrc2; zmieszane logi 2-pass dałyby wynik daleko poza tym pasmem)
        assert!(r <= cel && r >= cel * 0.78, "{} poza [78%, 100%] celu: {r} B", wyjscie.display());
        assert_eq!(z.rozmiar_wyniku, Some(r as u64));
        assert!(z.rozmiar_wejscia.is_some());
    }
    let smieci: Vec<_> = std::fs::read_dir(tmp.path())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("2pass") || n.contains(".part.") || n.contains("ffmpeg2pass"))
        .collect();
    assert!(smieci.is_empty(), "{smieci:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn d25_polskie_znaki_cjk_i_dluga_sciezka() {
    let tmp = tempfile::tempdir().unwrap();
    let dlugi = "katalog o bardzo długiej nazwie żeby przekroczyć limit MAX_PATH ".repeat(3);
    let katalog = tmp.path().join(dlugi.trim()).join("drugi poziom zażółć gęślą jaźń 日本語 ".repeat(3).trim());
    std::fs::create_dir_all(&katalog).unwrap();
    let we = film(&katalog, "zażółć 日本 film.mp4", 2, "320x240");
    assert!(we.as_os_str().len() > 260, "ścieżka ma {} bajtów", we.as_os_str().len());
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let id = k.dodaj(konwersja(&we, Profil::dla(Kontener::Mp3), None));
    let w = czekaj_na(&k, &[id], Duration::from_secs(60)).await;
    let Stan::Gotowe { wyjscie } = &w[0].stan else { panic!("{w:?}") };
    assert_eq!(wyjscie.file_name().unwrap(), "zażółć 日本 film.mp3");
    assert!(wyjscie.is_file());
    assert_eq!(w[0].nazwa, "zażółć 日本 film.mp4");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c21_sprzetowy_padl_powrot_do_programowego() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "a.mp4", 2, "320x240");
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let mut p = Profil::dla(Kontener::Mp4);
    // W chmurze nie ma GPU NVIDIA: h264_nvenc albo nie istnieje w buildzie, albo padnie przy starcie.
    p.wideo = Some(ProfilWideo { sprzet: Some(Sprzet::Nvenc), ..Default::default() });
    let id = k.dodaj(konwersja(&we, p, None));
    let w = czekaj_na(&k, &[id], Duration::from_secs(60)).await;
    let Stan::Gotowe { wyjscie } = &w[0].stan else { panic!("{w:?}") };
    assert!(w[0].awaria_sprzetu, "powinno zgłosić powrót do kodowania programowego");
    let kodek = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0"])
        .arg(wyjscie)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&kodek.stdout).trim(), "h264");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn d27_jedno_wideo_naraz_obrazy_obok() {
    use soraconverter_lib::kolejka::Opcje;
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "w.mp4", 3, "640x360");
    let obraz = tmp.path().join("o.png");
    assert!(Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=400x300",
            "-frames:v",
            "1"
        ])
        .arg(&obraz)
        .status()
        .unwrap()
        .success());
    let zb = Arc::new(Zbieracz::default());
    let opcje = Opcje { limit: 3, limit_wideo: 1, niski_priorytet: true };
    let k = Kolejka::z_opcjami(opcje, zb.clone(), Arc::new(RwLock::new(sciezki())), None);
    let wideo = Profil::dla(Kontener::Mkv);
    let ids = vec![
        k.dodaj(konwersja(&we, wideo.clone(), None)),
        k.dodaj(konwersja(&we, wideo, None)),
        k.dodaj(konwersja(&obraz, Profil::dla(Kontener::Webp), None)),
    ];
    let wyniki = czekaj_na(&k, &ids, Duration::from_secs(120)).await;
    assert!(wyniki.iter().all(|z| matches!(z.stan, Stan::Gotowe { .. })), "{wyniki:?}");
    let stany = zb.stany.lock().unwrap().clone();
    let (mut trwa, mut maks_wideo, mut obraz_obok) = (std::collections::HashSet::new(), 0, false);
    for s in &stany {
        match s.stan {
            Stan::Trwa => {
                trwa.insert(s.id);
            }
            _ if s.stan.zakonczony() => {
                trwa.remove(&s.id);
            }
            _ => {}
        }
        let w = trwa.iter().filter(|id| **id != ids[2]).count();
        maks_wideo = maks_wideo.max(w);
        obraz_obok |= w == 1 && trwa.contains(&ids[2]);
    }
    assert_eq!(maks_wideo, 1, "dwa wideo naraz mimo limitu 1");
    assert!(obraz_obok, "obraz powinien ruszyć obok wideo");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn p4_foldery_pomin_juz_przekonwertowane() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "nagranie.mp4", 2, "320x240");
    let wy = tmp.path().join("wyniki");
    std::fs::create_dir(&wy).unwrap();
    std::fs::write(wy.join("nagranie.mp3"), b"juz jest").unwrap();
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let mut z = konwersja(&we, Profil::dla(Kontener::Mp3), Some(&wy));
    z.pomin_istniejace = true;
    let id = k.dodaj(z);
    // podfolder struktury tworzony w locie
    let pod = wy.join("a/b");
    let id2 = k.dodaj(konwersja(&we, Profil::dla(Kontener::Mp3), Some(&pod)));
    let w = czekaj_na(&k, &[id, id2], Duration::from_secs(60)).await;
    assert_eq!(w[0].stan, Stan::Pominiete { wyjscie: wy.join("nagranie.mp3") });
    assert_eq!(std::fs::read(wy.join("nagranie.mp3")).unwrap(), b"juz jest");
    assert!(matches!(&w[1].stan, Stan::Gotowe { wyjscie } if wyjscie == &pod.join("nagranie.mp3")), "{w:?}");
}

// ---------- pobieranie (atrapa yt-dlp, bez sieci i bez prawdziwych utworów) ----------

/// Atrapa yt-dlp: wypisuje postęp wg naszego szablonu, „pobiera” przez skopiowanie
/// pliku i podaje ścieżkę jak `--print after_move:`. `blad` = udaje odmowę serwisu (403).
#[cfg(unix)]
fn atrapa_ytdlp(katalog: &Path, zrodlo: &Path, blad: bool) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let s = katalog.join(if blad { "yt-dlp-403" } else { "yt-dlp" });
    let koniec = if blad {
        "echo 'ERROR: unable to download video data: HTTP Error 403: Forbidden' >&2\nexit 1".to_string()
    } else {
        format!("cp \"{}\" \"$cel\"\necho \"PLIK|$cel\"", zrodlo.display())
    };
    let skrypt = format!(
        r#"#!/bin/sh
wy=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then wy="$2"; shift; fi
  shift
done
cel="$(dirname "$wy")/Film testowy [abc].mp4"
for p in 0 1048576 2097152 4194304; do
  echo "SORA|$p|4194304|NA|1048576.0|2"
  sleep 0.05
done
{koniec}
"#
    );
    std::fs::write(&s, skrypt).unwrap();
    std::fs::set_permissions(&s, std::fs::Permissions::from_mode(0o755)).unwrap();
    s
}

#[cfg(unix)]
fn pobranie(url: &str, potem: Option<Profil>, katalog: &Path) -> NoweZadanie {
    use soraconverter_lib::pobieracz::{OpcjePobrania, Wybor};
    NoweZadanie {
        rodzaj: RodzajZadania::Pobranie {
            url: url.into(),
            opcje: OpcjePobrania { wybor: Wybor::Najlepsza, tytul: Some("Film testowy".into()), ..Default::default() },
            potem,
        },
        katalog: Some(katalog.to_path_buf()),
        pomin_istniejace: false,
    }
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pobranie_i_potem_konwersja() {
    let tmp = tempfile::tempdir().unwrap();
    let zrodlo = film(tmp.path(), "zrodlo.mp4", 3, "320x240");
    // folder pobierania nie istnieje: tworzy się sam
    let pobrane = tmp.path().join("pobrane zażółć");
    let mut sc = sciezki();
    sc.ytdlp = Some(atrapa_ytdlp(tmp.path(), &zrodlo, false));
    let zb = Arc::new(Zbieracz::default());
    let k = Kolejka::nowa(2, zb.clone(), Arc::new(RwLock::new(sc)));
    let id = k.dodaj(pobranie("https://example.com/film", Some(Profil::dla(Kontener::Mp3)), &pobrane));
    let w = czekaj_na(&k, &[id], Duration::from_secs(30)).await;
    let Stan::Gotowe { wyjscie } = &w[0].stan else { panic!("{w:?}") };
    assert_eq!(wyjscie, &pobrane.join("Film testowy [abc].mp4"));
    assert_eq!(w[0].rodzaj, "pobranie");
    // zadanie konwersji dodane po pobraniu
    let start = Instant::now();
    let konwersja = loop {
        if let Some(z) = k.lista().into_iter().find(|z| z.id != id && z.stan.zakonczony()) {
            break z;
        }
        assert!(start.elapsed() < Duration::from_secs(30), "brak konwersji po pobraniu");
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    let Stan::Gotowe { wyjscie } = &konwersja.stan else { panic!("{konwersja:?}") };
    assert_eq!(wyjscie, &pobrane.join("Film testowy [abc].mp3"));
    let postepy = zb.postepy.lock().unwrap();
    assert!(postepy.iter().any(|p| p.id == id && p.bajty_s == Some(1048576.0)));
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a7_pobranie_403_po_ludzku() {
    let tmp = tempfile::tempdir().unwrap();
    let mut sc = sciezki();
    sc.ytdlp = Some(atrapa_ytdlp(tmp.path(), Path::new("/nie-ma"), true));
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sc)));
    let id = k.dodaj(pobranie("https://example.com/film", None, tmp.path()));
    let w = czekaj_na(&k, &[id], Duration::from_secs(30)).await;
    let Stan::Blad { komunikat } = &w[0].stan else { panic!("{w:?}") };
    assert!(komunikat.starts_with("Serwis zablokował pobieranie. Kliknij Aktualizuj yt-dlp"), "{komunikat}");
    assert!(komunikat.contains("HTTP Error 403"), "surowy błąd do raportu");
}

/// Minimalny serwer HTTP na 127.0.0.1 z jednym plikiem (bez internetu).
fn serwer_http(plik: PathBuf) -> u16 {
    use std::io::{BufRead, BufReader, Write};
    let nasluch = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = nasluch.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for strumien in nasluch.incoming().flatten() {
            let plik = plik.clone();
            std::thread::spawn(move || {
                let mut r = BufReader::new(strumien.try_clone().unwrap());
                let mut pierwsza = String::new();
                let _ = r.read_line(&mut pierwsza);
                loop {
                    let mut l = String::new();
                    if r.read_line(&mut l).unwrap_or(0) == 0 || l == "\r\n" {
                        break;
                    }
                }
                let dane = std::fs::read(&plik).unwrap();
                let mut w = strumien;
                let _ = write!(
                    w,
                    "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    dane.len()
                );
                if !pierwsza.starts_with("HEAD") {
                    let _ = w.write_all(&dane);
                }
            });
        }
    });
    port
}

/// Prawdziwy yt-dlp (jeśli jest w PATH albo SORACONVERTER_YTDLP) pobiera z lokalnego serwera
/// plik wygenerowany przez ffmpeg (żadnych cudzych utworów).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pobranie_prawdziwym_ytdlp_z_lokalnego_serwera() {
    let mut sc = sciezki();
    if let Ok(p) = std::env::var("SORACONVERTER_YTDLP") {
        sc.ytdlp = Some(p.into());
    }
    if sc.ytdlp.is_none() {
        eprintln!("POMINIĘTE: brak yt-dlp (ustaw SORACONVERTER_YTDLP)");
        return;
    }
    std::env::set_var("NO_PROXY", "127.0.0.1");
    std::env::set_var("no_proxy", "127.0.0.1");
    let tmp = tempfile::tempdir().unwrap();
    let zrodlo = film(tmp.path(), "film.mp4", 4, "640x360");
    let port = serwer_http(zrodlo);
    let pobrane = tmp.path().join("pobrane");
    let zb = Arc::new(Zbieracz::default());
    let k = Kolejka::nowa(1, zb.clone(), Arc::new(RwLock::new(sc)));
    let id = k.dodaj(NoweZadanie {
        rodzaj: RodzajZadania::Pobranie {
            url: format!("http://127.0.0.1:{port}/film.mp4"),
            opcje: soraconverter_lib::pobieracz::OpcjePobrania::default(),
            potem: None,
        },
        katalog: Some(pobrane.clone()),
        pomin_istniejace: false,
    });
    let w = czekaj_na(&k, &[id], Duration::from_secs(60)).await;
    let Stan::Gotowe { wyjscie } = &w[0].stan else { panic!("{w:?}") };
    assert!(wyjscie.starts_with(&pobrane) && wyjscie.exists(), "{wyjscie:?}");
    assert!(zb.postepy.lock().unwrap().iter().any(|p| p.id == id && p.procent > 0.0));
}

/// Wybrany folder zapisu, którego nie ma, tworzy się sam; gdy się nie da (ścieżka to plik),
/// błąd mówi wprost, co zrobić.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wybrany_folder_tworzy_sie_sam() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "a.mp4", 1, "320x240");
    let k = Kolejka::nowa(2, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let nowy = tmp.path().join("nie ma/jeszcze/Gotowe");
    let zajete = tmp.path().join("plik-nie-folder");
    std::fs::write(&zajete, b"x").unwrap();
    let ids = vec![
        k.dodaj(konwersja(&we, Profil::dla(Kontener::Mp3), Some(&nowy))),
        k.dodaj(konwersja(&we, Profil::dla(Kontener::Mp3), Some(&zajete.join("pod")))),
    ];
    let w = czekaj_na(&k, &ids, Duration::from_secs(60)).await;
    let Stan::Gotowe { wyjscie } = &w[0].stan else { panic!("{w:?}") };
    assert_eq!(wyjscie, &nowy.join("a.mp3"));
    let Stan::Blad { komunikat } = &w[1].stan else { panic!("{w:?}") };
    assert!(
        komunikat.starts_with("nie można użyć folderu") && komunikat.contains("zmień folder zapisu"),
        "{komunikat}"
    );
}

/// Usterka 1 z 07.10: ucięty plik (nagłówek mówi pełny czas, dane urywają się wcześniej)
/// przechodził jako „Gotowe” bez słowa. MKV zapisuje czas w nagłówku, więc `head -c`
/// zostawia nagłówek z pełnym czasem i połowę danych.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn uciety_plik_gotowe_z_ostrzezeniem() {
    let tmp = tempfile::tempdir().unwrap();
    let caly = film(tmp.path(), "caly.mkv", 12, "320x240");
    let rozmiar = std::fs::metadata(&caly).unwrap().len();
    let uciety = tmp.path().join("uciety.mkv");
    let ok = Command::new("head").arg("-c").arg((rozmiar * 4 / 10).to_string()).arg(&caly).output().unwrap();
    std::fs::write(&uciety, ok.stdout).unwrap();
    let k = Kolejka::nowa(2, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let ids = vec![
        k.dodaj(konwersja(&uciety, Profil::dla(Kontener::Mp3), None)),
        k.dodaj(konwersja(&caly, Profil::dla(Kontener::Mp3), None)),
    ];
    let w = czekaj_na(&k, &ids, Duration::from_secs(60)).await;
    assert!(matches!(w[0].stan, Stan::Gotowe { .. }), "{w:?}");
    let Some(soraconverter_lib::kolejka::OstrzezenieWyniku::Uciete { zrodlo_konczy_s, wynik_s, oczekiwane_s }) =
        w[0].ostrzezenie.clone()
    else {
        panic!("brak ostrzeżenia o uciętym pliku: {w:?}")
    };
    assert!((11.5..12.5).contains(&oczekiwane_s), "{oczekiwane_s}");
    assert!(wynik_s < oczekiwane_s * 0.97 && wynik_s > 1.0, "{wynik_s}");
    assert_eq!(zrodlo_konczy_s, wynik_s);
    assert_eq!(w[1].ostrzezenie, None, "cały plik bez ostrzeżenia");
}

/// Usterka 4b z 07.10: szacunek GIF-a 43 MB, wynik 11 MB. Po kalibracji szacunek dla
/// typowego materiału (ruch w części kadru) mieści się w ×2 rzeczywistego rozmiaru.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn gif_szacunek_skalibrowany() {
    let tmp = tempfile::tempdir().unwrap();
    let mut pliki = Vec::new();
    for (nazwa, graf) in [
        ("okno.mp4", "color=c=0x334455:size=1280x720:rate=30:d=4[t];testsrc2=size=480x270:rate=30:d=4[m];[t][m]overlay=400:200"),
        ("ruch.mp4", "smptehdbars=size=1280x720:rate=30:d=4[t];testsrc2=size=320x180:rate=30:d=4[m];[t][m]overlay=x='mod(t*100,960)':y=300"),
    ] {
        let p = tmp.path().join(nazwa);
        let ok = Command::new("ffmpeg")
            .args(["-nostdin", "-hide_banner", "-y", "-loglevel", "error", "-filter_complex", graf])
            .args(["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"])
            .arg(&p)
            .status()
            .unwrap();
        assert!(ok.success());
        pliki.push(p);
    }
    let sc = sciezki();
    let k = Kolejka::nowa(2, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sc.clone())));
    let mut p = Profil::dla(Kontener::Gif);
    p.gif = Some(ProfilGif::default());
    p.audio = None;
    let ids: Vec<u64> = pliki.iter().map(|f| k.dodaj(konwersja(f, p.clone(), None))).collect();
    let w = czekaj_na(&k, &ids, Duration::from_secs(120)).await;
    for (z, f) in w.iter().zip(&pliki) {
        let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
        let jest = std::fs::metadata(wyjscie).unwrap().len() as f64;
        let media = soraconverter_lib::sonda::sonduj(sc.ffprobe.as_ref().unwrap(), f).await.unwrap();
        let szac = soraconverter_lib::szacunek::szacuj(&media, &p).bajty.unwrap() as f64;
        let r = szac / jest;
        assert!((0.5..2.0).contains(&r), "{f:?}: szacunek {szac:.0} B, wynik {jest:.0} B (×{r:.2})");
    }
}
