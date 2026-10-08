//! Przewidywany rozmiar wyniku (na żywo w GUI, wołane z debounce).
//! Bitrate i rozmiar MB są dokładne; CRF, GIF i obrazy to heurystyki.

use crate::budowniczy::kbps_audio_szac;
use crate::sonda::Media;
use crate::ustawienia::*;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Ostrzezenie {
    /// GIF/animacja powyżej 20 MB.
    Ogromny,
    /// Wynik wyraźnie większy niż źródło.
    WiekszyNizZrodlo,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Szacunek {
    pub bajty: Option<u64>,
    /// true = liczone z bitrate/rozmiaru, false = przybliżenie.
    pub dokladny: bool,
    pub ostrzezenie: Option<Ostrzezenie>,
    /// Docelowy bitrate wideo wyższy niż źródło: tyle kb/s ma źródło (podpowiedź
    /// „wyższy bitrate nie poprawi jakości”; szacunek liczony z bitrate źródła).
    #[serde(default)]
    pub zrodlo_kbps: Option<u32>,
}

const PROG_OGROMNY: u64 = 20 * 1024 * 1024;

/// Wymiary wyniku wideo (po obrocie, skali, przycięciu).
pub fn wymiary_wyniku(media: &Media, profil: &Profil) -> Option<(u32, u32)> {
    let src = media.wideo.as_ref()?;
    let r = profil.przyciecie;
    let (mut w, mut h) = (src.w.saturating_sub(r.lewo + r.prawo).max(1), src.h.saturating_sub(r.gora + r.dol).max(1));
    if matches!(profil.obrot, Obrot::O90 | Obrot::O270) {
        std::mem::swap(&mut w, &mut h);
    }
    let Some(pw) = &profil.wideo else { return Some((w, h)) };
    Some(match &pw.rozdzielczosc {
        Rozdzielczosc::Zachowaj => (w, h),
        Rozdzielczosc::Wysokosc { h: cel } => {
            let cel = if pw.nie_powiekszaj { (*cel).min(h) } else { *cel };
            (((w as f64 * cel as f64 / h as f64) / 2.0).round() as u32 * 2, cel)
        }
        Rozdzielczosc::Wlasna { w: cw, h: ch } => match pw.dopasowanie {
            Dopasowanie::Proporcje => {
                let s = (*cw as f64 / w as f64).min(*ch as f64 / h as f64);
                let s = if pw.nie_powiekszaj { s.min(1.0) } else { s };
                ((w as f64 * s).round() as u32, (h as f64 * s).round() as u32)
            }
            _ => (*cw, *ch),
        },
    })
}

fn bpp_crf(kodek: KodekWideo, crf: u8) -> f64 {
    // Bity na piksel na klatkę przy „typowym” materiale; co 6 CRF ≈ połowa bitrate.
    let (baza, srodek) = match kodek {
        KodekWideo::H264 => (0.075, 23.0),
        KodekWideo::H265 => (0.045, 23.0),
        KodekWideo::Av1 => (0.04, 30.0),
        KodekWideo::Vp9 => (0.045, 30.0),
        KodekWideo::Mpeg4 => (0.12, 23.0),
        KodekWideo::Kopiuj => (0.075, 23.0),
    };
    baza * 2f64.powf((srodek - crf as f64) / 6.0)
}

/// Bitrate samego obrazu w źródle: ze strumienia, a gdy go brak, całość minus dźwięk.
pub fn kbps_wideo_zrodla(media: &Media) -> Option<u32> {
    let v = media.wideo.as_ref()?;
    v.kbps.filter(|k| *k > 0).or_else(|| {
        let a = media.audio.as_ref().and_then(|a| a.kbps).unwrap_or(0);
        media.kbps.map(|k| k.saturating_sub(a)).filter(|k| *k > 0)
    })
}

/// Usterka 4a z testów 07.10: koder nie wyprodukuje więcej szczegółów, niż ma źródło
/// (statyczny obraz 7 MB, preset 800 kb/s → szacunek 21,4 MB, wynik 7,7 MB). Liczymy
/// `min(docelowy, źródłowy)`; zwraca też bitrate źródła, gdy docelowy jest wyższy.
fn bitrate_docelowy(media: &Media, kbps: u32) -> (f64, Option<u32>) {
    match kbps_wideo_zrodla(media) {
        Some(src) if kbps > src => (src as f64, Some(src)),
        _ => (kbps as f64, None),
    }
}

fn kbps_wideo(media: &Media, profil: &Profil, pw: &ProfilWideo) -> Option<(f64, bool)> {
    let (w, h) = wymiary_wyniku(media, profil)?;
    let fps = match pw.fps {
        Fps::Wartosc { fps } => fps as f64,
        Fps::Zachowaj => media.wideo.as_ref().and_then(|v| v.fps).unwrap_or(30.0),
    };
    match &pw.jakosc {
        JakoscWideo::Bitrate { kbps } => {
            let (k, przyciety) = bitrate_docelowy(media, *kbps);
            Some((k, przyciety.is_none()))
        }
        JakoscWideo::Crf { .. } if pw.kodek == KodekWideo::Kopiuj => {
            let v = media.wideo.as_ref()?;
            Some((v.kbps.map(|k| k as f64).or(media.kbps.map(|k| k as f64))?, true))
        }
        JakoscWideo::Crf { crf } => {
            let mut kbps = w as f64 * h as f64 * fps * bpp_crf(pw.kodek, *crf) / 1000.0;
            // Nie więcej niż źródło przeskalowane do nowej liczby pikseli (koder nie „doda” szczegółów).
            if let Some(src) = media.wideo.as_ref() {
                if let Some(k) = src.kbps.or(media.kbps) {
                    let skala = (w as f64 * h as f64) / (src.w.max(1) as f64 * src.h.max(1) as f64);
                    kbps = kbps.min(k as f64 * skala.max(0.05) * 1.3);
                }
            }
            Some((kbps, false))
        }
        JakoscWideo::RozmiarMb { .. } => None,
    }
}

pub fn szacuj(media: &Media, profil: &Profil) -> Szacunek {
    let nic = Szacunek { bajty: None, dokladny: false, ostrzezenie: None, zrodlo_kbps: None };
    let k = profil.kontener;

    // Animacje
    if let Some(g) = profil.gif.as_ref().filter(|_| (k == Kontener::Gif || k == Kontener::Webp) && !media.obraz) {
        let Some(czas) = media.czas_wyniku(profil.ciecie.as_ref(), profil.predkosc) else { return nic };
        let Some(src) = media.wideo.as_ref() else { return nic };
        let w = g.szerokosc.min(src.w).max(1) as f64;
        let h = w * src.h as f64 / src.w.max(1) as f64;
        // Bajty na piksel na klatkę. Kalibracja (usterka 4b z 07.10: szacunek 43 MB, wynik 11 MB,
        // czyli stare 0,13 było ~4× za dużo) na klipach z lavfi przez ten sam łańcuch
        // palettegen/paletteuse: mały ruch na stałym tle 0,036–0,048, testsrc2 0,11, plansza 0,006.
        // Bierzemy typowy materiał (ruch w części kadru); test: kolejka::gif_szacunek_skalibrowany.
        let na_piksel = match (k, &g.dithering) {
            (Kontener::Webp, _) => 0.015,
            (_, Dithering::Brak) => 0.04,
            _ => 0.045,
        };
        let bajty = (w * h * g.fps as f64 * czas * na_piksel) as u64;
        return Szacunek {
            bajty: Some(bajty),
            dokladny: false,
            ostrzezenie: (bajty > PROG_OGROMNY).then_some(Ostrzezenie::Ogromny),
            zrodlo_kbps: None,
        };
    }

    // Obrazy
    if k.obraz() {
        let Some((w, h)) = wymiary_obrazu(media, profil) else { return nic };
        let px = w as f64 * h as f64;
        let q = profil.obraz.as_ref().map(|o| o.jakosc).unwrap_or(85) as f64 / 100.0;
        let (bajty, dokladny) = match k {
            Kontener::Bmp => (px * 3.0 + 54.0, true),
            Kontener::Ico => (px * 4.0 + 62.0, false),
            Kontener::Png => (px * 1.6, false),
            Kontener::Gif => (px * 0.6, false),
            Kontener::Jpg => (px * (0.06 + q.powi(3) * 0.45), false),
            Kontener::Webp => (px * (0.04 + q.powi(3) * 0.3), false),
            Kontener::Avif => (px * (0.03 + q.powi(3) * 0.2), false),
            _ => return nic,
        };
        return Szacunek { bajty: Some(bajty as u64), dokladny, ostrzezenie: None, zrodlo_kbps: None };
    }

    let Some(czas) = media.czas_wyniku(profil.ciecie.as_ref(), profil.predkosc) else { return nic };
    let audio = if media.audio.is_some() { profil.audio.as_ref() } else { None };
    let kbps_a = kbps_audio_szac(audio, media) as f64;
    let mut dokladny = true;
    let wideo_wl = !k.tylko_audio() && media.wideo.is_some() && !media.obraz;
    let bajty = match profil.wideo.as_ref().filter(|_| wideo_wl) {
        Some(pw) => {
            if let JakoscWideo::RozmiarMb { mb } = pw.jakosc {
                Some(mb as f64 * 1024.0 * 1024.0 * 0.98)
            } else {
                kbps_wideo(media, profil, pw).map(|(kv, d)| {
                    dokladny &= d;
                    (kv + kbps_a) * 1000.0 / 8.0 * czas * 1.01
                })
            }
        }
        None => Some(kbps_a * 1000.0 / 8.0 * czas * 1.005),
    };
    let Some(bajty) = bajty else { return nic };
    if audio.is_some_and(|a| a.kodek == KodekAudio::Flac) {
        dokladny = false;
    }
    let bajty = bajty as u64;
    let ostrzezenie = match media.rozmiar_b {
        Some(src) if wideo_wl && bajty > src.saturating_mul(3) / 2 && src > 0 => Some(Ostrzezenie::WiekszyNizZrodlo),
        _ => None,
    };
    let zrodlo_kbps = match profil.wideo.as_ref().filter(|_| wideo_wl).map(|pw| &pw.jakosc) {
        Some(JakoscWideo::Bitrate { kbps }) => bitrate_docelowy(media, *kbps).1,
        _ => None,
    };
    Szacunek { bajty: Some(bajty), dokladny, ostrzezenie, zrodlo_kbps }
}

pub fn wymiary_obrazu(media: &Media, profil: &Profil) -> Option<(u32, u32)> {
    let src = media.wideo.as_ref()?;
    let (w, h) = (src.w as f64, src.h as f64);
    let po = profil.obraz.clone().unwrap_or_default();
    let (nw, nh) = match &po.rozmiar {
        RozmiarObrazu::Zachowaj => (w, h),
        RozmiarObrazu::Procent { p } => {
            let p = if po.nie_powiekszaj { p.min(100.0) } else { *p } as f64 / 100.0;
            (w * p, h * p)
        }
        RozmiarObrazu::Wymiary { w: cw, h: ch } => match (cw, ch) {
            (None, None) => (w, h),
            (Some(cw), None) => {
                let cw = if po.nie_powiekszaj { (*cw as f64).min(w) } else { *cw as f64 };
                (cw, h * cw / w)
            }
            (None, Some(ch)) => {
                let ch = if po.nie_powiekszaj { (*ch as f64).min(h) } else { *ch as f64 };
                (w * ch / h, ch)
            }
            (Some(cw), Some(ch)) => match po.dopasowanie {
                Dopasowanie::Proporcje => {
                    let s = (*cw as f64 / w).min(*ch as f64 / h);
                    let s = if po.nie_powiekszaj { s.min(1.0) } else { s };
                    (w * s, h * s)
                }
                _ => (*cw as f64, *ch as f64),
            },
        },
    };
    let (mut nw, mut nh) = (nw.round().max(1.0), nh.round().max(1.0));
    if profil.kontener == Kontener::Ico && (nw > 256.0 || nh > 256.0) {
        let s = (256.0 / nw).min(256.0 / nh);
        nw = (nw * s).round();
        nh = (nh * s).round();
    }
    Some((nw as u32, nh as u32))
}

#[cfg(test)]
mod testy {
    use super::*;
    use crate::sonda::{StrumienAudio, StrumienWideo};

    fn film() -> Media {
        Media {
            czas_s: Some(100.0),
            rozmiar_b: Some(100_000_000),
            kbps: Some(8000),
            wideo: Some(StrumienWideo {
                kodek: "h264".into(),
                w: 1920,
                h: 1080,
                fps: Some(30.0),
                kbps: Some(7800),
                ..Default::default()
            }),
            audio: Some(StrumienAudio {
                kodek: "aac".into(),
                hz: Some(48000),
                kanaly: Some(2),
                kbps: Some(192),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn bitrate_dokladny() {
        let mut p = Profil::dla(Kontener::Mp4);
        p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::Bitrate { kbps: 800 }, ..Default::default() });
        p.audio = Some(ProfilAudio { kbps: 8, ..Default::default() });
        let s = szacuj(&film(), &p);
        // (800+8) kb/s * 100 s = 10,1 MB
        let b = s.bajty.unwrap() as f64;
        assert!((b - 808.0 * 125.0 * 100.0 * 1.01).abs() < 10.0);
        assert!(s.dokladny);
    }

    #[test]
    fn rozmiar_mb_i_audio() {
        let mut p = Profil::dla(Kontener::Mp4);
        p.wideo = Some(ProfilWideo { jakosc: JakoscWideo::RozmiarMb { mb: 10.0 }, ..Default::default() });
        assert!(szacuj(&film(), &p).bajty.unwrap() <= 10 * 1024 * 1024);
        let mut p = Profil::dla(Kontener::Mp3);
        p.audio = Some(ProfilAudio { kodek: KodekAudio::Mp3, kbps: 320, ..Default::default() });
        let b = szacuj(&film(), &p).bajty.unwrap();
        assert!((3_900_000..4_200_000).contains(&b), "{b}");
    }

    /// Usterka 4a: film 7 MB ze statycznym obrazem (ok. 3 min, obraz 150 kb/s), preset Telefon
    /// 800 kb/s: wcześniej 21,4 MB i „większy niż oryginał”, faktycznie wyszło 7,7 MB.
    #[test]
    fn bitrate_ponad_zrodlo_liczony_ze_zrodla() {
        let m = Media {
            czas_s: Some(191.0),
            rozmiar_b: Some(7 * 1024 * 1024),
            kbps: Some(293),
            wideo: Some(StrumienWideo { w: 854, h: 480, fps: Some(25.0), kbps: Some(150), ..Default::default() }),
            audio: Some(StrumienAudio { kodek: "aac".into(), kbps: Some(128), ..Default::default() }),
            ..Default::default()
        };
        let mut p = Profil::dla(Kontener::Mp4);
        p.wideo = Some(ProfilWideo {
            rozdzielczosc: Rozdzielczosc::Wysokosc { h: 480 },
            nie_powiekszaj: true,
            jakosc: JakoscWideo::Bitrate { kbps: 800 },
            ..Default::default()
        });
        p.audio = Some(ProfilAudio { kbps: 96, ..Default::default() });
        let s = szacuj(&m, &p);
        let mb = s.bajty.unwrap() as f64 / 1_048_576.0;
        assert!((5.0..9.0).contains(&mb), "{mb:.1} MB (faktycznie 7,7 MB)");
        assert_eq!(s.ostrzezenie, None, "nie „większy niż oryginał”");
        assert_eq!(s.zrodlo_kbps, Some(150));
        assert!(!s.dokladny);
        // bez strumieniowego bitrate: całość minus dźwięk
        let mut m2 = m.clone();
        m2.wideo.as_mut().unwrap().kbps = None;
        assert_eq!(kbps_wideo_zrodla(&m2), Some(165));
    }

    #[test]
    fn gif_ogromny() {
        let mut p = Profil::dla(Kontener::Gif);
        p.gif = Some(ProfilGif { szerokosc: 1920, fps: 30.0, ..Default::default() });
        let s = szacuj(&film(), &p);
        assert_eq!(s.ostrzezenie, Some(Ostrzezenie::Ogromny));
        p.ciecie = Some(Ciecie { od: 0.0, koniec: Some(3.0) });
        p.gif = Some(ProfilGif::default());
        assert_eq!(szacuj(&film(), &p).ostrzezenie, None);
    }

    #[test]
    fn wymiary() {
        let mut p = Profil::dla(Kontener::Mp4);
        p.wideo = Some(ProfilWideo { rozdzielczosc: Rozdzielczosc::Wysokosc { h: 480 }, ..Default::default() });
        assert_eq!(wymiary_wyniku(&film(), &p), Some((854, 480)));
        p.obrot = Obrot::O90;
        assert_eq!(wymiary_wyniku(&film(), &p), Some((270, 480)));
        let obraz = Media {
            wideo: Some(StrumienWideo { w: 1000, h: 800, ..Default::default() }),
            obraz: true,
            ..Default::default()
        };
        let mut p = Profil::dla(Kontener::Ico);
        assert_eq!(wymiary_obrazu(&obraz, &p), Some((256, 205)));
        p.kontener = Kontener::Webp;
        p.obraz = Some(ProfilObrazu { rozmiar: RozmiarObrazu::Procent { p: 50.0 }, ..Default::default() });
        assert_eq!(wymiary_obrazu(&obraz, &p), Some((500, 400)));
    }
}
