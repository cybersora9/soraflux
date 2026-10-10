//! SoraConverter: rdzeń aplikacji. Front tylko rysuje, tu budujemy komendy,
//! uruchamiamy ffmpeg i raportujemy postęp.

pub mod blad;
pub mod budowniczy;
pub mod dziennik;
pub mod kolejka;
pub mod komendy;
pub mod konfig;
pub mod napisy;
pub mod narzedzia;
pub mod pobieracz;
pub mod postep;
pub mod presety;
pub mod procesy;
pub mod sonda;
pub mod szacunek;
pub mod ustawienia;

use kolejka::{InfoZadania, Kolejka, Nadajnik, Stan};
use komendy::StanApki;
use postep::Postep;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter, Manager};

struct NadajnikOkna {
    app: AppHandle,
    katalog_danych: PathBuf,
}

impl Nadajnik for NadajnikOkna {
    fn postep(&self, p: &Postep) {
        let _ = self.app.emit("zadanie://postep", p);
    }
    fn stan(&self, z: &InfoZadania) {
        if let Stan::Blad { komunikat } = &z.stan {
            dziennik::zapisz(&self.katalog_danych, &format!("zadanie {} ({}): {komunikat}", z.id, z.nazwa));
        }
        let _ = self.app.emit("zadanie://stan", z);
    }
}

/// Pliki z linii poleceń (menu kontekstowe Eksploratora, „Otwórz za pomocą”, drugie
/// uruchomienie): tylko istniejące ścieżki, względne liczone od `cwd`, bez flag.
pub fn sciezki_z_argumentow(argumenty: &[String], cwd: &Path) -> Vec<PathBuf> {
    argumenty
        .iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .filter(|p| p.exists())
        .collect()
}

/// Wszystkie komendy dostępne dla frontu (też w testach z `tauri::test`).
pub fn komendy_apki<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        komendy::wersja_apki,
        komendy::sonda,
        komendy::plan_komendy,
        komendy::dodaj_zadania,
        komendy::lista_zadan,
        komendy::anuluj_zadanie,
        komendy::wyczysc_zakonczone,
        komendy::rozwin_sciezki,
        komendy::konfig_wczytaj,
        komendy::konfig_zapisz,
        komendy::szacuj,
        komendy::szacuj_z_probki,
        komendy::presety_lista,
        komendy::preset_zapisz,
        komendy::preset_usun,
        komendy::narzedzia_stan,
        komendy::narzedzia_wykryj,
        komendy::narzedzia_pobierz,
        komendy::raport,
        komendy::rozwin_foldery,
        komendy::podglad_klatki,
        komendy::odsluch,
        komendy::pliki_startowe,
        komendy::ytdlp_info,
        komendy::ytdlp_aktualizuj,
        komendy::ytdlp_zapewnij,
        komendy::napisy_stan,
        komendy::napisy_pobierz_model,
        komendy::napisy_anuluj_model,
    ]
}

/// Katalogi, w których szukamy narzędzi pobranych przez apkę.
fn katalogi_narzedzi() -> Vec<std::path::PathBuf> {
    let mut k = vec![konfig::katalog_danych().join("narzedzia")];
    if let Some(obok) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("narzedzia"))) {
        k.push(obok);
    }
    k
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        // Jedna instancja: kolejne pliki z Eksploratora trafiają do już otwartego okna.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argumenty, cwd| {
            let pliki = sciezki_z_argumentow(&argumenty[1.min(argumenty.len())..], Path::new(&cwd));
            if let Some(okno) = app.get_webview_window("main") {
                let _ = okno.unminimize();
                let _ = okno.set_focus();
            }
            if !pliki.is_empty() {
                let _ = app.emit("pliki://otworz", pliki);
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let katalog_konfiguracji = konfig::katalog_konfiguracji();
            let katalog_danych = konfig::katalog_danych();
            for p in konfig::migruj_ze_starej() {
                dziennik::zapisz(
                    &katalog_danych,
                    &format!("migracja z {}: skopiowano {}", konfig::STARA_NAZWA, p.display()),
                );
            }
            let k = konfig::wczytaj(&katalog_konfiguracji);
            let plik_w_toku = katalog_danych.join("w_toku.json");
            for p in kolejka::sprzatnij_po_awarii(&plik_w_toku) {
                dziennik::zapisz(&katalog_danych, &format!("po awarii usunięto niepełny plik {}", p.display()));
            }
            let katalogi = katalogi_narzedzi();
            let sciezki = Arc::new(RwLock::new(narzedzia::wykryj(&k.sciezki, &katalogi)));
            let nadajnik = NadajnikOkna { app: app.handle().clone(), katalog_danych: katalog_danych.clone() };
            let kolejka =
                Kolejka::z_opcjami(komendy::opcje_kolejki(&k), Arc::new(nadajnik), sciezki.clone(), Some(plik_w_toku));
            let katalog_modeli = katalog_danych.join("modele");
            kolejka.ustaw_katalog_modeli(Some(katalog_modeli.clone()));
            let argumenty: Vec<String> = std::env::args().skip(1).collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            app.manage(StanApki {
                kolejka,
                sciezki,
                konfig: Mutex::new(k),
                katalog_konfiguracji,
                katalogi_narzedzi: katalogi,
                enkodery: RwLock::new(Vec::new()),
                pamiec_narzedzi: Mutex::new(None),
                katalog_danych,
                pliki_startowe: Mutex::new(sciezki_z_argumentow(&argumenty, &cwd)),
                katalog_modeli,
                model_napisow: Default::default(),
            });
            Ok(())
        })
        .invoke_handler(komendy_apki())
        .build(tauri::generate_context!())
        .expect("nie udało się uruchomić SoraConverter");
    app.run(|app, zdarzenie| {
        if let tauri::RunEvent::Exit = zdarzenie {
            // Zamknięcie okna w trakcie pracy: żadnego ffmpeg w tle (na Windows dodatkowo Job Object).
            if let Some(s) = app.try_state::<StanApki>() {
                s.kolejka.anuluj_wszystko();
                s.model_napisow.przerwij.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
    });
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn pliki_z_argumentow() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("zażółć 日本.mp4"), b"").unwrap();
        let a = vec!["--flaga".to_string(), "zażółć 日本.mp4".into(), "nie-ma.mp4".into()];
        assert_eq!(sciezki_z_argumentow(&a, tmp.path()), vec![tmp.path().join("zażółć 日本.mp4")]);
    }
}
