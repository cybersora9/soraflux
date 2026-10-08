//! Presety: wbudowane (nazwa to klucz i18n) + użytkownika (presety.json).

use crate::ustawienia::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Preset {
    pub id: String,
    /// Dla wbudowanych: klucz i18n (`preset.telefon`); dla własnych: zwykły tekst.
    pub nazwa: String,
    /// "konwertuj" | "obrazy"
    pub zakladka: String,
    #[serde(default)]
    pub wbudowany: bool,
    pub profil: Profil,
}

fn preset(id: &str, zakladka: &str, profil: Profil) -> Preset {
    Preset { id: id.into(), nazwa: format!("preset.{id}"), zakladka: zakladka.into(), wbudowany: true, profil }
}

fn wideo(kontener: Kontener, pw: ProfilWideo, audio: ProfilAudio) -> Profil {
    Profil { wideo: Some(pw), audio: Some(audio), ..Profil::dla(kontener) }
}

pub fn wbudowane() -> Vec<Preset> {
    let aac96 = ProfilAudio { kodek: KodekAudio::Aac, kbps: 96, ..Default::default() };
    let p720 = |mb: f32| ProfilWideo {
        rozdzielczosc: Rozdzielczosc::Wysokosc { h: 720 },
        nie_powiekszaj: true,
        jakosc: JakoscWideo::RozmiarMb { mb },
        ..Default::default()
    };
    vec![
        preset(
            "telefon",
            "konwertuj",
            wideo(
                Kontener::Mp4,
                ProfilWideo {
                    rozdzielczosc: Rozdzielczosc::Wysokosc { h: 480 },
                    nie_powiekszaj: true,
                    fps: Fps::Wartosc { fps: 25.0 },
                    jakosc: JakoscWideo::Bitrate { kbps: 800 },
                    ..Default::default()
                },
                aac96.clone(),
            ),
        ),
        // Zapas poniżej limitu (Discord liczy 10 MB, WhatsApp 16 MB).
        preset("discord", "konwertuj", wideo(Kontener::Mp4, p720(9.5), aac96.clone())),
        preset("whatsapp", "konwertuj", wideo(Kontener::Mp4, p720(15.5), aac96)),
        preset(
            "podcast",
            "konwertuj",
            Profil {
                audio: Some(ProfilAudio {
                    kodek: KodekAudio::Aac,
                    kbps: 8,
                    hz: Some(16000),
                    kanaly: Some(1),
                    normalizacja: true,
                }),
                ..Profil::dla(Kontener::M4a)
            },
        ),
        preset(
            "mp3_320",
            "konwertuj",
            Profil {
                audio: Some(ProfilAudio {
                    kodek: KodekAudio::Mp3,
                    kbps: 320,
                    hz: Some(44100),
                    kanaly: Some(2),
                    normalizacja: false,
                }),
                ..Profil::dla(Kontener::Mp3)
            },
        ),
        preset("gif", "konwertuj", Profil { gif: Some(ProfilGif::default()), ..Profil::dla(Kontener::Gif) }),
        preset(
            "webp_1600",
            "obrazy",
            Profil {
                obraz: Some(ProfilObrazu {
                    rozmiar: RozmiarObrazu::Wymiary { w: Some(1600), h: None },
                    jakosc: 80,
                    nie_powiekszaj: true,
                    ..Default::default()
                }),
                ..Profil::dla(Kontener::Webp)
            },
        ),
    ]
}

pub const PLIK: &str = "presety.json";

pub fn wczytaj_uzytkownika(katalog: &Path) -> Vec<Preset> {
    std::fs::read_to_string(katalog.join(PLIK)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn zapisz_uzytkownika(katalog: &Path, presety: &[Preset]) -> Result<(), String> {
    std::fs::create_dir_all(katalog).map_err(|e| e.to_string())?;
    let tmp = katalog.join(format!("{PLIK}.tmp"));
    std::fs::write(&tmp, serde_json::to_string_pretty(presety).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, katalog.join(PLIK)).map_err(|e| e.to_string())
}

/// Dodaje albo podmienia preset użytkownika (po id).
pub fn zapisz(katalog: &Path, mut p: Preset) -> Result<Preset, String> {
    let mut lista = wczytaj_uzytkownika(katalog);
    p.wbudowany = false;
    if p.id.is_empty() || p.id.starts_with("preset.") || wbudowane().iter().any(|w| w.id == p.id) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        p.id = format!("u{t}");
    }
    match lista.iter_mut().find(|x| x.id == p.id) {
        Some(x) => *x = p.clone(),
        None => lista.push(p.clone()),
    }
    zapisz_uzytkownika(katalog, &lista)?;
    Ok(p)
}

pub fn usun(katalog: &Path, id: &str) -> Result<(), String> {
    let mut lista = wczytaj_uzytkownika(katalog);
    lista.retain(|p| p.id != id);
    zapisz_uzytkownika(katalog, &lista)
}

#[cfg(test)]
mod testy {
    use super::*;
    use crate::budowniczy;
    use crate::sonda::{Media, StrumienAudio, StrumienWideo};

    #[test]
    fn wbudowane_buduja_sie() {
        let film = Media {
            czas_s: Some(60.0),
            wideo: Some(StrumienWideo {
                kodek: "h264".into(),
                w: 1920,
                h: 1080,
                fps: Some(30.0),
                kbps: None,
                ..Default::default()
            }),
            audio: Some(StrumienAudio {
                kodek: "aac".into(),
                hz: Some(48000),
                kanaly: Some(2),
                kbps: Some(128),
                ..Default::default()
            }),
            ..Default::default()
        };
        let obraz = Media {
            wideo: Some(StrumienWideo { kodek: "png".into(), w: 3000, h: 2000, ..Default::default() }),
            obraz: true,
            ..Default::default()
        };
        for p in wbudowane() {
            let m = if p.zakladka == "obrazy" { &obraz } else { &film };
            budowniczy::plan(m, &p.profil, Path::new("a"), Path::new("b")).unwrap_or_else(|e| panic!("{}: {e}", p.id));
        }
    }

    #[test]
    fn zapis_i_usuwanie() {
        let tmp = tempfile::tempdir().unwrap();
        let p = Preset {
            id: String::new(),
            nazwa: "Mój".into(),
            zakladka: "konwertuj".into(),
            wbudowany: true,
            profil: Profil::dla(Kontener::Mkv),
        };
        let zapisany = zapisz(tmp.path(), p).unwrap();
        assert!(zapisany.id.starts_with('u'));
        assert!(!zapisany.wbudowany);
        assert_eq!(wczytaj_uzytkownika(tmp.path()).len(), 1);
        usun(tmp.path(), &zapisany.id).unwrap();
        assert!(wczytaj_uzytkownika(tmp.path()).is_empty());
    }
}
