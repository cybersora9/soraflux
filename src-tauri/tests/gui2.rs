//! GUI 2.0 z prawdziwym ffmpeg: głośność 2-przebiegowo do celu, pauza kolejki, wyodrębnianie ścieżek,
//! łączenie klipów (kopią i z kodowaniem), porównanie przed/po (SSIM, głośność).

use soraconverter_lib::budowniczy::{self, obrobka};
use soraconverter_lib::kolejka::{InfoZadania, Kolejka, Nadajnik, NoweZadanie, RodzajZadania, Stan};
use soraconverter_lib::komendy;
use soraconverter_lib::narzedzia::{self, Sciezki};
use soraconverter_lib::postep::Postep;
use soraconverter_lib::sonda;
use soraconverter_lib::ustawienia::*;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Zbieracz {
    postepy: Mutex<Vec<Postep>>,
}

impl Nadajnik for Zbieracz {
    fn postep(&self, p: &Postep) {
        self.postepy.lock().unwrap().push(p.clone());
    }
    fn stan(&self, _: &InfoZadania) {}
}

fn sciezki() -> Sciezki {
    narzedzia::wykryj(&Sciezki::default(), &[])
}

fn ffmpeg(args: &[&str]) {
    let ok = Command::new("ffmpeg").args(["-hide_banner", "-y", "-loglevel", "error"]).args(args).status().unwrap();
    assert!(ok.success(), "{args:?}");
}

/// Film testowy: obraz + ton o danej głośności (`volume`), opcjonalnie bez dźwięku.
fn film(k: &Path, nazwa: &str, s: u32, rozmiar: &str, glosnosc: Option<&str>) -> PathBuf {
    let p = k.join(nazwa);
    let src = format!("testsrc2=size={rozmiar}:rate=30:duration={s}");
    let p_s = p.to_string_lossy().into_owned();
    match glosnosc {
        Some(v) => {
            let a = format!("sine=frequency=440:duration={s},volume={v}");
            ffmpeg(&[
                "-f",
                "lavfi",
                "-i",
                &src,
                "-f",
                "lavfi",
                "-i",
                &a,
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                &p_s,
            ]);
        }
        None => {
            ffmpeg(&["-f", "lavfi", "-i", &src, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &p_s])
        }
    }
    p
}

async fn czekaj(k: &Kolejka, id: u64, limit: Duration) -> InfoZadania {
    let start = Instant::now();
    loop {
        if let Some(z) = k.lista().into_iter().find(|z| z.id == id && z.stan.zakonczony()) {
            return z;
        }
        assert!(start.elapsed() < limit, "zadanie {id} nie skończyło się: {:?}", k.lista());
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn zadanie(rodzaj: RodzajZadania) -> NoweZadanie {
    NoweZadanie { rodzaj, katalog: None, pomin_istniejace: false, dopisek: None }
}

fn lufs(plik: &Path) -> f64 {
    let w = Command::new("ffmpeg").args(obrobka::argumenty_glosnosci(plik)).output().unwrap();
    budowniczy::PomiarGlosnosci::z_tekstu(&String::from_utf8_lossy(&w.stderr)).expect("pomiar").i
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn glosnosc_dwa_przebiegi_trafia_w_cel() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "cichy.mp4", 8, "320x240", Some("0.05"));
    let przed = lufs(&we);
    assert!(przed < -30.0, "źródło ma być ciche: {przed}");
    let zb = Arc::new(Zbieracz::default());
    let k = Kolejka::nowa(1, zb.clone(), Arc::new(RwLock::new(sciezki())));
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::Kopiuj, ..Default::default() });
    p.audio = Some(ProfilAudio { normalizacja: true, lufs: Some(-14.0), ..Default::default() });
    let id = k.dodaj(zadanie(RodzajZadania::Konwersja { wejscie: we.clone(), profil: p }));
    let z = czekaj(&k, id, Duration::from_secs(120)).await;
    let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
    let po = lufs(wyjscie);
    assert!((po + 14.0).abs() < 1.0, "po normalizacji {po} LUFS, cel −14");
    // pomiar to osobny przebieg: postęp raportuje 2 przebiegi
    assert!(zb.postepy.lock().unwrap().iter().any(|p| p.przebiegi == 2 && p.przebieg == 1));
}

#[test]
fn argumenty_pomiaru_tylko_przy_normalizacji() {
    let m = sonda::Media {
        audio: Some(sonda::StrumienAudio { indeks: 1, kodek: "aac".into(), ..Default::default() }),
        ..Default::default()
    };
    let mut p = Profil::dla(Kontener::Mp3);
    assert!(budowniczy::argumenty_pomiaru(&m, &p, Path::new("a.mp4")).is_none());
    p.audio.as_mut().unwrap().normalizacja = true;
    p.audio.as_mut().unwrap().lufs = Some(-23.0);
    let a = budowniczy::argumenty_pomiaru(&m, &p, Path::new("a.mp4")).unwrap();
    let j = a.iter().map(|x| x.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");
    assert!(j.contains("-map 0:1 -af loudnorm=I=-23:TP=-1.5:LRA=11:print_format=json"), "{j}");
    assert!(j.ends_with("-f null -"));
    let pomiar = budowniczy::PomiarGlosnosci { i: -30.5, tp: -10.0, lra: 2.0, prog: -41.0, przesuniecie: 0.3 };
    assert_eq!(
        budowniczy::filtr_loudnorm(-14.0, Some(&pomiar)),
        "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-30.5:measured_TP=-10:measured_LRA=2:measured_thresh=-41:offset=0.3:linear=true"
    );
    let tekst = "[Parsed_loudnorm_0 @ 0x1]\n{\n\t\"input_i\" : \"-30.50\",\n\t\"input_tp\" : \"-10.00\",\n\t\"input_lra\" : \"2.00\",\n\t\"input_thresh\" : \"-41.00\",\n\t\"output_i\" : \"-14.0\",\n\t\"target_offset\" : \"0.30\"\n}\n";
    assert_eq!(budowniczy::PomiarGlosnosci::z_tekstu(tekst), Some(pomiar));
    assert_eq!(budowniczy::PomiarGlosnosci::z_tekstu(&tekst.replace("-30.50", "-inf")), None, "cisza = jeden przebieg");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pauza_wstrzymuje_start_kolejnych() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path(), "p.mp4", 2, "160x120", Some("0.5"));
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    k.wstrzymaj(true);
    assert!(k.wstrzymana());
    let id = k.dodaj(zadanie(RodzajZadania::Konwersja { wejscie: we, profil: Profil::dla(Kontener::Mp3) }));
    tokio::time::sleep(Duration::from_millis(700)).await;
    let z = k.lista().into_iter().find(|z| z.id == id).unwrap();
    assert_eq!(z.stan, Stan::Oczekuje, "w pauzie nic nie startuje");
    k.wstrzymaj(false);
    let z = czekaj(&k, id, Duration::from_secs(60)).await;
    assert!(matches!(z.stan, Stan::Gotowe { .. }), "{z:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wyodrebnia_obraz_dzwiek_i_napisy() {
    let tmp = tempfile::tempdir().unwrap();
    let we0 = film(tmp.path(), "zrodlo.mp4", 3, "320x240", Some("0.5"));
    let srt = tmp.path().join("n.srt");
    std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,000\nCześć\n").unwrap();
    let we = tmp.path().join("film z napisami.mkv");
    ffmpeg(&[
        "-i",
        &we0.to_string_lossy(),
        "-i",
        &srt.to_string_lossy(),
        "-map",
        "0",
        "-map",
        "1",
        "-c",
        "copy",
        "-metadata:s:a:0",
        "language=pol",
        "-metadata:s:s:0",
        "language=eng",
        &we.to_string_lossy(),
    ]);
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let id = k.dodaj(zadanie(RodzajZadania::Sciezki { wejscie: we.clone() }));
    let z = czekaj(&k, id, Duration::from_secs(60)).await;
    assert!(matches!(z.stan, Stan::Gotowe { .. }), "{z:?}");
    let nazwy: Vec<String> = z.wyniki.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
    assert_eq!(nazwy, vec!["film z napisami.v1.mp4", "film z napisami.a1-pol.m4a", "film z napisami.s1-eng.srt"]);
    assert!(z.wyniki.iter().all(|p| p.is_file()));
    assert_eq!(z.wejscie.as_deref(), Some(we.as_path()));
    // przeciągać do innej apki można tylko wyniki zadań, nie dowolne pliki
    assert!(komendy::wynik_z_kolejki(&k.lista(), &z.wyniki[1]));
    assert!(!komendy::wynik_z_kolejki(&k.lista(), &we));
    let srt_wynik = std::fs::read_to_string(&z.wyniki[2]).unwrap();
    assert!(srt_wynik.contains("Cześć"), "{srt_wynik}");
    let ffprobe = sciezki().ffprobe.unwrap();
    let a = sonda::sonduj(&ffprobe, &z.wyniki[1]).await.unwrap();
    assert!(a.wideo.is_none() && a.audio.as_ref().unwrap().kodek == "aac", "bez kodowania: {a:?}");
    let jest_part =
        std::fs::read_dir(tmp.path()).unwrap().flatten().any(|e| e.file_name().to_string_lossy().contains(".part."));
    assert!(!jest_part);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn laczy_kopia_i_z_kodowaniem() {
    let tmp = tempfile::tempdir().unwrap();
    let a = film(tmp.path(), "a.mp4", 2, "320x240", Some("0.5"));
    let b = film(tmp.path(), "b'2.mp4", 3, "320x240", Some("0.5"));
    let c = film(tmp.path(), "c.mp4", 2, "640x360", None);
    let k = Kolejka::nowa(1, Arc::new(Zbieracz::default()), Arc::new(RwLock::new(sciezki())));
    let ffprobe = sciezki().ffprobe.unwrap();
    // te same parametry: kopia strumieni
    let id = k.dodaj(NoweZadanie {
        dopisek: Some("połączone".into()),
        ..zadanie(RodzajZadania::Polacz { wejscia: vec![a.clone(), b.clone()], kontener: Kontener::Mp4 })
    });
    let z = czekaj(&k, id, Duration::from_secs(60)).await;
    let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
    assert_eq!(z.bez_kodowania, Some(true));
    assert_eq!(wyjscie.file_name().unwrap().to_string_lossy(), "a (połączone).mp4");
    let m = sonda::sonduj(&ffprobe, wyjscie).await.unwrap();
    assert!((m.czas_s.unwrap() - 5.0).abs() < 0.3, "{:?}", m.czas_s);
    // inne wymiary i brak dźwięku w jednym: kodowanie, cisza w miejsce brakującego dźwięku
    let id = k.dodaj(zadanie(RodzajZadania::Polacz { wejscia: vec![a, c], kontener: Kontener::Mp4 }));
    let z = czekaj(&k, id, Duration::from_secs(120)).await;
    let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
    assert_eq!(z.bez_kodowania, Some(false));
    let m = sonda::sonduj(&ffprobe, wyjscie).await.unwrap();
    assert!((m.czas_s.unwrap() - 4.0).abs() < 0.3, "{:?}", m.czas_s);
    let v = m.wideo.unwrap();
    assert_eq!((v.w, v.h), (320, 240));
    assert!(m.audio.is_some());
    // jeden plik: błąd po ludzku
    let id = k.dodaj(zadanie(RodzajZadania::Polacz { wejscia: vec![b], kontener: Kontener::Mp4 }));
    let z = czekaj(&k, id, Duration::from_secs(10)).await;
    let Stan::Blad { komunikat } = &z.stan else { panic!("{z:?}") };
    assert_eq!(soraconverter_lib::blad::klucz(komunikat).as_deref(), Some("polacz_za_malo"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn porownanie_ssim_i_glosnosc() {
    let tmp = tempfile::tempdir().unwrap();
    let o = film(tmp.path(), "o.mp4", 3, "320x240", Some("0.5"));
    let w = tmp.path().join("w.mp4");
    ffmpeg(&[
        "-i",
        &o.to_string_lossy(),
        "-vf",
        "scale=160:120",
        "-c:v",
        "libx264",
        "-crf",
        "35",
        "-af",
        "volume=0.25",
        &w.to_string_lossy(),
    ]);
    let s = sciezki();
    let (ff, fp) = (s.ffmpeg.unwrap(), s.ffprobe.unwrap());
    let m = komendy::porownaj_metryki_z(&ff, &fp, &o, &w, false).await.unwrap();
    let ssim = m.ssim.expect("ssim");
    assert!((0.5..1.0).contains(&ssim), "{ssim}");
    assert!(m.vmaf.is_none(), "bez libvmaf nie liczymy VMAF");
    let (przed, po) = (m.lufs_przed.unwrap(), m.lufs_po.unwrap());
    assert!((przed - po - 12.0).abs() < 1.5, "−12 dB: {przed} → {po}");
    assert!(m.rozmiar_po.unwrap() < m.rozmiar_przed.unwrap());
    let k = komendy::porownaj_klatke_z(&ff, &o, &w, 1.0, 0.0).await.unwrap();
    assert!(k.przed.starts_with("data:image/jpeg;base64,") && k.po.starts_with("data:image/jpeg;base64,"));
    // VMAF tylko, gdy ffmpeg ma libvmaf
    let filtry = narzedzia::filtry(&ff);
    if komendy::ma_vmaf(&filtry) {
        let m = komendy::porownaj_metryki_z(&ff, &fp, &o, &w, true).await.unwrap();
        assert!(m.vmaf.is_some());
    }
}

#[test]
fn plik_motywu_tylko_json() {
    let tmp = tempfile::tempdir().unwrap();
    let p = tmp.path().join("moj.json");
    komendy::zapisz_motyw_z(&p, r##"{"akcent":"#ff7ac6"}"##).unwrap();
    assert_eq!(komendy::wczytaj_motyw_z(&p).unwrap(), r##"{"akcent":"#ff7ac6"}"##);
    assert!(komendy::zapisz_motyw_z(&tmp.path().join("x.exe"), "{}").is_err());
    assert!(komendy::zapisz_motyw_z(&p, "nie json").is_err());
    std::fs::write(tmp.path().join("duzy.json"), vec![b' '; 70_000]).unwrap();
    assert!(komendy::wczytaj_motyw_z(&tmp.path().join("duzy.json")).is_err());
}

#[test]
fn skala_w_zakresie() {
    use soraconverter_lib::konfig::{skala_poprawna, Konfig};
    assert_eq!(skala_poprawna(1.25), 1.25);
    assert_eq!(skala_poprawna(3.0), 1.5);
    assert_eq!(skala_poprawna(0.2), 0.9);
    assert_eq!(skala_poprawna(f64::NAN), 1.0);
    assert_eq!(skala_poprawna(1.1000001), 1.1);
    // konfig sprzed 2.0 (bez pól GUI 2.0) wczytuje się z domyślnymi
    let k: Konfig = serde_json::from_str(r#"{"motyw_wyglad":"jp-b","tryb":"prosty"}"#).unwrap();
    assert_eq!((k.skala, k.motyw_wlasny.is_none(), k.tryb.as_deref()), (1.0, true, Some("prosty")));
}
