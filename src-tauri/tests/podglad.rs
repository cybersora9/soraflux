//! Punkt 4: podgląd klatki przed/po, odsłuch 5 s, foldery wsadowo (prawdziwy ffmpeg).

use base64::Engine;
use soraconverter_lib::budowniczy::Kontekst;
use soraconverter_lib::komendy::{odsluch_z, podglad_klatki_z, rozwin_z_folderami};
use soraconverter_lib::sonda;
use soraconverter_lib::ustawienia::*;
use std::path::{Path, PathBuf};
use std::process::Command;

fn generuj(args: &[&str], wy: &Path) {
    let ok =
        Command::new("ffmpeg").args(["-hide_banner", "-y", "-loglevel", "error"]).args(args).arg(wy).status().unwrap();
    assert!(ok.success());
}

fn film(k: &Path) -> PathBuf {
    let p = k.join("film.mp4");
    generuj(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=25:duration=6",
            "-f",
            "lavfi",
            "-i",
            "sine=duration=6:sample_rate=48000",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ac",
            "2",
        ],
        &p,
    );
    p
}

fn media(p: &Path) -> sonda::Media {
    let w = Command::new("ffprobe").args(sonda::argumenty_ffprobe(p)).output().unwrap();
    sonda::media_z_json(&String::from_utf8_lossy(&w.stdout)).unwrap()
}

/// data URL → plik, żeby ffprobe sprawdził wynik.
fn zapisz(data: &str, cel: &Path) {
    let (naglowek, b64) = data.split_once(',').unwrap();
    assert!(naglowek.ends_with(";base64"));
    std::fs::write(cel, base64::engine::general_purpose::STANDARD.decode(b64).unwrap()).unwrap();
}

fn wymiary(p: &Path) -> (u32, u32) {
    let m = media(p);
    let w = m.wideo.unwrap();
    (w.w, w.h)
}

#[tokio::test]
async fn p4_podglad_klatki_przed_i_po() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path());
    let m = media(&we);
    let mut p = Profil::dla(Kontener::Mp4);
    p.wideo = Some(ProfilWideo { rozdzielczosc: Rozdzielczosc::Wysokosc { h: 360 }, ..Default::default() });
    p.obrot = Obrot::O90;
    let k = podglad_klatki_z(Path::new("ffmpeg"), &we, &m, &p, Some(2.0), &Kontekst::default()).await.unwrap();
    assert!(k.przed.starts_with("data:image/jpeg;base64,") && k.po.starts_with("data:image/jpeg;base64,"));
    zapisz(&k.przed, &tmp.path().join("przed.jpg"));
    zapisz(&k.po, &tmp.path().join("po.jpg"));
    assert_eq!(wymiary(&tmp.path().join("przed.jpg")), (960, 540), "przed: przeskalowane do 960 px");
    // po: obrót 90° i 360p → 202×360 (parzyste), mniejsze niż 960, więc bez dalszego skalowania
    assert_eq!(wymiary(&tmp.path().join("po.jpg")), (202, 360));
    // GIF: paleta z jednej klatki
    let g = podglad_klatki_z(Path::new("ffmpeg"), &we, &m, &Profil::dla(Kontener::Gif), None, &Kontekst::default())
        .await
        .unwrap();
    zapisz(&g.po, &tmp.path().join("gif.jpg"));
    assert_eq!(wymiary(&tmp.path().join("gif.jpg")), (480, 270));
}

#[tokio::test]
async fn p4_odsluch_5s_z_ustawieniami() {
    let tmp = tempfile::tempdir().unwrap();
    let we = film(tmp.path());
    let m = media(&we);
    let mut p = Profil::dla(Kontener::Mp4);
    p.audio =
        Some(ProfilAudio { kodek: KodekAudio::Aac, kbps: 8, hz: Some(16000), kanaly: Some(1), normalizacja: false });
    let d = odsluch_z(Path::new("ffmpeg"), &we, &m, &p, 0.5, &Kontekst::default()).await.unwrap();
    assert!(d.starts_with("data:audio/mp4;base64,"));
    let plik = tmp.path().join("o.m4a");
    zapisz(&d, &plik);
    let mo = media(&plik);
    let a = mo.audio.unwrap();
    assert_eq!((a.kodek.as_str(), a.kanaly, a.hz), ("aac", Some(1), Some(16000)));
    assert!(mo.wideo.is_none());
    let czas = mo.czas_s.unwrap();
    assert!((czas - 5.0).abs() < 0.2, "odsłuch {czas} s");
    // Opus → ogg
    p.audio = Some(ProfilAudio { kodek: KodekAudio::Opus, kbps: 8, ..Default::default() });
    p.kontener = Kontener::Webm;
    p.wideo = Some(ProfilWideo { kodek: KodekWideo::Vp9, ..Default::default() });
    assert!(odsluch_z(Path::new("ffmpeg"), &we, &m, &p, 0.0, &Kontekst::default())
        .await
        .unwrap()
        .starts_with("data:audio/ogg;base64,"));
}

#[test]
fn p4_foldery_struktura_i_filtr() {
    let tmp = tempfile::tempdir().unwrap();
    let f = tmp.path().join("Wakacje");
    std::fs::create_dir_all(f.join("dzien 1/telefon")).unwrap();
    for n in ["a.mp4", "dzien 1/b.MOV", "dzien 1/telefon/c.mp4", "dzien 1/notatka.txt", "dzien 1/zdj.jpg"] {
        std::fs::write(f.join(n), b"").unwrap();
    }
    let luzny = tmp.path().join("luzny.mkv");
    std::fs::write(&luzny, b"").unwrap();
    let wszystko = rozwin_z_folderami(&[f.clone(), luzny.clone()], &[]);
    let pary: Vec<(String, Option<String>)> = wszystko
        .iter()
        .map(|p| {
            (
                p.sciezka.file_name().unwrap().to_string_lossy().into_owned(),
                p.podkatalog.as_ref().map(|k| k.to_string_lossy().replace('\\', "/")),
            )
        })
        .collect();
    assert!(pary.contains(&("a.mp4".into(), Some("".into()))));
    assert!(pary.contains(&("b.MOV".into(), Some("dzien 1".into()))));
    assert!(pary.contains(&("c.mp4".into(), Some("dzien 1/telefon".into()))));
    assert!(pary.contains(&("zdj.jpg".into(), Some("dzien 1".into()))));
    assert!(pary.contains(&("luzny.mkv".into(), None)));
    assert!(!pary.iter().any(|(n, _)| n == "notatka.txt"));
    // filtr rozszerzeń (wielkość liter bez znaczenia, kropka opcjonalna)
    let tylko = rozwin_z_folderami(&[f], &["mov".into(), ".mp4".into()]);
    assert_eq!(tylko.len(), 3);
}
