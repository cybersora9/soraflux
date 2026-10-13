// Test układu paska akcji (P10 z testu na żywo 1.4.0): przy minimalnym oknie 860×600 pasek „Zapisz do /
// Wynik / Konwertuj” miał 144 px (24% wysokości) i zasłaniał treść, w tym podpis pod strefą upuszczania;
// przy 1180×800 przycisk zawijał się pod „Zapisz do”. Build Vite + atrapa backendu, Chromium (playwright-core).
// Użycie: npm run build && npm run uklad   (kod wyjścia 1 = coś zasłonięte albo pasek w dwóch rzędach)
import { preview } from "vite";
import { chromium } from "playwright-core";

const PRZEGLADARKA = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
const serwer = await preview({ preview: { port: 4175, strictPort: true }, logLevel: "warn" });
const przegladarka = await chromium.launch({ executablePath: PRZEGLADARKA });
let bledy = 0;
const sprawdz = (ok, opis) => {
  console.log(`${ok ? "ok  " : "BŁĄD"} ${opis}`);
  if (!ok) bledy++;
};

/** Pomiar paska akcji widocznej zakładki. */
const pomiar = (s) =>
  s.evaluate(() => {
    const pasek = [...document.querySelectorAll(".tresc .pasek-akcji")].find((p) => p.offsetParent !== null);
    const r = pasek.getBoundingClientRect();
    const dzieci = [...pasek.children].map((d) => d.getBoundingClientRect());
    // jeden rząd: każde dwa elementy paska nachodzą na siebie w pionie i nie nachodzą w poziomie
    let jedenRzad = true;
    let bezNakladania = true;
    for (let i = 0; i < dzieci.length; i++) {
      for (let j = i + 1; j < dzieci.length; j++) {
        const [a, b] = [dzieci[i], dzieci[j]];
        if (a.bottom <= b.top || b.bottom <= a.top) jedenRzad = false;
        if (a.right > b.left + 1 && b.right > a.left + 1) bezNakladania = false;
      }
    }
    const wPasku = [...pasek.querySelectorAll("*")].every((e) => {
      const q = e.getBoundingClientRect();
      return q.width === 0 || (q.left >= r.left - 1 && q.right <= r.right + 1);
    });
    const zmienna = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--wys-paska"));
    return { h: r.height, top: r.top, jedenRzad, bezNakladania, wPasku, zmienna, przewijanieX: document.documentElement.scrollWidth > innerWidth };
  });

async function strona(w, h, parametry) {
  const s = await (await przegladarka.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  s.on("pageerror", (e) => sprawdz(false, `błąd strony: ${e.message}`));
  await s.goto(`http://localhost:4175/?demo=1&tryb=pelny&jezyk=pl${parametry}`);
  await s.waitForSelector(".nawigacja-przycisk");
  // GUI 2.0: tryb Pełny startuje na Taśmie; te zrzuty i pomiary dotyczą widoków 1.4 (Konwertuj itd.)
  if (!parametry.includes("tryb=prosty") && !parametry.includes("kreator=1")) await s.evaluate(() => window.__zakladka("konwertuj"));
  await s.waitForTimeout(300);
  return s;
}

for (const [w, h] of [[860, 600], [1180, 800]]) {
  for (const folder of ["", "&folder=1"]) {
    const nazwa = `${w}×${h}${folder ? " z wybranym folderem" : ""}`;
    // 1. pusta zakładka Konwertuj i Obrazy: strefa upuszczania i jej podpis nad paskiem
    for (const zakladka of ["konwertuj", "obrazy"]) {
      const s = await strona(w, h, folder);
      await s.evaluate((z) => window.__zakladka(z), zakladka);
      await s.waitForTimeout(300);
      const m = await pomiar(s);
      const podpisy = await s.evaluate(() =>
        // strefa, podpis w niej (Konwertuj) i podpis pod nią („Pliki zostają…” / „PNG, JPG…”)
        [...document.querySelectorAll(".tresc .strefa, .tresc .strefa-pomoc, .tresc .lewa-pomoc")]
          .filter((e) => e.offsetParent !== null)
          .map((e) => e.getBoundingClientRect().bottom),
      );
      sprawdz(m.jedenRzad && m.bezNakladania && m.wPasku, `${nazwa}, ${zakladka}: pasek w jednym rzędzie, bez nakładania (${Math.round(m.h)} px)`);
      sprawdz(m.h <= 72, `${nazwa}, ${zakladka}: pasek ≤ 72 px (${Math.round(m.h)} px)`);
      sprawdz(podpisy.length >= 2 && podpisy.every((b) => b <= m.top), `${nazwa}, ${zakladka}: strefa upuszczania i podpis nad paskiem`);
      sprawdz(!m.przewijanieX, `${nazwa}, ${zakladka}: bez poziomego przewijania`);
      await s.context().close();
    }
    // 2. pliki + „Zmniejsz do 10 MB” (ostrzeżenie „1 z 2 już się mieści” w pasku)
    const s = await strona(w, h, folder);
    await s.evaluate(() => window.__dodajDoKonwertuj(["C:/Wideo/maly-klip.mp4", "C:/Wideo/wakacje.mp4"]));
    await s.waitForSelector(".plik");
    await s.click('[data-akcja="rozmiar"]');
    await s.waitForFunction(() => document.querySelector(".pasek-akcji .szacunek-ostrzezenie"), null, { timeout: 3000 }).catch(() => {});
    await s.waitForTimeout(400);
    let m = await pomiar(s);
    sprawdz(m.jedenRzad && m.bezNakladania && m.wPasku, `${nazwa}, z ostrzeżeniem: jeden rząd, bez nakładania (${Math.round(m.h)} px)`);
    sprawdz(m.h <= 84, `${nazwa}, z ostrzeżeniem: pasek ≤ 84 px (${Math.round(m.h)} px)`);
    sprawdz(Math.abs(m.zmienna - m.h) <= 1, `${nazwa}: --wys-paska = wysokość paska (${m.zmienna} / ${Math.round(m.h)})`);
    // 3. fokus na elemencie pod paskiem: przewinięcie z scroll-padding-bottom zostawia go nad paskiem
    const zaslaniany = await s.evaluate(() => {
      const pasek = document.querySelector(".tresc .pasek-akcji").getBoundingClientRect();
      const kandydaci = [...document.querySelectorAll(".tresc button, .tresc select, .tresc input")].filter((e) => {
        const r = e.getBoundingClientRect();
        return e.offsetParent !== null && !e.closest(".pasek-akcji") && r.top >= pasek.top && r.height > 0;
      });
      if (!kandydaci.length) return null;
      kandydaci[0].setAttribute("data-test-fokus", "1");
      return true;
    });
    if (zaslaniany) {
      await s.focus('[data-test-fokus="1"]');
      await s.waitForTimeout(600);
      const ok = await s.evaluate(() => {
        const e = document.querySelector('[data-test-fokus="1"]').getBoundingClientRect();
        const p = document.querySelector(".tresc .pasek-akcji").getBoundingClientRect();
        return e.bottom <= p.top + 1;
      });
      sprawdz(ok, `${nazwa}: element z fokusem nie ląduje pod paskiem`);
    }
    // 4. przewinięte do końca: ostatni element treści nad paskiem
    await s.evaluate(() => document.querySelector(".tresc").scrollTo({ top: 1e6, behavior: "instant" }));
    await s.waitForTimeout(300);
    m = await pomiar(s);
    const dol = await s.evaluate(() => {
      const pasek = document.querySelector(".tresc .pasek-akcji");
      return pasek.previousElementSibling.getBoundingClientRect().bottom;
    });
    sprawdz(dol <= m.top + 1, `${nazwa}: po przewinięciu do końca treść kończy się nad paskiem`);
    await s.context().close();
    // 5. Pobierz: ten sam pasek
    const p = await strona(w, h, folder);
    await p.evaluate(() => window.__zakladka("pobierz"));
    await p.waitForTimeout(300);
    m = await pomiar(p);
    sprawdz(m.jedenRzad && m.bezNakladania && m.wPasku && m.h <= 72, `${nazwa}, pobierz: pasek w jednym rzędzie (${Math.round(m.h)} px)`);
    await p.context().close();
  }
}

await przegladarka.close();
await serwer.close();
console.log(bledy ? `Układ: ${bledy} błędów` : "Układ OK");
process.exit(bledy ? 1 : 0);
