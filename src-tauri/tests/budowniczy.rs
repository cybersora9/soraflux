//! Tabela przypadków dla budowniczego argumentów ffmpeg.

use soraconverter_lib::budowniczy::{self, BladProfilu, Podpowiedz};
use soraconverter_lib::sonda::{Media, StrumienAudio, StrumienWideo};
use soraconverter_lib::ustawienia::*;
use std::path::Path;

fn film(czas: f64) -> Media {
    Media {
        czas_s: Some(czas),
        rozmiar_b: Some(50_000_000),
        kbps: Some(5000),
        format: Some("mov,mp4,m4a,3gp,3g2,mj2".into()),
        wideo: Some(StrumienWideo {
            indeks: 0,
            kodek: "h264".into(),
            w: 1920,
            h: 1080,
            fps: Some(30.0),
            kbps: Some(4800),
            ..Default::default()
        }),
        audio: Some(audio1()),
        sciezki_audio: vec![audio1()],
        ..Default::default()
    }
}

fn audio1() -> StrumienAudio {
    StrumienAudio { indeks: 1, kodek: "aac".into(), hz: Some(48000), kanaly: Some(2), kbps: Some(192), jezyk: None }
}

fn obraz(w: u32, h: u32) -> Media {
    Media {
        format: Some("png_pipe".into()),
        wideo: Some(StrumienWideo { kodek: "png".into(), w, h, ..Default::default() }),
        obraz: true,
        ..Default::default()
    }
}

/// Czy `args` zawiera `szukane` jako ciągły fragment.
fn ma(args: &[String], szukane: &[&str]) -> bool {
    args.windows(szukane.len()).any(|o| o.iter().zip(szukane).all(|(a, b)| a == b))
}

fn wartosc<'a>(args: &'a [String], flaga: &str) -> Option<&'a str> {
    args.iter().position(|a| a == flaga).map(|i| args[i + 1].as_str())
}

/// Plan z argumentami jako tekst (łatwiej porównywać).
struct PlanT {
    przebiegi: Vec<Vec<String>>,
    podpowiedzi: Vec<Podpowiedz>,
    tymczasowe: Vec<std::path::PathBuf>,
}

fn plan(m: &Media, p: &Profil, wy: &str) -> PlanT {
    plan_k(m, p, wy, &budowniczy::Kontekst::default())
}

fn plan_k(m: &Media, p: &Profil, wy: &str, k: &budowniczy::Kontekst) -> PlanT {
    let pl = budowniczy::plan_z(m, p, Path::new("we.mp4"), Path::new(wy), k).expect("plan powinien się udać");
    PlanT { przebiegi: pl.jako_tekst(), podpowiedzi: pl.podpowiedzi, tymczasowe: pl.tymczasowe }
}

fn telefon_480p() -> Profil {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo {
        rozdzielczosc: Rozdzielczosc::Wysokosc { h: 480 },
        fps: Fps::Wartosc { fps: 25.0 },
        jakosc: JakoscWideo::Bitrate { kbps: 800 },
        ..Default::default()
    });
    p.audio =
        Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 8, hz: Some(16000), kanaly: Some(1), normalizacja: false });
    p
}

#[test]
fn p480_25fps_800k_aac_8k_mono_16khz() {
    let pl = plan(&film(60.0), &telefon_480p(), "wy.mp4");
    assert_eq!(pl.przebiegi.len(), 1);
    let a = &pl.przebiegi[0];
    assert!(ma(a, &["-hide_banner", "-nostdin", "-y"]));
    assert!(ma(a, &["-progress", "pipe:1", "-nostats"]));
    assert_eq!(wartosc(a, "-vf"), Some("scale=w=-2:h=480:flags=lanczos,fps=25"));
    assert!(ma(a, &["-c:v", "libx264"]));
    assert!(ma(a, &["-b:v", "800k"]));
    assert!(ma(a, &["-c:a", "aac", "-b:a", "8k", "-ar", "16000", "-ac", "1"]));
    assert!(ma(a, &["-movflags", "+faststart"]));
    assert_eq!(a.last().unwrap(), "wy.mp4");
    assert!(pl.podpowiedzi.contains(&Podpowiedz::MonoNiskiHz { kanaly: 1, hz: 16000 }));
}

#[test]
fn mp4_na_mp3_320() {
    let mut p = Profil::dla(Kontener::Mp3);
    p.audio =
        Some(ProfilAudio { kodek: KodekAudio::Mp3, kbps: 320, hz: Some(44100), kanaly: Some(2), normalizacja: false });
    let a = &plan(&film(60.0), &p, "wy.mp3").przebiegi[0];
    assert!(a.contains(&"-vn".to_string()));
    assert!(!a.contains(&"-c:v".to_string()));
    assert!(ma(a, &["-c:a", "libmp3lame", "-b:a", "320k", "-ar", "44100", "-ac", "2"]));
}

#[test]
fn docelowy_rozmiar_dwa_przebiegi() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 10.0 }, ..Default::default() });
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 128, ..Default::default() });
    let pl = plan(&film(60.0), &p, "wy.mp4");
    assert_eq!(pl.przebiegi.len(), 2);
    // 10*8192*0.97/60 = 1324 kb/s razem, minus 128 audio
    let (p1, p2) = (&pl.przebiegi[0], &pl.przebiegi[1]);
    assert!(ma(p1, &["-b:v", "1196k"]));
    assert!(ma(p1, &["-pass", "1", "-passlogfile", "wy.mp4.2pass"]));
    assert!(ma(p1, &["-an", "-sn", "-dn", "-f", "null", "-"]));
    assert!(ma(p2, &["-b:v", "1196k"]));
    assert!(ma(p2, &["-pass", "2", "-passlogfile", "wy.mp4.2pass"]));
    assert!(ma(p2, &["-c:a", "aac", "-b:a", "128k"]));
    assert!(pl.tymczasowe.iter().any(|t| t.ends_with("wy.mp4.2pass-0.log")));
}

#[test]
fn docelowy_rozmiar_z_cieciem_i_predkoscia() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 8.0 }, ..Default::default() });
    p.audio = None;
    p.ciecie = Some(Ciecie { od: 10.0, koniec: Some(50.0) });
    p.predkosc = 2.0;
    // 40 s / 2 = 20 s; 8*8192*0.97/20 = 3178
    let a = &plan(&film(600.0), &p, "wy.mp4").przebiegi[1];
    assert!(ma(a, &["-b:v", "3178k"]));
    assert!(a.contains(&"-an".to_string()));
}

#[test]
fn za_maly_rozmiar_to_blad() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 1.0 }, ..Default::default() });
    let e = budowniczy::plan(&film(600.0), &p, Path::new("a"), Path::new("b.mp4")).unwrap_err();
    assert!(matches!(e, BladProfilu::ZaMalyRozmiar { .. }));
}

#[test]
fn rozmiar_bez_czasu_to_blad() {
    let mut m = film(10.0);
    m.czas_s = None;
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 10.0 }, ..Default::default() });
    assert_eq!(budowniczy::plan(&m, &p, Path::new("a"), Path::new("b.mp4")).unwrap_err(), BladProfilu::BrakCzasu);
}

#[test]
fn obrot_i_ciecie() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.obrot = Obrot::O90;
    p.ciecie = Some(Ciecie { od: 5.0, koniec: Some(15.5) });
    let a = &plan(&film(60.0), &p, "wy.mp4").przebiegi[0];
    let i = a.iter().position(|x| x == "-i").unwrap();
    assert!(ma(&a[..i], &["-ss", "5", "-t", "10.5"]), "cięcie jako opcje wejścia: {a:?}");
    assert_eq!(wartosc(a, "-vf"), Some("transpose=clock"));
}

#[test]
fn kolejnosc_filtrow_wideo() {
    let mut p = Profil::dla(Kontener::Mkv);
    p.przyciecie = Ramka { gora: 10, dol: 10, lewo: 0, prawo: 0 };
    p.deinterlace = true;
    p.obrot = Obrot::O180;
    p.odbicie = Odbicie { poziomo: true, pionowo: false };
    p.predkosc = 1.5;
    p.wideo = Some(ProfilWideo {
        rozdzielczosc: Rozdzielczosc::Wysokosc { h: 720 },
        fps: Fps::Wartosc { fps: 29.97 },
        ..Default::default()
    });
    let a = &plan(&film(60.0), &p, "wy.mkv").przebiegi[0];
    assert_eq!(
        wartosc(a, "-vf"),
        Some("crop=w=iw-0:h=ih-20:x=0:y=10,bwdif,hflip,vflip,hflip,scale=w=-2:h=720:flags=lanczos,setpts=PTS/1.5,fps=29.97")
    );
    assert_eq!(wartosc(a, "-af"), Some("atempo=1.5"));
}

#[test]
fn obraz_50_procent_webp_q80() {
    let mut p = Profil::dla(Kontener::Webp);
    p.obraz = Some(ProfilObrazu { rozmiar: RozmiarObrazu::Procent { p: 50.0 }, jakosc: 80, ..Default::default() });
    let a = &plan(&obraz(1000, 800), &p, "wy.webp").przebiegi[0];
    assert_eq!(wartosc(a, "-vf"), Some("scale=w='max(1,trunc(iw*50/100))':h='max(1,trunc(ih*50/100))':flags=lanczos"));
    assert!(ma(a, &["-c:v", "libwebp", "-quality", "80"]));
    assert!(ma(a, &["-frames:v", "1"]));
}

#[test]
fn gif_dwufazowy() {
    let mut p = Profil::dla(Kontener::Gif);
    p.gif = Some(ProfilGif {
        fps: 15.0,
        szerokosc: 480,
        petla: Petla::Nieskonczona,
        dithering: Dithering::Bayer { skala: 3 },
    });
    p.ciecie = Some(Ciecie { od: 2.0, koniec: Some(6.0) });
    let pl = plan(&film(60.0), &p, "wy.gif");
    assert_eq!(pl.przebiegi.len(), 2);
    let (p1, p2) = (&pl.przebiegi[0], &pl.przebiegi[1]);
    assert_eq!(wartosc(p1, "-vf"), Some("fps=15,scale=w='min(480,iw)':h=-1:flags=lanczos,palettegen=stats_mode=diff"));
    assert_eq!(p1.last().unwrap(), "wy.gif.paleta.png");
    assert!(ma(p2, &["-i", "wy.gif.paleta.png"]));
    assert_eq!(
        wartosc(p2, "-lavfi"),
        Some("[0:v]fps=15,scale=w='min(480,iw)':h=-1:flags=lanczos[sf_x];[sf_x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle")
    );
    assert!(ma(p2, &["-loop", "0"]));
    assert!(ma(p2, &["-ss", "2", "-t", "4", "-i", "we.mp4"]));
    assert_eq!(pl.tymczasowe.len(), 1);
}

#[test]
fn gif_petla_razy_i_bez_petli() {
    let mut p = Profil::dla(Kontener::Gif);
    p.gif = Some(ProfilGif { petla: Petla::Razy { n: 3 }, ..Default::default() });
    assert!(ma(&plan(&film(5.0), &p, "a.gif").przebiegi[1], &["-loop", "3"]));
    p.gif = Some(ProfilGif { petla: Petla::Brak, ..Default::default() });
    assert!(ma(&plan(&film(5.0), &p, "a.gif").przebiegi[1], &["-loop", "-1"]));
}

#[test]
fn animowany_webp() {
    let mut p = Profil::dla(Kontener::Webp);
    p.gif = Some(ProfilGif::default());
    let a = &plan(&film(5.0), &p, "a.webp").przebiegi[0];
    assert!(ma(a, &["-c:v", "libwebp_anim"]));
    assert!(ma(a, &["-loop", "0"]));
}

#[test]
fn obraz_na_gif_jednym_przebiegiem() {
    let p = Profil::dla(Kontener::Gif);
    let mut p = p;
    p.gif = None;
    p.obraz = Some(ProfilObrazu::default());
    let pl = plan(&obraz(64, 64), &p, "a.gif");
    assert_eq!(pl.przebiegi.len(), 1);
    assert!(wartosc(&pl.przebiegi[0], "-vf").unwrap().contains("palettegen"));
}

#[test]
fn kopia_z_filtrami_to_blad() {
    let mut p = Profil::dla(Kontener::Mkv);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::Kopiuj, fps: Fps::Wartosc { fps: 25.0 }, ..Default::default() });
    let e = budowniczy::plan(&film(5.0), &p, Path::new("a"), Path::new("b.mkv")).unwrap_err();
    assert_eq!(e, BladProfilu::KopiaZFiltrami);
}

#[test]
fn kopia_bez_filtrow() {
    let mut p = Profil::dla(Kontener::Mkv);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::Kopiuj, ..Default::default() });
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Kopiuj, ..Default::default() });
    let a = &plan(&film(5.0), &p, "b.mkv").przebiegi[0];
    assert!(ma(a, &["-c:v", "copy"]));
    assert!(ma(a, &["-c:a", "copy"]));
    assert!(!a.contains(&"-vf".to_string()));
}

#[test]
fn niezgodny_kodek() {
    let mut p = Profil::dla(Kontener::Webm);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::H264, ..Default::default() });
    assert!(matches!(
        budowniczy::plan(&film(5.0), &p, Path::new("a"), Path::new("b.webm")),
        Err(BladProfilu::NiezgodnyKodekWideo { .. })
    ));
    let mut p = Profil::dla(Kontener::Wav);
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Mp3, kbps: 128, ..Default::default() });
    assert!(matches!(
        budowniczy::plan(&film(5.0), &p, Path::new("a"), Path::new("b.wav")),
        Err(BladProfilu::NiezgodnyKodekAudio { .. })
    ));
}

#[test]
fn wlasne_wymiary_pasy_rozmycie_przytnij() {
    let mut p = Profil::dla(Kontener::Mp4);
    let mut pw = ProfilWideo { rozdzielczosc: Rozdzielczosc::Wlasna { w: 1080, h: 1920 }, ..Default::default() };
    pw.dopasowanie = Dopasowanie::Pasy { kolor: "white".into() };
    p.wideo = Some(pw.clone());
    let vf = wartosc(&plan(&film(5.0), &p, "a.mp4").przebiegi[0], "-vf").unwrap().to_string();
    assert!(vf.contains("force_original_aspect_ratio=decrease:force_divisible_by=2"));
    assert!(vf.contains("pad=w=1080:h=1920:x=(ow-iw)/2:y=(oh-ih)/2:color=white"));

    pw.dopasowanie = Dopasowanie::Rozmycie;
    p.wideo = Some(pw.clone());
    let vf = wartosc(&plan(&film(5.0), &p, "a.mp4").przebiegi[0], "-vf").unwrap().to_string();
    assert!(vf.starts_with("split[sf_a][sf_b];"));
    assert!(vf.contains("boxblur") && vf.contains("overlay=x=(W-w)/2:y=(H-h)/2"));

    pw.dopasowanie = Dopasowanie::Przytnij;
    p.wideo = Some(pw);
    let vf = wartosc(&plan(&film(5.0), &p, "a.mp4").przebiegi[0], "-vf").unwrap().to_string();
    assert_eq!(vf, "scale=w=1080:h=1920:force_original_aspect_ratio=increase:flags=lanczos,crop=w=1080:h=1920");
}

#[test]
fn nieparzyste_wymiary_zaokraglone() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo {
        rozdzielczosc: Rozdzielczosc::Wlasna { w: 641, h: 361 },
        dopasowanie: Dopasowanie::Rozciagnij,
        skaler: Skaler::Neighbor,
        ..Default::default()
    });
    let pl = plan(&film(5.0), &p, "a.mp4");
    assert_eq!(wartosc(&pl.przebiegi[0], "-vf"), Some("scale=w=640:h=360:flags=neighbor"));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::WymiaryParzyste { w: 640, h: 360 }));
}

#[test]
fn nie_powiekszaj_wysokosci() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo {
        rozdzielczosc: Rozdzielczosc::Wysokosc { h: 2160 },
        nie_powiekszaj: true,
        ..Default::default()
    });
    let a = &plan(&film(5.0), &p, "a.mp4").przebiegi[0];
    assert_eq!(wartosc(a, "-vf"), Some("scale=w=-2:h='trunc(min(2160,ih)/2)*2':flags=lanczos"));
}

#[test]
fn nieparzyste_zrodlo_bez_skalowania() {
    let mut m = film(5.0);
    m.wideo.as_mut().unwrap().w = 641;
    let p = Profil::dla(Kontener::Mp4);
    let a = &plan(&m, &p, "a.mp4").przebiegi[0];
    assert_eq!(wartosc(a, "-vf"), Some("scale=w='trunc(iw/2)*2':h='trunc(ih/2)*2'"));
}

#[test]
fn crf_dla_roznych_koderow() {
    let przypadki: &[(Kontener, KodekWideo, Option<Sprzet>, &[&str])] = &[
        (Kontener::Mp4, KodekWideo::H264, None, &["-c:v", "libx264", "-crf", "23", "-preset", "medium"]),
        (Kontener::Mp4, KodekWideo::H265, None, &["-c:v", "libx265", "-crf", "23"]),
        (Kontener::Mkv, KodekWideo::Av1, None, &["-c:v", "libsvtav1", "-crf", "23", "-preset", "8"]),
        (Kontener::Webm, KodekWideo::Vp9, None, &["-c:v", "libvpx-vp9", "-crf", "23", "-b:v", "0"]),
        (Kontener::Avi, KodekWideo::Mpeg4, None, &["-c:v", "mpeg4", "-q:v", "15"]),
        (Kontener::Mp4, KodekWideo::H264, Some(Sprzet::Nvenc), &["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", "23"]),
        (Kontener::Mp4, KodekWideo::H265, Some(Sprzet::Qsv), &["-c:v", "hevc_qsv", "-global_quality", "23"]),
        (Kontener::Mp4, KodekWideo::Av1, Some(Sprzet::Amf), &["-c:v", "av1_amf", "-rc", "cqp"]),
    ];
    for (k, kodek, sprzet, oczekiwane) in przypadki {
        let mut p = Profil::dla(*k);
        p.wideo = Some(ProfilWideo { kodek: *kodek, sprzet: *sprzet, ..Default::default() });
        let a = &plan(&film(5.0), &p, &format!("a.{}", k.rozszerzenie())).przebiegi[0];
        assert!(ma(a, oczekiwane), "{kodek:?}/{sprzet:?}: {a:?}");
    }
}

#[test]
fn h265_w_mp4_ma_tag_hvc1_i_dwa_przebiegi_x265() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo {
        kodek: KodekWideo::H265,
        jakosc: JakoscWideo::RozmiarMb { mb: 50.0 },
        ..Default::default()
    });
    let pl = plan(&film(60.0), &p, r"C:\Filmy\wy.mp4");
    assert!(ma(&pl.przebiegi[1], &["-tag:v", "hvc1"]));
    assert!(ma(&pl.przebiegi[0], &["-x265-params", r"pass=1:stats=C\:\\Filmy\\wy.mp4.2pass"]));
}

#[test]
fn av1_rozmiar_jednym_przebiegiem() {
    let mut p = Profil::dla(Kontener::Mkv);
    p.wideo =
        Some(ProfilWideo { kodek: KodekWideo::Av1, jakosc: JakoscWideo::RozmiarMb { mb: 20.0 }, ..Default::default() });
    let pl = plan(&film(60.0), &p, "a.mkv");
    assert_eq!(pl.przebiegi.len(), 1);
    assert!(pl.podpowiedzi.contains(&Podpowiedz::JedenPrzebieg));
}

#[test]
fn sprzetowy_bitrate_ma_limit() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo {
        sprzet: Some(Sprzet::Nvenc),
        jakosc: JakoscWideo::Bitrate { kbps: 3000 },
        ..Default::default()
    });
    let a = &plan(&film(60.0), &p, "a.mp4").przebiegi[0];
    assert!(ma(a, &["-b:v", "3000k", "-maxrate", "3000k", "-bufsize", "6000k"]));
}

#[test]
fn audio_normalizacja_predkosc_i_hz() {
    let mut p = Profil::dla(Kontener::Opus);
    p.audio =
        Some(ProfilAudio { kodek: KodekAudio::Opus, kbps: 24, hz: Some(44100), kanaly: Some(1), normalizacja: true });
    p.predkosc = 3.0;
    let pl = plan(&film(60.0), &p, "a.opus");
    let a = &pl.przebiegi[0];
    assert_eq!(wartosc(a, "-af"), Some("atempo=2,atempo=1.5,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000"));
    assert!(ma(a, &["-c:a", "libopus", "-b:a", "24k", "-ar", "48000", "-ac", "1"]));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::OpusHz { hz: 48000 }));
}

#[test]
fn wolniej_niz_pol() {
    let mut p = Profil::dla(Kontener::Mp3);
    p.predkosc = 0.25;
    let a = &plan(&film(60.0), &p, "a.mp3").przebiegi[0];
    assert_eq!(wartosc(a, "-af"), Some("atempo=0.5,atempo=0.5"));
}

#[test]
fn mp3_niski_bitrate_obniza_hz() {
    let mut p = Profil::dla(Kontener::Mp3);
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Mp3, kbps: 8, ..Default::default() });
    let pl = plan(&film(60.0), &p, "a.mp3");
    assert!(ma(&pl.przebiegi[0], &["-ar", "16000"]));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::Mp3NiskiHz { hz: 16000 }));
}

#[test]
fn bitrate_audio_poza_zakresem() {
    let mut p = Profil::dla(Kontener::M4a);
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 4, ..Default::default() });
    assert_eq!(
        budowniczy::plan(&film(5.0), &p, Path::new("a"), Path::new("b.m4a")).unwrap_err(),
        BladProfilu::ZlyBitrateAudio
    );
}

#[test]
fn wav_i_flac_bez_bitrate() {
    let p = Profil::dla(Kontener::Wav);
    let a = &plan(&film(5.0), &p, "a.wav").przebiegi[0];
    assert!(ma(a, &["-c:a", "pcm_s16le"]));
    assert!(!a.contains(&"-b:a".to_string()));
    let p = Profil::dla(Kontener::Flac);
    let a = &plan(&film(5.0), &p, "a.flac").przebiegi[0];
    assert!(ma(a, &["-c:a", "flac"]));
}

#[test]
fn bez_dzwieku() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.audio = None;
    let a = &plan(&film(5.0), &p, "a.mp4").przebiegi[0];
    assert!(a.contains(&"-an".to_string()));
}

#[test]
fn obrazy_wszystkie_formaty() {
    let przypadki: &[(Kontener, &[&str])] = &[
        (Kontener::Jpg, &["-c:v", "mjpeg", "-q:v"]),
        (Kontener::Png, &["-c:v", "png"]),
        (Kontener::Avif, &["-c:v", "libaom-av1", "-still-picture", "1"]),
        (Kontener::Bmp, &["-c:v", "bmp"]),
        (Kontener::Ico, &["-c:v", "png"]),
    ];
    for (k, oczekiwane) in przypadki {
        let p = Profil::dla(*k);
        let a = &plan(&obraz(300, 200), &p, &format!("a.{}", k.rozszerzenie())).przebiegi[0];
        assert!(ma(a, oczekiwane), "{k:?}: {a:?}");
    }
}

#[test]
fn obraz_wymiary_dopasowania() {
    let mut p = Profil::dla(Kontener::Png);
    p.obraz = Some(ProfilObrazu {
        rozmiar: RozmiarObrazu::Wymiary { w: Some(1600), h: None },
        nie_powiekszaj: true,
        ..Default::default()
    });
    let a = &plan(&obraz(3000, 2000), &p, "a.png").przebiegi[0];
    assert_eq!(wartosc(a, "-vf"), Some("scale=w='min(1600,iw)':h=-1:flags=lanczos"));

    p.obraz = Some(ProfilObrazu {
        rozmiar: RozmiarObrazu::Wymiary { w: Some(500), h: Some(500) },
        dopasowanie: Dopasowanie::Przytnij,
        nie_powiekszaj: false,
        ..Default::default()
    });
    let a = &plan(&obraz(3000, 2000), &p, "a.png").przebiegi[0];
    assert_eq!(
        wartosc(a, "-vf"),
        Some("scale=w=500:h=500:force_original_aspect_ratio=increase:flags=lanczos,crop=w=500:h=500")
    );
}

#[test]
fn ico_maks_256() {
    let p = Profil::dla(Kontener::Ico);
    let pl = plan(&obraz(1024, 1024), &p, "a.ico");
    assert!(wartosc(&pl.przebiegi[0], "-vf").unwrap().contains("min(256,iw)"));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::IcoMaks256));
}

#[test]
fn zla_predkosc_i_ciecie() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.predkosc = 10.0;
    assert_eq!(budowniczy::plan(&film(5.0), &p, Path::new("a"), Path::new("b")).unwrap_err(), BladProfilu::ZlaPredkosc);
    p.predkosc = 1.0;
    p.ciecie = Some(Ciecie { od: 5.0, koniec: Some(3.0) });
    assert_eq!(budowniczy::plan(&film(5.0), &p, Path::new("a"), Path::new("b")).unwrap_err(), BladProfilu::ZleCiecie);
}

#[test]
fn profil_json_ma_ksztalt_dla_frontu() {
    let p = telefon_480p();
    let j = serde_json::to_value(&p).unwrap();
    assert_eq!(j["kontener"], "mp4");
    assert_eq!(j["wideo"]["rozdzielczosc"]["typ"], "wysokosc");
    assert_eq!(j["wideo"]["rozdzielczosc"]["h"], 480);
    assert_eq!(j["wideo"]["jakosc"]["typ"], "bitrate");
    assert_eq!(j["audio"]["kodek"], "aac");
    let z_powrotem: Profil = serde_json::from_value(j).unwrap();
    assert_eq!(z_powrotem, p);
}

#[test]
fn liczby_bez_zer() {
    assert_eq!(budowniczy::liczba(25.0), "25");
    assert_eq!(budowniczy::liczba(29.97), "29.97");
    assert_eq!(budowniczy::liczba(0.5), "0.5");
}

// ---------- pancerz v1.1 (C13–C20, D25) ----------

fn film_hdr(hdr: soraconverter_lib::sonda::Hdr) -> Media {
    let mut m = film(30.0);
    let w = m.wideo.as_mut().unwrap();
    w.kodek = "hevc".into();
    w.piksele = Some("yuv420p10le".into());
    w.bity = Some(10);
    w.hdr = Some(hdr);
    m
}

#[test]
fn c13_domyslnie_8_bit_yuv420p() {
    let mut m = film(30.0);
    m.wideo.as_mut().unwrap().bity = Some(10);
    for kodek in [KodekWideo::H264, KodekWideo::H265, KodekWideo::Av1, KodekWideo::Vp9] {
        let mut p = Profil::dla(if kodek == KodekWideo::Vp9 { Kontener::Webm } else { Kontener::Mkv });
        p.wideo = Some(ProfilWideo { kodek, ..Default::default() });
        p.audio = None;
        let pl = plan(&m, &p, "wy.mkv");
        assert_eq!(wartosc(&pl.przebiegi[0], "-pix_fmt"), Some("yuv420p"), "{kodek:?}");
    }
}

#[test]
fn c13_dziesiec_bit_swiadomie() {
    let mut p = Profil::dla(Kontener::Mkv);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::H265, dziesiec_bit: true, ..Default::default() });
    let pl = plan(&film(30.0), &p, "wy.mkv");
    assert_eq!(wartosc(&pl.przebiegi[0], "-pix_fmt"), Some("yuv420p10le"));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::DziesiecBit { hdr: false }));
    // H.264 10 bit: zostaje 8 bit z podpowiedzią
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::H264, dziesiec_bit: true, ..Default::default() });
    let pl = plan(&film(30.0), &p, "wy.mkv");
    assert_eq!(wartosc(&pl.przebiegi[0], "-pix_fmt"), Some("yuv420p"));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::DziesiecBitNiedostepne));
}

#[test]
fn c14_hdr_na_sdr_tonemapping_i_bt709() {
    use soraconverter_lib::sonda::Hdr;
    for hdr in [Hdr::Pq, Hdr::Hlg] {
        let pl = plan(&film_hdr(hdr), &Profil::dla(Kontener::Mp4), "wy.mp4");
        let a = &pl.przebiegi[0];
        let vf = wartosc(a, "-vf").unwrap();
        assert!(vf.contains("zscale=t=linear") && vf.contains("tonemap=tonemap=hable"), "{vf}");
        assert!(ma(a, &["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]));
        assert_eq!(wartosc(a, "-pix_fmt"), Some("yuv420p"));
        assert!(pl.podpowiedzi.contains(&Podpowiedz::HdrNaSdr));
    }
    // GIF i obraz z filmu HDR też tonemapowane
    let gif = plan(&film_hdr(Hdr::Pq), &Profil::dla(Kontener::Gif), "wy.gif");
    assert!(gif.przebiegi[0].iter().any(|a| a.contains("tonemap=")));
}

#[test]
fn c14_hdr_bez_zscale_ostrzega() {
    use soraconverter_lib::sonda::Hdr;
    let k = budowniczy::Kontekst { zscale: false, katalog_tmp: None };
    let pl = plan_k(&film_hdr(Hdr::Pq), &Profil::dla(Kontener::Mp4), "wy.mp4", &k);
    assert!(!pl.przebiegi[0].iter().any(|a| a.contains("tonemap")));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::HdrBezTonemapowania));
}

#[test]
fn c14_hdr_10_bit_h265_zachowuje_hdr() {
    use soraconverter_lib::sonda::Hdr;
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::H265, dziesiec_bit: true, ..Default::default() });
    let pl = plan(&film_hdr(Hdr::Hlg), &p, "wy.mp4");
    let a = &pl.przebiegi[0];
    assert!(!a.iter().any(|x| x.contains("tonemap")));
    assert!(ma(a, &["-color_trc", "arib-std-b67"]));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::DziesiecBit { hdr: true }));
}

#[test]
fn c15_fps_mode_przy_zachowaj() {
    let pl = plan(&film(10.0), &Profil::dla(Kontener::Mp4), "wy.mp4");
    assert_eq!(wartosc(&pl.przebiegi[0], "-fps_mode"), Some("vfr"));
    let pl = plan(&film(10.0), &Profil::dla(Kontener::Avi), "wy.avi");
    assert_eq!(wartosc(&pl.przebiegi[0], "-fps_mode"), Some("cfr"));
    // ustawiony FPS: filtr fps, bez -fps_mode
    let pl = plan(&film(10.0), &telefon_480p(), "wy.mp4");
    assert!(wartosc(&pl.przebiegi[0], "-vf").unwrap().ends_with("fps=25"));
    assert_eq!(wartosc(&pl.przebiegi[0], "-fps_mode"), None);
}

fn film_wielosciezkowy() -> Media {
    use soraconverter_lib::sonda::StrumienNapisow;
    let mut m = film(30.0);
    let a2 = StrumienAudio { indeks: 2, kodek: "ac3".into(), kanaly: Some(6), ..audio1() };
    m.sciezki_audio = vec![audio1(), a2];
    m.napisy = vec![
        StrumienNapisow { indeks: 3, kodek: "subrip".into(), jezyk: Some("pol".into()), tekstowe: true },
        StrumienNapisow { indeks: 4, kodek: "hdmv_pgs_subtitle".into(), jezyk: None, tekstowe: false },
        StrumienNapisow { indeks: 5, kodek: "mov_text".into(), jezyk: None, tekstowe: true },
    ];
    m
}

#[test]
fn c17_napisy_mp4_mov_text_pgs_pominiete() {
    let pl = plan(&film_wielosciezkowy(), &Profil::dla(Kontener::Mp4), "wy.mp4");
    let a = &pl.przebiegi[0];
    assert!(ma(a, &["-map", "0:3", "-c:s:0", "mov_text"]));
    assert!(ma(a, &["-map", "0:5", "-c:s:1", "mov_text"]));
    assert!(!ma(a, &["-map", "0:4"]));
    assert!(!a.contains(&"-sn".to_string()));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::NapisyPominiete { n: 1 }));
}

#[test]
fn c17_napisy_mkv_kopia_webm_vtt_avi_brak() {
    let pl = plan(&film_wielosciezkowy(), &Profil::dla(Kontener::Mkv), "wy.mkv");
    let a = &pl.przebiegi[0];
    assert!(ma(a, &["-map", "0:3", "-c:s:0", "copy"]));
    assert!(ma(a, &["-map", "0:4", "-c:s:1", "copy"]));
    assert!(ma(a, &["-map", "0:5", "-c:s:2", "srt"]));
    let pl = plan(&film_wielosciezkowy(), &Profil::dla(Kontener::Webm), "wy.webm");
    assert!(ma(&pl.przebiegi[0], &["-c:s:0", "webvtt"]));
    let pl = plan(&film_wielosciezkowy(), &Profil::dla(Kontener::Avi), "wy.avi");
    assert!(pl.przebiegi[0].contains(&"-sn".to_string()));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::NapisyNieobslugiwane));
    // wyłączone napisy
    let mut p = Profil::dla(Kontener::Mkv);
    p.napisy = false;
    let pl = plan(&film_wielosciezkowy(), &p, "wy.mkv");
    assert!(pl.przebiegi[0].contains(&"-sn".to_string()));
    assert!(!pl.przebiegi[0].iter().any(|x| x.starts_with("-c:s")));
}

#[test]
fn c17_opus_w_mp4_ostrzega() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Opus, kbps: 96, ..Default::default() });
    assert!(plan(&film(10.0), &p, "wy.mp4").podpowiedzi.contains(&Podpowiedz::Mp4Opus));
}

#[test]
fn c18_faststart_w_mp4_mov_m4a() {
    for (k, wy) in [(Kontener::Mp4, "a.mp4"), (Kontener::Mov, "a.mov"), (Kontener::M4a, "a.m4a")] {
        assert!(ma(&plan(&film(10.0), &Profil::dla(k), wy).przebiegi[0], &["-movflags", "+faststart"]), "{k:?}");
    }
    assert!(!ma(&plan(&film(10.0), &Profil::dla(Kontener::Mkv), "a.mkv").przebiegi[0], &["-movflags", "+faststart"]));
}

#[test]
fn c19_wybor_sciezek_audio() {
    let m = film_wielosciezkowy();
    let pl = plan(&m, &Profil::dla(Kontener::Mkv), "wy.mkv");
    assert!(ma(&pl.przebiegi[0], &["-map", "0:0", "-map", "0:1"]));
    assert!(!ma(&pl.przebiegi[0], &["-map", "0:2"]));
    let mut p = Profil::dla(Kontener::Mkv);
    p.sciezki_audio = WyborAudio::Wszystkie;
    assert!(ma(&plan(&m, &p, "wy.mkv").przebiegi[0], &["-map", "0:1", "-map", "0:2"]));
    p.sciezki_audio = WyborAudio::Numer { n: 1 };
    let a = plan(&m, &p, "wy.mkv").przebiegi.remove(0);
    assert!(ma(&a, &["-map", "0:2"]) && !ma(&a, &["-map", "0:1"]));
    // numer spoza zakresu = ostatnia
    p.sciezki_audio = WyborAudio::Numer { n: 9 };
    assert!(ma(&plan(&m, &p, "wy.mkv").przebiegi[0], &["-map", "0:2"]));
}

#[test]
fn c19_mp3_z_okladka() {
    let m = Media {
        czas_s: Some(200.0),
        audio: Some(StrumienAudio { indeks: 0, kodek: "mp3".into(), ..audio1() }),
        sciezki_audio: vec![StrumienAudio { indeks: 0, kodek: "mp3".into(), ..audio1() }],
        okladka: true,
        ..Default::default()
    };
    let pl = plan(&m, &Profil::dla(Kontener::M4a), "wy.m4a");
    let a = &pl.przebiegi[0];
    assert!(ma(a, &["-map", "0:0"]));
    assert!(a.contains(&"-vn".to_string()));
    assert_eq!(a.iter().filter(|x| *x == "-map").count(), 1);
}

#[test]
fn c20_unikalny_passlogfile_w_katalogu_zadania() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 5.0 }, ..Default::default() });
    let k1 = budowniczy::Kontekst { zscale: true, katalog_tmp: Some("/tmp/zadanie-1".into()) };
    let k2 = budowniczy::Kontekst { zscale: true, katalog_tmp: Some("/tmp/zadanie-2".into()) };
    let a = plan_k(&film(60.0), &p, "wy.mp4", &k1);
    let b = plan_k(&film(60.0), &p, "wy.mp4", &k2);
    let la = wartosc(&a.przebiegi[0], "-passlogfile").unwrap().to_string();
    let lb = wartosc(&b.przebiegi[0], "-passlogfile").unwrap().to_string();
    assert_ne!(la, lb);
    assert!(la.starts_with("/tmp/zadanie-1"));
    assert!(a.tymczasowe.iter().all(|t| t.starts_with("/tmp/zadanie-1")));
    // GIF: paleta też w katalogu zadania
    let g = plan_k(&film(10.0), &Profil::dla(Kontener::Gif), "wy.gif", &k1);
    assert!(g.tymczasowe[0].starts_with("/tmp/zadanie-1"));
}

#[cfg(unix)]
#[test]
fn d25_sciezka_spoza_utf8_bez_strat() {
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    let we = std::ffi::OsString::from_vec(b"/filmy/zle\xffimie.mp4".to_vec());
    let wy = std::ffi::OsString::from_vec(b"/filmy/wynik\xfe.mp4".to_vec());
    let pl = budowniczy::plan(&film(10.0), &Profil::dla(Kontener::Mp4), Path::new(&we), Path::new(&wy)).unwrap();
    let a = &pl.przebiegi[0];
    assert!(a.iter().any(|x| x.as_bytes() == we.as_bytes()));
    assert_eq!(a.last().unwrap().as_bytes(), wy.as_bytes());
}

#[test]
fn p4_wytnij_bez_ponownego_kodowania() {
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::Kopiuj, ..Default::default() });
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Kopiuj, ..Default::default() });
    p.ciecie = Some(Ciecie { od: 12.0, koniec: Some(20.0) });
    let pl = plan(&film(60.0), &p, "wy.mp4");
    let a = &pl.przebiegi[0];
    assert!(ma(a, &["-ss", "12", "-t", "8", "-i", "we.mp4"]));
    assert!(ma(a, &["-c:v", "copy"]) && ma(a, &["-c:a", "copy"]));
    assert!(ma(a, &["-avoid_negative_ts", "make_zero"]));
    assert!(pl.podpowiedzi.contains(&Podpowiedz::CiecieKlatkaKluczowa));
    // zwykła konwersja z cięciem: bez tej podpowiedzi
    let mut p2 = Profil::dla(Kontener::Mp4);
    p2.ciecie = p.ciecie.clone();
    assert!(!plan(&film(60.0), &p2, "wy.mp4").podpowiedzi.contains(&Podpowiedz::CiecieKlatkaKluczowa));
}

#[test]
fn p4_lancuch_podgladu_ten_sam_co_konwersja() {
    let k = budowniczy::Kontekst::default();
    let pl = plan(&film(60.0), &telefon_480p(), "wy.mp4");
    let vf = wartosc(&pl.przebiegi[0], "-vf").map(String::from);
    assert_eq!(budowniczy::lancuch_podgladu(&film(60.0), &telefon_480p(), &k).unwrap(), vf);
    let gif = budowniczy::lancuch_podgladu(&film(60.0), &Profil::dla(Kontener::Gif), &k).unwrap().unwrap();
    assert!(gif.contains("palettegen") && gif.contains("paletteuse=dither=sierra2_4a"), "{gif}");
    assert!(budowniczy::lancuch_podgladu(&film(60.0), &Profil::dla(Kontener::Mp3), &k).is_err());
    let o = budowniczy::plan_odsluchu(&film(60.0), &telefon_480p(), Path::new("we.mp4"), Path::new("o.m4a"), 10.0, &k)
        .unwrap();
    let t = o.jako_tekst();
    assert!(
        ma(&t[0], &["-ss", "10", "-t", "5"])
            && ma(&t[0], &["-c:a", "aac", "-b:a", "8k"])
            && t[0].contains(&"-vn".to_string())
    );
}
