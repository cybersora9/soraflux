// GUI 2.0: zrzuty z trybu atrapy (src/atrapa.ts) i kontrola „tekst nigdy poza ramką”.
// Ekrany Taśma, Z linku, Porównaj, Narzędzia, Gotowe, Ustawienia (+ Prosty) × szerokość 1280/1024/800
// × jasny/ciemny × skala 100/125% → docs/zrzuty/gui2/<ekran>-<szer>-<tryb>-<skala>.png.
// Kontrola na każdym zrzucie: brak poziomego przewijania strony, żaden tekst nie wystaje poza swój element
// (chyba że kończy się wielokropkiem, wtedy pełny tekst musi być w `title`), nic nie wychodzi poza okno,
// żadne słowo nie łamie się w środku (etykieta ściśnięta do ~1 znaku: „W / yn / ik”, test na żywo 1.4.2).
// Taśma w trybie ciemnym idzie bez karty graficznej (atrapa `karta=0`: pigułka „nie wykryto, koduje procesor”).
// Użycie: npm run build && node scripts/gui2.mjs   (kod wyjścia 1 = coś wystaje)
//         GUI2_EKRANY=tasma,porownaj GUI2_BEZ_ZRZUTOW=1 node scripts/gui2.mjs   (tylko wybrane ekrany, bez zapisu)
import { preview } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const PRZEGLADARKA = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
const WYJSCIE = "docs/zrzuty/gui2";
const ZRZUTY = process.env.GUI2_BEZ_ZRZUTOW !== "1";
mkdirSync(WYJSCIE, { recursive: true });

const ROZMIARY = [[1280, 800], [1024, 720], [800, 600]];
const EKRANY = ["tasma", "link", "porownaj", "narzedzia", "gotowe", "ustawienia", "prosty"].filter(
  (e) => !process.env.GUI2_EKRANY || process.env.GUI2_EKRANY.split(",").includes(e),
);
const PLIKI = [
  "C:/Wideo/wakacje-2026-pelne-nagranie-z-drona-i-telefonu-wersja-ostateczna-NAPRAWDE-ostateczna-v7.mp4",
  "C:/Wideo/telefon-pion-hdr.mov",
  "C:/Muzyka/podcast-odc-14.wav",
  "C:/Wideo/maly-klip.mp4",
  "C:/Wideo/bez-dzwieku.mp4",
];

const serwer = await preview({ preview: { port: 4178, strictPort: true }, logLevel: "warn" });
const przegladarka = await chromium.launch({ executablePath: PRZEGLADARKA });
let bledy = 0;
let zrzutow = 0;

/** Elementy, z których tekst wystaje (bez wielokropka) albo z wielokropkiem bez pełnego tekstu w `title`. */
const kontrola = () => {
  const problemy = [];
  const opis = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""} „${(e.textContent ?? "").trim().slice(0, 40)}”`;
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) problemy.push(`poziome przewijanie strony (${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth})`);
  const okno = document.querySelector("#app").getBoundingClientRect();
  for (const e of document.querySelectorAll("#app *")) {
    if (!(e instanceof HTMLElement) || e.closest(".paleta-tlo, .dymek, .nakladka-upuszczania, svg")) continue;
    const st = getComputedStyle(e);
    if (st.display === "none" || st.visibility === "hidden" || e.offsetParent === null) continue;
    const tekst = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!tekst) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // przewijane kontenery (lista, panel) mogą mieć treść poza widokiem: sprawdzamy tylko poziomo
    if (r.right > okno.right + 1 || r.left < okno.left - 1) problemy.push(`poza oknem: ${opis(e)}`);
    // słowo (ciąg liter/cyfr) łamane w środku = więcej niż jedna linia dla jednego słowa
    // (podgląd komendy ffmpeg w pre/code łamie się celowo)
    for (const n of e.closest("pre, code") ? [] : e.childNodes) {
      if (n.nodeType !== 3) continue;
      for (const m of n.textContent.matchAll(/[\p{L}\p{N}]{2,24}/gu)) {
        const zakres = document.createRange();
        zakres.setStart(n, m.index);
        zakres.setEnd(n, m.index + m[0].length);
        const linie = new Set([...zakres.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (linie.size > 1) problemy.push(`słowo łamane w środku („${m[0]}”, ${linie.size} linie): ${opis(e)}`);
      }
    }
    const wystaje = e.scrollWidth > e.clientWidth + 1 && st.overflowX !== "auto" && st.overflowX !== "scroll";
    if (!wystaje || ["INPUT", "SELECT", "TEXTAREA", "OPTION", "PRE", "CODE"].includes(e.tagName)) continue;
    if (st.textOverflow === "ellipsis" && st.overflowX === "hidden") {
      const pelny = e.closest("[title]")?.getAttribute("title") ?? e.getAttribute("aria-label");
      if (!pelny) problemy.push(`wielokropek bez title: ${opis(e)}`);
    } else if (st.overflowX === "hidden" || st.overflowX === "clip") {
      problemy.push(`ucięty tekst (bez wielokropka): ${opis(e)}`);
    } else problemy.push(`tekst wystaje: ${opis(e)}`);
  }
  return [...new Set(problemy)];
};

async function zrob(ekran, [w, h], motyw, skala) {
  const nazwa = `${ekran}-${w}-${motyw === "dark" ? "ciemny" : "jasny"}-${Math.round(skala * 100)}`;
  const kontekst = await przegladarka.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: motyw });
  const s = await kontekst.newPage();
  s.on("pageerror", (e) => {
    bledy++;
    console.error(`BŁĄD STRONY (${nazwa}):`, e.message);
  });
  const tryb = ekran === "prosty" ? "prosty" : "pelny";
  const karta = ekran === "tasma" && motyw === "dark" ? "&karta=0" : "";
  await s.goto(`http://localhost:4178/?demo=1&tryb=${tryb}&jezyk=pl&motyw=${motyw}&skala=${skala}${karta}`);
  await s.waitForSelector(".szyna [data-zakladka]");
  await s.waitForTimeout(300);
  if (ekran === "tasma" || ekran === "narzedzia") {
    await s.evaluate((p) => window.__dodajDoKonwertuj(p), PLIKI);
    await s.waitForSelector(".poz");
    await s.waitForTimeout(1200);
  }
  if (ekran === "prosty") {
    await s.evaluate((p) => window.__dodajDoKonwertuj(p), [PLIKI[0]]);
    await s.waitForTimeout(1000);
  }
  if (ekran !== "tasma" && ekran !== "prosty") await s.evaluate((z) => window.__zakladka(z), ekran);
  if (ekran === "link") {
    await s.fill('[data-fokus="url"]', "https://example.com/watch?v=test01");
    await s.press('[data-fokus="url"]', "Enter");
    await s.waitForSelector(".podgl-link", { timeout: 3000 }).catch(() => {});
    await s.evaluate(() => {
      const [od, doo] = document.querySelectorAll(".os-suwaki input");
      for (const [el, v] of [[od, 40], [doo, 71]]) {
        el.value = String(v);
        el.dispatchEvent(new Event("input"));
        el.dispatchEvent(new Event("change"));
      }
    });
  }
  if (ekran === "porownaj") {
    await s.waitForTimeout(300);
    const pil = s.locator('.pil:has-text("wakacje-2026")');
    if (await pil.count()) await pil.first().click();
    await s.waitForSelector(".ab img", { timeout: 3000 }).catch(() => {});
  }
  if (ekran === "narzedzia") {
    await s.click('[data-narzedzie="kadr"]');
    await s.click('.panel2c .seg button[data-wartosc="9:16"]').catch(() => {});
  }
  await s.waitForTimeout(900);
  const problemy = await s.evaluate(kontrola);
  for (const p of problemy) {
    console.log(`BŁĄD ${nazwa}: ${p}`);
    bledy++;
  }
  if (ZRZUTY) {
    await s.screenshot({ path: `${WYJSCIE}/${nazwa}.png` });
    zrzutow++;
  }
  if (!problemy.length) console.log(`ok   ${nazwa}`);
  await kontekst.close();
}

for (const ekran of EKRANY) {
  for (const rozmiar of ROZMIARY) {
    for (const motyw of ["light", "dark"]) {
      for (const skala of [1, 1.25]) await zrob(ekran, rozmiar, motyw, skala);
    }
  }
}

await przegladarka.close();
await serwer.close();
console.log(bledy ? `GUI 2.0: ${bledy} problemów, zrzutów ${zrzutow}` : `GUI 2.0 OK, zrzutów ${zrzutow}`);
process.exit(bledy ? 1 : 0);
