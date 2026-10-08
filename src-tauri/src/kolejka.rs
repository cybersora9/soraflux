//! Kolejka zadań: N równoległych (osobny limit dla wideo, ustawialne w locie), stany,
//! anulowanie (zabicie drzewa procesów + usunięcie niepełnego pliku). Wynik powstaje
//! jako `nazwa.part.ext`, rename dopiero po sukcesie. Niepełne pliki zapisujemy w
//! dzienniku, żeby po awarii apki sprzątnąć je przy następnym starcie.

use crate::blad;
use crate::budowniczy::{self, Kontekst};
use crate::narzedzia::Sciezki;
use crate::pobieracz::{self, OpcjePobrania};
use crate::postep::{self, LiniaYtdlp, ParserFfmpeg, Postep};
use crate::procesy::{self, Drzewo};
use crate::sonda::{self, Media};
use crate::szacunek;
use crate::ustawienia::{JakoscWideo, Profil};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::Notify;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum Stan {
    Oczekuje,
    Trwa,
    Gotowe {
        wyjscie: PathBuf,
    },
    Blad {
        komunikat: String,
    },
    Anulowane,
    /// „Pomiń już przekonwertowane”: wynik już istnieje.
    Pominiete {
        wyjscie: PathBuf,
    },
}

impl Stan {
    pub fn zakonczony(&self) -> bool {
        matches!(self, Stan::Gotowe { .. } | Stan::Blad { .. } | Stan::Anulowane | Stan::Pominiete { .. })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum RodzajZadania {
    Konwersja {
        wejscie: PathBuf,
        profil: Profil,
    },
    /// yt-dlp; `potem` = po pobraniu przekonwertuj tym profilem (nowe zadanie w kolejce).
    Pobranie {
        url: String,
        opcje: OpcjePobrania,
        #[serde(default)]
        potem: Option<Profil>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NoweZadanie {
    pub rodzaj: RodzajZadania,
    /// `None` = obok pliku źródłowego (dla pobrań: katalog Pobrane).
    #[serde(default)]
    pub katalog: Option<PathBuf>,
    /// Foldery wsadowo: nie konwertuj, jeśli `nazwa.ext` już jest w katalogu wyniku.
    #[serde(default)]
    pub pomin_istniejace: bool,
}

/// To, co front widzi na liście.
#[derive(Serialize, Clone, Debug)]
pub struct InfoZadania {
    pub id: u64,
    pub nazwa: String,
    pub rodzaj: &'static str,
    pub stan: Stan,
    pub procent: f64,
    pub wyjscie: Option<PathBuf>,
    /// Rozmiar źródła i wyniku (porównanie „−82%” po zakończeniu).
    pub rozmiar_wejscia: Option<u64>,
    pub rozmiar_wyniku: Option<u64>,
    /// Enkoder sprzętowy padł w trakcie, zadanie dokończone programowo.
    pub awaria_sprzetu: bool,
    /// Gotowe, ale z ostrzeżeniem (np. źródło urywa się wcześniej, niż mówi nagłówek).
    pub ostrzezenie: Option<OstrzezenieWyniku>,
}

/// „Gotowe z ostrzeżeniem”.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "typ", rename_all = "snake_case")]
pub enum OstrzezenieWyniku {
    /// Usterka 1 z testów 07.10: nagłówek mówi 2:59, dane kończą się w 0:32, wynik ma 32 s.
    Uciete {
        /// Moment w źródle, w którym urywają się dane.
        zrodlo_konczy_s: f64,
        wynik_s: f64,
        oczekiwane_s: f64,
    },
}

/// Próg „wynik krótszy niż oczekiwany”: poniżej 97% czasu z nagłówka.
pub const PROG_UCIECIA: f64 = 0.97;

/// Czy wynik jest podejrzanie krótki (ucięte źródło). Pomija bardzo krótkie materiały
/// (< 2 s), gdzie zaokrąglenia kontenera dają kilka procent różnicy.
pub fn sprawdz_uciecie(
    oczekiwane_s: Option<f64>,
    wynik_s: Option<f64>,
    od_s: f64,
    predkosc: f32,
) -> Option<OstrzezenieWyniku> {
    let (o, w) = (oczekiwane_s?, wynik_s?);
    if o < 2.0 || w >= o * PROG_UCIECIA {
        return None;
    }
    let p = if predkosc > 0.0 { predkosc as f64 } else { 1.0 };
    Some(OstrzezenieWyniku::Uciete { zrodlo_konczy_s: od_s + w * p, wynik_s: w, oczekiwane_s: o })
}

/// Odbiorca zdarzeń (w apce: emit do okna; w testach: wektor).
pub trait Nadajnik: Send + Sync {
    fn postep(&self, p: &Postep);
    fn stan(&self, z: &InfoZadania);
}

/// Ustawienia kolejki zmieniane w locie (Ustawienia → Praca).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Opcje {
    /// Wszystkich zadań naraz.
    pub limit: usize,
    /// Zadań wideo naraz (obrazy się nie liczą). Słaby procesor: 1.
    pub limit_wideo: usize,
    /// „Nie zamulaj komputera”: ffmpeg z priorytetem poniżej normalnego.
    pub niski_priorytet: bool,
}

struct Wpis {
    info: InfoZadania,
    nowe: NoweZadanie,
    anuluj: Arc<Notify>,
    wideo: bool,
}

struct Wewn {
    nastepne_id: u64,
    opcje: Opcje,
    trwajace: usize,
    trwajace_wideo: usize,
    oczekujace: VecDeque<u64>,
    zadania: BTreeMap<u64, Wpis>,
    zarezerwowane: HashSet<PathBuf>,
    /// Niepełne pliki w toku (dziennik na wypadek awarii).
    w_toku: BTreeSet<PathBuf>,
}

#[derive(Clone)]
pub struct Kolejka {
    wewn: Arc<Mutex<Wewn>>,
    nadajnik: Arc<dyn Nadajnik>,
    sciezki: Arc<RwLock<Sciezki>>,
    /// Build ffmpeg ma `zscale` (tonemapping HDR). Ustawiane po wykryciu filtrów.
    zscale: Arc<AtomicBool>,
    dziennik: Option<PathBuf>,
}

fn nazwa_zadania(r: &RodzajZadania) -> String {
    match r {
        RodzajZadania::Konwersja { wejscie, .. } => {
            wejscie.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
        }
        RodzajZadania::Pobranie { url, opcje, .. } => opcje.tytul.clone().unwrap_or_else(|| url.clone()),
    }
}

/// Zadanie „wideo” (ciężkie): wszystko poza obrazami.
fn zadanie_wideo(r: &RodzajZadania) -> bool {
    match r {
        RodzajZadania::Konwersja { profil, .. } => !profil.kontener.obraz() || profil.gif.is_some(),
        // Pobieranie czeka głównie na sieć: nie zajmuje limitu wideo (D27).
        RodzajZadania::Pobranie { .. } => false,
    }
}

impl Kolejka {
    pub fn nowa(limit: usize, nadajnik: Arc<dyn Nadajnik>, sciezki: Arc<RwLock<Sciezki>>) -> Kolejka {
        let opcje = Opcje { limit: limit.max(1), limit_wideo: limit.max(1), niski_priorytet: false };
        Kolejka::z_opcjami(opcje, nadajnik, sciezki, None)
    }

    /// `dziennik`: plik z listą niepełnych wyników (sprzątanie po awarii).
    pub fn z_opcjami(
        opcje: Opcje,
        nadajnik: Arc<dyn Nadajnik>,
        sciezki: Arc<RwLock<Sciezki>>,
        dziennik: Option<PathBuf>,
    ) -> Kolejka {
        Kolejka {
            wewn: Arc::new(Mutex::new(Wewn {
                nastepne_id: 1,
                opcje: popraw(opcje),
                trwajace: 0,
                trwajace_wideo: 0,
                oczekujace: VecDeque::new(),
                zadania: BTreeMap::new(),
                zarezerwowane: HashSet::new(),
                w_toku: BTreeSet::new(),
            })),
            nadajnik,
            sciezki,
            zscale: Arc::new(AtomicBool::new(true)),
            dziennik,
        }
    }

    pub fn ustaw_zscale(&self, jest: bool) {
        self.zscale.store(jest, Ordering::Relaxed);
    }

    pub fn dodaj(&self, nowe: NoweZadanie) -> u64 {
        let info = {
            let mut w = self.wewn.lock().unwrap();
            let id = w.nastepne_id;
            w.nastepne_id += 1;
            let info = InfoZadania {
                id,
                nazwa: nazwa_zadania(&nowe.rodzaj),
                rodzaj: match nowe.rodzaj {
                    RodzajZadania::Konwersja { .. } => "konwersja",
                    RodzajZadania::Pobranie { .. } => "pobranie",
                },
                stan: Stan::Oczekuje,
                procent: 0.0,
                wyjscie: None,
                rozmiar_wejscia: None,
                rozmiar_wyniku: None,
                awaria_sprzetu: false,
                ostrzezenie: None,
            };
            let wideo = zadanie_wideo(&nowe.rodzaj);
            w.zadania.insert(id, Wpis { info: info.clone(), nowe, anuluj: Arc::new(Notify::new()), wideo });
            w.oczekujace.push_back(id);
            info
        };
        self.nadajnik.stan(&info);
        self.pompuj();
        info.id
    }

    pub fn lista(&self) -> Vec<InfoZadania> {
        self.wewn.lock().unwrap().zadania.values().map(|w| w.info.clone()).collect()
    }

    pub fn ustaw_limit(&self, n: usize) {
        let mut o = self.opcje();
        o.limit = n;
        self.ustaw_opcje(o);
    }

    pub fn opcje(&self) -> Opcje {
        self.wewn.lock().unwrap().opcje
    }

    pub fn ustaw_opcje(&self, o: Opcje) {
        self.wewn.lock().unwrap().opcje = popraw(o);
        self.pompuj();
    }

    pub fn anuluj(&self, id: u64) {
        let info = {
            let mut w = self.wewn.lock().unwrap();
            let Some(wpis) = w.zadania.get_mut(&id) else {
                return;
            };
            match wpis.info.stan {
                Stan::Oczekuje => {
                    wpis.info.stan = Stan::Anulowane;
                    let info = wpis.info.clone();
                    w.oczekujace.retain(|x| *x != id);
                    Some(info)
                }
                Stan::Trwa => {
                    // notify_one zostawia pozwolenie, nawet gdy proces jeszcze nie czeka.
                    wpis.anuluj.notify_one();
                    None
                }
                _ => None,
            }
        };
        if let Some(i) = info {
            self.nadajnik.stan(&i);
        }
    }

    /// Anuluje wszystko (zamknięcie apki): trwające procesy giną razem z drzewem.
    pub fn anuluj_wszystko(&self) {
        let ids: Vec<u64> = self.wewn.lock().unwrap().zadania.keys().copied().collect();
        for id in ids {
            self.anuluj(id);
        }
    }

    pub fn wyczysc_zakonczone(&self) {
        self.wewn.lock().unwrap().zadania.retain(|_, w| !w.info.stan.zakonczony());
    }

    fn ustaw(&self, id: u64, f: impl FnOnce(&mut InfoZadania)) {
        let info = {
            let mut w = self.wewn.lock().unwrap();
            let Some(wpis) = w.zadania.get_mut(&id) else {
                return;
            };
            f(&mut wpis.info);
            wpis.info.clone()
        };
        self.nadajnik.stan(&info);
    }

    fn pompuj(&self) {
        loop {
            let start = {
                let mut w = self.wewn.lock().unwrap();
                if w.trwajace >= w.opcje.limit {
                    return;
                }
                // Pierwsze oczekujące, które mieści się w limitach (obraz może wyprzedzić wideo).
                let wideo_pelne = w.trwajace_wideo >= w.opcje.limit_wideo;
                let Some(poz) = w.oczekujace.iter().position(|id| !(wideo_pelne && w.zadania[id].wideo)) else {
                    return;
                };
                let id = w.oczekujace.remove(poz).unwrap();
                w.trwajace += 1;
                let wpis = w.zadania.get_mut(&id).unwrap();
                wpis.info.stan = Stan::Trwa;
                let wideo = wpis.wideo;
                let dane = (id, wpis.nowe.clone(), wpis.anuluj.clone(), wpis.info.clone(), wideo);
                if wideo {
                    w.trwajace_wideo += 1;
                }
                dane
            };
            let (id, nowe, anuluj, info, wideo) = start;
            self.nadajnik.stan(&info);
            let k = self.clone();
            tauri::async_runtime::spawn(async move {
                let wynik = k.wykonaj(id, nowe, anuluj).await;
                let mut kolejne = None;
                {
                    let mut w = k.wewn.lock().unwrap();
                    w.trwajace -= 1;
                    if wideo {
                        w.trwajace_wideo -= 1;
                    }
                    if let Some(wpis) = w.zadania.get_mut(&id) {
                        if let Some(wy) = &wpis.info.wyjscie {
                            let wy = wy.clone();
                            w.zarezerwowane.remove(&wy);
                        }
                    }
                }
                let stan = match wynik {
                    Ok((wyjscie, potem)) => {
                        kolejne = potem;
                        Stan::Gotowe { wyjscie }
                    }
                    Err(Przerwanie::Anulowane) => Stan::Anulowane,
                    Err(Przerwanie::Blad(komunikat)) => Stan::Blad { komunikat },
                    Err(Przerwanie::Pominiete(wyjscie)) => Stan::Pominiete { wyjscie },
                };
                k.ustaw(id, |i| {
                    if let Stan::Gotowe { wyjscie } = &stan {
                        i.procent = 100.0;
                        i.rozmiar_wyniku = std::fs::metadata(wyjscie).ok().map(|m| m.len());
                    }
                    i.stan = stan;
                });
                if let Some(n) = kolejne {
                    k.dodaj(n);
                }
                k.pompuj();
            });
        }
    }

    /// Wolna ścieżka wyniku: `nazwa.ext`, `nazwa (1).ext`… Nigdy nie nadpisuje źródła
    /// (porównanie także po kanonicznej ścieżce: wielkość liter na Windows, dowiązania).
    fn zarezerwuj(&self, katalog: &Path, rdzen: &OsStr, ext: &str, zrodlo: &Path) -> PathBuf {
        let zrodlo_kan = std::fs::canonicalize(zrodlo).ok();
        let mut w = self.wewn.lock().unwrap();
        for i in 0.. {
            let mut nazwa = rdzen.to_os_string();
            if i > 0 {
                nazwa.push(format!(" ({i})"));
            }
            nazwa.push(format!(".{ext}"));
            let p = katalog.join(nazwa);
            let to_zrodlo = p == zrodlo || (zrodlo_kan.is_some() && std::fs::canonicalize(&p).ok() == zrodlo_kan);
            if to_zrodlo || p.exists() || w.zarezerwowane.contains(&p) {
                continue;
            }
            w.zarezerwowane.insert(p.clone());
            return p;
        }
        unreachable!()
    }

    async fn wykonaj(
        &self,
        id: u64,
        nowe: NoweZadanie,
        anuluj: Arc<Notify>,
    ) -> Result<(PathBuf, Option<NoweZadanie>), Przerwanie> {
        match nowe.rodzaj {
            RodzajZadania::Pobranie { url, opcje, potem } => {
                let plik = self.pobierz(id, &url, &opcje, nowe.katalog.as_deref(), &anuluj).await?;
                let kolejne = potem.map(|profil| NoweZadanie {
                    rodzaj: RodzajZadania::Konwersja { wejscie: plik.clone(), profil },
                    katalog: nowe.katalog.clone(),
                    pomin_istniejace: false,
                });
                Ok((plik, kolejne))
            }
            RodzajZadania::Konwersja { wejscie, profil } => {
                // Unikalny katalog zadania (pid + licznik globalny): logi 2 przebiegów, paleta.
                static LICZNIK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                let n = LICZNIK.fetch_add(1, Ordering::Relaxed);
                let tmp = std::env::temp_dir().join(format!("soraconverter-{}-{n}-{id}", std::process::id()));
                let _ = std::fs::create_dir_all(&tmp);
                let w = self
                    .konwertuj(id, &wejscie, &profil, nowe.katalog.as_deref(), nowe.pomin_istniejace, &tmp, &anuluj)
                    .await;
                let _ = std::fs::remove_dir_all(&tmp);
                w.map(|p| (p, None))
            }
        }
    }

    fn zapisz_dziennik(&self, w: &Wewn) {
        if let Some(d) = &self.dziennik {
            if let Some(k) = d.parent() {
                let _ = std::fs::create_dir_all(k);
            }
            let tekst: Vec<String> = w.w_toku.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            let _ = std::fs::write(d, serde_json::to_string(&tekst).unwrap_or_default());
        }
    }

    fn w_toku(&self, p: &Path, dodaj: bool) {
        let mut w = self.wewn.lock().unwrap();
        if dodaj {
            w.w_toku.insert(p.to_path_buf());
        } else {
            w.w_toku.remove(p);
        }
        self.zapisz_dziennik(&w);
    }

    #[allow(clippy::too_many_arguments)]
    async fn konwertuj(
        &self,
        id: u64,
        wejscie: &Path,
        profil: &Profil,
        katalog: Option<&Path>,
        pomin_istniejace: bool,
        tmp: &Path,
        anuluj: &Notify,
    ) -> Result<PathBuf, Przerwanie> {
        let katalog =
            katalog.map(Path::to_path_buf).or_else(|| wejscie.parent().map(Path::to_path_buf)).unwrap_or_default();
        if pomin_istniejace {
            let gotowy = cel_bez_kolizji(&katalog, wejscie, profil.kontener.rozszerzenie());
            if gotowy.is_file() && gotowy != wejscie {
                return Err(Przerwanie::Pominiete(gotowy));
            }
        }
        upewnij_katalog(&katalog)?;
        let s = self.sciezki.read().unwrap().clone();
        let ffmpeg = s.ffmpeg.ok_or_else(|| Przerwanie::Blad(blad::kod("brak_narzedzia", &[("nazwa", &"ffmpeg")])))?;
        let ffprobe =
            s.ffprobe.ok_or_else(|| Przerwanie::Blad(blad::kod("brak_narzedzia", &[("nazwa", &"ffprobe")])))?;
        let media = sonda::sonduj(&ffprobe, wejscie).await.map_err(Przerwanie::Blad)?;
        let kt = Kontekst { zscale: self.zscale.load(Ordering::Relaxed), katalog_tmp: Some(tmp.to_path_buf()) };
        // Szybki test profilu, zanim cokolwiek zarezerwujemy.
        budowniczy::plan_z(&media, profil, wejscie, Path::new("x"), &kt)
            .map_err(|e| Przerwanie::Blad(e.to_string()))?;

        sprawdz_miejsce(&media, profil, &katalog)?;
        let rdzen = wejscie.file_stem().map(OsStr::to_os_string).unwrap_or_else(|| OsString::from("wynik"));
        let ext = profil.kontener.rozszerzenie();
        let wyjscie = self.zarezerwuj(&katalog, &rdzen, ext, wejscie);
        let rozmiar_wejscia = std::fs::metadata(wejscie).ok().map(|m| m.len());
        self.ustaw(id, |i| {
            i.wyjscie = Some(wyjscie.clone());
            i.rozmiar_wejscia = rozmiar_wejscia;
        });
        let czesc = sciezka_czesci(&wyjscie);
        self.w_toku(&czesc, true);
        let wynik = self.koduj(id, &ffmpeg, &media, wejscie, profil, &czesc, &kt, anuluj).await;
        let wynik = wynik.and_then(|()| {
            std::fs::rename(&czesc, &wyjscie).map_err(|e| Przerwanie::Blad(blad::kod("zapis_wyniku", &[("blad", &e)])))
        });
        if wynik.is_err() {
            usun_z_ponowieniem(&czesc).await;
        }
        self.w_toku(&czesc, false);
        wynik?;
        // Ucięte źródło: ffmpeg kończy „sukcesem”, a wynik jest krótszy niż nagłówek.
        if !profil.kontener.obraz() || profil.gif.is_some() {
            let oczekiwane = media.czas_wyniku(profil.ciecie.as_ref(), profil.predkosc);
            let wynik_s = sonda::sonduj(&ffprobe, &wyjscie).await.ok().and_then(|m| m.czas_s);
            let od = profil.ciecie.as_ref().map(|c| c.od).unwrap_or(0.0);
            if let Some(o) = sprawdz_uciecie(oczekiwane, wynik_s, od, profil.predkosc) {
                self.ustaw(id, |i| i.ostrzezenie = Some(o));
            }
        }
        Ok(wyjscie)
    }

    #[allow(clippy::too_many_arguments)]
    async fn koduj(
        &self,
        id: u64,
        ffmpeg: &Path,
        media: &Media,
        wejscie: &Path,
        profil: &Profil,
        czesc: &Path,
        kt: &Kontekst,
        anuluj: &Notify,
    ) -> Result<(), Przerwanie> {
        let czas = media.czas_wyniku(profil.ciecie.as_ref(), profil.predkosc);
        let mut profil = profil.clone();
        let mut proba = 0;
        loop {
            let plan =
                budowniczy::plan_z(media, &profil, wejscie, czesc, kt).map_err(|e| Przerwanie::Blad(e.to_string()))?;
            let n = plan.przebiegi.len() as u8;
            let mut wynik = Ok(());
            for (i, args) in plan.przebiegi.iter().enumerate() {
                wynik = self.uruchom_ffmpeg(id, ffmpeg, args, czas, i as u8 + 1, n, anuluj).await;
                if wynik.is_err() {
                    break;
                }
            }
            for t in &plan.tymczasowe {
                let _ = std::fs::remove_file(t);
            }
            match wynik {
                Err(Przerwanie::Blad(e)) => {
                    // Enkoder sprzętowy jest na liście, a padł (sterownik, brak GPU, limit sesji NVENC):
                    // automatyczny powrót do kodowania programowego.
                    if let Some(w) = profil.wideo.as_mut().filter(|w| w.sprzet.is_some()) {
                        w.sprzet = None;
                        let _ = std::fs::remove_file(czesc);
                        self.ustaw(id, |i| i.awaria_sprzetu = true);
                        continue;
                    }
                    return Err(Przerwanie::Blad(e));
                }
                Err(e) => return Err(e),
                Ok(()) => {}
            }
            // Docelowy rozmiar: jeśli koder przestrzelił, poprawka bitrate (maks. 2 razy).
            let Some(JakoscWideo::RozmiarMb { mb }) = profil.wideo.as_ref().map(|w| w.jakosc.clone()) else {
                return Ok(());
            };
            let cel = (mb as f64) * 1024.0 * 1024.0;
            let jest = std::fs::metadata(czesc).map(|m| m.len() as f64).unwrap_or(0.0);
            if jest <= cel || proba == 2 {
                return Ok(());
            }
            proba += 1;
            let wsp = (cel / jest * 0.98) as f32;
            if let Some(w) = profil.wideo.as_mut() {
                w.jakosc = JakoscWideo::RozmiarMb { mb: mb * wsp };
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn uruchom_ffmpeg(
        &self,
        id: u64,
        ffmpeg: &Path,
        args: &[OsString],
        czas: Option<f64>,
        przebieg: u8,
        przebiegi: u8,
        anuluj: &Notify,
    ) -> Result<(), Przerwanie> {
        let niski = self.opcje().niski_priorytet;
        let mut dziecko = procesy::komenda_z(ffmpeg, niski)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| Przerwanie::Blad(blad::kod("uruchomienie", &[("program", &"ffmpeg"), ("blad", &e)])))?;
        let drzewo = Drzewo::przypnij(&dziecko, niski);
        let stderr = tokio::spawn(ogon(dziecko.stderr.take().unwrap()));
        let mut linie = BufReader::new(dziecko.stdout.take().unwrap()).lines();
        let mut parser = ParserFfmpeg::default();
        let status = loop {
            tokio::select! {
                l = linie.next_line() => match l {
                    Ok(Some(l)) => {
                        if let Some(m) = parser.linia(&l) {
                            let (procent, eta_s) = postep::postep_przebiegu(&m, czas, przebieg, przebiegi);
                            self.zglos(Postep {
                                id, procent, eta_s, predkosc_x: m.predkosc_x, bajty_s: None, przebieg, przebiegi,
                                nieokreslony: czas.is_none(),
                            });
                        }
                    }
                    _ => break dziecko.wait().await,
                },
                _ = anuluj.notified() => {
                    drzewo.zabij();
                    let _ = dziecko.kill().await;
                    let _ = dziecko.wait().await;
                    return Err(Przerwanie::Anulowane);
                }
            }
        };
        let ogon = stderr.await.unwrap_or_default();
        match status {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(Przerwanie::Blad(blad::z_ogonem("ffmpeg_kod", &[("kod", &s.code().unwrap_or(-1))], &ogon))),
            Err(e) => Err(Przerwanie::Blad(e.to_string())),
        }
    }

    /// Pobranie yt-dlp: postęp z naszego szablonu, ścieżka wyniku z `--print after_move:`.
    /// Drzewo procesów (yt-dlp → ffmpeg; .exe to bootloader + dziecko) w Job Object / grupie (D24).
    async fn pobierz(
        &self,
        id: u64,
        url: &str,
        opcje: &OpcjePobrania,
        katalog: Option<&Path>,
        anuluj: &Notify,
    ) -> Result<PathBuf, Przerwanie> {
        let s = self.sciezki.read().unwrap().clone();
        let ytdlp =
            s.ytdlp.clone().ok_or_else(|| Przerwanie::Blad(blad::kod("brak_narzedzia", &[("nazwa", &"yt-dlp")])))?;
        let katalog = katalog.map(Path::to_path_buf).unwrap_or_else(pobieracz::katalog_domyslny);
        upewnij_katalog(&katalog)?;
        let args = pobieracz::argumenty_pobrania(url, opcje, &katalog, &s);
        let niski = self.opcje().niski_priorytet;
        let mut dziecko = procesy::komenda_z(&ytdlp, niski)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| Przerwanie::Blad(blad::kod("uruchomienie", &[("program", &"yt-dlp"), ("blad", &e)])))?;
        let drzewo = Drzewo::przypnij(&dziecko, niski);
        let stderr = tokio::spawn(ogon(dziecko.stderr.take().unwrap()));
        let mut linie = BufReader::new(dziecko.stdout.take().unwrap()).lines();
        let mut plik = None;
        // Wideo + audio to dwa pliki pobierane po kolei: liczymy postęp w sumie.
        let mut skonczone_czesci: u8 = 0;
        let mut ostatni_procent = 0.0;
        let status = loop {
            tokio::select! {
                l = linie.next_line() => match l {
                    Ok(Some(l)) => match postep::linia_ytdlp(&l) {
                        LiniaYtdlp::Postep { pobrane, calosc, bajty_s, eta_s } => {
                            let ulamek = calosc.filter(|c| *c > 0).map(|c| (pobrane as f64 / c as f64).min(1.0)).unwrap_or(0.0);
                            let mut procent = ulamek * 100.0;
                            if procent + 50.0 < ostatni_procent {
                                skonczone_czesci = skonczone_czesci.saturating_add(1);
                            }
                            ostatni_procent = procent;
                            if skonczone_czesci > 0 {
                                procent = 50.0 + procent / 2.0;
                            }
                            self.zglos(Postep {
                                id, procent: procent.min(99.0), eta_s, predkosc_x: None, bajty_s,
                                przebieg: 1, przebiegi: 1, nieokreslony: calosc.is_none(),
                            });
                        }
                        LiniaYtdlp::Plik(p) => plik = Some(PathBuf::from(p)),
                        LiniaYtdlp::Inna => {}
                    },
                    _ => break dziecko.wait().await,
                },
                _ = anuluj.notified() => {
                    drzewo.zabij();
                    let _ = dziecko.kill().await;
                    let _ = dziecko.wait().await;
                    return Err(Przerwanie::Anulowane);
                }
            }
        };
        let ogon = stderr.await.unwrap_or_default();
        match status {
            Ok(st) if st.success() => {
                let plik = plik.ok_or_else(|| Przerwanie::Blad(blad::kod("ytdlp_bez_sciezki", &[])))?;
                self.ustaw(id, |i| {
                    i.wyjscie = Some(plik.clone());
                });
                Ok(plik)
            }
            Ok(st) => Err(Przerwanie::Blad(format!(
                "{}\n(yt-dlp, kod {})",
                pobieracz::komunikat_bledu(&ogon),
                st.code().unwrap_or(-1)
            ))),
            Err(e) => Err(Przerwanie::Blad(e.to_string())),
        }
    }

    fn zglos(&self, p: Postep) {
        if let Some(w) = self.wewn.lock().unwrap().zadania.get_mut(&p.id) {
            w.info.procent = p.procent;
        }
        self.nadajnik.postep(&p);
    }
}

fn popraw(o: Opcje) -> Opcje {
    let limit = o.limit.max(1);
    Opcje { limit, limit_wideo: o.limit_wideo.clamp(1, limit), niski_priorytet: o.niski_priorytet }
}

/// Sprawdzenie wolnego miejsca przed startem (szacunek wyniku + zapas).
fn sprawdz_miejsce(media: &Media, profil: &Profil, katalog: &Path) -> Result<(), Przerwanie> {
    let Some(potrzeba) = szacunek::szacuj(media, profil).bajty else { return Ok(()) };
    let Some(wolne) = procesy::wolne_miejsce(katalog) else { return Ok(()) };
    if procesy::miejsce_wystarczy(potrzeba, wolne) {
        return Ok(());
    }
    Err(Przerwanie::Blad(format!(
        "za mało miejsca na dysku: wynik zajmie ok. {} MB, wolne {} MB",
        potrzeba / 1_048_576 + 1,
        wolne / 1_048_576
    )))
}

#[derive(Debug)]
enum Przerwanie {
    Anulowane,
    Blad(String),
    Pominiete(PathBuf),
}

/// `katalog/nazwa.ext` (cel bez dopisku „ (1)”).
pub fn cel_bez_kolizji(katalog: &Path, wejscie: &Path, ext: &str) -> PathBuf {
    let mut n = wejscie.file_stem().map(OsStr::to_os_string).unwrap_or_else(|| OsString::from("wynik"));
    n.push(format!(".{ext}"));
    katalog.join(n)
}

/// Usuwa plik, ponawiając do ~2 s. Na Windows zabity ffmpeg albo Defender potrafi jeszcze chwilę trzymać
/// świeży plik (ERROR_SHARING_VIOLATION), więc jedna próba po anulowaniu zostawiała `*.part.*`
/// (złapane w publicznym CI windows-latest 08.10). Brak pliku = sukces.
pub(crate) async fn usun_z_ponowieniem(p: &Path) {
    for _ in 0..40 {
        match std::fs::remove_file(p) {
            Ok(()) => return,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(50)).await,
        }
    }
}

/// `film.mp4` → `film.part.mp4` (ffmpeg dalej rozpozna kontener po rozszerzeniu).
pub fn sciezka_czesci(wyjscie: &Path) -> PathBuf {
    let mut nazwa = wyjscie.file_stem().map(OsStr::to_os_string).unwrap_or_default();
    nazwa.push(".part");
    if let Some(ext) = wyjscie.extension() {
        nazwa.push(".");
        nazwa.push(ext);
    }
    wyjscie.with_file_name(nazwa)
}

/// Czy nazwa wygląda na nasz niepełny wynik (`*.part.ext`).
pub fn to_czesc(p: &Path) -> bool {
    p.file_stem().and_then(|s| Path::new(s).extension()).is_some_and(|e| e == "part")
}

/// Po awarii apki: usuwa niepełne pliki z dziennika (tylko `*.part.*`, które sami zapisaliśmy).
/// Zwraca usunięte ścieżki.
pub fn sprzatnij_po_awarii(dziennik: &Path) -> Vec<PathBuf> {
    let Ok(tekst) = std::fs::read_to_string(dziennik) else { return vec![] };
    let lista: Vec<PathBuf> =
        serde_json::from_str::<Vec<String>>(&tekst).unwrap_or_default().into_iter().map(PathBuf::from).collect();
    let mut usuniete = Vec::new();
    for p in lista {
        if to_czesc(&p) && p.is_file() && std::fs::remove_file(&p).is_ok() {
            usuniete.push(p);
        }
    }
    let _ = std::fs::remove_file(dziennik);
    usuniete
}

/// Folder wyniku musi istnieć: tworzymy go, a jeśli się nie da, mówimy wprost dlaczego.
fn upewnij_katalog(katalog: &Path) -> Result<(), Przerwanie> {
    if katalog.as_os_str().is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(katalog)
        .map_err(|e| Przerwanie::Blad(blad::kod("folder_zapisu", &[("folder", &katalog.display()), ("blad", &e)])))
}

/// Ostatnie 50 linii stderr (do komunikatu błędu).
async fn ogon(r: impl AsyncRead + Unpin) -> String {
    let mut linie = BufReader::new(r).lines();
    let mut bufor: VecDeque<String> = VecDeque::with_capacity(50);
    while let Ok(Some(l)) = linie.next_line().await {
        if bufor.len() == 50 {
            bufor.pop_front();
        }
        bufor.push_back(l);
    }
    Vec::from(bufor).join("\n")
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn czesc_i_sprzatanie_po_awarii() {
        let tmp = tempfile::tempdir().unwrap();
        let czesc = sciezka_czesci(&tmp.path().join("film zażółć.mp4"));
        assert_eq!(czesc.file_name().unwrap(), "film zażółć.part.mp4");
        assert!(to_czesc(&czesc));
        assert!(!to_czesc(&tmp.path().join("film.mp4")));
        std::fs::write(&czesc, b"niepelny").unwrap();
        let cudzy = tmp.path().join("notatki.txt");
        std::fs::write(&cudzy, b"nie ruszac").unwrap();
        let dziennik = tmp.path().join("w_toku.json");
        let lista = vec![czesc.to_string_lossy().into_owned(), cudzy.to_string_lossy().into_owned()];
        std::fs::write(&dziennik, serde_json::to_string(&lista).unwrap()).unwrap();
        assert_eq!(sprzatnij_po_awarii(&dziennik), vec![czesc.clone()]);
        assert!(!czesc.exists());
        assert!(cudzy.exists(), "plik spoza *.part.* nie może zniknąć");
        assert!(!dziennik.exists());
    }

    #[test]
    fn uciecie_ponizej_97_procent() {
        // test na żywo: nagłówek 2:59, wynik 32 s
        let o = sprawdz_uciecie(Some(179.0), Some(32.0), 0.0, 1.0).unwrap();
        assert_eq!(o, OstrzezenieWyniku::Uciete { zrodlo_konczy_s: 32.0, wynik_s: 32.0, oczekiwane_s: 179.0 });
        assert_eq!(sprawdz_uciecie(Some(179.0), Some(178.0), 0.0, 1.0), None, "zaokrąglenia kontenera");
        assert_eq!(sprawdz_uciecie(Some(1.5), Some(0.5), 0.0, 1.0), None, "za krótkie, by oceniać");
        assert_eq!(sprawdz_uciecie(None, Some(3.0), 0.0, 1.0), None);
        // cięcie od 10 s i przyspieszenie 2×: źródło urywa się w 10 + 5×2
        let Some(OstrzezenieWyniku::Uciete { zrodlo_konczy_s, .. }) = sprawdz_uciecie(Some(20.0), Some(5.0), 10.0, 2.0)
        else {
            panic!()
        };
        assert_eq!(zrodlo_konczy_s, 20.0);
    }

    #[test]
    fn opcje_poprawiane() {
        let o = popraw(Opcje { limit: 0, limit_wideo: 5, niski_priorytet: false });
        assert_eq!((o.limit, o.limit_wideo), (1, 1));
        let o = popraw(Opcje { limit: 4, limit_wideo: 0, niski_priorytet: true });
        assert_eq!((o.limit, o.limit_wideo), (4, 1));
    }
}
