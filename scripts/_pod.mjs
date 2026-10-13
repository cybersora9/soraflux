import { preview } from "vite";
import { chromium } from "playwright-core";
const OUT = process.argv[2];
const serwer = await preview({ root: "/home/user/soraflux", preview: { port: 4176, strictPort: true }, logLevel: "warn" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ekrany = (process.argv[3] ?? "tasma").split(",");
for (const ekran of ekrany) {
  const s = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  s.on("pageerror", (e) => console.log("BLAD", e.message));
  s.on("console", (m) => m.type() === "error" && console.log("KONSOLA", m.text()));
  await s.goto(`http://localhost:4176/?demo=1&tryb=pelny&jezyk=pl&motyw=dark`);
  await s.waitForSelector(".szyna button");
  await s.evaluate(() => window.__dodajDoKonwertuj(["C:/Wideo/wakacje-2026.mp4", "C:/Wideo/telefon-pion-hdr.mov", "C:/Muzyka/podcast-odc-14.wav", "C:/Wideo/maly-klip.mp4"]));
  await s.waitForTimeout(1200);
  if (ekran !== "tasma") await s.click(`[data-zakladka="${ekran}"]`);
  if (ekran === "link") { await s.fill('[data-fokus="url"]', "https://example.com/watch?v=test01"); await s.press('[data-fokus="url"]', "Enter"); }
  await s.waitForTimeout(1500);
  await s.screenshot({ path: `${OUT}/${ekran}.png` });
  await s.context().close();
}
await b.close(); await serwer.close();
