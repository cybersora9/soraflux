# Aktualizacje apki (updater Tauri + GitHub Releases)

SoraFlux sprawdza aktualizacje **tylko na żądanie** (Ustawienia → „Sprawdź aktualizacje”), pobiera
`latest.json` z najnowszego wydania na GitHubie i instaluje nową wersję dopiero po zgodzie użytkownika.
Każda aktualizacja jest sprawdzana podpisem: apka zna **klucz publiczny**, wydanie podpisuje się **kluczem prywatnym**.

## Jednorazowo (maisa, lokalnie)
1. Wygeneruj parę kluczy (na swoim komputerze, nigdy w chmurze ani w repo):
   ```
   npx tauri signer generate -w %USERPROFILE%\.tauri\soraconverter.key
   ```
   Zapamiętaj hasło. Plik `soraconverter.key` (prywatny) trzymaj w bezpiecznym miejscu + kopia zapasowa.
   Zgubiony klucz = stare instalacje nie przyjmą nowych aktualizacji.
2. Klucz publiczny (`soraconverter.key.pub`, jedna linia base64) wklej w `src-tauri/tauri.conf.json`
   w miejsce `ZAMIEN_NA_KLUCZ_PUBLICZNY_Z_docs_AKTUALIZACJE_md` (`plugins.updater.pubkey`) i zrób commit.
3. W repo (Settings → Secrets and variables → Actions) dodaj sekrety:
   - `TAURI_SIGNING_PRIVATE_KEY`: zawartość pliku `soraconverter.key`,
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: hasło.

## Każde wydanie
1. Podnieś wersję w `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`.
2. Tag `vX.Y.Z` → workflow „Wydanie” buduje instalator, (opcjonalnie) podpisuje go SignPath,
   podpisuje dla updatera, tworzy `latest.json` i `SHA256SUMS.txt` w **szkicu** wydania.
3. Sprawdź szkic, opublikuj. Od tej chwili „Sprawdź aktualizacje” w starszych wersjach ją zobaczy.

Bez klucza publicznego w konfiguracji sprawdzanie aktualizacji kończy się komunikatem o błędzie; reszta apki działa normalnie.
Lokalny `npm run tauri build` nie potrzebuje klucza (`createUpdaterArtifacts: false`, podpis robi workflow).
