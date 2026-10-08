[Polski → pl/PODPIS.md]

# Code signing: SignPath Foundation (free for open source)

Without a signature, Windows shows "Windows protected your PC" (SmartScreen) when the installer is run.
SignPath Foundation signs open source projects for free if they are built automatically in GitHub Actions.
The workflow `.github/workflows/release.yml` (display name "Release") already has a signing step, which stays **disabled** until the application is approved.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- **What is signed:** only release builds produced from this repository by its GitHub Actions workflow (`release.yml`). Nothing built on a developer machine is signed.
- **Committers and reviewers:** the members of the [cybersora9](https://github.com/cybersora9) GitHub account.
- **Approvers:** the maintainer (cybersora9). Every signing request is approved manually in SignPath.
- **Privacy:** SoraFlux sends no telemetry. The app connects to the network only when the user asks for it: downloading the tools ffmpeg, yt-dlp and Deno, downloading media, and "Check for updates" (which reads GitHub Releases).

## Requirements (state of the repo)
- OSI-approved license: MIT (`LICENSE`) ✔
- Public source code: the repository is public ✔
- Built entirely from the repo by GitHub Actions: `release.yml` ✔ (no binaries in the repo; ffmpeg is not bundled).
- Active project, README description, privacy statement (README: "Privacy") ✔
- No infringing content (no links to third-party works in the repository) ✔

## What to do (the maintainer)
1. Apply at <https://signpath.org/apply> (the "Open Source" form). Provide:
   - name: SoraFlux, repo: `https://github.com/cybersora9/soraflux`, license MIT,
   - artifact to sign: the NSIS installer `SoraFlux_*_x64-setup.exe` from the workflow "Release",
   - the people allowed to approve signatures (the maintainer) and a contact address.
2. After approval, install the **SignPath** GitHub app on the repo (the link arrives by email). In SignPath, create the project `soraflux` with the signing policy `release-signing` (names as in `release.yml`; if they differ, fix them in the file).
3. In the repo (Settings → Secrets and variables → Actions) set:
   - secret `SIGNPATH_API_TOKEN` (the token from SignPath),
   - variable `SIGNPATH_ORGANIZATION_ID`,
   - variable `SIGNPATH_WLACZONE` = `true` ("wlaczone" = "enabled"; this turns the signing step on).
4. Run the workflow "Release" (Actions → Release → Run workflow) and approve the signing request in SignPath.
   Result: the artifact `soraflux-windows` with the signed installer, `SHA256SUMS.txt` and `latest.json`.
   A `v*` tag produces a **draft** release; you publish it by hand.

## Until the app is signed
The installer works, but SmartScreen warns: "More info" → "Run anyway". The SHA256 sums in the release let you verify that the file is the original.
