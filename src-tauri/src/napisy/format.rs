//! Wynik whispera → kwestie → SRT, VTT i ASS (do wypalenia). Czyste funkcje.
//!
//! Zasady dla krótkich filmów: maks. 2 linie na kwestię, linia nie dłuższa niż limit znaków
//! (pionowe filmy krócej), podział długiego segmentu na kilka kwestii z czasem proporcjonalnym
//! do liczby znaków, kwestie się nie nakładają i nie wiszą dłużej niż [`MAKS_KWESTII_MS`].

use serde_json::Value;

/// Najwięcej linii w jednej kwestii.
pub const MAKS_LINII: usize = 2;
/// Najdłużej widoczna kwestia (ms): dłuższy segment to zwykle cisza w środku.
pub const MAKS_KWESTII_MS: u64 = 7000;

/// Segment mowy z whispera (czasy w ms od początku pliku).
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub od_ms: u64,
    pub do_ms: u64,
    pub tekst: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct WynikWhisper {
    /// Język z `result.language` (rozpoznany przy `-l auto`).
    pub jezyk: Option<String>,
    pub segmenty: Vec<Segment>,
}

/// Jedna kwestia napisów: 1–2 linie.
#[derive(Debug, Clone, PartialEq)]
pub struct Kwestia {
    pub od_ms: u64,
    pub do_ms: u64,
    pub linie: Vec<String>,
}

/// whisper-cli ucieka w JSON-ie tylko `"` i `\`: znak sterujący (np. tabulator) w tekście
/// psuje parser. Zamieniamy znaki sterujące wewnątrz napisów na spację.
pub fn oczysc_json(t: &str) -> String {
    let mut wynik = String::with_capacity(t.len());
    let (mut w_napisie, mut ucieczka) = (false, false);
    for c in t.chars() {
        if w_napisie {
            if ucieczka {
                ucieczka = false;
            } else if c == '\\' {
                ucieczka = true;
            } else if c == '"' {
                w_napisie = false;
            } else if c.is_control() {
                wynik.push(' ');
                continue;
            }
        } else if c == '"' {
            w_napisie = true;
        }
        wynik.push(c);
    }
    wynik
}

/// Czyta JSON z `whisper-cli -oj`. `przesuniecie_ms` = początek fragmentu w całym pliku.
pub fn czytaj_json(t: &str, przesuniecie_ms: u64) -> Result<WynikWhisper, String> {
    let v: Value = serde_json::from_str(&oczysc_json(t)).map_err(|e| e.to_string())?;
    let jezyk = v.pointer("/result/language").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    let mut segmenty = Vec::new();
    for s in v.get("transcription").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default() {
        let od = s.pointer("/offsets/from").and_then(Value::as_u64);
        let koniec = s.pointer("/offsets/to").and_then(Value::as_u64);
        let tekst = s.get("text").and_then(Value::as_str).unwrap_or_default();
        if let (Some(od), Some(koniec)) = (od, koniec) {
            segmenty.push(Segment {
                od_ms: od + przesuniecie_ms,
                do_ms: koniec + przesuniecie_ms,
                tekst: tekst.to_string(),
            });
        }
    }
    Ok(WynikWhisper { jezyk, segmenty })
}

/// Tekst segmentu bez znaczników whispera (`[BLANK_AUDIO]`, `[Muzyka]`, `♪`) i bez samych
/// opisów dźwięków w nawiasach (`(śmiech)`). Pusty wynik = brak mowy.
pub fn tekst_mowy(t: &str) -> String {
    let mut bez = String::with_capacity(t.len());
    let mut w_nawiasie = false;
    for c in t.chars() {
        match c {
            '[' => w_nawiasie = true,
            ']' if w_nawiasie => w_nawiasie = false,
            '♪' | '♫' => {}
            _ if !w_nawiasie => bez.push(c),
            _ => {}
        }
    }
    let slowa: Vec<&str> = bez.split_whitespace().collect();
    let tekst = slowa.join(" ");
    // sam opis dźwięku: „(muzyka)”, „(śmiech)”, „*brzęk*”
    let opis =
        |s: &str| (s.starts_with('(') && s.ends_with(')')) || (s.len() > 1 && s.starts_with('*') && s.ends_with('*'));
    if opis(&tekst) {
        return String::new();
    }
    tekst
}

/// Segmenty z mową (puste i bez czasu odrzucone), posortowane po czasie.
pub fn segmenty_mowy(segmenty: &[Segment]) -> Vec<Segment> {
    let mut wynik: Vec<Segment> = segmenty
        .iter()
        .filter(|s| s.do_ms > s.od_ms)
        .map(|s| Segment { tekst: tekst_mowy(&s.tekst), ..s.clone() })
        .filter(|s| !s.tekst.is_empty())
        .collect();
    wynik.sort_by_key(|s| s.od_ms);
    wynik
}

fn dl(s: &str) -> usize {
    s.chars().count()
}

/// Słowa, z twardym podziałem tych dłuższych niż `max` (np. długi link czytany przez lektora).
fn slowa(tekst: &str, max: usize) -> Vec<String> {
    let max = max.max(1);
    let mut wynik = Vec::new();
    for s in tekst.split_whitespace() {
        let znaki: Vec<char> = s.chars().collect();
        for kawalek in znaki.chunks(max) {
            wynik.push(kawalek.iter().collect());
        }
    }
    wynik
}

/// Zawijanie zachłanne: linie nie dłuższe niż `max` znaków.
pub fn zawijaj(tekst: &str, max: usize) -> Vec<String> {
    let mut linie: Vec<String> = Vec::new();
    let mut biezaca = String::new();
    for s in slowa(tekst, max) {
        if biezaca.is_empty() {
            biezaca = s;
        } else if dl(&biezaca) + 1 + dl(&s) <= max {
            biezaca.push(' ');
            biezaca.push_str(&s);
        } else {
            linie.push(std::mem::take(&mut biezaca));
            biezaca = s;
        }
    }
    if !biezaca.is_empty() {
        linie.push(biezaca);
    }
    linie
}

/// Jak [`zawijaj`], ale tekst mieszczący się w dwóch liniach dzielimy możliwie po równo
/// (dwie linie podobnej długości czyta się łatwiej niż długą i jedno słowo pod spodem).
pub fn zawijaj_rowno(tekst: &str, max: usize) -> Vec<String> {
    let zachlanne = zawijaj(tekst, max);
    if zachlanne.len() != 2 {
        return zachlanne;
    }
    let s = slowa(tekst, max);
    let mut najlepszy: Option<(usize, usize)> = None;
    for i in 1..s.len() {
        let (a, b) = (s[..i].join(" "), s[i..].join(" "));
        let (la, lb) = (dl(&a), dl(&b));
        if la > max || lb > max {
            continue;
        }
        let gorsza = la.max(lb);
        if najlepszy.is_none_or(|(_, g)| gorsza < g) {
            najlepszy = Some((i, gorsza));
        }
    }
    match najlepszy {
        Some((i, _)) => vec![s[..i].join(" "), s[i..].join(" ")],
        None => zachlanne,
    }
}

/// Segmenty → kwestie. Długi segment dzielimy na grupy słów mieszczące się w [`MAKS_LINII`]
/// liniach po `max_znakow`, a jego czas proporcjonalnie do liczby znaków.
pub fn kwestie(segmenty: &[Segment], max_znakow: usize) -> Vec<Kwestia> {
    let max_znakow = max_znakow.max(8);
    let mut wynik: Vec<Kwestia> = Vec::new();
    for seg in segmenty_mowy(segmenty) {
        let mut grupy: Vec<String> = Vec::new();
        let mut biezaca = String::new();
        for s in slowa(&seg.tekst, max_znakow) {
            let proba = if biezaca.is_empty() { s.clone() } else { format!("{biezaca} {s}") };
            if biezaca.is_empty() || zawijaj(&proba, max_znakow).len() <= MAKS_LINII {
                biezaca = proba;
            } else {
                grupy.push(std::mem::replace(&mut biezaca, s));
            }
        }
        if !biezaca.is_empty() {
            grupy.push(biezaca);
        }
        let suma: usize = grupy.iter().map(|g| dl(g)).sum::<usize>().max(1);
        let czas = seg.do_ms - seg.od_ms;
        let mut znaki_przed = 0usize;
        for g in grupy {
            let od = seg.od_ms + czas * znaki_przed as u64 / suma as u64;
            znaki_przed += dl(&g);
            let koniec = seg.od_ms + czas * znaki_przed as u64 / suma as u64;
            if koniec > od {
                wynik.push(Kwestia {
                    od_ms: od,
                    do_ms: koniec.min(od + MAKS_KWESTII_MS),
                    linie: zawijaj_rowno(&g, max_znakow),
                });
            }
        }
    }
    // bez nakładania: kwestia kończy się, zanim zacznie się następna
    for i in 1..wynik.len() {
        let nastepna = wynik[i].od_ms;
        if wynik[i - 1].do_ms > nastepna {
            wynik[i - 1].do_ms = nastepna;
        }
    }
    wynik.retain(|k| k.do_ms > k.od_ms);
    wynik
}

/// `HH:MM:SS,mmm` (SRT) albo `HH:MM:SS.mmm` (VTT).
pub fn czas(ms: u64, separator: char) -> String {
    let (h, m, s, r) = (ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
    format!("{h:02}:{m:02}:{s:02}{separator}{r:03}")
}

/// Tekst linii bez sekwencji, które psują format (strzałka czasu, puste linie).
fn linia_bezpieczna(l: &str) -> String {
    l.replace("-->", "->").replace(['\r', '\n'], " ")
}

pub fn do_srt(kwestie: &[Kwestia]) -> String {
    let mut s = String::new();
    for (i, k) in kwestie.iter().enumerate() {
        s.push_str(&format!("{}\n{} --> {}\n", i + 1, czas(k.od_ms, ','), czas(k.do_ms, ',')));
        for l in &k.linie {
            s.push_str(&linia_bezpieczna(l));
            s.push('\n');
        }
        s.push('\n');
    }
    s
}

pub fn do_vtt(kwestie: &[Kwestia]) -> String {
    let mut s = String::from("WEBVTT\n\n");
    for k in kwestie {
        s.push_str(&format!("{} --> {}\n", czas(k.od_ms, '.'), czas(k.do_ms, '.')));
        for l in &k.linie {
            // WebVTT: `&`, `<` i `>` jako encje (inaczej znaczniki kwestii)
            s.push_str(&linia_bezpieczna(l).replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;"));
            s.push('\n');
        }
        s.push('\n');
    }
    s
}

/// Parametry stylu ASS w pikselach obrazu.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParametryStylu {
    pub rozmiar: u32,
    pub pogrubienie: bool,
    pub obrys: u32,
    pub cien: u32,
    /// Wyrównanie ASS (klawiatura numeryczna): 2 = dół środek, 5 = środek.
    pub wyrownanie: u8,
    pub margines_poziomy: u32,
    pub margines_pionowy: u32,
    /// Maks. znaków w linii wynikający z szerokości obrazu i rozmiaru czcionki.
    pub max_znakow: usize,
}

/// Styl z wymiarów obrazu. Rozmiary liczone od krótszego boku, więc pionowy 1080×1920 i poziomy
/// 1920×1080 mają tę samą wielkość liter. Rolki: tekst nad dolnymi ~22% kadru, gdzie aplikacje
/// rysują opis i przyciski.
pub fn parametry_stylu(styl: super::StylNapisow, w: u32, h: u32) -> ParametryStylu {
    use super::StylNapisow::*;
    let (w, h) = (w.max(16), h.max(16));
    let krotszy = w.min(h) as f64;
    let pionowy = h > w;
    let (wsp_rozmiaru, wyrownanie, margines_pionowy) = match styl {
        Rolki => (0.075, 2, if pionowy { h as f64 * 0.22 } else { h as f64 * 0.08 }),
        Srodek => (0.085, 5, 0.0),
        Klasyczny => (0.055, 2, h as f64 * 0.06),
    };
    let rozmiar = (krotszy * wsp_rozmiaru).round().max(12.0);
    let pogrubienie = styl != Klasyczny;
    let obrys = (rozmiar * if pogrubienie { 0.09 } else { 0.06 }).round().max(1.0);
    let margines_poziomy = (w as f64 * 0.08).round();
    // średnia szerokość znaku pogrubionego kroju bezszeryfowego ≈ 0,55 wysokości czcionki
    let szerokosc_znaku = rozmiar * if pogrubienie { 0.58 } else { 0.52 };
    let max_znakow = ((w as f64 - 2.0 * margines_poziomy) / szerokosc_znaku).floor() as usize;
    ParametryStylu {
        rozmiar: rozmiar as u32,
        pogrubienie,
        obrys: obrys as u32,
        cien: if styl == Klasyczny { 1 } else { 0 },
        wyrownanie,
        margines_poziomy: margines_poziomy as u32,
        margines_pionowy: margines_pionowy.round() as u32,
        max_znakow: max_znakow.clamp(12, 42),
    }
}

/// `H:MM:SS.cc` (ASS liczy w setnych sekundy).
pub fn czas_ass(ms: u64) -> String {
    let cs = ms / 10;
    format!("{}:{:02}:{:02}.{:02}", cs / 360_000, cs / 6000 % 60, cs / 100 % 60, cs % 100)
}

/// Linia bez znaków sterujących ASS (`{…}` = znaczniki, `\` = sekwencje).
fn linia_ass(l: &str) -> String {
    linia_bezpieczna(l).replace('\\', "/").replace('{', "(").replace('}', ")")
}

/// Plik ASS z rozdzielczością skryptu równą obrazowi (rozmiary w prawdziwych pikselach).
/// Krój Arial: jest na każdym Windows; na Linux fontconfig podstawia podobny.
pub fn do_ass(kwestie: &[Kwestia], p: &ParametryStylu, w: u32, h: u32) -> String {
    let b = if p.pogrubienie { -1 } else { 0 };
    let mut s = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, \
         Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
         Style: Default,Arial,{},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,{b},0,0,0,100,100,0,0,1,{},{},{},{},{},{},1\n\n\
         [Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        p.rozmiar, p.obrys, p.cien, p.wyrownanie, p.margines_poziomy, p.margines_poziomy, p.margines_pionowy
    );
    for k in kwestie {
        let tekst: Vec<String> = k.linie.iter().map(|l| linia_ass(l)).collect();
        s.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            czas_ass(k.od_ms),
            czas_ass(k.do_ms),
            tekst.join("\\N")
        ));
    }
    s
}

#[cfg(test)]
mod testy {
    use super::*;
    use crate::napisy::StylNapisow;

    fn seg(od: u64, koniec: u64, t: &str) -> Segment {
        Segment { od_ms: od, do_ms: koniec, tekst: t.into() }
    }

    #[test]
    fn czyta_json_whispera_z_przesunieciem_i_tabulatorem() {
        let j = "{\n\t\"result\": {\n\t\t\"language\": \"pl\"\n\t},\n\t\"transcription\": [\n\t\t{\n\t\t\t\"timestamps\": {\"from\": \"00:00:00,000\", \"to\": \"00:00:02,500\"},\n\t\t\t\"offsets\": {\"from\": 0, \"to\": 2500},\n\t\t\t\"text\": \" Dzień\tdobry, \\\"cześć\\\"\"\n\t\t}\n\t]\n}\n";
        let w = czytaj_json(j, 600_000).unwrap();
        assert_eq!(w.jezyk.as_deref(), Some("pl"));
        assert_eq!(w.segmenty, vec![seg(600_000, 602_500, " Dzień dobry, \"cześć\"")]);
        assert!(czytaj_json("nie json", 0).is_err());
        assert_eq!(czytaj_json("{}", 0).unwrap(), WynikWhisper::default());
    }

    #[test]
    fn cisza_i_znaczniki_to_nie_mowa() {
        assert_eq!(tekst_mowy(" [BLANK_AUDIO]"), "");
        assert_eq!(tekst_mowy("[ Silence ]"), "");
        assert_eq!(tekst_mowy("♪ ♪"), "");
        assert_eq!(tekst_mowy(" (muzyka)"), "");
        assert_eq!(tekst_mowy("*music*"), "");
        assert_eq!(tekst_mowy(" [Muzyka] No to   zaczynamy"), "No to zaczynamy");
        assert_eq!(tekst_mowy("(śmiech) dobra"), "(śmiech) dobra");
        let s = segmenty_mowy(&[
            seg(5000, 6000, "b"),
            seg(0, 1000, "[BLANK_AUDIO]"),
            seg(2000, 2000, "x"),
            seg(1000, 2000, "a"),
        ]);
        assert_eq!(s, vec![seg(1000, 2000, "a"), seg(5000, 6000, "b")]);
    }

    #[test]
    fn zawijanie_po_znakach_unicode() {
        assert_eq!(zawijaj("zażółć gęślą jaźń", 12), vec!["zażółć gęślą", "jaźń"]);
        assert_eq!(zawijaj("a", 10), vec!["a"]);
        assert_eq!(zawijaj("", 10), Vec::<String>::new());
        // za długie słowo dzielone twardo
        assert_eq!(zawijaj("abcdefghij", 4), vec!["abcd", "efgh", "ij"]);
        // równe linie zamiast długiej i krótkiej
        assert_eq!(zawijaj_rowno("to jest dość długie zdanie x", 24), vec!["to jest dość", "długie zdanie x"]);
        for l in zawijaj_rowno("to jest dość długie zdanie x", 24) {
            assert!(l.chars().count() <= 24);
        }
    }

    #[test]
    fn dlugi_segment_dzielony_na_kwestie_max_2_linie() {
        let tekst = "raz dwa trzy cztery pięć sześć siedem osiem dziewięć dziesięć jedenaście dwanaście";
        let k = kwestie(&[seg(1000, 9000, tekst)], 16);
        assert!(k.len() >= 2, "{k:?}");
        for x in &k {
            assert!(x.linie.len() <= MAKS_LINII, "{x:?}");
            assert!(x.linie.iter().all(|l| l.chars().count() <= 16), "{x:?}");
            assert!(x.do_ms > x.od_ms);
        }
        assert_eq!(k[0].od_ms, 1000);
        assert_eq!(k.last().map(|x| x.do_ms), Some(9000));
        // ciągłość: następna zaczyna się tam, gdzie kończy poprzednia
        for p in k.windows(2) {
            assert_eq!(p[0].do_ms, p[1].od_ms);
        }
        let razem: Vec<String> = k.iter().flat_map(|x| x.linie.clone()).collect();
        assert_eq!(razem.join(" "), tekst, "żadne słowo nie ginie");
    }

    #[test]
    fn kwestie_bez_nakladania_i_nie_za_dlugie() {
        let k = kwestie(&[seg(0, 3000, "pierwsza"), seg(2500, 4000, "druga"), seg(10_000, 30_000, "trzecia")], 42);
        assert_eq!(k[0].do_ms, 2500);
        assert_eq!(k[2].do_ms, 10_000 + MAKS_KWESTII_MS);
        assert!(kwestie(&[seg(0, 1000, "[BLANK_AUDIO]")], 42).is_empty());
    }

    #[test]
    fn srt_i_vtt() {
        let k = vec![
            Kwestia { od_ms: 1500, do_ms: 3_723_004, linie: vec!["A --> B".into(), "<i>&".into()] },
            Kwestia { od_ms: 3_800_000, do_ms: 3_801_000, linie: vec!["dwa".into()] },
        ];
        assert_eq!(
            do_srt(&k),
            "1\n00:00:01,500 --> 01:02:03,004\nA -> B\n<i>&\n\n2\n01:03:20,000 --> 01:03:21,000\ndwa\n\n"
        );
        assert_eq!(
            do_vtt(&k),
            "WEBVTT\n\n00:00:01.500 --> 01:02:03.004\nA -&gt; B\n&lt;i&gt;&amp;\n\n01:03:20.000 --> 01:03:21.000\ndwa\n\n"
        );
        assert_eq!(czas(0, ','), "00:00:00,000");
        assert_eq!(czas(100 * 3_600_000, '.'), "100:00:00.000");
    }

    #[test]
    fn style_rolek_i_ass() {
        let pion = parametry_stylu(StylNapisow::Rolki, 1080, 1920);
        let poziom = parametry_stylu(StylNapisow::Rolki, 1920, 1080);
        assert_eq!(pion.rozmiar, poziom.rozmiar, "ta sama wielkość liter od krótszego boku");
        assert!(pion.pogrubienie && pion.obrys >= 4);
        assert!(pion.margines_pionowy >= 1920 / 5, "nad strefą przycisków: {pion:?}");
        assert!(pion.max_znakow < poziom.max_znakow);
        assert!((12..=24).contains(&pion.max_znakow), "{pion:?}");
        let srodek = parametry_stylu(StylNapisow::Srodek, 1080, 1920);
        assert_eq!(srodek.wyrownanie, 5);
        let klas = parametry_stylu(StylNapisow::Klasyczny, 1920, 1080);
        assert!(!klas.pogrubienie && klas.rozmiar < poziom.rozmiar && klas.max_znakow == 42);
        let maly = parametry_stylu(StylNapisow::Rolki, 0, 0);
        assert!(maly.rozmiar >= 12 && maly.max_znakow >= 12);

        assert_eq!(czas_ass(3_723_456), "1:02:03.45");
        let ass =
            do_ass(&[Kwestia { od_ms: 0, do_ms: 1000, linie: vec!["{\\b1}a".into(), "b".into()] }], &pion, 1080, 1920);
        assert!(ass.contains("PlayResX: 1080\nPlayResY: 1920"));
        assert!(ass.contains(&format!("Style: Default,Arial,{},", pion.rozmiar)));
        assert!(ass.ends_with("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,(/b1)a\\Nb\n"), "{ass}");
    }
}
