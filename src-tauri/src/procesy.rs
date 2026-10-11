//! Wspólne tworzenie procesów potomnych i sprzątanie po nich.
//!
//! - Windows: bez okna konsoli (`CREATE_NO_WINDOW`), opcjonalnie niższy priorytet
//!   (`BELOW_NORMAL_PRIORITY_CLASS`), każde dziecko w Job Object z `KILL_ON_JOB_CLOSE`:
//!   zamknięcie apki (nawet awaryjne) zabija całe drzewo, anulowanie = `TerminateJobObject`.
//! - Unix: dziecko we własnej grupie procesów, anulowanie zabija całą grupę,
//!   niższy priorytet przez `setpriority` (nice 10).
//! - Argumenty zawsze jako lista (`OsStr`), nigdy przez powłokę.
//! - `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`: yt-dlp (Python) pisze polskie tytuły i komunikaty
//!   systemu bez krzaków; wyjście i tak czytamy przez [`dekoduj`] (UTF-8, a gdy nie, strona kodowa konsoli).

use std::ffi::OsStr;
use std::path::Path;
use tokio::process::Command;

/// `CREATE_NO_WINDOW`: ffmpeg bez migającego okna konsoli.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// `BELOW_NORMAL_PRIORITY_CLASS`: opcja „nie zamulaj komputera”.
pub const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
/// Wartość nice dla niskiego priorytetu na Unix.
pub const NICE_NISKI: i32 = 10;

/// Flagi tworzenia procesu na Windows (czysta funkcja, testowalna na każdym systemie).
pub fn flagi_tworzenia(niski_priorytet: bool) -> u32 {
    CREATE_NO_WINDOW | if niski_priorytet { BELOW_NORMAL_PRIORITY_CLASS } else { 0 }
}

/// Zmienne środowiska wymuszające UTF-8 w Pythonie (yt-dlp). P5 z testu 1.4.0: „[WinError 10061] Nie mona
/// nawiza poczenia” (polskie litery zgubione przez stronę kodową konsoli Windows).
pub const SRODOWISKO_UTF8: [(&str, &str); 2] = [("PYTHONIOENCODING", "utf-8"), ("PYTHONUTF8", "1")];

pub fn komenda(program: impl AsRef<OsStr>) -> Command {
    komenda_z(program, false)
}

/// Komenda dla zadania: własna grupa procesów (Unix), flagi Windows.
pub fn komenda_z(program: impl AsRef<OsStr>, niski_priorytet: bool) -> Command {
    let mut k = Command::new(program);
    k.envs(SRODOWISKO_UTF8).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    k.creation_flags(flagi_tworzenia(niski_priorytet));
    #[cfg(unix)]
    {
        let _ = niski_priorytet;
        k.process_group(0);
    }
    k
}

/// Wersja synchroniczna (wykrywanie narzędzi przy starcie).
pub fn komenda_sync(program: impl AsRef<OsStr>) -> std::process::Command {
    let mut k = std::process::Command::new(program);
    k.env("PYTHONIOENCODING", "utf-8").stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        k.creation_flags(CREATE_NO_WINDOW);
    }
    k
}

/// Uchwyt drzewa procesów jednego zadania.
pub struct Drzewo {
    pid: Option<u32>,
    #[cfg(windows)]
    zadanie: Option<windows::Job>,
}

impl Drzewo {
    /// Po `spawn`: przypina dziecko do Job Object (Windows) i ustawia priorytet (Unix).
    pub fn przypnij(dziecko: &tokio::process::Child, niski_priorytet: bool) -> Drzewo {
        let pid = dziecko.id();
        #[cfg(unix)]
        if let (Some(p), true) = (pid, niski_priorytet) {
            // SAFETY: setpriority na pid naszego dziecka, bez wskaźników.
            unsafe {
                libc::setpriority(libc::PRIO_PROCESS, p as libc::id_t, NICE_NISKI);
            }
        }
        #[cfg(not(unix))]
        let _ = niski_priorytet;
        Drzewo {
            pid,
            #[cfg(windows)]
            zadanie: dziecko.raw_handle().and_then(windows::Job::dla_procesu),
        }
    }

    /// Zabija całe drzewo (ffmpeg i ewentualnych potomków).
    pub fn zabij(&self) {
        #[cfg(windows)]
        if let Some(j) = &self.zadanie {
            j.zakoncz();
        }
        #[cfg(unix)]
        if let Some(p) = self.pid {
            // SAFETY: sygnał do grupy procesów, którą sami utworzyliśmy (process_group(0)).
            unsafe {
                libc::kill(-(p as libc::pid_t), libc::SIGKILL);
            }
        }
        let _ = self.pid;
    }
}

#[cfg(windows)]
mod windows {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Job Object z KILL_ON_JOB_CLOSE: zamknięcie uchwytu (także przy awarii apki) zabija drzewo.
    pub struct Job(HANDLE);

    // SAFETY: uchwyt jądra można używać z dowolnego wątku.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn dla_procesu(proces: std::os::windows::io::RawHandle) -> Option<Job> {
            // SAFETY: wywołania WinAPI z poprawnymi argumentami; uchwyt zamykany w Drop.
            unsafe {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    h,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 || AssignProcessToJobObject(h, proces as HANDLE) == 0 {
                    CloseHandle(h);
                    return None;
                }
                Some(Job(h))
            }
        }

        pub fn zakoncz(&self) {
            // SAFETY: uchwyt jest ważny do Drop.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: zamykamy własny uchwyt raz.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

/// Wolne miejsce na dysku, na którym leży `katalog` (bajty).
pub fn wolne_miejsce(katalog: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let c = std::ffi::CString::new(katalog.as_os_str().as_bytes()).ok()?;
        // SAFETY: statvfs wypełnia strukturę zainicjalizowaną zerami; ścieżka zakończona zerem.
        unsafe {
            let mut s: libc::statvfs = std::mem::zeroed();
            if libc::statvfs(c.as_ptr(), &mut s) != 0 {
                return None;
            }
            Some(s.f_bavail as u64 * s.f_frsize as u64)
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let w: Vec<u16> = katalog.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut wolne: u64 = 0;
        // SAFETY: ścieżka zakończona zerem, wskaźnik na lokalną zmienną.
        let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut wolne, std::ptr::null_mut(), std::ptr::null_mut()) };
        (ok != 0).then_some(wolne)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = katalog;
        None
    }
}

/// Czy szacowany wynik (z 10% zapasu i 50 MB rezerwy) zmieści się na dysku.
pub fn miejsce_wystarczy(potrzeba: u64, wolne: u64) -> bool {
    let z_zapasem = potrzeba.saturating_add(potrzeba / 10).saturating_add(50 * 1024 * 1024);
    z_zapasem <= wolne
}

// ---------- dekodowanie wyjścia programów ----------

/// Bajty 0x80–0xFF w Windows-1250 (strona ANSI polskiego Windows).
const CP1250: &str = "€\u{fffd}‚\u{fffd}„…†‡\u{fffd}‰Š‹ŚŤŽŹ\u{fffd}‘’“”•–—\u{fffd}™š›śťžź\u{a0}ˇ˘Ł¤Ą¦§¨©Ş«¬\u{ad}®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙";
/// Bajty 0x80–0xFF w CP852 (strona OEM polskiej konsoli `cmd`).
const CP852: &str = "ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´\u{ad}˝˛ˇ˘§÷¸°¨˙űŘř■\u{a0}";

fn ze_strony(b: &[u8], strona: &str) -> String {
    let tabela: Vec<char> = strona.chars().collect();
    b.iter().map(|&x| if x < 0x80 { x as char } else { tabela[(x - 0x80) as usize] }).collect()
}

/// Ocena, czy tekst wygląda na polski: litery z ogonkami na plus, ramki konsoli i � na minus.
fn ocena(s: &str) -> i64 {
    s.chars()
        .map(|c| match c {
            'ą' | 'ć' | 'ę' | 'ł' | 'ń' | 'ó' | 'ś' | 'ź' | 'ż' | 'Ą' | 'Ć' | 'Ę' | 'Ł' | 'Ń' | 'Ó' | 'Ś' | 'Ź'
            | 'Ż' => 2,
            '\u{2500}'..='\u{259f}' | '\u{fffd}' => -3,
            c if c.is_control() && !c.is_whitespace() => -3,
            _ => 0,
        })
        .sum()
}

/// Wyjście programu jako tekst: UTF-8, a gdy to nie UTF-8 (stary yt-dlp, komunikat systemu w stronie
/// kodowej konsoli), lepsza z CP1250/CP852 albo UTF-8 ze znakami zastępczymi. Nigdy nie gubi całej linii.
pub fn dekoduj(b: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(b) {
        return s.to_string();
    }
    let kandydaci = [String::from_utf8_lossy(b).into_owned(), ze_strony(b, CP1250), ze_strony(b, CP852)];
    kandydaci.into_iter().max_by_key(|s| ocena(s)).unwrap_or_default()
}

/// Linie z potoku (stdout/stderr) bez założenia, że to poprawny UTF-8: `Lines` z tokio przerywa czytanie
/// na pierwszym złym bajcie i gubi resztę (np. ogon błędu yt-dlp). Bufor w strukturze = bezpieczne w `select!`.
pub struct LinieBajtow<R> {
    czytnik: tokio::io::BufReader<R>,
    bufor: Vec<u8>,
}

impl<R: tokio::io::AsyncRead + Unpin> LinieBajtow<R> {
    pub fn nowe(r: R) -> Self {
        LinieBajtow { czytnik: tokio::io::BufReader::new(r), bufor: Vec::new() }
    }

    /// Następna linia (bez `\n` i `\r`), `None` na końcu strumienia.
    pub async fn nastepna(&mut self) -> std::io::Result<Option<String>> {
        use tokio::io::AsyncBufReadExt;
        let n = self.czytnik.read_until(b'\n', &mut self.bufor).await?;
        if n == 0 && self.bufor.is_empty() {
            return Ok(None);
        }
        let mut linia = std::mem::take(&mut self.bufor);
        while matches!(linia.last(), Some(b'\n' | b'\r')) {
            linia.pop();
        }
        Ok(Some(dekoduj(&linia)))
    }
}

#[cfg(test)]
mod testy {
    use super::*;

    /// P5: komunikat Windows „Nie można nawiązać połączenia…” w trzech kodowaniach, w jakich może przyjść.
    #[test]
    fn p5_dekodowanie_utf8_cp1250_cp852() {
        let zdanie = "Nie można nawiązać połączenia, ponieważ komputer docelowy aktywnie go odmawia";
        assert_eq!(CP1250.chars().count(), 128);
        assert_eq!(CP852.chars().count(), 128);
        let utf8 = zdanie.as_bytes().to_vec();
        // bajty z `"...".encode("cp1250")` / `"cp852"` w Pythonie
        let cp1250: Vec<u8> = zdanie
            .chars()
            .map(|c| match c {
                'ż' => 0xbf,
                'ą' => 0xb9,
                'ć' => 0xe6,
                'ł' => 0xb3,
                c => c as u8,
            })
            .collect();
        let cp852: Vec<u8> = zdanie
            .chars()
            .map(|c| match c {
                'ż' => 0xbe,
                'ą' => 0xa5,
                'ć' => 0x86,
                'ł' => 0x88,
                c => c as u8,
            })
            .collect();
        assert!(std::str::from_utf8(&cp1250).is_err() && std::str::from_utf8(&cp852).is_err());
        for (nazwa, b) in [("utf-8", utf8), ("cp1250", cp1250), ("cp852", cp852)] {
            assert_eq!(dekoduj(&b), zdanie, "{nazwa}");
        }
        // UTF-8 z jednym złym bajtem: polskie litery zostają, zły bajt = znak zastępczy
        let mut zepsuty = "[WinError 10061] Nie można nawiązać połączenia".as_bytes().to_vec();
        zepsuty.push(0xff);
        let d = dekoduj(&zepsuty);
        assert!(d.starts_with("[WinError 10061] Nie można nawiązać połączenia"), "{d}");
        // ASCII bez zmian
        assert_eq!(dekoduj(b"ERROR: [generic] x: HTTP Error 404"), "ERROR: [generic] x: HTTP Error 404");
    }

    #[tokio::test]
    async fn p5_linie_bajtow_nie_gubia_reszty_po_zlym_bajcie() {
        let dane: &[u8] = b"pierwsza\r\nNie mo\xbfna nawi\xb9za\xe6\nERROR: ostatnia";
        let mut l = LinieBajtow::nowe(dane);
        assert_eq!(l.nastepna().await.unwrap().as_deref(), Some("pierwsza"));
        assert_eq!(l.nastepna().await.unwrap().as_deref(), Some("Nie można nawiązać"));
        assert_eq!(l.nastepna().await.unwrap().as_deref(), Some("ERROR: ostatnia"));
        assert_eq!(l.nastepna().await.unwrap(), None);
    }

    #[test]
    fn p5_python_w_utf8() {
        let k = komenda("yt-dlp");
        let env: Vec<_> = k.as_std().get_envs().map(|(a, b)| (a.to_owned(), b.map(|b| b.to_owned()))).collect();
        for (n, w) in SRODOWISKO_UTF8 {
            assert!(env.contains(&(n.into(), Some(w.into()))), "{n}={w}: {env:?}");
        }
    }

    #[test]
    fn d23_flagi_windows() {
        assert_eq!(flagi_tworzenia(false), 0x0800_0000);
        assert_eq!(flagi_tworzenia(true), 0x0800_4000);
    }

    #[test]
    fn d26_miejsce() {
        assert!(miejsce_wystarczy(100 * 1024 * 1024, 1024 * 1024 * 1024));
        assert!(!miejsce_wystarczy(1000 * 1024 * 1024, 1024 * 1024 * 1024));
        assert!(!miejsce_wystarczy(u64::MAX, u64::MAX - 1));
        let w = wolne_miejsce(&std::env::temp_dir());
        assert!(w.is_some_and(|w| w > 0), "{w:?}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn d24_d27_grupa_niski_priorytet_i_zabicie_drzewa() {
        // sh odpala sleep jako wnuka: zabicie musi objąć oba
        let mut d = komenda_z("sh", true)
            .args(["-c", "sleep 30 & echo $!; wait"])
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let drzewo = Drzewo::przypnij(&d, true);
        let pid = d.id().unwrap();
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
        let nice: i32 = stat.rsplit(')').next().unwrap().split_whitespace().nth(16).unwrap().parse().unwrap();
        assert_eq!(nice, NICE_NISKI, "priorytet");
        use tokio::io::AsyncBufReadExt;
        let mut l = tokio::io::BufReader::new(d.stdout.take().unwrap()).lines();
        let wnuk: u32 = l.next_line().await.unwrap().unwrap().trim().parse().unwrap();
        drzewo.zabij();
        let _ = d.wait().await;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let zyje = std::fs::read_to_string(format!("/proc/{wnuk}/stat")).map(|s| !s.contains(") Z ")).unwrap_or(false);
        assert!(!zyje, "wnuk {wnuk} przeżył zabicie drzewa");
    }
}
