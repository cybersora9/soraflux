//! Cienka warstwa `#[tauri::command]`: tylko przekazuje do modułów rdzenia.

use crate::blad;
use crate::budowniczy::{self, Podpowiedz};
use crate::kolejka::{InfoZadania, Kolejka, NoweZadanie, RodzajZadania};
use crate::konfig::{self, Konfig};
use crate::narzedzia::zrodla::{self, Pakiet};
use crate::narzedzia::{self, pobieranie, Narzedzie, Pochodzenie, Sciezki};
use crate::sonda::{self, Media};
use crate::ustawienia::{Kontener, Profil};
use crate::{pobieracz, presety};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use tauri::Emitter;
use tauri::State;

pub struct StanApki {
    pub kolejka: Kolejka,
    pub sciezki: Arc<RwLock<Sciezki>>,
    pub konfig: Mutex<Konfig>,
    pub katalog_konfiguracji: PathBuf,
    pub katalogi_narzedzi: Vec<PathBuf>,
    pub enkodery: RwLock<Vec<String>>,
    /// Wynik badania narzędzi (próbne kodowanie sprzętowe trwa): ważny dla danej ścieżki ffmpeg.
    pub pamiec_narzedzi: Mutex<Option<StanNarzedzi>>,
    /// Katalog danych (presety, dziennik).
    pub katalog_danych: PathBuf,
    /// Pliki z linii poleceń przy pierwszym uruchomieniu (menu kontekstowe Eksploratora).
    pub pliki_startowe: Mutex<Vec<PathBuf>>,
}

impl StanApki {
    pub fn sciezki(&self) -> Sciezki {
        self.sciezki.read().unwrap().clone()
    }
    pub fn konfig(&self) -> Konfig {
        self.konfig.lock().unwrap().clone()
    }
}

type Wynik<T> = Result<T, String>;

#[tauri::command]
pub fn wersja_apki() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn wymagane(p: Option<PathBuf>, nazwa: &str) -> Wynik<PathBuf> {
    p.ok_or_else(|| blad::kod("brak_narzedzia", &[("nazwa", &nazwa)]))
}

#[tauri::command]
pub async fn sonda(stan: State<'_, StanApki>, sciezka: PathBuf) -> Wynik<Media> {
    let ffprobe = wymagane(stan.sciezki().ffprobe, "ffprobe")?;
    sonda::sonduj(&ffprobe, &sciezka).await
}

#[derive(Serialize)]
pub struct PodgladPlanu {
    pub przebiegi: Vec<Vec<String>>,
    pub podpowiedzi: Vec<Podpowiedz>,
    pub blad: Option<budowniczy::BladProfilu>,
}

/// Ścieżka wyniku w podglądzie komendy: ten sam folder co przy dodaniu zadania
/// (`katalog` z konfigu, `None` = obok źródła). Usterka 2 z testów 07.10.
pub fn wyjscie_podgladu(wejscie: &Path, katalog: Option<&Path>, profil: &Profil) -> PathBuf {
    let katalog = katalog.map(normalizuj).or_else(|| wejscie.parent().map(Path::to_path_buf)).unwrap_or_default();
    crate::kolejka::cel_bez_kolizji(&katalog, wejscie, profil.kontener.rozszerzenie())
}

/// Jednolity separator systemu (usterka 3: `C:/Users/…/test\plik.mp4` z folderu z okna
/// dialogowego i nazwy doklejonej przez Windows). Na Windows `components()` czyta oba
/// separatory i składa ścieżkę z `\`; na Unix to bez zmian.
pub fn normalizuj(p: &Path) -> PathBuf {
    p.components().collect()
}

/// Podgląd komendy ffmpeg i podpowiedzi dla bieżących ustawień (bez uruchamiania).
#[tauri::command]
pub fn plan_komendy(stan: State<'_, StanApki>, wejscie: PathBuf, media: Media, profil: Profil) -> PodgladPlanu {
    let katalog = stan.konfig().katalog_wyjscia;
    plan_komendy_z(&wejscie, katalog.as_deref(), &media, &profil)
}

pub fn plan_komendy_z(wejscie: &Path, katalog: Option<&Path>, media: &Media, profil: &Profil) -> PodgladPlanu {
    let wyjscie = wyjscie_podgladu(wejscie, katalog, profil);
    match budowniczy::plan(media, profil, wejscie, &wyjscie) {
        Ok(p) => PodgladPlanu { przebiegi: p.jako_tekst(), podpowiedzi: p.podpowiedzi, blad: None },
        Err(e) => PodgladPlanu { przebiegi: vec![], podpowiedzi: vec![], blad: Some(e) },
    }
}

#[tauri::command]
pub fn dodaj_zadania(stan: State<'_, StanApki>, zadania: Vec<NoweZadanie>) -> Vec<u64> {
    let k = stan.konfig();
    zadania
        .into_iter()
        .map(|mut z| {
            if z.katalog.is_none() {
                z.katalog = match z.rodzaj {
                    RodzajZadania::Konwersja { .. } => k.katalog_wyjscia.clone(),
                    RodzajZadania::Pobranie { .. } => k.katalog_pobierania.clone(),
                };
            }
            z.katalog = z.katalog.as_deref().map(normalizuj);
            if let RodzajZadania::Konwersja { wejscie, .. } = &mut z.rodzaj {
                *wejscie = normalizuj(wejscie);
            }
            stan.kolejka.dodaj(z)
        })
        .collect()
}

/// Pliki przekazane przy starcie (zwracane raz).
#[tauri::command]
pub fn pliki_startowe(stan: State<'_, StanApki>) -> Vec<PathBuf> {
    std::mem::take(&mut *stan.pliki_startowe.lock().unwrap())
}

#[tauri::command]
pub fn lista_zadan(stan: State<'_, StanApki>) -> Vec<InfoZadania> {
    stan.kolejka.lista()
}

#[tauri::command]
pub fn anuluj_zadanie(stan: State<'_, StanApki>, id: u64) {
    stan.kolejka.anuluj(id)
}

#[tauri::command]
pub fn wyczysc_zakonczone(stan: State<'_, StanApki>) {
    stan.kolejka.wyczysc_zakonczone()
}

pub const ROZSZERZENIA_MEDIOW: &[&str] = &[
    "mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts", "mts", "3gp", "ogv", "gif",
    "mp3", "m4a", "aac", "opus", "ogg", "oga", "flac", "wav", "wma", "aiff", "aif", "amr", "ac3", "mka", "png", "jpg",
    "jpeg", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic", "jxl",
];

/// Plik z folderu: ścieżka + podkatalog względem upuszczonego folderu (do zachowania struktury).
#[derive(Serialize, Debug, PartialEq)]
pub struct PlikZFolderu {
    pub sciezka: PathBuf,
    /// `None` = plik upuszczony bezpośrednio; `Some("")` = w korzeniu folderu; `Some("a/b")` = podfolder.
    pub podkatalog: Option<PathBuf>,
}

/// Rozwija upuszczone pliki i foldery. `rozszerzenia` (małe litery, bez kropki) zawęża
/// pliki z folderów; puste = wszystkie media.
pub fn rozwin_z_folderami(sciezki: &[PathBuf], rozszerzenia: &[String]) -> Vec<PlikZFolderu> {
    let mut wynik = Vec::new();
    for p in sciezki {
        if p.is_dir() {
            let mut pliki = Vec::new();
            zbierz(p, &mut pliki, 8);
            for f in pliki {
                let ext = f.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
                if !rozszerzenia.is_empty() && !rozszerzenia.iter().any(|r| r.trim_start_matches('.') == ext) {
                    continue;
                }
                let podkatalog = f.parent().and_then(|r| r.strip_prefix(p).ok()).map(Path::to_path_buf);
                wynik.push(PlikZFolderu { sciezka: f, podkatalog });
            }
        } else {
            let mut pliki = Vec::new();
            zbierz(p, &mut pliki, 0);
            wynik.extend(pliki.into_iter().map(|sciezka| PlikZFolderu { sciezka, podkatalog: None }));
        }
    }
    wynik
}

#[tauri::command]
pub fn rozwin_foldery(sciezki: Vec<PathBuf>, rozszerzenia: Vec<String>) -> Vec<PlikZFolderu> {
    rozwin_z_folderami(&sciezki, &rozszerzenia)
}

fn zbierz(p: &Path, wynik: &mut Vec<PathBuf>, glebokosc: u8) {
    if p.is_dir() {
        if glebokosc == 0 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(p) else { return };
        let mut wpisy: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        wpisy.sort();
        for w in wpisy {
            zbierz(&w, wynik, glebokosc - 1);
        }
    } else if p
        .extension()
        .map(|e| ROZSZERZENIA_MEDIOW.contains(&e.to_string_lossy().to_ascii_lowercase().as_str()))
        .unwrap_or(false)
    {
        wynik.push(p.to_path_buf());
    }
}

/// Upuszczone pliki i foldery → lista plików mediów (foldery rekurencyjnie, do 8 poziomów).
#[tauri::command]
pub fn rozwin_sciezki(sciezki: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut wynik = Vec::new();
    for p in sciezki {
        zbierz(&p, &mut wynik, 8);
    }
    wynik
}

// ---------- podgląd (punkt 4.1) ----------

#[derive(Serialize)]
pub struct PodgladKlatki {
    /// data:image/jpeg;base64,… (CSP pozwala na data: w img)
    pub przed: String,
    pub po: String,
    pub czas_s: Option<f64>,
}

fn data_url(mime: &str, plik: &Path) -> Wynik<String> {
    use base64::Engine;
    let b = std::fs::read(plik).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
}

fn katalog_podgladu() -> Wynik<PathBuf> {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let k = std::env::temp_dir().join(format!("soraconverter-podglad-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&k).map_err(|e| e.to_string())?;
    Ok(k)
}

async fn uruchom_ffmpeg_proste(ffmpeg: &Path, args: &[std::ffi::OsString]) -> Wynik<()> {
    let w = crate::procesy::komenda(ffmpeg)
        .args(args)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| blad::kod("uruchomienie", &[("program", &"ffmpeg"), ("blad", &e)]))?;
    if w.status.success() {
        Ok(())
    } else {
        let e = String::from_utf8_lossy(&w.stderr);
        Err(e.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n"))
    }
}

fn kontekst(stan: &StanApki) -> budowniczy::Kontekst {
    let zscale =
        stan.pamiec_narzedzi.lock().unwrap().as_ref().map(|s| s.filtry.iter().any(|f| f == "zscale")).unwrap_or(true);
    budowniczy::Kontekst { zscale, katalog_tmp: None }
}

/// Jedna klatka przed i po (ten sam łańcuch filtrów co konwersja) z wybranego momentu.
pub async fn podglad_klatki_z(
    ffmpeg: &Path,
    wejscie: &Path,
    media: &Media,
    profil: &Profil,
    czas_s: Option<f64>,
    kt: &budowniczy::Kontekst,
) -> Wynik<PodgladKlatki> {
    let lancuch = budowniczy::lancuch_podgladu(media, profil, kt).map_err(|e| e.to_string())?;
    let czas = if media.obraz { None } else { czas_s.or(media.czas_s.map(|c| c / 3.0)) };
    let k = katalog_podgladu()?;
    let (przed, po) = (k.join("przed.jpg"), k.join("po.jpg"));
    let wynik = async {
        uruchom_ffmpeg_proste(ffmpeg, &budowniczy::argumenty_klatki(wejscie, czas, None, &przed)).await?;
        uruchom_ffmpeg_proste(ffmpeg, &budowniczy::argumenty_klatki(wejscie, czas, lancuch.as_deref(), &po)).await?;
        Ok(PodgladKlatki { przed: data_url("image/jpeg", &przed)?, po: data_url("image/jpeg", &po)?, czas_s: czas })
    }
    .await;
    let _ = std::fs::remove_dir_all(&k);
    wynik
}

#[tauri::command]
pub async fn podglad_klatki(
    stan: State<'_, StanApki>,
    wejscie: PathBuf,
    media: Media,
    profil: Profil,
    czas_s: Option<f64>,
) -> Wynik<PodgladKlatki> {
    let ffmpeg = wymagane(stan.sciezki().ffmpeg, "ffmpeg")?;
    podglad_klatki_z(&ffmpeg, &wejscie, &media, &profil, czas_s, &kontekst(&stan)).await
}

/// Długość próbki do szacunku animacji.
pub const PROBKA_S: f64 = 2.0;

/// Szacunek rozmiaru GIF/animowanego WebP z próbki: koduje ~2 s ze środka (tym samym łańcuchem co
/// prawdziwa konwersja) i przelicza na całą długość. Stała z `szacunek::szacuj` myliła się ×2,6 na obrazie
/// z ruchem w całym kadrze (test na żywo 1.2.1, 08.10: „≈ 1,7 MB”, wynik 4,38 MB). `None` = nie dotyczy.
pub async fn szacuj_z_probki_z(
    ffmpeg: &Path,
    wejscie: &Path,
    media: &Media,
    profil: &Profil,
    kt: &budowniczy::Kontekst,
) -> Wynik<Option<u64>> {
    let animacja = profil.gif.is_some() && matches!(profil.kontener, Kontener::Gif | Kontener::Webp) && !media.obraz;
    let Some(czas) = media.czas_wyniku(profil.ciecie.as_ref(), profil.predkosc).filter(|_| animacja) else {
        return Ok(None);
    };
    if (profil.predkosc - 1.0).abs() > f32::EPSILON || czas <= PROBKA_S * 1.5 {
        return Ok(None); // krótki klip: pełna konwersja trwa tyle co próbka, zostaje szacunek ze stałej
    }
    let od = profil.ciecie.as_ref().map(|c| c.od).unwrap_or(0.0) + (czas - PROBKA_S) / 2.0;
    let mut p = profil.clone();
    p.ciecie = Some(crate::ustawienia::Ciecie { od, koniec: Some(od + PROBKA_S) });
    let k = katalog_podgladu()?;
    let plik = k.join(format!("probka.{}", profil.kontener.rozszerzenie()));
    let wynik = async {
        let kt = budowniczy::Kontekst { katalog_tmp: Some(k.clone()), ..kt.clone() };
        let plan = budowniczy::plan_z(media, &p, wejscie, &plik, &kt).map_err(|e| e.to_string())?;
        for przebieg in &plan.przebiegi {
            uruchom_ffmpeg_proste(ffmpeg, przebieg).await?;
        }
        let bajty = std::fs::metadata(&plik).map_err(|e| e.to_string())?.len() as f64;
        Ok(Some((bajty * czas / PROBKA_S) as u64))
    }
    .await;
    let _ = std::fs::remove_dir_all(&k);
    wynik
}

#[tauri::command]
pub async fn szacuj_z_probki(
    stan: State<'_, StanApki>,
    wejscie: PathBuf,
    media: Media,
    profil: Profil,
) -> Wynik<Option<u64>> {
    let ffmpeg = wymagane(stan.sciezki().ffmpeg, "ffmpeg")?;
    szacuj_z_probki_z(&ffmpeg, &wejscie, &media, &profil, &kontekst(&stan)).await
}

/// 5 s dźwięku z dokładnie tymi ustawieniami audio (np. AAC 8 kb/s) jako data URL.
pub async fn odsluch_z(
    ffmpeg: &Path,
    wejscie: &Path,
    media: &Media,
    profil: &Profil,
    od_s: f64,
    kt: &budowniczy::Kontekst,
) -> Wynik<String> {
    let kodek = profil.audio.as_ref().map(|a| a.kodek).ok_or_else(|| blad::kod("profil_bez_dzwieku", &[]))?;
    let kontener = budowniczy::kontener_odsluchu(kodek);
    let k = katalog_podgladu()?;
    let plik = k.join(format!("odsluch.{}", kontener.rozszerzenie()));
    let wynik = async {
        let plan = budowniczy::plan_odsluchu(media, profil, wejscie, &plik, od_s, kt).map_err(|e| e.to_string())?;
        for p in &plan.przebiegi {
            uruchom_ffmpeg_proste(ffmpeg, p).await?;
        }
        let mime = match kontener {
            Kontener::Mp3 => "audio/mpeg",
            Kontener::Opus | Kontener::Ogg => "audio/ogg",
            Kontener::Flac => "audio/flac",
            Kontener::Wav => "audio/wav",
            _ => "audio/mp4",
        };
        data_url(mime, &plik)
    }
    .await;
    let _ = std::fs::remove_dir_all(&k);
    wynik
}

#[tauri::command]
pub async fn odsluch(
    stan: State<'_, StanApki>,
    wejscie: PathBuf,
    media: Media,
    profil: Profil,
    od_s: f64,
) -> Wynik<String> {
    let ffmpeg = wymagane(stan.sciezki().ffmpeg, "ffmpeg")?;
    odsluch_z(&ffmpeg, &wejscie, &media, &profil, od_s, &kontekst(&stan)).await
}

// ---------- konfig ----------

#[tauri::command]
pub fn konfig_wczytaj(stan: State<'_, StanApki>) -> Konfig {
    stan.konfig()
}

pub fn opcje_kolejki(k: &Konfig) -> crate::kolejka::Opcje {
    crate::kolejka::Opcje { limit: k.rownolegle, limit_wideo: k.rownolegle_wideo, niski_priorytet: k.niski_priorytet }
}

#[tauri::command]
pub fn konfig_zapisz(stan: State<'_, StanApki>, konfig: Konfig) -> Wynik<()> {
    konfig::zapisz(&stan.katalog_konfiguracji, &konfig)?;
    stan.kolejka.ustaw_opcje(opcje_kolejki(&konfig));
    let reczne_zmienione = stan.konfig.lock().unwrap().sciezki != konfig.sciezki;
    *stan.konfig.lock().unwrap() = konfig.clone();
    if reczne_zmienione {
        *stan.sciezki.write().unwrap() = narzedzia::wykryj(&konfig.sciezki, &stan.katalogi_narzedzi);
    }
    Ok(())
}

// ---------- szacunek i presety ----------

#[tauri::command]
pub fn szacuj(media: Media, profil: Profil) -> crate::szacunek::Szacunek {
    crate::szacunek::szacuj(&media, &profil)
}

#[tauri::command]
pub fn presety_lista(stan: State<'_, StanApki>) -> Vec<presety::Preset> {
    let mut l = presety::wbudowane();
    l.extend(presety::wczytaj_uzytkownika(&stan.katalog_danych));
    l
}

#[tauri::command]
pub fn preset_zapisz(stan: State<'_, StanApki>, preset: presety::Preset) -> Wynik<presety::Preset> {
    presety::zapisz(&stan.katalog_danych, preset)
}

#[tauri::command]
pub fn preset_usun(stan: State<'_, StanApki>, id: String) -> Wynik<()> {
    presety::usun(&stan.katalog_danych, &id)
}

/// Raport do schowka (Ustawienia → „Kopiuj raport”): bez ścieżek prywatnych folderów.
#[tauri::command]
pub fn raport(stan: State<'_, StanApki>) -> String {
    let wersje: Vec<(String, String)> = stan
        .pamiec_narzedzi
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.wersje.iter().map(|(n, w)| (format!("{n:?}").to_lowercase(), w.clone())).collect())
        .unwrap_or_default();
    let wpisy = crate::dziennik::ogon(&stan.katalog_danych, 40);
    crate::dziennik::raport(env!("CARGO_PKG_VERSION"), &wersje, &wpisy)
}

// ---------- narzędzia ----------

#[derive(Serialize, Clone)]
pub struct StanNarzedzi {
    pub sciezki: Sciezki,
    pub wersje: HashMap<Narzedzie, String>,
    /// Wszystkie enkodery z `ffmpeg -encoders`.
    pub enkodery: Vec<String>,
    /// Enkodery sprzętowe, które naprawdę działają na tym komputerze.
    pub sprzet: Vec<String>,
    /// Filtry z `ffmpeg -filters` (np. `zscale` do HDR).
    pub filtry: Vec<String>,
    /// Pakiety, które umiemy pobrać na tym systemie.
    pub do_pobrania: Vec<Pakiet>,
    pub katalog: PathBuf,
    /// Tryb przenośny (folder `portable` obok programu).
    pub przenosny: bool,
    /// Stan yt-dlp (wiek, skąd jest); `None` = brak yt-dlp.
    pub ytdlp: Option<InfoYtdlp>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct InfoYtdlp {
    pub wersja: Option<String>,
    /// Dni od wydania (wersja to data RRRR.MM.DD).
    pub wiek_dni: Option<i64>,
    pub pochodzenie: Pochodzenie,
    /// Starszy niż [`narzedzia::MAKS_WIEK_YTDLP`] dni: YouTube może odmawiać.
    pub stary: bool,
}

pub fn info_ytdlp(
    sciezki: &Sciezki,
    wersja: Option<&String>,
    reczne: &Sciezki,
    katalogi: &[PathBuf],
    dzis: i64,
) -> Option<InfoYtdlp> {
    let p = sciezki.ytdlp.as_ref()?;
    let wiek_dni = wersja.and_then(|w| narzedzia::wiek_ytdlp(w, dzis));
    Some(InfoYtdlp {
        wersja: wersja.cloned(),
        wiek_dni,
        pochodzenie: narzedzia::pochodzenie(p, reczne, katalogi),
        stary: wiek_dni.is_some_and(|w| w > narzedzia::MAKS_WIEK_YTDLP),
    })
}

const KANDYDACI_SPRZETU: &[&str] =
    &["h264_nvenc", "hevc_nvenc", "av1_nvenc", "h264_qsv", "hevc_qsv", "av1_qsv", "h264_amf", "hevc_amf", "av1_amf"];

fn zbadaj(sciezki: Sciezki, reczne: Sciezki, katalogi: Vec<PathBuf>) -> StanNarzedzi {
    let katalog = katalogi[0].clone();
    let mut wersje = HashMap::new();
    for n in Narzedzie::WSZYSTKIE {
        if let Some(v) = sciezki.get(n).and_then(|p| narzedzia::wersja(n, p)) {
            wersje.insert(n, v);
        }
    }
    let enkodery = sciezki.ffmpeg.as_deref().map(narzedzia::enkodery).unwrap_or_default();
    let sprzet = match &sciezki.ffmpeg {
        Some(f) => KANDYDACI_SPRZETU
            .iter()
            .filter(|e| enkodery.iter().any(|x| x == *e))
            .filter(|e| narzedzia::sprzet_dziala(f, e))
            .map(|e| e.to_string())
            .collect(),
        None => vec![],
    };
    let filtry = sciezki.ffmpeg.as_deref().map(narzedzia::filtry).unwrap_or_default();
    let do_pobrania = [Pakiet::Ffmpeg, Pakiet::FfmpegFull, Pakiet::Ytdlp, Pakiet::Deno]
        .into_iter()
        .filter(|p| zrodla::zrodlo(*p).is_some())
        .collect();
    let ytdlp = info_ytdlp(&sciezki, wersje.get(&Narzedzie::Ytdlp), &reczne, &katalogi, narzedzia::dzis());
    StanNarzedzi {
        sciezki,
        wersje,
        enkodery,
        sprzet,
        filtry,
        do_pobrania,
        katalog,
        przenosny: konfig::przenosny(),
        ytdlp,
    }
}

/// Stan narzędzi; próbne kodowanie sprzętowe tylko raz na ścieżki ffmpeg (pamięć podręczna).
#[tauri::command]
pub async fn narzedzia_stan(stan: State<'_, StanApki>) -> Wynik<StanNarzedzi> {
    let (s, k, r) = (stan.sciezki(), stan.katalogi_narzedzi.clone(), stan.konfig().sciezki);
    if let Some(z) = stan.pamiec_narzedzi.lock().unwrap().as_ref().filter(|z| z.sciezki == s) {
        return Ok(z.clone());
    }
    let wynik = tauri::async_runtime::spawn_blocking(move || zbadaj(s, r, k)).await.map_err(|e| e.to_string())?;
    *stan.enkodery.write().unwrap() = wynik.enkodery.clone();
    stan.kolejka.ustaw_zscale(wynik.filtry.iter().any(|f| f == "zscale"));
    *stan.pamiec_narzedzi.lock().unwrap() = Some(wynik.clone());
    Ok(wynik)
}

#[tauri::command]
pub fn narzedzia_wykryj(stan: State<'_, StanApki>) -> Sciezki {
    let nowe = narzedzia::wykryj(&stan.konfig().sciezki, &stan.katalogi_narzedzi);
    *stan.sciezki.write().unwrap() = nowe.clone();
    nowe
}

#[derive(Serialize, Clone)]
pub struct PostepNarzedzia {
    pub pakiet: Pakiet,
    pub pobrane: u64,
    pub calosc: Option<u64>,
}

#[tauri::command]
pub async fn narzedzia_pobierz<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    stan: State<'_, StanApki>,
    pakiet: Pakiet,
) -> Wynik<Sciezki> {
    zainstaluj_pakiet(&app, &stan, pakiet).await?;
    Ok(narzedzia_wykryj(stan))
}

/// Pobiera pakiet do katalogu narzędzi apki (z SHA256) i unieważnia pamięć badania narzędzi.
async fn zainstaluj_pakiet<R: tauri::Runtime>(app: &tauri::AppHandle<R>, stan: &StanApki, pakiet: Pakiet) -> Wynik<()> {
    let app = app.clone();
    let z = zrodla::zrodlo(pakiet).ok_or_else(|| blad::kod("menedzer_pakietow", &[]))?;
    let katalog = stan.katalogi_narzedzi[0].clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut ostatni = 0u64;
        pobieranie::zainstaluj(&z, &katalog, |pobrane, calosc| {
            // co ~256 KB, żeby nie zalać okna zdarzeniami
            if pobrane - ostatni > 256 * 1024 || Some(pobrane) == calosc {
                ostatni = pobrane;
                let _ = app.emit("narzedzia://postep", PostepNarzedzia { pakiet, pobrane, calosc });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    *stan.pamiec_narzedzi.lock().unwrap() = None;
    Ok(())
}

// ---------- pobieracz (yt-dlp) ----------

#[tauri::command]
pub async fn ytdlp_info(stan: State<'_, StanApki>, url: String, playlista: bool) -> Wynik<pobieracz::Info> {
    let s = stan.sciezki();
    let ytdlp = wymagane(s.ytdlp.clone(), "yt-dlp")?;
    pobieracz::info(&ytdlp, &url, playlista, &s).await
}

/// „Aktualizuj yt-dlp”: zawsze pobiera świeżą WŁASNĄ kopię (oficjalne wydanie + SHA256) do
/// katalogu narzędzi apki. yt-dlp z pipa/PATH użytkownika nigdy nie jest ruszany; ręczna
/// ścieżka do yt-dlp spoza apki jest czyszczona, żeby nowa kopia faktycznie była używana.
#[tauri::command]
pub async fn ytdlp_aktualizuj<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    stan: State<'_, StanApki>,
) -> Wynik<StanNarzedzi> {
    zainstaluj_pakiet(&app, &stan, Pakiet::Ytdlp).await?;
    let mut k = stan.konfig();
    if k.sciezki.ytdlp.as_ref().is_some_and(|p| !stan.katalogi_narzedzi.iter().any(|kat| p.starts_with(kat))) {
        k.sciezki.ytdlp = None;
        konfig::zapisz(&stan.katalog_konfiguracji, &k)?;
        *stan.konfig.lock().unwrap() = k;
    }
    narzedzia_wykryj(stan.clone());
    narzedzia_stan(stan).await
}

/// Przy wejściu na Pobierz: brak yt-dlp albo stary z PATH (> 30 dni) i brak własnej kopii
/// → pobiera własną. Zwraca `true`, gdy coś pobrano.
#[tauri::command]
pub async fn ytdlp_zapewnij<R: tauri::Runtime>(app: tauri::AppHandle<R>, stan: State<'_, StanApki>) -> Wynik<bool> {
    let st = narzedzia_stan(stan.clone()).await?;
    let jest = st.ytdlp.as_ref().map(|y| y.pochodzenie);
    if !narzedzia::ytdlp_decyzja(jest, st.ytdlp.as_ref().and_then(|y| y.wiek_dni)) {
        return Ok(false);
    }
    zainstaluj_pakiet(&app, &stan, Pakiet::Ytdlp).await?;
    narzedzia_wykryj(stan);
    Ok(true)
}
