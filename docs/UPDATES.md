[Polski → pl/AKTUALIZACJE.md]

# App updates (Tauri updater + GitHub Releases)

SoraFlux checks for updates **only on request** (Settings → "Check for updates"). It downloads
`latest.json` from the newest GitHub release and installs the new version only after the user agrees.
Every update is verified by signature: the app knows the **public key**, and the release is signed with the **private key**.

## State (October 2026)
Done: the key pair exists (`soraflux.key`, kept by the maintainer with a backup), the public key is in
`src-tauri/tauri.conf.json` and both secrets are set in the repository. **1.3.0 is the first version with
working updates**; anyone on 1.2.x installs 1.3.0 once by hand.

## One-time setup (the maintainer, locally)
1. Generate a key pair (on your own computer, never in the cloud or in the repo):
   ```
   npx tauri signer generate -w %USERPROFILE%\.tauri\soraconverter.key
   ```
   Remember the password. Keep the private file `soraconverter.key` somewhere safe, with a backup.
   A lost key means existing installs will not accept new updates.
   (The name `soraconverter` is the app's earlier internal name, kept on purpose.)
2. Paste the public key (`soraconverter.key.pub`, a single base64 line) into `src-tauri/tauri.conf.json`
   in place of `ZAMIEN_NA_KLUCZ_PUBLICZNY_Z_docs_AKTUALIZACJE_md` (`plugins.updater.pubkey`) and commit.
   (The placeholder is Polish for "replace with the public key from docs/AKTUALIZACJE.md"; it is the literal value in the config.)
3. In the repo (Settings → Secrets and variables → Actions) add the secrets:
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of the file `soraconverter.key`,
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password.

## Every release
1. Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`.
2. Push a tag `vX.Y.Z` (it must match the version, or the workflow stops). The workflow "Release" builds the installer,
   optionally signs it with SignPath (see [SIGNING.md](SIGNING.md)), signs it for the updater (a tag without the
   `.sig` fails), and creates `latest.json` and `SHA256SUMS.txt` in a **draft** release. If a release for that tag
   already exists, the workflow leaves it alone (the files are still in the run's artifact).
   A manual run (Actions → Release → Run workflow) builds the same files as an artifact only, with `latest.json`
   pointing at `v<version>`: a dry run before tagging.
3. Check the draft and publish it. From then on, "Check for updates" in older versions will see it.

If the check fails (no internet, no release with `latest.json` yet), the app says so and offers a button that opens the releases page.
A local `npm run tauri build` does not need the key (`createUpdaterArtifacts: false`; the workflow does the signing).
