//! Oficjalne źródła narzędzi i ich sum SHA256 (jedyne miejsce z linkami).
//! Sumy pobieramy z tego samego oficjalnego wydania co plik (pliki „latest”
//! zmieniają się z każdym wydaniem, więc stała suma w kodzie szybko by umarła).

use super::Narzedzie;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pakiet {
    /// ffmpeg + ffprobe, gyan.dev „release essentials” (mniejszy, wystarcza do Windows 10+)
    Ffmpeg,
    /// ffmpeg + ffprobe, gyan.dev „release full” (więcej kodeków i filtrów)
    FfmpegFull,
    /// yt-dlp: oficjalne wydanie z GitHuba, suma w `SHA2-256SUMS` tego samego wydania.
    Ytdlp,
    /// Deno: środowisko JS, którego yt-dlp potrzebuje do wyzwań YouTube.
    Deno,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Archiwum {
    /// Sam plik wykonywalny.
    Plik,
    /// ZIP; wyciągamy pliki o podanych końcówkach ścieżki.
    Zip,
}

#[derive(Debug, Clone)]
pub struct Zrodlo {
    pub url: &'static str,
    /// Nazwa pliku w wydaniu (do odszukania w pliku sum).
    pub nazwa: &'static str,
    pub url_sum: &'static str,
    pub archiwum: Archiwum,
    /// (narzędzie, końcówka ścieżki w archiwum)
    pub pliki: &'static [(Narzedzie, &'static str)],
    pub licencja: &'static str,
    pub strona: &'static str,
}

pub fn zrodlo(p: Pakiet) -> Option<Zrodlo> {
    match p {
        Pakiet::Ytdlp => return Some(zrodlo_ytdlp()),
        Pakiet::Deno => return Some(zrodlo_deno()),
        Pakiet::Ffmpeg | Pakiet::FfmpegFull => {}
    }
    if !cfg!(windows) {
        // Linux/macOS: menedżer pakietów (apt, dnf, brew).
        return None;
    }
    // gyan.dev: oficjalnie polecane buildy Windows z ffmpeg.org, suma w pliku `.sha256` obok.
    // Licencja buildu: GPL-3.0 (x264, x265). Zip ma katalog `ffmpeg-X.Y-essentials_build/bin/`.
    Some(match p {
        Pakiet::Ffmpeg => Zrodlo {
            url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
            nazwa: "ffmpeg-release-essentials.zip",
            url_sum: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256",
            archiwum: Archiwum::Zip,
            pliki: &[(Narzedzie::Ffmpeg, "bin/ffmpeg.exe"), (Narzedzie::Ffprobe, "bin/ffprobe.exe")],
            licencja: "GPL-3.0",
            strona: "https://www.gyan.dev/ffmpeg/builds/",
        },
        Pakiet::FfmpegFull => Zrodlo {
            url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.zip",
            nazwa: "ffmpeg-release-full.zip",
            url_sum: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.zip.sha256",
            archiwum: Archiwum::Zip,
            pliki: &[(Narzedzie::Ffmpeg, "bin/ffmpeg.exe"), (Narzedzie::Ffprobe, "bin/ffprobe.exe")],
            licencja: "GPL-3.0",
            strona: "https://www.gyan.dev/ffmpeg/builds/",
        },
        Pakiet::Ytdlp | Pakiet::Deno => unreachable!(),
    })
}

fn zrodlo_ytdlp() -> Zrodlo {
    let (url, nazwa) = if cfg!(windows) {
        ("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", "yt-dlp.exe")
    } else if cfg!(target_os = "macos") {
        ("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos", "yt-dlp_macos")
    } else if cfg!(target_arch = "aarch64") {
        ("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64", "yt-dlp_linux_aarch64")
    } else {
        ("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux", "yt-dlp_linux")
    };
    Zrodlo {
        url,
        nazwa,
        url_sum: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS",
        archiwum: Archiwum::Plik,
        pliki: &[(Narzedzie::Ytdlp, "")],
        licencja: "Unlicense",
        strona: "https://github.com/yt-dlp/yt-dlp",
    }
}

fn zrodlo_deno() -> Zrodlo {
    macro_rules! deno {
        ($c:literal) => {
            (
                concat!("https://github.com/denoland/deno/releases/latest/download/deno-", $c, ".zip"),
                concat!("deno-", $c, ".zip"),
                concat!("https://github.com/denoland/deno/releases/latest/download/deno-", $c, ".zip.sha256sum"),
            )
        };
    }
    let (url, nazwa, url_sum) = if cfg!(windows) {
        deno!("x86_64-pc-windows-msvc")
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        deno!("aarch64-apple-darwin")
    } else if cfg!(target_os = "macos") {
        deno!("x86_64-apple-darwin")
    } else if cfg!(target_arch = "aarch64") {
        deno!("aarch64-unknown-linux-gnu")
    } else {
        deno!("x86_64-unknown-linux-gnu")
    };
    let pliki: &'static [(Narzedzie, &'static str)] =
        if cfg!(windows) { &[(Narzedzie::Deno, "deno.exe")] } else { &[(Narzedzie::Deno, "deno")] };
    Zrodlo { url, nazwa, url_sum, archiwum: Archiwum::Zip, pliki, licencja: "MIT", strona: "https://deno.com" }
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn e31_zrodla_tylko_https_i_suma_z_tego_samego_wydania() {
        let windows = cfg!(windows);
        for p in [Pakiet::Ffmpeg, Pakiet::FfmpegFull] {
            let z = zrodlo(p);
            assert_eq!(z.is_some(), windows);
            if let Some(z) = z {
                assert!(z.url.starts_with("https://") && z.url_sum.starts_with("https://"));
                assert_eq!(z.url_sum, format!("{}.sha256", z.url));
                assert!(z.url.ends_with(z.nazwa));
            }
        }
    }

    #[test]
    fn a1_ytdlp_i_deno_z_oficjalnych_wydan() {
        let y = zrodlo(Pakiet::Ytdlp).unwrap();
        assert!(y.url.starts_with("https://github.com/yt-dlp/yt-dlp/releases/latest/download/"));
        assert!(y.url.ends_with(y.nazwa));
        assert!(y.url_sum.ends_with("/SHA2-256SUMS"));
        assert_eq!(y.archiwum, Archiwum::Plik);
        let d = zrodlo(Pakiet::Deno).unwrap();
        assert!(d.url.starts_with("https://github.com/denoland/deno/releases/latest/download/deno-"));
        assert_eq!(d.url_sum, format!("{}.sha256sum", d.url));
        assert!(d.url.ends_with(d.nazwa));
    }
}
