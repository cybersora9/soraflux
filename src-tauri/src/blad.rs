//! Komunikaty błędów dla GUI w dwóch językach. Rust nie zna języka interfejsu, więc zamiast
//! gotowego zdania wysyła klucz i parametry, a front tłumaczy (`tlumaczBlad` w `src/i18n`,
//! klucze `rust.*` w `pl.json` / `en.json`).
//!
//! Format: pierwsza linia `@i18n {"k":"klucz","a":{"nazwa":"wartość"}}`, potem opcjonalnie
//! `\n\n` i surowy ogon (stderr ffmpeg/yt-dlp do raportu), którego się nie tłumaczy.

use serde_json::{json, Map, Value};

pub const ZNACZNIK: &str = "@i18n ";

/// Komunikat z kluczem `rust.<klucz>` i parametrami `{nazwa}`.
pub fn kod(klucz: &str, parametry: &[(&str, &dyn std::fmt::Display)]) -> String {
    let a: Map<String, Value> =
        parametry.iter().map(|(n, w)| ((*n).to_string(), Value::String(w.to_string()))).collect();
    format!("{ZNACZNIK}{}", json!({ "k": klucz, "a": a }))
}

/// Jak [`kod`], z surowym ogonem pod spodem (pusty ogon = bez ogona).
pub fn z_ogonem(klucz: &str, parametry: &[(&str, &dyn std::fmt::Display)], ogon: &str) -> String {
    let k = kod(klucz, parametry);
    let ogon = ogon.trim();
    if ogon.is_empty() {
        k
    } else {
        format!("{k}\n\n{ogon}")
    }
}

/// Klucz z komunikatu (do testów i dziennika); `None` dla zwykłego tekstu.
pub fn klucz(komunikat: &str) -> Option<String> {
    let linia = komunikat.lines().next()?.strip_prefix(ZNACZNIK)?;
    let v: Value = serde_json::from_str(linia).ok()?;
    v.get("k")?.as_str().map(str::to_string)
}

/// Parametr `nazwa` z komunikatu (do testów).
pub fn parametr(komunikat: &str, nazwa: &str) -> Option<String> {
    let linia = komunikat.lines().next()?.strip_prefix(ZNACZNIK)?;
    let v: Value = serde_json::from_str(linia).ok()?;
    v.get("a")?.get(nazwa)?.as_str().map(str::to_string)
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn klucz_parametry_i_ogon() {
        let k = z_ogonem("folder_zapisu", &[("folder", &"C:\\zażółć \"x\"\n|y"), ("blad", &5)], "  ERROR: surowy\n");
        assert_eq!(klucz(&k).as_deref(), Some("folder_zapisu"));
        assert_eq!(parametr(&k, "folder").as_deref(), Some("C:\\zażółć \"x\"\n|y"));
        assert_eq!(parametr(&k, "blad").as_deref(), Some("5"));
        assert!(k.ends_with("\n\nERROR: surowy"));
        assert_eq!(k.lines().count(), 3, "JSON w jednej linii mimo \\n w parametrze");
        assert_eq!(z_ogonem("x", &[], " "), kod("x", &[]));
        assert_eq!(klucz("zwykły tekst"), None);
    }
}
