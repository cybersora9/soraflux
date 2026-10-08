// Zrzuty GUI: build Vite + atrapa backendu (bez Tauri) → zrzuty/v1_2-*.png (PL) albo zrzuty/en/ (EN).
// Każdy z 6 motywów × jasny/ciemny na Konwertuj, plus Pobierz, Obrazy, Kolejka, Ustawienia → Wygląd.
// Użycie: npm run build && npm run zrzuty   (angielski: npm run zrzuty:en, czyli ZRZUTY_JEZYK=en)
import { preview } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";

const PRZEGLADARKA = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
const JEZYK = process.env.ZRZUTY_JEZYK ?? "pl";
const SLOWNIK = JSON.parse(readFileSync(`src/i18n/${JEZYK}.json`, "utf8"));
const WYJSCIE = JEZYK === "pl" ? "zrzuty" : `zrzuty/${JEZYK}`;
const PREFIKS = "v1_2";
const MOTYWY = ["sora-a", "sora-b", "sora-c", "jp-a", "jp-b", "jp-c"];
mkdirSync(WYJSCIE, { recursive: true });

const serwer = await preview({ preview: { port: 4174, strictPort: true }, logLevel: "warn" });
const adres = "http://localhost:4174/";
const przegladarka = await chromium.launch({ executablePath: PRZEGLADARKA });
let bledy = 0;

async function strona(motyw, parametry = "", jezyk = JEZYK) {
  const kontekst = await przegladarka.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, colorScheme: motyw });
  const s = await kontekst.newPage();
  s.on("pageerror", (e) => {
    bledy++;
    console.error("BŁĄD STRONY:", e.message);
  });
  await s.goto(`${adres}?motyw=${motyw}&jezyk=${jezyk}${parametry}`);
  await s.waitForSelector(".nawigacja-przycisk");
  await s.waitForTimeout(400);
  return s;
}

const zakladka = (s, z) => s.click(`[data-zakladka="${z}"]`);
const zdj = async (s, nazwa) => {
  // poczekaj na szacunek (atrapa ma opóźnienia jak prawdziwy ffprobe)
  await s.waitForFunction(() => [...document.querySelectorAll(".szacunek-wartosc")].every((e) => e.textContent !== "—" || !document.querySelector(".plik")), null, { timeout: 3000 }).catch(() => {});
  await s.waitForTimeout(500);
  await s.screenshot({ path: `${WYJSCIE}/${PREFIKS}-${nazwa}.png` });
  console.log(`${WYJSCIE}/${PREFIKS}-${nazwa}.png`);
};
const naGore = (s) => s.evaluate(() => document.querySelector(".tresc").scrollTo(0, 0));

// 6 motywów × jasny/ciemny na Konwertuj (dwa pliki, szybka akcja „Na telefon”)
for (const wyglad of MOTYWY) {
  for (const motyw of ["dark", "light"]) {
    const s = await strona(motyw, `&demo=1&wyglad=${wyglad}`);
    await s.click(".strefa");
    await s.waitForSelector(".plik");
    await s.click('[data-akcja="telefon"]');
    await zdj(s, `konwertuj-${wyglad}-${motyw === "dark" ? "ciemny" : "jasny"}`);
    await s.context().close();
  }
}

for (const motyw of ["dark", "light"]) {
  // Podgląd przed/po i zaawansowane (domyślny motyw)
  let s = await strona(motyw, "&demo=1");
  await s.click(".strefa");
  await s.waitForSelector(".plik");
  await s.click(".plik:nth-child(2) .plik-wybierz");
  await s.click(".podglad > summary");
  await s.waitForSelector(".porownanie-po", { timeout: 3000 }).catch(() => {});
  await s.evaluate(() => document.querySelector(".podglad").scrollIntoView({ block: "center" }));
  await zdj(s, `podglad-przed-po-${motyw}`);
  await naGore(s);
  await s.click('[data-akcja="gif"]');
  await zdj(s, `konwertuj-gif-${motyw}`);
  await s.context().close();

  // Pobierz: stary yt-dlp z pipa (ostrzeżenie o wieku) i po sprawdzeniu linku (atrapa, example.com)
  s = await strona(motyw, "&demo=1&ytdlp=stary");
  await zakladka(s, "pobierz");
  await s.fill(".pole-url", "https://example.com/watch?v=test01");
  await s.click(".przycisk-sprawdz");
  await s.waitForSelector(".film", { timeout: 3000 }).catch(() => {});
  await s.click('[data-akcja-pobierania="mp3"]');
  await s.waitForFunction(() => !document.querySelector(".dymek.widoczny"), null, { timeout: 5000 }).catch(() => {});
  await zdj(s, `pobierz-${motyw}`);

  // Obrazy
  await zakladka(s, "obrazy");
  await s.click(".widok-obrazy .strefa");
  await s.waitForSelector(".widok-obrazy .plik");
  await s.click(`.widok-obrazy >> text=${SLOWNIK["preset.webp_1600"]}`);
  await zdj(s, `obrazy-${motyw}`);

  // Kolejka (dane demo: w toku, błąd, gotowe z ostrzeżeniem o uciętym pliku)
  await zakladka(s, "kolejka");
  await s.evaluate(() => document.querySelector(".zadanie-ostrzezenie")?.scrollIntoView({ block: "end" }));
  await zdj(s, `kolejka-${motyw}`);

  // Ustawienia → Wygląd z edytorem własnego motywu
  await zakladka(s, "ustawienia");
  await s.click(`text=${SLOWNIK["motyw.nowy"]}`);
  await s.waitForSelector(".edytor-motywu");
  await s.evaluate(() => document.querySelector(".motywy").scrollIntoView({ block: "start" }));
  await zdj(s, `ustawienia-wyglad-${motyw}`);
  await s.context().close();

  // Kreator pierwszego uruchomienia
  s = await strona(motyw, "&kreator=1");
  await s.waitForSelector(".kreator", { timeout: 3000 }).catch(() => {});
  await zdj(s, `kreator-${motyw}`);
  await s.context().close();
}

// Angielski, jeden przykład obok polskich (pełny zestaw EN: npm run zrzuty:en)
if (JEZYK === "pl") {
  const s = await strona("dark", "&demo=1", "en");
  await s.click(".strefa");
  await s.waitForSelector(".plik");
  await zdj(s, "convert-en-dark");
}

await przegladarka.close();
await serwer.close();
if (bledy) {
  console.error(`Błędy strony: ${bledy}`);
  process.exit(1);
}
