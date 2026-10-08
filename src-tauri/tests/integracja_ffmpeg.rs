//! Integracja z prawdziwym ffmpeg/ffprobe: źródło z lavfi (testsrc + sine),
//! konwersja przez budowniczego, potem ffprobe sprawdza wynik.
//! Wymaga ffmpeg i ffprobe w PATH (albo SORACONVERTER_FFMPEG / SORACONVERTER_FFPROBE).

use soraconverter_lib::budowniczy;
use soraconverter_lib::sonda::{self, Media};
use soraconverter_lib::ustawienia::*;
use std::path::{Path, PathBuf};
use std::process::Command;

fn ffmpeg() -> String {
    std::env::var("SORACONVERTER_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}
fn ffprobe() -> String {
    std::env::var("SORACONVERTER_FFPROBE").unwrap_or_else(|_| "ffprobe".into())
}

fn uruchom<S: AsRef<std::ffi::OsStr> + std::fmt::Debug>(args: &[S]) {
    let w = Command::new(ffmpeg()).args(args).output().expect("brak ffmpeg w PATH");
    assert!(w.status.success(), "ffmpeg {:?}\n{}", args, String::from_utf8_lossy(&w.stderr));
}

fn sonda(plik: &Path) -> Media {
    let w = Command::new(ffprobe()).args(sonda::argumenty_ffprobe(plik)).output().expect("brak ffprobe");
    assert!(w.status.success());
    sonda::media_z_json(&String::from_utf8_lossy(&w.stdout)).unwrap()
}

fn ffprobe_pole(plik: &Path, strumien: &str, pole: &str) -> String {
    let w = Command::new(ffprobe())
        .args([
            "-v",
            "error",
            "-select_streams",
            strumien,
            "-show_entries",
            &format!("stream={pole}"),
            "-of",
            "csv=p=0",
        ])
        .arg(plik)
        .output()
        .unwrap();
    String::from_utf8_lossy(&w.stdout).trim().to_string()
}

/// Film testowy: 1280×720, 30 fps, stereo 48 kHz, `sekundy` długości.
fn zrodlo(katalog: &Path, sekundy: u32) -> PathBuf {
    let p = katalog.join("zrodlo.mp4");
    let s = sekundy.to_string();
    uruchom(
        &[
            "-hide_banner",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc=size=1280x720:rate=30:duration={s}"),
            "-f",
            "lavfi",
            "-i",
            &format!("sine=frequency=440:sample_rate=48000:duration={s}"),
            "-ac",
            "2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
        ]
        .map(String::from)
        .into_iter()
        .chain([p.to_string_lossy().into_owned()])
        .collect::<Vec<_>>(),
    );
    p
}

fn obraz_zrodlowy(katalog: &Path) -> PathBuf {
    let p = katalog.join("obraz.png");
    uruchom(&[
        "-hide_banner".into(),
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "testsrc2=size=1000x800".into(),
        "-frames:v".into(),
        "1".into(),
        p.to_string_lossy().into_owned(),
    ]);
    p
}

fn konwertuj(we: &Path, wy: &Path, profil: &Profil) -> budowniczy::Plan {
    let media = sonda(we);
    let plan = budowniczy::plan(&media, profil, we, wy).expect("plan");
    for przebieg in &plan.przebiegi {
        uruchom(przebieg);
    }
    for t in &plan.tymczasowe {
        let _ = std::fs::remove_file(t);
    }
    assert!(wy.exists(), "brak wyniku {wy:?}");
    plan
}

#[test]
fn p480_25fps_aac_8k_mono() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 20);
    let wy = tmp.path().join("telefon.mp4");
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo {
        rozdzielczosc: Rozdzielczosc::Wysokosc { h: 480 },
        fps: Fps::Wartosc { fps: 25.0 },
        jakosc: JakoscWideo::Bitrate { kbps: 800 },
        ..Default::default()
    });
    p.audio =
        Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 8, hz: Some(16000), kanaly: Some(1), normalizacja: false });
    konwertuj(&we, &wy, &p);

    assert_eq!(ffprobe_pole(&wy, "v:0", "height"), "480");
    assert_eq!(ffprobe_pole(&wy, "v:0", "width"), "854");
    assert_eq!(ffprobe_pole(&wy, "v:0", "r_frame_rate"), "25/1");
    assert_eq!(ffprobe_pole(&wy, "v:0", "avg_frame_rate"), "25/1");
    assert_eq!(ffprobe_pole(&wy, "a:0", "codec_name"), "aac");
    assert_eq!(ffprobe_pole(&wy, "a:0", "channels"), "1");
    assert_eq!(ffprobe_pole(&wy, "a:0", "sample_rate"), "16000");
    let br: f64 = ffprobe_pole(&wy, "a:0", "bit_rate").parse().unwrap();
    let kbps = br / 1000.0;
    eprintln!(
        "FFPROBE 480p/25fps/AAC8k: {}x{} @ {} fps, {} {} Hz {} kan., audio {:.1} kb/s",
        ffprobe_pole(&wy, "v:0", "width"),
        ffprobe_pole(&wy, "v:0", "height"),
        ffprobe_pole(&wy, "v:0", "avg_frame_rate"),
        ffprobe_pole(&wy, "a:0", "codec_name"),
        ffprobe_pole(&wy, "a:0", "sample_rate"),
        ffprobe_pole(&wy, "a:0", "channels"),
        kbps
    );
    assert!((6.0..=10.0).contains(&kbps), "bitrate audio {kbps} kb/s, oczekiwane ~8");
}

#[test]
fn mp4_na_mp3_320() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 5);
    let wy = tmp.path().join("dzwiek.mp3");
    let mut p = Profil::dla(Kontener::Mp3);
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Mp3, kbps: 320, ..Default::default() });
    konwertuj(&we, &wy, &p);
    let m = sonda(&wy);
    assert!(m.wideo.is_none());
    let a = m.audio.unwrap();
    assert_eq!(a.kodek, "mp3");
    assert_eq!(a.kbps, Some(320));
}

#[test]
fn docelowy_rozmiar_miesci_sie() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 20);
    let wy = tmp.path().join("maly.mp4");
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 1.0 }, ..Default::default() });
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 64, ..Default::default() });
    let plan = konwertuj(&we, &wy, &p);
    assert_eq!(plan.przebiegi.len(), 2);
    let rozmiar = std::fs::metadata(&wy).unwrap().len();
    eprintln!("rozmiar 1 MB → {rozmiar} B");
    // Sam budowniczy (bez korekty z kolejki) może przestrzelić o kilka %.
    assert!(rozmiar <= 1024 * 1024 * 115 / 100, "{rozmiar} B > 1,15 MB");
    assert!(rozmiar >= 600 * 1024, "{rozmiar} B: za mało wykorzystany budżet");
    // logi 2 przebiegów posprzątane
    assert!(!tmp.path().join("maly.mp4.2pass-0.log").exists());
}

#[test]
fn obrot_ciecie_predkosc() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 12);
    let wy = tmp.path().join("obrot.mkv");
    let mut p = Profil::dla(Kontener::Mkv);
    p.obrot = Obrot::O90;
    p.ciecie = Some(Ciecie { od: 2.0, koniec: Some(10.0) });
    p.predkosc = 2.0;
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::Crf { crf: 30 }, ..Default::default() });
    konwertuj(&we, &wy, &p);
    let m = sonda(&wy);
    let w = m.wideo.unwrap();
    assert_eq!((w.w, w.h), (720, 1280));
    let czas = m.czas_s.unwrap();
    assert!((czas - 4.0).abs() < 0.3, "czas {czas}");
}

#[test]
fn gif_z_klipu() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 6);
    let wy = tmp.path().join("klip.gif");
    let mut p = Profil::dla(Kontener::Gif);
    p.gif = Some(ProfilGif {
        fps: 10.0,
        szerokosc: 320,
        petla: Petla::Nieskonczona,
        dithering: Dithering::Bayer { skala: 3 },
    });
    p.ciecie = Some(Ciecie { od: 1.0, koniec: Some(3.0) });
    konwertuj(&we, &wy, &p);
    assert_eq!(ffprobe_pole(&wy, "v:0", "codec_name"), "gif");
    assert_eq!(ffprobe_pole(&wy, "v:0", "width"), "320");
    assert_eq!(ffprobe_pole(&wy, "v:0", "height"), "180");
    assert!(!tmp.path().join("klip.gif.paleta.png").exists());
}

#[test]
fn obraz_50_procent_webp() {
    let tmp = tempfile::tempdir().unwrap();
    let we = obraz_zrodlowy(tmp.path());
    let wy = tmp.path().join("pol.webp");
    let mut p = Profil::dla(Kontener::Webp);
    p.obraz = Some(ProfilObrazu { rozmiar: RozmiarObrazu::Procent { p: 50.0 }, jakosc: 80, ..Default::default() });
    konwertuj(&we, &wy, &p);
    let m = sonda(&wy);
    let w = m.wideo.unwrap();
    assert_eq!((w.w, w.h), (500, 400));
}

#[test]
fn obrazy_formaty_i_wymiary() {
    let tmp = tempfile::tempdir().unwrap();
    let we = obraz_zrodlowy(tmp.path());
    let przypadki: &[(Kontener, RozmiarObrazu, Dopasowanie, (u32, u32))] = &[
        (Kontener::Jpg, RozmiarObrazu::Wymiary { w: Some(1600), h: None }, Dopasowanie::Proporcje, (1600, 1280)),
        (Kontener::Png, RozmiarObrazu::Wymiary { w: Some(300), h: Some(300) }, Dopasowanie::Proporcje, (300, 240)),
        (Kontener::Png, RozmiarObrazu::Wymiary { w: Some(300), h: Some(300) }, Dopasowanie::Przytnij, (300, 300)),
        (
            Kontener::Bmp,
            RozmiarObrazu::Wymiary { w: Some(300), h: Some(300) },
            Dopasowanie::Pasy { kolor: "white".into() },
            (300, 300),
        ),
        (Kontener::Avif, RozmiarObrazu::Procent { p: 25.0 }, Dopasowanie::Proporcje, (250, 200)),
        (Kontener::Ico, RozmiarObrazu::Zachowaj, Dopasowanie::Proporcje, (256, 205)),
        (Kontener::Gif, RozmiarObrazu::Wymiary { w: None, h: Some(100) }, Dopasowanie::Proporcje, (125, 100)),
    ];
    for (i, (k, rozmiar, dop, oczekiwane)) in przypadki.iter().enumerate() {
        let wy = tmp.path().join(format!("o{i}.{}", k.rozszerzenie()));
        let mut p = Profil::dla(*k);
        p.gif = None;
        // JPG 1600: powiększanie dozwolone w tym przypadku
        p.obraz = Some(ProfilObrazu {
            rozmiar: rozmiar.clone(),
            dopasowanie: dop.clone(),
            nie_powiekszaj: false,
            ..Default::default()
        });
        konwertuj(&we, &wy, &p);
        let m = sonda(&wy);
        let w = m.wideo.unwrap_or_else(|| panic!("{k:?}: brak obrazu"));
        assert_eq!((w.w, w.h), *oczekiwane, "{k:?} {rozmiar:?} {dop:?}");
    }
}

#[test]
fn audio_formaty() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 4);
    let przypadki: &[(Kontener, KodekAudio, u32, &str)] = &[
        (Kontener::Opus, KodekAudio::Opus, 8, "opus"),
        (Kontener::Ogg, KodekAudio::Vorbis, 96, "vorbis"),
        (Kontener::Flac, KodekAudio::Flac, 0, "flac"),
        (Kontener::Wav, KodekAudio::Pcm, 0, "pcm_s16le"),
        (Kontener::M4a, KodekAudio::Aac, 8, "aac"),
        (Kontener::Aac, KodekAudio::Aac, 64, "aac"),
        (Kontener::Mp3, KodekAudio::Mp3, 8, "mp3"),
    ];
    for (k, kodek, kbps, nazwa) in przypadki {
        let wy = tmp.path().join(format!("a_{}.{}", kbps, k.rozszerzenie()));
        let mut p = Profil::dla(*k);
        p.audio = Some(ProfilAudio { kodek: *kodek, kbps: (*kbps).max(8), normalizacja: true, ..Default::default() });
        konwertuj(&we, &wy, &p);
        assert_eq!(ffprobe_pole(&wy, "a:0", "codec_name"), *nazwa, "{k:?}");
    }
}

#[test]
fn wideo_kodeki_i_kontenery() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 2);
    let przypadki: &[(Kontener, KodekWideo, &str)] = &[
        (Kontener::Webm, KodekWideo::Vp9, "vp9"),
        (Kontener::Mkv, KodekWideo::Av1, "av1"),
        (Kontener::Mov, KodekWideo::H265, "hevc"),
        (Kontener::Avi, KodekWideo::Mpeg4, "mpeg4"),
    ];
    // GUI wyszarza kodek bez enkodera (PanelUstawien: brakEnkodera); test robi to samo, zamiast zakładać pełny build
    // (CI Windows: choco ffmpeg bez libsvtav1 → „Encoder not found”). Lokalnie gyan full ma wszystkie.
    let enkodery = soraconverter_lib::narzedzia::enkodery(Path::new(&ffmpeg()));
    for (k, kodek, nazwa) in przypadki {
        let koder = match kodek {
            KodekWideo::Vp9 => "libvpx-vp9",
            KodekWideo::Av1 => "libsvtav1",
            KodekWideo::H265 => "libx265",
            _ => "mpeg4",
        };
        if !enkodery.iter().any(|e| e == koder) {
            eprintln!("pomijam {k:?}/{kodek:?}: ffmpeg nie ma enkodera {koder}");
            continue;
        }
        let wy = tmp.path().join(format!("w.{}", k.rozszerzenie()));
        let mut p = Profil::dla(*k);
        p.wideo = Some(ProfilWideo {
            kodek: *kodek,
            rozdzielczosc: Rozdzielczosc::Wlasna { w: 320, h: 320 },
            dopasowanie: Dopasowanie::Rozmycie,
            jakosc: JakoscWideo::Crf { crf: 40 },
            ..Default::default()
        });
        konwertuj(&we, &wy, &p);
        assert_eq!(ffprobe_pole(&wy, "v:0", "codec_name"), *nazwa, "{k:?}");
        assert_eq!(ffprobe_pole(&wy, "v:0", "width"), "320");
        assert_eq!(ffprobe_pole(&wy, "v:0", "height"), "320");
    }
}

// ---------- pancerz v1.1: obowiązkowe przypadki ----------

fn generuj(args: &[&str], wy: &Path) {
    let mut a: Vec<std::ffi::OsString> = ["-hide_banner", "-y", "-loglevel", "error"].map(Into::into).to_vec();
    a.extend(args.iter().map(Into::into));
    a.push(wy.into());
    uruchom(&a);
}

fn czas_strumienia(plik: &Path, strumien: &str) -> f64 {
    ffprobe_pole(plik, strumien, "duration").parse().unwrap_or_else(|_| panic!("brak duration {strumien}"))
}

#[test]
fn c12_nieparzyste_853x481_na_480p_h264() {
    let tmp = tempfile::tempdir().unwrap();
    let we = tmp.path().join("nieparzyste.mkv");
    // FFV1 (bezstratny) przyjmuje nieparzyste wymiary źródła
    generuj(
        &["-f", "lavfi", "-i", "testsrc=size=853x481:rate=25:duration=2", "-pix_fmt", "rgb24", "-c:v", "ffv1"],
        &we,
    );
    assert_eq!(ffprobe_pole(&we, "v:0", "width"), "853");
    let wy = tmp.path().join("p480.mp4");
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { rozdzielczosc: Rozdzielczosc::Wysokosc { h: 480 }, ..Default::default() });
    konwertuj(&we, &wy, &p);
    let w: u32 = ffprobe_pole(&wy, "v:0", "width").parse().unwrap();
    let h: u32 = ffprobe_pole(&wy, "v:0", "height").parse().unwrap();
    assert_eq!(h, 480);
    assert_eq!(w % 2, 0, "szerokość {w} nieparzysta");
    assert_eq!(ffprobe_pole(&wy, "v:0", "codec_name"), "h264");
    // Bez skalowania też parzyste (853×481 → 852×480)
    let wy2 = tmp.path().join("zachowaj.mp4");
    konwertuj(&we, &wy2, &Profil::dla(Kontener::Mp4));
    assert_eq!(ffprobe_pole(&wy2, "v:0", "width"), "852");
    assert_eq!(ffprobe_pole(&wy2, "v:0", "height"), "480");
}

#[test]
fn c13_c14_hdr_pq_10bit_na_h264_sdr() {
    let tmp = tempfile::tempdir().unwrap();
    let we = tmp.path().join("hdr.mp4");
    generuj(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=25:duration=2",
            "-c:v",
            "libx265",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p10le",
            "-x265-params",
            "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
            "-color_primaries",
            "bt2020",
            "-color_trc",
            "smpte2084",
            "-colorspace",
            "bt2020nc",
        ],
        &we,
    );
    let m = sonda(&we);
    let w = m.wideo.as_ref().unwrap();
    assert_eq!(w.hdr, Some(soraconverter_lib::sonda::Hdr::Pq), "sonda nie wykryła HDR");
    assert_eq!(w.bity, Some(10));
    let wy = tmp.path().join("sdr.mp4");
    let plan = konwertuj(&we, &wy, &Profil::dla(Kontener::Mp4));
    assert!(plan.podpowiedzi.contains(&budowniczy::Podpowiedz::HdrNaSdr));
    assert_eq!(ffprobe_pole(&wy, "v:0", "codec_name"), "h264");
    assert_eq!(ffprobe_pole(&wy, "v:0", "pix_fmt"), "yuv420p");
    assert_eq!(ffprobe_pole(&wy, "v:0", "color_space"), "bt709");
    assert_eq!(ffprobe_pole(&wy, "v:0", "color_transfer"), "bt709");
    assert_eq!(ffprobe_pole(&wy, "v:0", "color_primaries"), "bt709");
    eprintln!(
        "FFPROBE HDR→SDR: {} {} {} {}",
        ffprobe_pole(&wy, "v:0", "pix_fmt"),
        ffprobe_pole(&wy, "v:0", "color_space"),
        ffprobe_pole(&wy, "v:0", "color_transfer"),
        ffprobe_pole(&wy, "v:0", "color_primaries")
    );
}

#[test]
fn c15_vfr_na_25fps_synchronizacja() {
    let tmp = tempfile::tempdir().unwrap();
    let we = tmp.path().join("vfr.mp4");
    // 60 fps, w pierwszych 3 s co druga klatka wyrzucona (znaczniki czasu zostają) → VFR jak z telefonu
    generuj(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=60:duration=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=500:sample_rate=48000:duration=6",
            "-vf",
            "select='if(lt(t,3),not(mod(n,2)),1)'",
            "-fps_mode",
            "vfr",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
        ],
        &we,
    );
    assert!(sonda(&we).wideo.unwrap().vfr, "źródło powinno być VFR");
    let wy = tmp.path().join("cfr25.mp4");
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { fps: Fps::Wartosc { fps: 25.0 }, ..Default::default() });
    konwertuj(&we, &wy, &p);
    assert_eq!(ffprobe_pole(&wy, "v:0", "avg_frame_rate"), "25/1");
    assert_eq!(ffprobe_pole(&wy, "v:0", "r_frame_rate"), "25/1");
    let (v, a) = (czas_strumienia(&wy, "v:0"), czas_strumienia(&wy, "a:0"));
    eprintln!("VFR→25: wideo {v:.3} s, audio {a:.3} s");
    assert!((v - a).abs() < 0.1, "rozjazd audio/wideo {:.0} ms", (v - a).abs() * 1000.0);
    // „zachowaj”: -fps_mode vfr, długości też się zgadzają
    let wy2 = tmp.path().join("zachowaj.mp4");
    konwertuj(&we, &wy2, &Profil::dla(Kontener::Mp4));
    let (v, a) = (czas_strumienia(&wy2, "v:0"), czas_strumienia(&wy2, "a:0"));
    assert!((v - a).abs() < 0.1, "zachowaj: rozjazd {:.0} ms", (v - a).abs() * 1000.0);
}

/// Średni kolor kwadratu 16×16 w rogu pierwszej klatki (po autorotacji ffmpeg, jak w odtwarzaczu).
fn rog(plik: &Path, x: &str, y: &str, vf_dodatkowy: &str) -> (u8, u8, u8) {
    let vf = format!("{vf_dodatkowy}crop=16:16:{x}:{y},scale=1:1");
    let w = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(plik)
        .args(["-frames:v", "1", "-vf", &vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .output()
        .unwrap();
    assert!(w.status.success(), "{}", String::from_utf8_lossy(&w.stderr));
    (w.stdout[0], w.stdout[1], w.stdout[2])
}

fn czerwony(c: (u8, u8, u8)) -> bool {
    c.0 > 150 && c.1 < 100 && c.2 < 100
}

fn czerwony_rog(plik: &Path, vf: &str) -> Vec<bool> {
    [("0", "0"), ("iw-16", "0"), ("0", "ih-16"), ("iw-16", "ih-16")]
        .iter()
        .map(|(x, y)| czerwony(rog(plik, x, y, vf)))
        .collect()
}

#[test]
fn c16_obrot_z_metadanych_i_uzytkownika() {
    let tmp = tempfile::tempdir().unwrap();
    let plaski = tmp.path().join("plaski.mp4");
    // szare tło 320×240, czerwony kwadrat w lewym górnym rogu
    generuj(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=gray:s=320x240:r=25:d=1",
            "-vf",
            "drawbox=x=0:y=0:w=60:h=60:color=red:t=fill",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ],
        &plaski,
    );
    // jak telefon nagrywający pionowo: tag rotate=90 (macierz wyświetlania -90)
    let we = tmp.path().join("pionowy.mp4");
    let mut a: Vec<std::ffi::OsString> =
        ["-hide_banner", "-y", "-loglevel", "error", "-display_rotation", "-90", "-i"].map(Into::into).to_vec();
    a.push(plaski.clone().into());
    a.extend(["-c", "copy"].map(Into::into));
    a.push(we.clone().into());
    uruchom(&a);
    let m = sonda(&we);
    let w = m.wideo.as_ref().unwrap();
    assert_eq!(w.obrot, 90, "obrót z metadanych");
    assert_eq!((w.w, w.h), (240, 320), "wymiary tak, jak widać film");

    // użytkownik obraca jeszcze o 90° w prawo → razem 180°
    let wy = tmp.path().join("obrocony.mp4");
    let mut p = Profil::dla(Kontener::Mp4);
    p.obrot = Obrot::O90;
    konwertuj(&we, &wy, &p);
    let mw = sonda(&wy);
    let ww = mw.wideo.unwrap();
    assert_eq!((ww.w, ww.h), (320, 240));
    assert_eq!(ww.obrot, 0, "w wyniku nie może zostać stary obrót w metadanych");
    // Oczekiwany obraz: to, co pokazuje odtwarzacz (autorotacja) + obrót użytkownika.
    let oczekiwane = czerwony_rog(&we, "transpose=clock,");
    let jest = czerwony_rog(&wy, "");
    assert_eq!(jest, oczekiwane, "orientacja: [lg, pg, ld, pd]");
    assert_eq!(oczekiwane, vec![false, false, false, true], "180° od oryginału: kwadrat w prawym dolnym rogu");
}

#[test]
fn opus_8kbps() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 6);
    let wy = tmp.path().join("mowa.opus");
    let mut p = Profil::dla(Kontener::Opus);
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Opus, kbps: 8, ..Default::default() });
    konwertuj(&we, &wy, &p);
    assert_eq!(ffprobe_pole(&wy, "a:0", "codec_name"), "opus");
    let b = std::fs::metadata(&wy).unwrap().len() as f64 * 8.0 / 6.0 / 1000.0;
    assert!(b < 14.0, "Opus 8 kb/s wyszedł {b:.1} kb/s");
}

#[test]
fn wideo_na_gif_480px_15fps_z_paleta() {
    let tmp = tempfile::tempdir().unwrap();
    let we = zrodlo(tmp.path(), 3);
    let wy = tmp.path().join("klip480.gif");
    let p = Profil::dla(Kontener::Gif); // domyślnie 480 px, 15 fps, sierra2_4a
    let plan = konwertuj(&we, &wy, &p);
    assert_eq!(plan.przebiegi.len(), 2);
    let t = plan.jako_tekst();
    assert!(t[0].iter().any(|a| a.contains("palettegen")));
    assert!(t[1].iter().any(|a| a.contains("paletteuse")));
    assert_eq!(ffprobe_pole(&wy, "v:0", "width"), "480");
    assert_eq!(ffprobe_pole(&wy, "v:0", "height"), "270");
    assert_eq!(ffprobe_pole(&wy, "v:0", "r_frame_rate"), "15/1");
}
