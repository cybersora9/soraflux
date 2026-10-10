//! Wspólne tworzenie procesów potomnych i sprzątanie po nich.
//!
//! - Windows: bez okna konsoli (`CREATE_NO_WINDOW`), opcjonalnie niższy priorytet
//!   (`BELOW_NORMAL_PRIORITY_CLASS`), każde dziecko w Job Object z `KILL_ON_JOB_CLOSE`:
//!   zamknięcie apki (nawet awaryjne) zabija całe drzewo, anulowanie = `TerminateJobObject`.
//! - Unix: dziecko we własnej grupie procesów, anulowanie zabija całą grupę,
//!   niższy priorytet przez `setpriority` (nice 10).
//! - Argumenty zawsze jako lista (`OsStr`), nigdy przez powłokę.
//! - `PYTHONIOENCODING=utf-8`: yt-dlp (Python) pisze polskie tytuły bez krzaków.

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

pub fn komenda(program: impl AsRef<OsStr>) -> Command {
    komenda_z(program, false)
}

/// Komenda dla zadania: własna grupa procesów (Unix), flagi Windows.
pub fn komenda_z(program: impl AsRef<OsStr>, niski_priorytet: bool) -> Command {
    let mut k = Command::new(program);
    k.env("PYTHONIOENCODING", "utf-8").stdin(std::process::Stdio::null());
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

/// Pamięć RAM komputera w MiB: (całkowita, dostępna teraz). `None`, gdy system nie podał.
pub fn pamiec_ram() -> (Option<u64>, Option<u64>) {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/meminfo").map(|t| pamiec_z_meminfo(&t)).unwrap_or((None, None))
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        // SAFETY: struktura zainicjalizowana zerami z poprawnym dwLength, wskaźnik na lokalną zmienną.
        unsafe {
            let mut s: MEMORYSTATUSEX = std::mem::zeroed();
            s.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut s) == 0 {
                return (None, None);
            }
            (Some(s.ullTotalPhys / 1_048_576), Some(s.ullAvailPhys / 1_048_576))
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        (None, None)
    }
}

/// `/proc/meminfo` → (MemTotal, MemAvailable) w MiB.
pub fn pamiec_z_meminfo(t: &str) -> (Option<u64>, Option<u64>) {
    let pole = |nazwa: &str| {
        t.lines()
            .find_map(|l| l.strip_prefix(nazwa))
            .and_then(|r| r.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
            .map(|kb| kb / 1024)
    };
    (pole("MemTotal:"), pole("MemAvailable:"))
}

/// Czy szacowany wynik (z 10% zapasu i 50 MB rezerwy) zmieści się na dysku.
pub fn miejsce_wystarczy(potrzeba: u64, wolne: u64) -> bool {
    let z_zapasem = potrzeba.saturating_add(potrzeba / 10).saturating_add(50 * 1024 * 1024);
    z_zapasem <= wolne
}

#[cfg(test)]
mod testy {
    use super::*;

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

    #[test]
    fn pamiec_z_proc_meminfo() {
        let t = "MemTotal:       16318452 kB\nMemFree:  100 kB\nMemAvailable:    8159226 kB\n";
        assert_eq!(pamiec_z_meminfo(t), (Some(15935), Some(7967)));
        assert_eq!(pamiec_z_meminfo(""), (None, None));
        #[cfg(target_os = "linux")]
        assert!(pamiec_ram().0.is_some_and(|m| m > 0));
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
