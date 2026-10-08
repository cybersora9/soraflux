// latest.json dla updatera Tauri (GitHub Releases).
// Użycie: node scripts/latest-json.mjs <katalog z instalatorem i .sig> <owner/repo> <tag>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [katalog, repo, tag] = process.argv.slice(2);
const pliki = readdirSync(katalog);
const instalator = pliki.find((p) => p.endsWith("-setup.exe"));
if (!instalator) throw new Error("brak instalatora *-setup.exe");
const sig = pliki.includes(`${instalator}.sig`) ? readFileSync(join(katalog, `${instalator}.sig`), "utf8").trim() : "";
const wersja = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const latest = {
  version: wersja,
  notes: `SoraFlux ${wersja}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: sig,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(instalator)}`,
    },
  },
};
writeFileSync(join(katalog, "latest.json"), JSON.stringify(latest, null, 2));
console.log(`latest.json: ${wersja}${sig ? "" : " (BEZ podpisu: updater go odrzuci)"}`);
