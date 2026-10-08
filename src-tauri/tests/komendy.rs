// Testy IPC (tauri::test, mock runtime) tylko na Linuxie: na Windows binarka testu bez manifestu
// Common Controls v6 nie startuje (0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND, lokalnie i w CI windows-latest).
// Ta sama logika komend jest pokryta tu na ubuntu-24.04 i testami jednostkowymi w src/.
#![cfg(not(windows))]

//! Kontrakt front ↔ Rust: komendy wołane przez IPC Tauri (mock runtime)
//! z JSON-em w dokładnie takim kształcie, jaki wysyła `src/api.ts`.

use serde_json::{json, Value};
use soraconverter_lib::kolejka::{InfoZadania, Kolejka, Nadajnik};
use soraconverter_lib::komendy::StanApki;
use soraconverter_lib::konfig::Konfig;
use soraconverter_lib::narzedzia::{self, Sciezki};
use soraconverter_lib::postep::Postep;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::WebviewWindow;

struct Cisza;
impl Nadajnik for Cisza {
    fn postep(&self, _: &Postep) {}
    fn stan(&self, _: &InfoZadania) {}
}

fn aplikacja(
    katalog_konfiguracji: std::path::PathBuf,
) -> (tauri::App<tauri::test::MockRuntime>, WebviewWindow<tauri::test::MockRuntime>) {
    let sciezki = Arc::new(RwLock::new(narzedzia::wykryj(&Sciezki::default(), &[])));
    let stan = StanApki {
        kolejka: Kolejka::nowa(2, Arc::new(Cisza), sciezki.clone()),
        sciezki,
        konfig: Mutex::new(Konfig::default()),
        katalog_danych: katalog_konfiguracji.clone(),
        katalog_konfiguracji,
        katalogi_narzedzi: vec![std::env::temp_dir().join("soraconverter-test-narzedzia")],
        enkodery: RwLock::new(vec![]),
        pamiec_narzedzi: Mutex::new(None),
        pliki_startowe: Mutex::new(vec![]),
    };
    let app = mock_builder()
        .manage(stan)
        .invoke_handler(soraconverter_lib::komendy_apki())
        .build(mock_context(noop_assets()))
        .expect("aplikacja testowa");
    let okno = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().expect("okno");
    (app, okno)
}

fn wywolaj(okno: &WebviewWindow<tauri::test::MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    get_ipc_response(
        okno,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<Value>().unwrap())
}

/// Dokładnie to, co daje `profilDla("mp4")` w logika.ts + zmiany z GUI.
fn profil_ts_480p_aac8() -> Value {
    json!({
        "kontener": "mp4",
        "wideo": {
            "kodek": "h264",
            "rozdzielczosc": { "typ": "wysokosc", "h": 480 },
            "dopasowanie": { "typ": "proporcje" },
            "nie_powiekszaj": false,
            "skaler": "lanczos",
            "fps": { "typ": "wartosc", "fps": 25 },
            "jakosc": { "typ": "bitrate", "kbps": 800 },
            "sprzet": null
        },
        "audio": { "kodek": "aac", "kbps": 8, "hz": 16000, "kanaly": 1, "normalizacja": false },
        "obraz": null,
        "gif": null,
        "ciecie": null,
        "obrot": "brak",
        "odbicie": { "poziomo": false, "pionowo": false },
        "przyciecie": { "gora": 0, "dol": 0, "lewo": 0, "prawo": 0 },
        "deinterlace": false,
        "predkosc": 1
    })
}

fn media_ts() -> Value {
    json!({
        "czas_s": 60.0, "rozmiar_b": 50000000, "kbps": 5000, "format": "mov,mp4,m4a,3gp,3g2,mj2",
        "wideo": { "kodek": "h264", "w": 1920, "h": 1080, "fps": 30.0, "kbps": 4800 },
        "audio": { "kodek": "aac", "hz": 48000, "kanaly": 2, "kbps": 192 },
        "obraz": false
    })
}

#[test]
fn wersja_i_plan_komendy() {
    let tmp = tempfile::tempdir().unwrap();
    let (_app, okno) = aplikacja(tmp.path().to_path_buf());
    assert_eq!(wywolaj(&okno, "wersja_apki", json!({})).unwrap(), json!(env!("CARGO_PKG_VERSION")));

    let plan = wywolaj(
        &okno,
        "plan_komendy",
        json!({ "wejscie": "C:/Wideo/a.mp4", "media": media_ts(), "profil": profil_ts_480p_aac8() }),
    )
    .unwrap();
    assert!(plan["blad"].is_null(), "{plan}");
    let args: Vec<String> = serde_json::from_value(plan["przebiegi"][0].clone()).unwrap();
    let vf = args.iter().position(|a| a == "-vf").unwrap();
    assert_eq!(args[vf + 1], "scale=w=-2:h=480:flags=lanczos,fps=25");
    assert_eq!(plan["podpowiedzi"][0]["typ"], "mono_niski_hz");

    // błąd profilu wraca jako dane, nie wyjątek (front pokazuje go spokojnie)
    let mut zly = profil_ts_480p_aac8();
    zly["kontener"] = json!("webm");
    let plan =
        wywolaj(&okno, "plan_komendy", json!({ "wejscie": "a.mp4", "media": media_ts(), "profil": zly })).unwrap();
    assert_eq!(plan["blad"]["typ"], "niezgodny_kodek_wideo");

    let s = wywolaj(&okno, "szacuj", json!({ "media": media_ts(), "profil": profil_ts_480p_aac8() })).unwrap();
    assert!(s["bajty"].as_u64().unwrap() > 5_000_000);
    assert_eq!(s["dokladny"], true);
}

#[test]
fn konfig_presety_i_sciezki() {
    let tmp = tempfile::tempdir().unwrap();
    let (_app, okno) = aplikacja(tmp.path().to_path_buf());
    // Kształt Konfig z typy.ts
    let k = json!({
        "jezyk": "en", "motyw": "light", "rownolegle": 3, "rownolegle_wideo": 1, "niski_priorytet": true, "katalog_wyjscia": null,
        "katalog_pobierania": null, "schowek": true,
        "sciezki": { "ffmpeg": null, "ffprobe": null, "ytdlp": null, "deno": null }, "kreator_zakonczony": true,
        "motyw_wyglad": "jp-c", "wlasne_motywy": [{ "id": "wlasny-1", "nazwa": "Mój", "baza": "sora-b", "jasny": { "akcent": "#123456" }, "ciemny": {} }],
        "ostatnie_foldery": ["C:/Wideo/Gotowe"]
    });
    wywolaj(&okno, "konfig_zapisz", json!({ "konfig": k })).unwrap();
    assert_eq!(wywolaj(&okno, "konfig_wczytaj", json!({})).unwrap(), k);
    assert!(tmp.path().join("konfig.json").exists());

    let presety = wywolaj(&okno, "presety_lista", json!({})).unwrap();
    let ids: Vec<&str> = presety.as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap()).collect();
    for id in ["telefon", "discord", "whatsapp", "podcast", "mp3_320", "gif", "webp_1600"] {
        assert!(ids.contains(&id), "brak presetu {id}");
    }

    std::fs::write(tmp.path().join("a.mp4"), b"").unwrap();
    std::fs::write(tmp.path().join("notatka.txt"), b"").unwrap();
    std::fs::create_dir(tmp.path().join("pod")).unwrap();
    std::fs::write(tmp.path().join("pod/b.PNG"), b"").unwrap();
    let pliki = wywolaj(&okno, "rozwin_sciezki", json!({ "sciezki": [tmp.path()] })).unwrap();
    let nazwy: Vec<String> = pliki.as_array().unwrap().iter().map(|p| p.as_str().unwrap().replace('\\', "/")).collect();
    assert_eq!(nazwy.len(), 2, "{nazwy:?}");
    assert!(nazwy[0].ends_with("a.mp4") && nazwy[1].ends_with("pod/b.PNG"));
}

#[test]
fn konwersja_przez_ipc() {
    let tmp = tempfile::tempdir().unwrap();
    let we = tmp.path().join("we.mp4");
    let ok = std::process::Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30:duration=3",
        ])
        .args([
            "-f",
            "lavfi",
            "-i",
            "sine=duration=3",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(&we)
        .status()
        .unwrap();
    assert!(ok.success());
    let (_app, okno) = aplikacja(tmp.path().to_path_buf());
    let media = wywolaj(&okno, "sonda", json!({ "sciezka": we })).unwrap();
    assert_eq!(media["wideo"]["h"], 360);
    // NoweZadanie jak w plikowy.ts
    let ids = wywolaj(
        &okno,
        "dodaj_zadania",
        json!({ "zadania": [{ "rodzaj": { "typ": "konwersja", "wejscie": we, "profil": profil_ts_480p_aac8() }, "katalog": null }] }),
    )
    .unwrap();
    let id = ids[0].as_u64().unwrap();
    let start = Instant::now();
    let zadanie = loop {
        let lista = wywolaj(&okno, "lista_zadan", json!({})).unwrap();
        let z = lista.as_array().unwrap().iter().find(|z| z["id"] == id).unwrap().clone();
        if ["gotowe", "blad", "anulowane"].contains(&z["stan"]["typ"].as_str().unwrap()) {
            break z;
        }
        assert!(start.elapsed() < Duration::from_secs(60));
        std::thread::sleep(Duration::from_millis(100));
    };
    assert_eq!(zadanie["stan"]["typ"], "gotowe", "{zadanie}");
    let wy = zadanie["stan"]["wyjscie"].as_str().unwrap();
    assert!(wy.ends_with("we (1).mp4"), "{wy}");
    let m = wywolaj(&okno, "sonda", json!({ "sciezka": wy })).unwrap();
    assert_eq!(m["wideo"]["h"], 480);
    assert_eq!(m["audio"]["kanaly"], 1);
}

/// Punkt 4 przez IPC w kształcie z api.ts (camelCase `czasS`/`odS` → `czas_s`/`od_s`).
#[test]
fn podglad_odsluch_foldery_przez_ipc() {
    let tmp = tempfile::tempdir().unwrap();
    let katalog = tmp.path().join("Folder z filmami/pod");
    std::fs::create_dir_all(&katalog).unwrap();
    let we = katalog.join("klip.mp4");
    let ok = std::process::Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=25:duration=3",
        ])
        .args([
            "-f",
            "lavfi",
            "-i",
            "sine=duration=3",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
        ])
        .arg(&we)
        .status()
        .unwrap();
    assert!(ok.success());
    let (_app, okno) = aplikacja(tmp.path().to_path_buf());
    let media = wywolaj(&okno, "sonda", json!({ "sciezka": we })).unwrap();
    let k = wywolaj(
        &okno,
        "podglad_klatki",
        json!({ "wejscie": we, "media": media, "profil": profil_ts_480p_aac8(), "czasS": 1.5 }),
    )
    .unwrap();
    assert!(k["przed"].as_str().unwrap().starts_with("data:image/jpeg;base64,"));
    assert!(k["po"].as_str().unwrap().starts_with("data:image/jpeg;base64,"));
    assert_eq!(k["czas_s"], 1.5);
    let o =
        wywolaj(&okno, "odsluch", json!({ "wejscie": we, "media": media, "profil": profil_ts_480p_aac8(), "odS": 0 }))
            .unwrap();
    assert!(o.as_str().unwrap().starts_with("data:audio/mp4;base64,"));
    let f = wywolaj(
        &okno,
        "rozwin_foldery",
        json!({ "sciezki": [tmp.path().join("Folder z filmami")], "rozszerzenia": [] }),
    )
    .unwrap();
    assert_eq!(f[0]["podkatalog"], "pod");
    assert_eq!(wywolaj(&okno, "pliki_startowe", json!({})).unwrap(), json!([]));
    assert!(wywolaj(&okno, "raport", json!({}))
        .unwrap()
        .as_str()
        .unwrap()
        .starts_with(&format!("SoraFlux {}", env!("CARGO_PKG_VERSION"))));
}

/// Przyczyna 403 z testu na żywo 07.10: stary yt-dlp z PATH. Front dostaje wiek i pochodzenie.
#[test]
fn a1_info_ytdlp_wiek_i_pochodzenie() {
    use soraconverter_lib::komendy::info_ytdlp;
    use soraconverter_lib::narzedzia::{dzien_z_daty, Pochodzenie, Sciezki};
    let tmp = tempfile::tempdir().unwrap();
    let apka = tmp.path().join("narzedzia");
    let dzis = dzien_z_daty(2026, 10, 7);
    let pip = Sciezki { ytdlp: Some(tmp.path().join("Scripts/yt-dlp.exe")), ..Default::default() };
    let i = info_ytdlp(&pip, Some(&"2026.07.04".to_string()), &Sciezki::default(), std::slice::from_ref(&apka), dzis)
        .unwrap();
    assert_eq!((i.wiek_dni, i.pochodzenie, i.stary), (Some(95), Pochodzenie::Path, true));
    let wlasna = Sciezki { ytdlp: Some(apka.join("yt-dlp.exe")), ..Default::default() };
    let i = info_ytdlp(&wlasna, Some(&"2026.10.01".to_string()), &Sciezki::default(), &[apka], dzis).unwrap();
    assert_eq!((i.wiek_dni, i.pochodzenie, i.stary), (Some(6), Pochodzenie::Apka, false));
    assert!(info_ytdlp(&Sciezki::default(), None, &Sciezki::default(), &[], dzis).is_none());
}

/// Usterka 2 z 07.10: podgląd komendy pokazywał folder źródła zamiast wybranego folderu.
#[test]
fn plan_komendy_bierze_folder_z_konfigu() {
    let tmp = tempfile::tempdir().unwrap();
    let (_app, okno) = aplikacja(tmp.path().to_path_buf());
    let wyniki = tmp.path().join("Wyniki");
    let mut k = wywolaj(&okno, "konfig_wczytaj", json!({})).unwrap();
    k["katalog_wyjscia"] = json!(wyniki);
    wywolaj(&okno, "konfig_zapisz", json!({ "konfig": k })).unwrap();
    let wejscie = tmp.path().join("zrodla").join("a.mp4");
    let plan = wywolaj(
        &okno,
        "plan_komendy",
        json!({ "wejscie": wejscie, "media": media_ts(), "profil": profil_ts_480p_aac8() }),
    )
    .unwrap();
    let args: Vec<String> = serde_json::from_value(plan["przebiegi"][0].clone()).unwrap();
    assert_eq!(args.last().unwrap(), &wyniki.join("a.mp4").to_string_lossy(), "{args:?}");
    // bez wybranego folderu: obok źródła, jak dodaj_zadania
    let p = soraconverter_lib::komendy::wyjscie_podgladu(
        &wejscie,
        None,
        &serde_json::from_value(profil_ts_480p_aac8()).unwrap(),
    );
    assert_eq!(p, tmp.path().join("zrodla").join("a.mp4"));
}

/// Usterka 3 z 07.10: mieszane separatory. Na Windows `normalizuj` składa ścieżkę z `\`;
/// na Unix `\` to zwykły znak nazwy, więc sprawdzamy tylko, że nic nie ginie.
#[test]
fn normalizacja_sciezek() {
    use soraconverter_lib::komendy::normalizuj;
    use std::path::Path;
    #[cfg(windows)]
    assert_eq!(
        normalizuj(Path::new("C:/Users/sora/test\\plik.mp4")).to_string_lossy(),
        "C:\\Users\\sora\\test\\plik.mp4"
    );
    assert_eq!(normalizuj(Path::new("/home/sora//test/./plik.mp4")), Path::new("/home/sora/test/plik.mp4"));
}
