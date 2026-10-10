//! Tryb Napisy (S5) z prawdziwym ffmpeg i udawanym whisper-cli (skrypt sh): kolejka, pliki SRT/VTT,
//! brak nadpisywania, brak dźwięku, cisza, anulowanie, fragmenty długich plików, wypalanie.
//! Jakość i szybkość prawdziwego whispera mierzy się ręcznie na Windows (lista w PR).
#![cfg(unix)]

use soraconverter_lib::blad;
use soraconverter_lib::kolejka::{InfoZadania, Kolejka, Nadajnik, NoweZadanie, RodzajZadania, Stan};
use soraconverter_lib::napisy::{JezykNapisow, OpcjeNapisow, StylNapisow};
use soraconverter_lib::narzedzia::{self, Sciezki};
use soraconverter_lib::postep::Postep;
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

const MOWA: &str = r#"{
	"result": {
		"language": "pl"
	},
	"transcription": [
		{
			"offsets": {"from": 1000, "to": 2500},
			"text": " Dzień dobry wszystkim."
		},
		{
			"offsets": {"from": 2500, "to": 2900},
			"text": " [BLANK_AUDIO]"
		},
		{
			"offsets": {"from": 3000, "to": 9000},
			"text": " To jest bardzo długie zdanie, które na pewno nie zmieści się w dwóch krótkich liniach napisów."
		}
	]
}
"#;

const CISZA: &str = r#"{"result": {"language": "en"}, "transcription": [{"offsets": {"from": 0, "to": 3000}, "text": " [BLANK_AUDIO]"}]}"#;

/// Udawany whisper-cli: zapisuje argumenty, kopiuje WAV (do sprawdzenia formatu), pisze postęp na stderr
/// i odpowiedź z `odpowiedz.json` do `<-of>.json`. Plik `spij` = czeka 30 s, plik `kod` = kończy błędem.
fn udawany_whisper(katalog: &Path, odpowiedz: &str) -> PathBuf {
    std::fs::create_dir_all(katalog).unwrap();
    let skrypt = katalog.join("whisper-cli");
    std::fs::write(
        &skrypt,
        r#"#!/bin/sh
DIR="$(dirname "$0")"
echo "$@" >> "$DIR/argumenty.txt"
while [ $# -gt 0 ]; do
  case "$1" in
    -f) WAV="$2"; shift ;;
    -of) BAZA="$2"; shift ;;
  esac
  shift
done
[ -s "$WAV" ] || { echo "brak wav $WAV" >&2; exit 2; }
cp "$WAV" "$DIR/ostatni.wav"
echo "whisper_print_progress_callback: progress =  50%" >&2
if [ -f "$DIR/spij" ]; then sleep 30; fi
if [ -f "$DIR/kod" ]; then echo "error: failed to initialize whisper context" >&2; exit 3; fi
cp "$DIR/odpowiedz.json" "$BAZA.json"
echo "whisper_print_progress_callback: progress = 100%" >&2
"#,
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&skrypt, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::write(katalog.join("odpowiedz.json"), odpowiedz).unwrap();
    skrypt
}

fn ffmpeg(args: &[&str], wyjscie: &Path) {
    let ok = Command::new("ffmpeg")
        .args(["-hide_banner", "-y", "-loglevel", "error"])
        .args(args)
        .arg(wyjscie)
        .status()
        .unwrap();
    assert!(ok.success());
}

fn film(katalog: &Path, nazwa: &str, rozmiar: &str, sekundy: u32, dzwiek: bool) -> PathBuf {
    let p = katalog.join(nazwa);
    let obraz = format!("testsrc2=size={rozmiar}:rate=25:duration={sekundy}");
    let ton = format!("sine=frequency=300:duration={sekundy}");
    let mut a = vec!["-f", "lavfi", "-i", &obraz];
    if dzwiek {
        a.extend(["-f", "lavfi", "-i", &ton, "-c:a", "aac", "-shortest"]);
    }
    a.extend(["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
    ffmpeg(&a, &p);
    p
}

struct Srodowisko {
    _tmp: tempfile::TempDir,
    katalog: PathBuf,
    whisper_dir: PathBuf,
    kolejka: Kolejka,
    zb: Arc<Zbieracz>,
}

fn srodowisko(odpowiedz: &str) -> Srodowisko {
    let tmp = tempfile::tempdir().unwrap();
    let katalog = tmp.path().join("filmy zażółć 日本");
    std::fs::create_dir_all(&katalog).unwrap();
    let whisper_dir = tmp.path().join("whisper");
    let whisper = udawany_whisper(&whisper_dir, odpowiedz);
    let modele = tmp.path().join("modele");
    std::fs::create_dir_all(&modele).unwrap();
    std::fs::write(modele.join("ggml-base.bin"), b"udawany model").unwrap();
    let mut s = narzedzia::wykryj(&Sciezki::default(), &[]);
    s.whisper = Some(whisper);
    let zb = Arc::new(Zbieracz::default());
    let kolejka = Kolejka::nowa(1, zb.clone(), Arc::new(RwLock::new(s)));
    kolejka.ustaw_katalog_modeli(Some(modele));
    Srodowisko { _tmp: tmp, katalog, whisper_dir, kolejka, zb }
}

fn zadanie(wejscie: &Path, opcje: OpcjeNapisow) -> NoweZadanie {
    NoweZadanie {
        rodzaj: RodzajZadania::Napisy { wejscie: wejscie.to_path_buf(), opcje },
        katalog: None,
        pomin_istniejace: false,
        dopisek: Some("z napisami".into()),
    }
}

async fn czekaj(k: &Kolejka, id: u64, limit: Duration) -> InfoZadania {
    let start = Instant::now();
    loop {
        if let Some(z) = k.lista().into_iter().find(|z| z.id == id && z.stan.zakonczony()) {
            return z;
        }
        assert!(start.elapsed() < limit, "zadanie nie skończyło się w czasie: {:?}", k.lista());
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn klucz_bledu(z: &InfoZadania) -> Option<String> {
    match &z.stan {
        Stan::Blad { komunikat } => blad::klucz(komunikat),
        _ => None,
    }
}

fn bez_czesci(katalog: &Path) {
    for e in std::fs::read_dir(katalog).unwrap().flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        assert!(!n.contains(".part."), "został niepełny plik {n}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s5_srt_i_vtt_z_unicode_postepem_i_bez_nadpisywania() {
    let s = srodowisko(MOWA);
    let we = film(&s.katalog, "rolka ąę 日本.mp4", "360x640", 3, true);
    // istniejące napisy użytkownika: nie mogą zniknąć
    let stary = s.katalog.join("rolka ąę 日本.srt");
    std::fs::write(&stary, "moje napisy").unwrap();
    let opcje = OpcjeNapisow { jezyk: JezykNapisow::Pl, vtt: true, ..Default::default() };
    let id = s.kolejka.dodaj(zadanie(&we, opcje));
    let z = czekaj(&s.kolejka, id, Duration::from_secs(60)).await;
    let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
    assert_eq!(std::fs::read_to_string(&stary).unwrap(), "moje napisy", "nic nie nadpisane");
    let srt = s.katalog.join("rolka ąę 日本 (1).srt");
    let vtt = s.katalog.join("rolka ąę 日本.vtt");
    assert_eq!(wyjscie, &srt);
    let w = z.napisy.clone().unwrap();
    assert_eq!(w.jezyk.as_deref(), Some("pl"));
    assert_eq!(w.pliki, vec![srt.clone(), vtt.clone()]);
    assert!(w.zmieniona_nazwa);
    let tekst = std::fs::read_to_string(&srt).unwrap();
    assert!(
        tekst.starts_with("1\n00:00:01,000 --> 00:00:02,500\nDzień dobry wszystkim.\n\n2\n00:00:03,000 --> "),
        "{tekst}"
    );
    assert!(!tekst.contains("BLANK_AUDIO"));
    // pionowy film: linie krótkie, maks. 2 na kwestię
    for kw in tekst.split("\n\n").filter(|k| !k.is_empty()) {
        let linie: Vec<&str> = kw.lines().skip(2).collect();
        assert!((1..=2).contains(&linie.len()), "{kw}");
        assert!(linie.iter().all(|l| l.chars().count() <= 24), "{kw}");
    }
    assert_eq!(w.kwestie, tekst.matches(" --> ").count());
    assert!(std::fs::read_to_string(&vtt).unwrap().starts_with("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n"));
    bez_czesci(&s.katalog);
    // whisper dostał WAV 16 kHz mono i wybrany język
    let argumenty = std::fs::read_to_string(s.whisper_dir.join("argumenty.txt")).unwrap();
    assert!(
        argumenty.contains("-l pl") && argumenty.contains("-oj") && argumenty.contains("-f audio-000.wav"),
        "{argumenty}"
    );
    let sonda = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "stream=sample_rate,channels,codec_name", "-of", "csv=p=0"])
        .arg(s.whisper_dir.join("ostatni.wav"))
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&sonda.stdout).trim(), "pcm_s16le,16000,1");
    // postęp z etapami, rosnący, poniżej 100 przed końcem
    let postepy = s.zb.postepy.lock().unwrap().clone();
    let etapy: Vec<String> = postepy.iter().filter_map(|p| p.etap.clone()).collect();
    assert!(etapy.contains(&"dzwiek".to_string()) && etapy.contains(&"rozpoznawanie".to_string()), "{etapy:?}");
    assert!(postepy.windows(2).all(|p| p[1].procent >= p[0].procent), "postęp nie cofa się");
    assert!(postepy.iter().all(|p| p.procent < 100.0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s5_bez_dzwieku_cisza_brak_modelu_i_blad_whispera() {
    let s = srodowisko(CISZA);
    let niemy = film(&s.katalog, "niemy.mp4", "320x240", 1, false);
    let id = s.kolejka.dodaj(zadanie(&niemy, OpcjeNapisow::default()));
    assert_eq!(
        klucz_bledu(&czekaj(&s.kolejka, id, Duration::from_secs(30)).await).as_deref(),
        Some("napisy_brak_audio")
    );

    let we = film(&s.katalog, "cisza.mp4", "320x240", 2, true);
    let id = s.kolejka.dodaj(zadanie(&we, OpcjeNapisow::default()));
    assert_eq!(klucz_bledu(&czekaj(&s.kolejka, id, Duration::from_secs(30)).await).as_deref(), Some("napisy_cisza"));
    assert!(!s.katalog.join("cisza.srt").exists());

    let opcje = OpcjeNapisow { model: soraconverter_lib::napisy::ModelNapisow::Small, ..Default::default() };
    let id = s.kolejka.dodaj(zadanie(&we, opcje));
    let z = czekaj(&s.kolejka, id, Duration::from_secs(30)).await;
    assert_eq!(klucz_bledu(&z).as_deref(), Some("napisy_brak_modelu"));

    let id = s.kolejka.dodaj(zadanie(&we, OpcjeNapisow { srt: false, ..Default::default() }));
    assert_eq!(klucz_bledu(&czekaj(&s.kolejka, id, Duration::from_secs(30)).await).as_deref(), Some("napisy_nic"));

    std::fs::write(s.whisper_dir.join("kod"), b"").unwrap();
    let id = s.kolejka.dodaj(zadanie(&we, OpcjeNapisow::default()));
    let z = czekaj(&s.kolejka, id, Duration::from_secs(30)).await;
    assert_eq!(klucz_bledu(&z).as_deref(), Some("napisy_proces"));
    let Stan::Blad { komunikat } = &z.stan else { panic!() };
    assert!(komunikat.contains("failed to initialize whisper context"), "ogon stderr w raporcie: {komunikat}");
    bez_czesci(&s.katalog);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s5_anulowanie_w_trakcie_rozpoznawania() {
    let s = srodowisko(MOWA);
    std::fs::write(s.whisper_dir.join("spij"), b"").unwrap();
    let we = film(&s.katalog, "film.mp4", "320x240", 2, true);
    let id = s.kolejka.dodaj(zadanie(&we, OpcjeNapisow { vtt: true, ..Default::default() }));
    // czekamy, aż whisper wystartuje (pisze argumenty), potem anulujemy
    let start = Instant::now();
    while !s.whisper_dir.join("ostatni.wav").exists() {
        assert!(start.elapsed() < Duration::from_secs(20), "whisper nie wystartował");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let t = Instant::now();
    s.kolejka.anuluj(id);
    let z = czekaj(&s.kolejka, id, Duration::from_secs(10)).await;
    assert_eq!(z.stan, Stan::Anulowane);
    assert!(t.elapsed() < Duration::from_secs(5), "anulowanie musi zabić whispera, nie czekać 30 s");
    assert!(!s.katalog.join("film.srt").exists() && !s.katalog.join("film.vtt").exists());
    bez_czesci(&s.katalog);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s5_dlugi_plik_we_fragmentach_z_przesunieciem_czasu() {
    let s = srodowisko(
        r#"{"result":{"language":"en"},"transcription":[{"offsets":{"from":1000,"to":2000},"text":" Hello."}]}"#,
    );
    // 16 min 40 s samego dźwięku: 2 fragmenty po 10 min
    let we = s.katalog.join("podcast.m4a");
    ffmpeg(
        &["-f", "lavfi", "-i", "sine=frequency=200:duration=1000:sample_rate=8000", "-c:a", "aac", "-b:a", "16k"],
        &we,
    );
    let id = s.kolejka.dodaj(zadanie(&we, OpcjeNapisow::default()));
    let z = czekaj(&s.kolejka, id, Duration::from_secs(120)).await;
    assert!(matches!(z.stan, Stan::Gotowe { .. }), "{z:?}");
    let srt = std::fs::read_to_string(s.katalog.join("podcast.srt")).unwrap();
    assert_eq!(
        srt, "1\n00:00:01,000 --> 00:00:02,000\nHello.\n\n2\n00:10:01,000 --> 00:10:02,000\nHello.\n\n",
        "drugi fragment przesunięty o 600 s"
    );
    let argumenty = std::fs::read_to_string(s.whisper_dir.join("argumenty.txt")).unwrap();
    assert!(argumenty.contains("audio-000.wav") && argumenty.contains("audio-001.wav"), "{argumenty}");
    assert_eq!(z.napisy.unwrap().jezyk.as_deref(), Some("en"));
    let przebiegi: Vec<u8> = s.zb.postepy.lock().unwrap().iter().map(|p| p.przebiegi).collect();
    assert!(przebiegi.iter().all(|n| *n == 2));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s5_wypalenie_napisow_w_pionowym_filmie() {
    let s = srodowisko(MOWA);
    let we = film(&s.katalog, "rolka.mp4", "360x640", 4, true);
    let opcje = OpcjeNapisow { srt: false, wypal: Some(StylNapisow::Rolki), ..Default::default() };
    let id = s.kolejka.dodaj(zadanie(&we, opcje));
    let z = czekaj(&s.kolejka, id, Duration::from_secs(120)).await;
    let ma_libass = Command::new("ffmpeg")
        .args(["-hide_banner", "-filters"])
        .output()
        .map(|w| narzedzia::filtry_z_tekstu(&String::from_utf8_lossy(&w.stdout)).iter().any(|f| f == "ass"))
        .unwrap_or(false);
    if !ma_libass {
        assert_eq!(klucz_bledu(&z).as_deref(), Some("napisy_brak_libass"));
        return;
    }
    let Stan::Gotowe { wyjscie } = &z.stan else { panic!("{z:?}") };
    assert_eq!(wyjscie, &s.katalog.join("rolka (z napisami).mp4"));
    assert!(!s.katalog.join("rolka.srt").exists(), "SRT wyłączony");
    let sonda = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0"])
        .arg(wyjscie)
        .output()
        .unwrap();
    let opis = String::from_utf8_lossy(&sonda.stdout);
    assert!(opis.contains("video,360,640") && opis.contains("audio"), "{opis}");
    let etapy: Vec<String> = s.zb.postepy.lock().unwrap().iter().filter_map(|p| p.etap.clone()).collect();
    assert!(etapy.contains(&"wypalanie".to_string()));
    bez_czesci(&s.katalog);
}
