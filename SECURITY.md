# Security policy

## Supported versions

Only the latest release from [Releases](https://github.com/cybersora9/soraflux/releases) gets security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately, either:

- through GitHub: **Security → Report a vulnerability** on this repository, or
- by email: **cybersora@zohomail.eu** (subject: `SoraFlux security`).

Include the version (Settings → "Copy report" helps), Windows version, steps to reproduce and the impact you see. You'll get an answer within 7 days. Once a fix is released, we credit the reporter in the release notes unless you prefer otherwise.

In scope, for example: running unexpected programs or commands, tool downloads that skip SHA256 verification, files written outside the chosen output folder, overwriting the source file, leaking local paths or files over the network.

Out of scope: problems in ffmpeg, yt-dlp or Deno themselves (report them upstream), and the SmartScreen warning on the not-yet-signed installer ([docs/SIGNING.md](docs/SIGNING.md)).
