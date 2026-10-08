// Showcase do README: demo (animowany WebP) i grafika Social preview 1280×640.
// Demo: Playwright nagrywa klatki atrapy (EN, ciemny): upuszczenie → „For phones” → kolejka
// „412 MB → 74 MB”; klatki → film (ffmpeg), film → animowany WebP silnikiem SoraFluxa
// (cargo run --example animacja). Dane zmyślone, jak w zrzutach.
// Użycie: npm run build && node scripts/showcase.mjs   (PW_CHROMIUM jak w zrzuty.mjs, ffmpeg w PATH)
import { preview } from "vite";
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PRZEGLADARKA = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
const WYJSCIE = "docs/showcase";
mkdirSync(WYJSCIE, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "showcase-"));

const serwer = await preview({ preview: { port: 4175, strictPort: true }, logLevel: "warn" });
const przegladarka = await chromium.launch({ executablePath: PRZEGLADARKA });
const s = await (await przegladarka.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" })).newPage();
await s.goto("http://localhost:4175/?motyw=dark&jezyk=en");
await s.waitForSelector(".nawigacja-przycisk");
await s.waitForTimeout(600);

// Kursor (headless go nie rysuje): strzałka przesuwana płynnie do celu.
await s.addStyleTag({ content: "#kursor{position:fixed;z-index:99999;left:0;top:0;width:22px;height:22px;pointer-events:none;transition:transform .55s cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 3px #0008)}" });
await s.evaluate(() => {
  const k = document.createElement("div");
  k.id = "kursor";
  k.innerHTML = '<svg viewBox="0 0 22 22"><path d="M3 2l15 9-6.5 1.5L8 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  k.style.transform = "translate(900px,640px)";
  document.body.append(k);
});

// Klatki ze znacznikiem czasu; ffmpeg concat odtworzy prawdziwe tempo.
const klatki = [];
let nagrywa = true;
const petla = (async () => {
  while (nagrywa) {
    const plik = join(tmp, `k${String(klatki.length).padStart(4, "0")}.png`);
    await s.screenshot({ path: plik });
    klatki.push({ plik, t: Date.now() });
  }
})();
const czekaj = (ms) => s.waitForTimeout(ms);
async function najedz(selektor) {
  const r = await s.locator(selektor).first().boundingBox();
  const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
  await s.evaluate(([x, y]) => (document.getElementById("kursor").style.transform = `translate(${x}px,${y}px)`), [x, y]);
  await czekaj(650);
  await s.mouse.move(x, y);
}
async function kliknij(selektor) {
  await najedz(selektor);
  await czekaj(200);
  await s.locator(selektor).first().click();
}

await czekaj(800);
await kliknij(".strefa"); // „upuszczenie” dwóch plików (atrapa)
await s.waitForSelector(".plik");
await czekaj(1000);
await kliknij('[data-akcja="telefon"]');
await czekaj(1300);
await kliknij(".przycisk-glowny");
await czekaj(700);
await kliknij('[data-zakladka="kolejka"]');
await s.waitForFunction(() => document.querySelectorAll(".zadanie").length > 0 && [...document.body.innerText.matchAll(/412 MB → 74(.0)? MB/g)].length >= 2, null, { timeout: 30000 });
await czekaj(1800);
nagrywa = false;
await petla;

// klatki → film (stałe 25 fps), czasy z nagrania
const lista = klatki
  .map((k, i) => `file '${k.plik.replace(/\\/g, "/")}'\nduration ${(((klatki[i + 1]?.t ?? k.t + 1500) - k.t) / 1000).toFixed(3)}`)
  .join("\n");
writeFileSync(join(tmp, "lista.txt"), lista + `\nfile '${klatki.at(-1).plik.replace(/\\/g, "/")}'\n`);
const film = join(tmp, "demo.mp4");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(tmp, "lista.txt"), "-fps_mode", "cfr", "-r", "25", "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv444p", film], { stdio: "inherit" });
execFileSync("cargo", ["run", "-q", "--example", "animacja", "--", film, resolve(WYJSCIE, "demo.webp"), "12", "960"], { cwd: "src-tauri", stdio: "inherit" });
const mb = statSync(join(WYJSCIE, "demo.webp")).size / 1e6;
console.log(`${WYJSCIE}/demo.webp: ${klatki.length} klatek, ${((klatki.at(-1).t - klatki[0].t) / 1000).toFixed(1)} s, ${mb.toFixed(2)} MB`);
if (mb > 6) throw new Error("demo.webp > 6 MB");

// Social preview 1280×640: znak, nazwa, podtytuł i wycinek ekranu (fonty apki już wczytane)
const zrzut = readFileSync("zrzuty/en/v1_2-konwertuj-sora-a-ciemny.png").toString("base64");
const znak = readFileSync("src-tauri/icons/128x128@2x.png").toString("base64");
await s.setViewportSize({ width: 1280, height: 640 });
await s.evaluate(
  ([zrzut, znak, podtytul]) => {
    document.body.innerHTML = `
<div style="position:fixed;inset:0;background:#121014;color:#f1ece8;overflow:hidden;font-family:'M PLUS Rounded 1c',sans-serif">
  <div style="position:absolute;left:0;right:0;top:0;height:8px;background:linear-gradient(#ff4d66 0 50%,transparent 50% 66%,#ff4d66 66%)"></div>
  <div style="position:absolute;left:72px;top:120px;width:520px">
    <img src="data:image/png;base64,${znak}" style="width:96px;height:96px;display:block;margin-bottom:28px">
    <div style="font-family:'Dela Gothic One',sans-serif;font-size:84px;line-height:1">SoraFlux</div>
    <div style="font-size:30px;line-height:1.35;margin-top:22px;color:#c4bcc0;font-weight:500">${podtytul}</div>
    <div style="font-size:22px;margin-top:30px;color:#ff4d66;font-weight:800">Free · Windows · open source</div>
  </div>
  <img src="data:image/png;base64,${zrzut}" style="position:absolute;left:640px;top:96px;width:760px;border-radius:18px;border:1px solid #2e2a32;box-shadow:0 30px 80px -20px #000">
</div>`;
  },
  [zrzut, znak, "Convert and download video, audio, images and GIFs. On your computer, no uploads."],
);
await czekaj(500);
await s.screenshot({ path: join(WYJSCIE, "social.png") });
console.log(`${WYJSCIE}/social.png`);

await przegladarka.close();
await serwer.close();
rmSync(tmp, { recursive: true, force: true });
