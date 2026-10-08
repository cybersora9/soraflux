//! Pobieracz na sucho: parsowanie zapisanego `yt-dlp -J` i argumenty pobrania.
//! Bez sieci. Fixtures mają zmyślone dane (żadnych linków do cudzych utworów).

use soraconverter_lib::narzedzia::Sciezki;
use soraconverter_lib::pobieracz::{self, Info, OpcjePobrania, Wybor};
use std::path::{Path, PathBuf};

fn fixture(nazwa: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures").join(nazwa);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{p:?}: {e}"))
}

#[test]
fn film_z_json() {
    let Info::Film(f) = pobieracz::info_z_json(&fixture("ytdlp_film.json")).unwrap() else { panic!("to nie film") };
    assert_eq!(f.id, "test-film01");
    assert!(f.tytul.starts_with("Film testowy"));
    assert_eq!(f.czas_s, Some(635.0));
    assert_eq!(f.autor.as_deref(), Some("Kanał testowy"));
    assert_eq!(f.miniatura.as_deref(), Some("https://img.example.com/vi_webp/test-film01/maxresdefault.webp"));
    assert_eq!(f.url, "https://www.example.com/watch?v=test-film01");
    // storyboard odfiltrowany, reszta jest
    assert_eq!(f.formaty.len(), 13);
    assert!(f.formaty.iter().all(|x| x.id != "sb0"));
    assert_eq!(f.wysokosci, vec![2160, 1440, 1080, 720, 480, 360]);
    assert_eq!(f.napisy, vec!["en", "pl"]);
    assert_eq!(f.rozdzialy, 3);
    assert!(!f.na_zywo);
    let audio = f.formaty.iter().find(|x| x.id == "140").unwrap();
    assert_eq!(audio.vkodek, None);
    assert_eq!(audio.akodek.as_deref(), Some("mp4a.40.2"));
    assert_eq!(audio.rozmiar_b, Some(10295366));
    let av1 = f.formaty.iter().find(|x| x.id == "401").unwrap();
    assert_eq!(av1.rozmiar_b, Some(1100223344), "filesize_approx gdy brak filesize");
    assert_eq!((av1.w, av1.h, av1.fps), (Some(3840), Some(2160), Some(60.0)));
}

#[test]
fn playlista_z_json() {
    let Info::Playlista { tytul, wpisy, url } = pobieracz::info_z_json(&fixture("ytdlp_playlista.json")).unwrap()
    else {
        panic!("to nie playlista")
    };
    assert_eq!(tytul, "Playlista testowa");
    assert!(url.contains("playlist?list="));
    assert_eq!(wpisy.len(), 3, "null w entries pominięty");
    assert_eq!(wpisy[1].tytul, "Film testowy 2");
    assert_eq!(wpisy[2].czas_s, None);
    assert_eq!(wpisy[0].url, "https://www.example.com/watch?v=test-film01");
}

#[test]
fn tolerancja_na_braki() {
    let Info::Film(f) = pobieracz::info_z_json(r#"{"id":"x","title":"Bez formatów"}"#).unwrap() else { panic!() };
    assert!(f.formaty.is_empty());
    assert_eq!(f.czas_s, None);
    assert!(pobieracz::info_z_json("nie json").is_err());
}

#[test]
fn argumenty_info_i_pobrania() {
    let sc = Sciezki { ffmpeg: Some("C:/SoraConverter/ffmpeg.exe".into()), ..Default::default() };
    let a = pobieracz::argumenty_info("https://example.com/x", true, &sc);
    assert!(a.windows(2).any(|w| w[0] == "--yes-playlist" && w[1] == "--flat-playlist"));
    assert_eq!(a[0], "-J");

    let o = OpcjePobrania {
        wybor: Wybor::Format { id: "299".into(), z_audio: false },
        rozdzialy: true,
        ..Default::default()
    };
    let a = pobieracz::argumenty_pobrania("https://example.com/x", &o, Path::new("/pobrane"), &sc);
    let j = pobieracz::jako_tekst(&a);
    assert!(j.contains("-f 299+ba/299"));
    assert!(j.contains("--progress-template download:SORA|"));
    assert!(j.contains("--print after_move:PLIK|%(filepath)s"));
    assert!(j.contains("--embed-chapters"));
    assert!(j.contains("--ffmpeg-location C:/SoraConverter/ffmpeg.exe"));
    assert!(!j.contains("-S "), "konkretny format bez sortowania");
    assert!(pobieracz::zawiera(&a, Path::new("/pobrane").join(pobieracz::SZABLON_NAZWY)));
}
