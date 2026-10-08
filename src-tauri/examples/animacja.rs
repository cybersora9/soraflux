//! Film → animowany WebP silnikiem SoraFluxa (ten sam `budowniczy::plan` co w apce, profil
//! „animowany WebP” z zakładki Konwertuj). Używane do dema w README (`scripts/showcase.mjs`).
//!
//! cargo run --example animacja -- <wejście> <wyjście.webp> [fps=12] [szerokość=960]
//! Wymaga ffmpeg i ffprobe w PATH.

use soraconverter_lib::budowniczy;
use soraconverter_lib::sonda;
use soraconverter_lib::ustawienia::{Kontener, Petla, Profil, ProfilGif};
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let [wejscie, wyjscie, ..] = a.as_slice() else {
        eprintln!("użycie: animacja <wejście> <wyjście.webp> [fps] [szerokość]");
        std::process::exit(2);
    };
    let fps: f32 = a.get(2).and_then(|x| x.parse().ok()).unwrap_or(12.0);
    let szerokosc: u32 = a.get(3).and_then(|x| x.parse().ok()).unwrap_or(960);
    let (wejscie, wyjscie) = (PathBuf::from(wejscie), PathBuf::from(wyjscie));

    let probe = Command::new("ffprobe").args(sonda::argumenty_ffprobe(&wejscie)).output().expect("ffprobe");
    let media = sonda::media_z_json(&String::from_utf8_lossy(&probe.stdout)).expect("ffprobe JSON");

    let mut profil = Profil::dla(Kontener::Webp);
    profil.gif = Some(ProfilGif { fps, szerokosc, petla: Petla::Nieskonczona, ..Default::default() });
    let plan = budowniczy::plan(&media, &profil, &wejscie, &wyjscie).expect("plan");
    for przebieg in &plan.przebiegi {
        println!("ffmpeg {}", przebieg.iter().map(|x| x.to_string_lossy()).collect::<Vec<_>>().join(" "));
        let ok = Command::new("ffmpeg").args(przebieg).status().expect("ffmpeg").success();
        assert!(ok, "ffmpeg zakończył się błędem");
    }
    for t in plan.tymczasowe {
        let _ = std::fs::remove_file(t);
    }
}
