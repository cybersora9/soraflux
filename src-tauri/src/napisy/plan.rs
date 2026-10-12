//! Argumenty ffmpeg i whisper-cli, fragmenty długich plików, postęp etapów i ETA. Czyste funkcje.

use crate::sonda::Media;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

/// Długość fragmentu długiego pliku (s). Każdy fragment to osobny WAV i osobne uruchomienie
/// whispera: mniej pamięci i miejsca w katalogu tymczasowym, częstszy postęp i szybsze anulowanie.
pub const DLUGOSC_FRAGMENTU_S: f64 = 600.0;

/// Bajty WAV 16 kHz mono 16-bit na sekundę.
pub const BAJTY_WAV_NA_S: u64 = 16_000 * 2;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fragment {
    pub od_s: f64,
    /// `None` = do końca pliku.
    pub dl_s: Option<f64>,
}

/// Podział na fragmenty. Do 1,5 × [`DLUGOSC_FRAGMENTU_S`] (i przy nieznanej długości) jeden
/// fragment; dłuższe po [`DLUGOSC_FRAGMENTU_S`], ostatni do końca pliku.
/// Cięcie bez zakładki: słowo na granicy fragmentów może się rozdzielić (ryzyko opisane w PR).
pub fn fragmenty(czas_s: Option<f64>) -> Vec<Fragment> {
    let Some(czas) = czas_s.filter(|c| c.is_finite() && *c > DLUGOSC_FRAGMENTU_S * 1.5) else {
        return vec![Fragment { od_s: 0.0, dl_s: None }];
    };
    let n = (czas / DLUGOSC_FRAGMENTU_S).ceil() as usize;
    (0..n)
        .map(|i| Fragment { od_s: i as f64 * DLUGOSC_FRAGMENTU_S, dl_s: (i + 1 < n).then_some(DLUGOSC_FRAGMENTU_S) })
        .collect()
}

/// Najdłuższy fragment w sekundach (do sprawdzenia miejsca na WAV).
pub fn najdluzszy_fragment_s(czas_s: Option<f64>) -> Option<f64> {
    let f = fragmenty(czas_s);
    match f.as_slice() {
        [jeden] => jeden.dl_s.or(czas_s),
        _ => czas_s.map(|c| c - f.last().map(|x| x.od_s).unwrap_or(0.0)).map(|ost| ost.max(DLUGOSC_FRAGMENTU_S)),
    }
}

/// Czy plik ma dźwięk, z którego da się zrobić napisy.
pub fn ma_dzwiek(m: &Media) -> bool {
    m.audio.is_some() || !m.sciezki_audio.is_empty()
}

fn os(s: impl Into<OsString>) -> OsString {
    s.into()
}

fn sekundy(s: f64) -> String {
    format!("{:.3}", s.max(0.0))
}

/// ffmpeg: pierwsza ścieżka dźwięku fragmentu → WAV 16 kHz mono PCM 16-bit (wejście whispera).
pub fn argumenty_audio(wejscie: &Path, f: &Fragment, wav: &Path) -> Vec<OsString> {
    let mut a: Vec<OsString> =
        ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"].into_iter().map(os).collect();
    if f.od_s > 0.0 {
        a.extend([os("-ss"), os(sekundy(f.od_s))]);
    }
    a.extend([os("-i"), wejscie.as_os_str().to_os_string()]);
    if let Some(dl) = f.dl_s {
        a.extend([os("-t"), os(sekundy(dl))]);
    }
    a.extend(
        ["-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav"]
            .into_iter()
            .map(os),
    );
    a.push(wav.as_os_str().to_os_string());
    a
}

/// Wątki dla whispera: wszystkie rdzenie logiczne poza jednym (GUI zostaje płynne), najwyżej 8.
pub fn liczba_watkow(logiczne: usize) -> usize {
    logiczne.saturating_sub(1).clamp(1, 8)
}

/// whisper-cli: JSON (`-oj`) do `baza.json`, postęp na stderr (`-pp`).
/// `wav` i `baza` to nazwy względne w katalogu roboczym procesu (ASCII, patrz [`sciezka_dla_whispera`]).
pub fn argumenty_whisper(model: &Path, wav: &Path, baza: &Path, jezyk: &str, watki: usize) -> Vec<OsString> {
    vec![
        os("-m"),
        model.as_os_str().to_os_string(),
        os("-f"),
        wav.as_os_str().to_os_string(),
        os("-l"),
        os(jezyk),
        os("-t"),
        os(watki.to_string()),
        os("-oj"),
        os("-of"),
        baza.as_os_str().to_os_string(),
        os("-pp"),
    ]
}

/// Postęp z linii stderr whispera: `whisper_print_progress_callback: progress =  45%` → 0,45.
pub fn postep_whispera(linia: &str) -> Option<f64> {
    let reszta = linia.split("progress =").nth(1)?;
    let liczba = reszta.trim().strip_suffix('%')?.trim();
    liczba.parse::<f64>().ok().filter(|p| p.is_finite()).map(|p| (p / 100.0).clamp(0.0, 1.0))
}

/// whisper-cli na Windows czyta ścieżki przez `argv` w stronie kodowej systemu: polskie litery
/// albo inne pismo w ścieżce mogą się nie otworzyć. Ścieżka z samymi znakami ASCII idzie bez zmian;
/// inaczej próbujemy względnej od katalogu roboczego (np. katalog tymczasowy i modele leżą pod tym
/// samym profilem użytkownika z „ł” w nazwie, a reszta ścieżki jest ASCII).
pub fn sciezka_dla_whispera(cel: &Path, cwd: &Path) -> PathBuf {
    let ascii = |p: &Path| p.to_str().is_some_and(|s| s.is_ascii());
    if ascii(cel) {
        return cel.to_path_buf();
    }
    match sciezka_wzgledna(cel, cwd) {
        Some(w) if ascii(&w) => w,
        _ => cel.to_path_buf(),
    }
}

/// Ścieżka `cel` względem katalogu `od` (obie bezwzględne, ten sam dysk). `None`, gdy się nie da.
pub fn sciezka_wzgledna(cel: &Path, od: &Path) -> Option<PathBuf> {
    if !cel.is_absolute() || !od.is_absolute() {
        return None;
    }
    let c: Vec<Component> = cel.components().collect();
    let o: Vec<Component> = od.components().collect();
    // inny dysk (Windows) albo inny korzeń
    if c.first() != o.first() {
        return None;
    }
    let wspolne = c.iter().zip(&o).take_while(|(a, b)| a == b).count();
    let mut w = PathBuf::new();
    for _ in wspolne..o.len() {
        w.push("..");
    }
    for k in &c[wspolne..] {
        w.push(k.as_os_str());
    }
    Some(w)
}

/// Kodeki dźwięku, które MP4 przyjmie bez przekodowania.
const AUDIO_DO_MP4: &[&str] = &["aac", "mp3", "ac3", "eac3", "alac", "opus"];

/// ffmpeg: film z wypalonymi napisami (MP4 H.264). `ass` = nazwa pliku napisów w katalogu
/// roboczym procesu: bez ścieżki w filtrze nie ma problemu z ucieczką `:` i `\` z Windows.
pub fn argumenty_wypalenia(wejscie: &Path, media: &Media, ass: &str, wyjscie: &Path) -> Vec<OsString> {
    let mut a: Vec<OsString> =
        ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-i"].into_iter().map(os).collect();
    a.push(wejscie.as_os_str().to_os_string());
    a.extend(["-map", "0:v:0", "-map", "0:a:0?", "-vf"].into_iter().map(os));
    a.push(os(format!("ass={ass}")));
    a.extend(["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p"].into_iter().map(os));
    let kodek = media.audio.as_ref().map(|x| x.kodek.as_str()).unwrap_or("");
    if AUDIO_DO_MP4.contains(&kodek) {
        a.extend(["-c:a", "copy"].into_iter().map(os));
    } else {
        a.extend(["-c:a", "aac", "-b:a", "192k"].into_iter().map(os));
    }
    a.extend(["-movflags", "+faststart"].into_iter().map(os));
    a.push(wyjscie.as_os_str().to_os_string());
    a
}

/// Etap zadania napisów (pokazywany w GUI).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Etap {
    Dzwiek,
    Rozpoznawanie,
    Wypalanie,
}

impl Etap {
    /// Klucz i18n (`napisy.etap.*`).
    pub fn klucz(self) -> &'static str {
        match self {
            Etap::Dzwiek => "dzwiek",
            Etap::Rozpoznawanie => "rozpoznawanie",
            Etap::Wypalanie => "wypalanie",
        }
    }
}

/// Udział wycinania dźwięku w czasie jednego fragmentu (reszta to whisper).
const UDZIAL_DZWIEKU: f64 = 0.1;
/// Udział rozpoznawania w całości, gdy jest też wypalanie (kodowanie H.264 całego filmu).
const UDZIAL_ROZPOZNAWANIA_Z_WYPALANIEM: f64 = 0.7;

/// Procent całego zadania (0–99,9; 100 dopiero po zapisaniu plików).
pub fn procent_calosci(etap: Etap, fragment: usize, fragmentow: usize, ulamek: f64, wypalanie: bool) -> f64 {
    let ulamek = if ulamek.is_finite() { ulamek.clamp(0.0, 1.0) } else { 0.0 };
    let n = fragmentow.max(1) as f64;
    let fragment = fragment.min(fragmentow.max(1) - 1) as f64;
    let rozpoznawanie = if wypalanie { UDZIAL_ROZPOZNAWANIA_Z_WYPALANIEM } else { 1.0 };
    let w_fragmencie = match etap {
        Etap::Dzwiek => ulamek * UDZIAL_DZWIEKU,
        Etap::Rozpoznawanie => UDZIAL_DZWIEKU + ulamek * (1.0 - UDZIAL_DZWIEKU),
        Etap::Wypalanie => return ((rozpoznawanie + ulamek * (1.0 - rozpoznawanie)) * 100.0).min(99.9),
    };
    (((fragment + w_fragmencie) / n * rozpoznawanie) * 100.0).min(99.9)
}

/// Pozostały czas z dotychczasowego tempa (`None` na samym początku, gdy szacunek byłby losowy).
pub fn eta(uplynelo_s: f64, procent: f64) -> Option<f64> {
    if !(2.0..100.0).contains(&procent) || uplynelo_s < 3.0 {
        return None;
    }
    Some(uplynelo_s * (100.0 - procent) / procent)
}

/// Szacunek miejsca na film z wypalonymi napisami: tyle co źródło plus połowa (CRF 20 bywa
/// większy od mocno skompresowanego źródła), bez danych: 8 Mb/s.
pub fn szacunek_wypalenia_b(m: &Media) -> Option<u64> {
    if let Some(r) = m.rozmiar_b {
        return Some(r.saturating_add(r / 2));
    }
    m.czas_s.map(|c| (c.max(0.0) * 1_000_000.0) as u64)
}

#[cfg(test)]
mod testy {
    use super::*;
    use crate::sonda::StrumienAudio;

    fn teksty(a: &[OsString]) -> Vec<String> {
        a.iter().map(|x| x.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn fragmenty_dlugich_plikow() {
        assert_eq!(fragmenty(None), vec![Fragment { od_s: 0.0, dl_s: None }]);
        assert_eq!(fragmenty(Some(800.0)).len(), 1, "do 15 min bez dzielenia");
        let f = fragmenty(Some(3.0 * 3600.0 + 5.0));
        assert_eq!(f.len(), 19);
        assert_eq!(f[1], Fragment { od_s: 600.0, dl_s: Some(600.0) });
        assert_eq!(f[18], Fragment { od_s: 10_800.0, dl_s: None });
        assert_eq!(fragmenty(Some(f64::NAN)).len(), 1);
        assert_eq!(najdluzszy_fragment_s(Some(100.0)), Some(100.0));
        assert_eq!(najdluzszy_fragment_s(Some(3000.0)), Some(600.0));
        assert_eq!(najdluzszy_fragment_s(None), None);
    }

    #[test]
    fn audio_16k_mono_z_fragmentem_i_unicode() {
        let we = Path::new("/filmy/zażółć 日本.mp4");
        let a = teksty(&argumenty_audio(we, &Fragment { od_s: 600.0, dl_s: Some(600.0) }, Path::new("a-001.wav")));
        let s = a.join(" ");
        assert!(s.contains("-ss 600.000 -i /filmy/zażółć 日本.mp4 -t 600.000"), "{s}");
        assert!(s.contains("-map 0:a:0 -vn -sn -dn -ac 1 -ar 16000 -c:a pcm_s16le -f wav a-001.wav"));
        assert!(s.starts_with("-hide_banner -nostdin -y -progress pipe:1"));
        let a = teksty(&argumenty_audio(we, &Fragment { od_s: 0.0, dl_s: None }, Path::new("a.wav")));
        assert!(!a.contains(&"-ss".to_string()) && !a.contains(&"-t".to_string()));
    }

    #[test]
    fn whisper_argumenty_i_postep() {
        let a = teksty(&argumenty_whisper(Path::new("m.bin"), Path::new("a.wav"), Path::new("w-000"), "pl", 4));
        assert_eq!(a.join(" "), "-m m.bin -f a.wav -l pl -t 4 -oj -of w-000 -pp");
        assert_eq!(postep_whispera("whisper_print_progress_callback: progress =  45%"), Some(0.45));
        assert_eq!(postep_whispera("progress = 100%"), Some(1.0));
        assert_eq!(postep_whispera("whisper_init_from_file: loading model"), None);
        assert_eq!(postep_whispera("progress = abc%"), None);
        assert_eq!(liczba_watkow(12), 8);
        assert_eq!(liczba_watkow(4), 3);
        assert_eq!(liczba_watkow(1), 1);
        assert_eq!(liczba_watkow(0), 1);
    }

    #[cfg(unix)]
    #[test]
    fn sciezki_ascii_dla_whispera() {
        let cwd = Path::new("/home/łukasz/.cache/tmp/soraflux-1");
        let model = Path::new("/home/łukasz/.local/share/soraflux/modele/ggml-base.bin");
        assert_eq!(
            sciezka_dla_whispera(model, cwd),
            PathBuf::from("../../../.local/share/soraflux/modele/ggml-base.bin")
        );
        let ascii = Path::new("/opt/modele/ggml-base.bin");
        assert_eq!(sciezka_dla_whispera(ascii, cwd), ascii);
        // nie da się uniknąć znaków spoza ASCII: zostaje pełna ścieżka
        let inny = Path::new("/dane/żółw/ggml-base.bin");
        assert_eq!(sciezka_dla_whispera(inny, cwd), inny);
        assert_eq!(sciezka_wzgledna(Path::new("a/b"), cwd), None);
        assert_eq!(sciezka_wzgledna(Path::new("/x/y"), Path::new("/x/y")), Some(PathBuf::new()));
    }

    #[test]
    fn wypalanie_kopiuje_aac_a_reszte_koduje() {
        let mut m =
            Media { audio: Some(StrumienAudio { kodek: "aac".into(), ..Default::default() }), ..Default::default() };
        let s =
            teksty(&argumenty_wypalenia(Path::new("we ł.mov"), &m, "napisy.ass", Path::new("wy.part.mp4"))).join(" ");
        assert!(s.contains("-i we ł.mov -map 0:v:0 -map 0:a:0? -vf ass=napisy.ass -c:v libx264"), "{s}");
        assert!(s.contains("-c:a copy") && s.ends_with("-movflags +faststart wy.part.mp4"));
        m.audio = Some(StrumienAudio { kodek: "pcm_s16le".into(), ..Default::default() });
        let s = teksty(&argumenty_wypalenia(Path::new("a"), &m, "n.ass", Path::new("b"))).join(" ");
        assert!(s.contains("-c:a aac -b:a 192k"));
    }

    #[test]
    fn procent_etapow_rosnie_i_nie_dochodzi_do_100() {
        let mut ostatni = -1.0;
        for (e, f, u) in [
            (Etap::Dzwiek, 0, 0.0),
            (Etap::Dzwiek, 0, 1.0),
            (Etap::Rozpoznawanie, 0, 0.5),
            (Etap::Rozpoznawanie, 0, 1.0),
            (Etap::Dzwiek, 1, 0.5),
            (Etap::Rozpoznawanie, 1, 1.0),
            (Etap::Wypalanie, 1, 0.0),
            (Etap::Wypalanie, 1, 1.0),
        ] {
            let p = procent_calosci(e, f, 2, u, true);
            assert!(p >= ostatni, "{e:?} {f} {u}: {p} < {ostatni}");
            assert!((0.0..100.0).contains(&p));
            ostatni = p;
        }
        assert!((procent_calosci(Etap::Rozpoznawanie, 0, 1, 1.0, false) - 99.9).abs() < 1e-9);
        assert!((procent_calosci(Etap::Rozpoznawanie, 0, 1, 1.0, true) - 70.0).abs() < 1e-9);
        assert_eq!(procent_calosci(Etap::Dzwiek, 5, 0, f64::NAN, false), 0.0);
    }

    #[test]
    fn eta_z_tempa() {
        assert_eq!(eta(10.0, 50.0), Some(10.0));
        assert_eq!(eta(1.0, 50.0), None, "za wcześnie");
        assert_eq!(eta(100.0, 1.0), None);
        assert_eq!(eta(100.0, 100.0), None);
    }

    #[test]
    fn dzwiek_i_szacunek() {
        let mut m = Media::default();
        assert!(!ma_dzwiek(&m));
        m.sciezki_audio.push(StrumienAudio::default());
        assert!(ma_dzwiek(&m));
        m.rozmiar_b = Some(100);
        assert_eq!(szacunek_wypalenia_b(&m), Some(150));
        m.rozmiar_b = None;
        m.czas_s = Some(10.0);
        assert_eq!(szacunek_wypalenia_b(&m), Some(10_000_000));
    }
}
