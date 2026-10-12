// Sumy SHA-256 modeli whisper.cpp do przypięcia w src-tauri/src/napisy/mod.rs (`OpisModelu::sha256`).
// Uruchamia opiekun przed wydaniem: `node scripts/sumy-modeli.mjs`. Czyta publiczne API Hugging Face
// (dla plików LFS `lfs.oid` to SHA-256 pliku), apka sama tego nie robi. Wynik warto porównać z drugim
// źródłem (np. `sha256sum` pliku pobranego ręcznie), zanim trafi do kodu.
const REPO = "ggerganov/whisper.cpp";
const PLIKI = ["ggml-base.bin", "ggml-small.bin", "ggml-medium.bin", "ggml-large-v3-turbo.bin"];

const odp = await fetch(`https://huggingface.co/api/models/${REPO}/tree/main`);
if (!odp.ok) {
  console.error(`Hugging Face odpowiedział ${odp.status}`);
  process.exit(1);
}
const wpisy = await odp.json();
let brak = 0;
for (const plik of PLIKI) {
  const w = wpisy.find((x) => x.path === plik);
  const sha = w?.lfs?.oid;
  if (!sha || !/^[0-9a-f]{64}$/.test(sha)) {
    console.error(`${plik}: brak sumy LFS`);
    brak++;
    continue;
  }
  const mib = Math.round((w.lfs.size ?? w.size) / 1048576);
  console.log(`${plik.padEnd(26)} sha256: "${sha}", rozmiar_mb: ${mib}`);
}
process.exit(brak ? 1 : 0);
