// SoraFlux to program na Windows, nie strona. Otwarty w zwykłej przeglądarce (np. index.html z paczki
// „Source code” albo własny hosting) pokazałby atrapę z danymi przykładowymi, która wygląda jak zepsuta apka.
// Zamiast niej pokazujemy krótką informację z linkiem do instalatora. Atrapa zostaje dla testów i zrzutów (localhost).

export const LINK_INSTALATORA = "https://github.com/cybersora9/soraflux/releases/latest/download/SoraFlux-setup.exe";
export const LINK_WYDANIA = "https://github.com/cybersora9/soraflux/releases/latest";

export function czyPokazacInformacje(wTauri: boolean, host: string): boolean {
  if (wTauri) return false;
  return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}

const TEKSTY = {
  pl: {
    tytul: "SoraFlux to program na Windows, nie strona",
    opis: "Ta karta nie zadziała w przeglądarce. Pobierz instalator, uruchom go i otwórz SoraFlux z menu Start.",
    przycisk: "⬇ Pobierz SoraFlux dla Windows",
    inne: "Wszystkie pliki i sumy kontrolne",
  },
  en: {
    tytul: "SoraFlux is a Windows program, not a website",
    opis: "This page won't work in a browser. Download the installer, run it and open SoraFlux from the Start menu.",
    przycisk: "⬇ Download SoraFlux for Windows",
    inne: "All files and checksums",
  },
} as const;

export function pokazInformacje(cel: HTMLElement, jezyk: "pl" | "en"): void {
  const x = TEKSTY[jezyk];
  cel.replaceChildren();
  const ramka = document.createElement("main");
  ramka.style.cssText = "max-width:34rem;margin:12vh auto;padding:0 1.5rem;font:16px/1.5 system-ui,sans-serif;text-align:center";
  const h1 = document.createElement("h1");
  h1.textContent = x.tytul;
  h1.style.fontSize = "1.5rem";
  const p = document.createElement("p");
  p.textContent = x.opis;
  const a = document.createElement("a");
  a.href = LINK_INSTALATORA;
  a.textContent = x.przycisk;
  a.style.cssText = "display:inline-block;margin:1rem 0;padding:.8rem 1.4rem;border-radius:999px;background:#d1204f;color:#fff;font-weight:600;text-decoration:none";
  const b = document.createElement("a");
  b.href = LINK_WYDANIA;
  b.textContent = x.inne;
  b.style.cssText = "display:block;font-size:.9rem";
  ramka.append(h1, p, a, b);
  cel.append(ramka);
}
