# Podpis kodu: SignPath Foundation (darmowy dla open source)

Bez podpisu Windows pokazuje przy instalatorze „System Windows ochronił ten komputer” (SmartScreen).
SignPath Foundation podpisuje za darmo projekty open source, które budują się automatycznie w GitHub Actions.
Workflow `.github/workflows/release.yml` ma już krok podpisu, **wyłączony** do czasu akceptacji wniosku.

## Warunki (stan repo)
- Licencja OSI: MIT (`LICENSE`) ✔
- Kod publiczny: **repo musi być publiczne** (teraz prywatne, decyzja maisy).
- Build w całości z repo przez GitHub Actions: `release.yml` ✔ (bez binarek w repo; ffmpeg nie jest dołączany).
- Aktywny projekt, opis w README, polityka prywatności (README: „Prywatność”) ✔
- Brak treści naruszających prawa (zero linków do cudzych utworów w repozytorium) ✔

## Co zrobić (maisa)
1. Upublicznij repozytorium `cybersora9/soraflux` (Settings → General → Danger Zone → Change visibility).
2. Złóż wniosek: <https://signpath.org/apply> (formularz „Open Source”). Podaj:
   - nazwa: SoraFlux, repo: `https://github.com/cybersora9/soraflux`, licencja MIT,
   - artefakt do podpisu: instalator NSIS `SoraFlux_*_x64-setup.exe` z workflow `Wydanie`,
   - osoby z prawem do zatwierdzania podpisów (Ty) i adres kontaktowy.
3. Po akceptacji zainstaluj w repo aplikację GitHub **SignPath** (link przyjdzie w mailu) i w SignPath utwórz projekt `soraflux` z polityką `release-signing` (nazwy jak w `release.yml`; inne = popraw w pliku).
4. W repo (Settings → Secrets and variables → Actions):
   - sekret `SIGNPATH_API_TOKEN` (token z SignPath),
   - zmienna `SIGNPATH_ORGANIZATION_ID`,
   - zmienna `SIGNPATH_WLACZONE` = `true` (to włącza krok podpisu).
5. Uruchom workflow „Wydanie” (Actions → Wydanie → Run workflow) i zatwierdź żądanie podpisu w SignPath.
   Wynik: artefakt `soraflux-windows` z podpisanym instalatorem, `SHA256SUMS.txt` i `latest.json`.
   Z tagu `v*` powstaje **szkic** wydania; publikujesz go ręcznie.

## Do czasu podpisu
Instalator działa, ale SmartScreen ostrzega: „Więcej informacji” → „Uruchom mimo to”. Sumy SHA256 w wydaniu pozwalają sprawdzić, że plik jest oryginalny.
