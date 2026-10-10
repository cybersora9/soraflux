//! Parsery postępu: ffmpeg `-progress pipe:1` (pary klucz=wartość, blok
//! zakończony `progress=continue|end`) i yt-dlp z naszym `--progress-template`.

use serde::Serialize;

/// Stan jednego bloku `-progress`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Migawka {
    pub czas_s: f64,
    pub predkosc_x: Option<f64>,
    pub rozmiar_b: Option<u64>,
    pub koniec: bool,
}

#[derive(Debug, Default)]
pub struct ParserFfmpeg {
    biezaca: Migawka,
}

impl ParserFfmpeg {
    /// Zwraca migawkę po linii `progress=…`, w pozostałych przypadkach `None`.
    pub fn linia(&mut self, linia: &str) -> Option<Migawka> {
        let (k, v) = linia.trim().split_once('=')?;
        let v = v.trim();
        match k {
            // out_time_ms to w ffmpeg mikrosekundy (historyczna nazwa), out_time_us też.
            "out_time_us" | "out_time_ms" => {
                if let Ok(us) = v.parse::<i64>() {
                    self.biezaca.czas_s = (us.max(0) as f64) / 1_000_000.0;
                }
            }
            "out_time" if self.biezaca.czas_s == 0.0 => {
                if let Some(s) = czas_hms(v) {
                    self.biezaca.czas_s = s;
                }
            }
            "speed" => self.biezaca.predkosc_x = v.trim_end_matches('x').trim().parse().ok().filter(|x: &f64| *x > 0.0),
            "total_size" => self.biezaca.rozmiar_b = v.parse().ok(),
            "progress" => {
                self.biezaca.koniec = v == "end";
                let m = self.biezaca.clone();
                self.biezaca = Migawka { czas_s: m.czas_s, ..Default::default() };
                return Some(m);
            }
            _ => {}
        }
        None
    }
}

/// "00:01:02.500000" → 62.5
pub fn czas_hms(s: &str) -> Option<f64> {
    let mut suma = 0.0;
    for cz in s.split(':') {
        suma = suma * 60.0 + cz.parse::<f64>().ok()?;
    }
    Some(suma)
}

/// Zdarzenie `zadanie://postep`.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct Postep {
    pub id: u64,
    pub procent: f64,
    pub eta_s: Option<f64>,
    /// Ile razy szybciej niż odtwarzanie (ffmpeg).
    pub predkosc_x: Option<f64>,
    /// Bajty na sekundę (pobieranie).
    #[serde(default)]
    pub bajty_s: Option<f64>,
    pub przebieg: u8,
    pub przebiegi: u8,
    /// Nieznany czas trwania (stream, część GIF-ów): front pokazuje pasek nieokreślony.
    #[serde(default)]
    pub nieokreslony: bool,
    /// Etap zadania z kilkoma krokami (napisy: `dzwiek`, `rozpoznawanie`, `wypalanie`; klucz i18n `napisy.etap.*`).
    #[serde(default)]
    pub etap: Option<String>,
}

/// Postęp całego zadania z wieloma przebiegami (np. 2 przebiegi x264, GIF z paletą).
pub fn postep_przebiegu(m: &Migawka, czas_calk: Option<f64>, przebieg: u8, przebiegi: u8) -> (f64, Option<f64>) {
    let n = przebiegi.max(1) as f64;
    let i = przebieg.saturating_sub(1) as f64;
    let Some(c) = czas_calk.filter(|c| *c > 0.0) else {
        let p = if m.koniec { (i + 1.0) / n * 100.0 } else { i / n * 100.0 };
        return (p, None);
    };
    let ulamek = if m.koniec { 1.0 } else { (m.czas_s / c).clamp(0.0, 1.0) };
    let procent = (i + ulamek) / n * 100.0;
    let eta = m.predkosc_x.map(|x| {
        let zostalo_tu = (c - m.czas_s).max(0.0) / x;
        let kolejne = (n - i - 1.0) * c / x;
        zostalo_tu + kolejne
    });
    (procent, eta)
}

/// Linia z yt-dlp wg `SZABLON_POSTEPU_YTDLP`.
#[derive(Debug, Clone, PartialEq)]
pub enum LiniaYtdlp {
    Postep { pobrane: u64, calosc: Option<u64>, bajty_s: Option<f64>, eta_s: Option<f64> },
    Plik(String),
    Inna,
}

pub const SZABLON_POSTEPU_YTDLP: &str = "download:SORA|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s";
pub const SZABLON_PLIKU_YTDLP: &str = "after_move:PLIK|%(filepath)s";

fn pole<T: std::str::FromStr>(s: Option<&str>) -> Option<T> {
    s.map(str::trim).filter(|s| !s.is_empty() && *s != "NA" && *s != "None").and_then(|s| s.parse().ok())
}

pub fn linia_ytdlp(linia: &str) -> LiniaYtdlp {
    let l = linia.trim_end_matches(['\r', '\n']);
    if let Some(reszta) = l.strip_prefix("PLIK|") {
        return LiniaYtdlp::Plik(reszta.to_string());
    }
    let Some(reszta) = l.trim().strip_prefix("SORA|") else {
        return LiniaYtdlp::Inna;
    };
    let mut cz = reszta.split('|');
    let pobrane: Option<f64> = pole(cz.next());
    let calosc: Option<f64> = pole(cz.next());
    let szacunek: Option<f64> = pole(cz.next());
    let bajty_s: Option<f64> = pole(cz.next());
    let eta_s: Option<f64> = pole(cz.next());
    match pobrane {
        Some(p) => {
            LiniaYtdlp::Postep { pobrane: p as u64, calosc: calosc.or(szacunek).map(|c| c as u64), bajty_s, eta_s }
        }
        None => LiniaYtdlp::Inna,
    }
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn blok_ffmpeg() {
        let mut p = ParserFfmpeg::default();
        let wejscie = "frame=120\nfps=60.0\nout_time_us=4000000\nout_time=00:00:04.000000\ntotal_size=1048576\nspeed=2.5x\nprogress=continue\n";
        let mut wynik = None;
        for l in wejscie.lines() {
            if let Some(m) = p.linia(l) {
                wynik = Some(m);
            }
        }
        let m = wynik.unwrap();
        assert_eq!(m.czas_s, 4.0);
        assert_eq!(m.predkosc_x, Some(2.5));
        assert_eq!(m.rozmiar_b, Some(1048576));
        assert!(!m.koniec);
        let (procent, eta) = postep_przebiegu(&m, Some(10.0), 1, 1);
        assert!((procent - 40.0).abs() < 1e-9);
        assert!((eta.unwrap() - 2.4).abs() < 1e-9);
    }

    #[test]
    fn speed_na_i_koniec() {
        let mut p = ParserFfmpeg::default();
        p.linia("out_time_ms=N/A");
        p.linia("speed=N/A");
        let m = p.linia("progress=end").unwrap();
        assert!(m.koniec);
        assert_eq!(m.predkosc_x, None);
        assert_eq!(postep_przebiegu(&m, Some(10.0), 2, 2).0, 100.0);
    }

    #[test]
    fn dwa_przebiegi() {
        let m = Migawka { czas_s: 5.0, predkosc_x: Some(1.0), ..Default::default() };
        let (p, eta) = postep_przebiegu(&m, Some(10.0), 1, 2);
        assert_eq!(p, 25.0);
        assert_eq!(eta, Some(15.0));
        let (p, _) = postep_przebiegu(&m, Some(10.0), 2, 2);
        assert_eq!(p, 75.0);
    }

    #[test]
    fn czas() {
        assert_eq!(czas_hms("00:01:02.5"), Some(62.5));
        assert_eq!(czas_hms("1:00:00"), Some(3600.0));
        assert_eq!(czas_hms("abc"), None);
    }

    #[test]
    fn c22_nieznany_czas_bez_dzielenia_przez_zero() {
        let mut p = ParserFfmpeg::default();
        p.linia("out_time_us=N/A");
        p.linia("out_time=N/A");
        p.linia("speed=0x");
        let m = p.linia("progress=continue").unwrap();
        assert_eq!(m.czas_s, 0.0);
        assert_eq!(m.predkosc_x, None);
        for czas in [None, Some(0.0), Some(-1.0)] {
            let (procent, eta) = postep_przebiegu(&m, czas, 1, 2);
            assert!(procent.is_finite() && (0.0..=100.0).contains(&procent));
            assert_eq!(eta, None);
        }
        let koniec = p.linia("progress=end").unwrap();
        assert_eq!(postep_przebiegu(&koniec, None, 2, 2).0, 100.0);
        // czas znany, prędkość 0 → bez ETA, bez nieskończoności
        let m = Migawka { czas_s: 1.0, predkosc_x: None, ..Default::default() };
        assert_eq!(postep_przebiegu(&m, Some(10.0), 1, 1).1, None);
    }

    #[test]
    fn ytdlp() {
        assert_eq!(
            linia_ytdlp("SORA|1024|4096|NA|512.5|6"),
            LiniaYtdlp::Postep { pobrane: 1024, calosc: Some(4096), bajty_s: Some(512.5), eta_s: Some(6.0) }
        );
        assert_eq!(
            linia_ytdlp("SORA|1024|NA|8192.0|NA|NA"),
            LiniaYtdlp::Postep { pobrane: 1024, calosc: Some(8192), bajty_s: None, eta_s: None }
        );
        assert_eq!(linia_ytdlp("PLIK|C:\\Filmy\\a b.mp4"), LiniaYtdlp::Plik("C:\\Filmy\\a b.mp4".into()));
        assert_eq!(linia_ytdlp("[youtube] abc: Downloading webpage"), LiniaYtdlp::Inna);
    }
}
