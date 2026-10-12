# Claude Meter

<p align="center">
  <a href="https://github.com/KrasimirKralev/claude-meter/stargazers"><img src="https://img.shields.io/github/stars/KrasimirKralev/claude-meter?style=for-the-badge&logo=github&color=ffc900&labelColor=111" alt="Stars"></a>
  <a href="https://github.com/KrasimirKralev/claude-meter/releases/latest"><img src="https://img.shields.io/github/v/release/KrasimirKralev/claude-meter?style=for-the-badge&color=ff90e8&labelColor=111" alt="Latest release"></a>
  <a href="https://github.com/KrasimirKralev/claude-meter/releases/latest"><img src="https://img.shields.io/github/downloads/KrasimirKralev/claude-meter/total?style=for-the-badge&color=23a094&labelColor=111" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20from%20source-9ee7c8?style=for-the-badge&labelColor=111" alt="Platforms: macOS, Linux from source">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/KrasimirKralev/claude-meter?style=for-the-badge&color=e5484d&labelColor=111" alt="License"></a>
</p>

A desktop widget that tracks your **Claude usage** in real time — current session, weekly (all models), Fable-only, and pay-as-you-go **extra-usage spend** — with a built-in planner: **calendar** (with optional Google Calendar sync), **tasks**, **notes** (markdown editor), and **habit tracking**. Pop-brutalist UI, always-on-top, snap-to-edge.

> **Unofficial; not affiliated with Anthropic.** Claude Meter is an independent open-source tool that reads the login
> [Claude Code](https://claude.com/claude-code) already keeps on your machine.

<p align="center">
  <img src="assets/screenshot-widget.png" alt="Claude Meter widget" width="340">
</p>

## Screenshots

| Dashboard | Notes editor |
|:---:|:---:|
| ![Dashboard](assets/screenshot-dashboard.png) | ![Notes editor](assets/screenshot-notes.png) |
| Usage overview, 7-day history, and the full planner. | Split markdown editor with live preview, tables → inline bars, and click-to-copy fields. |

---

## Platforms

| Platform | Status |
|----------|--------|
| macOS (Apple Silicon and Intel) | Released: unsigned DMGs on the [Releases](../../releases/latest) page, built by CI. |
| Linux | Runs from source (see [Build from source](#build-from-source)). No packaged build yet. |
| Windows | Untested. The app has not been verified on Windows, and no installer is published. |

## Download (macOS)

Grab the latest build from the [**Releases**](../../releases/latest) page:

| File | For |
|------|-----|
| `Claude.Meter-<version>-arm64.dmg` | Apple Silicon (M1 / M2 / M3 / M4) |
| `Claude.Meter-<version>-x64.dmg` | Intel Macs |

> The build is **unsigned** (no paid Apple Developer certificate), so macOS Gatekeeper will warn on first launch. This is expected.

### First launch (one time)

1. Open the `.dmg` and drag **Claude Meter** into **Applications**.
2. In **Applications**, **right-click** the app → **Open** → **Open** in the dialog.

If macOS still refuses (*"app is damaged / can't be opened"*), open **Terminal** and run:

```bash
xattr -cr "/Applications/Claude Meter.app"
```

then open it normally. After the first open it launches like any other app.

---

## Requirements

Claude Meter reads your usage from the **Claude Code** credentials on your machine
(`~/.claude/.credentials.json`). So you need [Claude Code](https://claude.com/claude-code)
installed and logged in (`claude` on your PATH). The app has no API key of its own —
it reuses the OAuth token Claude Code already has. When that token is close to expiring,
the app refreshes it with Anthropic and writes the new token back to the same file.

If you're not logged into Claude Code, the usage bars will be empty.

---

## Features

- **Multiple accounts** — log each Claude account into its own `CLAUDE_CONFIG_DIR` (`~/.claude-<name>`) and the widget shows a tab per account with a live status dot; click to switch, each polled independently with its own rate-limit backoff.
- **Usage meters** — current session, weekly (all models), Fable-only, each as a segmented bar with reset countdown.
- **Extra-usage strip** — how much pay-as-you-go credit you've spent this month vs your limit, color-coded (teal → yellow at 80% → red at 100%). Auto-hidden if you don't have extra usage enabled.
- **Calendar** — local events + optional read-only Google Calendar sync (see below). Meetings with a Meet/Zoom/Teams link show a 🎥 marker — click to **join directly**.
- **Tasks** — quick to-dos with a completion-streak badge.
- **Notes** — a **standalone note-taking app** (own window + taskbar icon) with a sticky board, markdown editor + live preview, tables → inline bars, tap-to-edit blocks in read view, a quick-capture bar, `/` slash commands, #tags + search, and click-to-copy fields for links/keys.
- **Quick task** — `Ctrl+]` from anywhere opens a popover that adds a task to your list.
- **Habits** — Training / Reading / Learning day-trackers with monthly calendars, reflected on the widget.

---

## Configuration

### Settings

Preferences (theme, hotkey, thresholds, window position) live in `~/.claude/usage-widget-settings.json`
and are written by the app — edit through the dashboard, not by hand.

### Google Calendar setup (optional)

Calendar sync is **off by default** and needs **your own** Google OAuth client
(the app ships with none, so it's safe and fully yours). One-time setup:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Enable APIs** → enable **Google Calendar API**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Desktop app**.
   - Copy the **Client ID** and **Client secret**.
4. Add yourself as a **Test user** under **OAuth consent screen** (keeps the app in "testing" — no verification needed for personal use).
5. Provide the credentials to Claude Meter one of two ways:

   **a) Config file** (recommended) — create `~/.claude/usage-widget-google.json`:
   ```json
   {
     "client_id": "YOUR_ID.apps.googleusercontent.com",
     "client_secret": "YOUR_SECRET"
   }
   ```
   (An example is in [`usage-widget-google.example.json`](usage-widget-google.example.json).)

   **b) Environment variables** — set `GCAL_CLIENT_ID` and `GCAL_CLIENT_SECRET` before launching.

6. Restart the app, open the **Calendar**, and click **Connect Google Calendar**.

The OAuth redirect uses a temporary `http://127.0.0.1:48271/callback` loopback — nothing is sent anywhere except Google. Scope is **read-only** (`calendar.readonly`).

---

## Build from source

Only dependency is Electron + Chart.js (no native modules).

```bash
npm install
npm start              # run from source (macOS, Linux)
npm run build:mac      # macOS DMGs (must run on macOS)
```

`npm run build:linux` (AppImage) and `npm run build:win` (NSIS installer) are defined in `package.json`,
but neither runs in CI and no Linux or Windows package has been released.

### macOS builds via CI

macOS DMGs must be produced **on macOS**. This repo's GitHub Actions workflow
([`.github/workflows/build-mac.yml`](.github/workflows/build-mac.yml)) builds both
arm64 and x64 DMGs on every push to `main` (docs-only changes are skipped) and publishes them to a Release — no Mac
required to ship.

---

## Tech

Electron 33 · Chart.js · vanilla JS (no framework). All rendering is safe-DOM (no `innerHTML`). Your Claude Code
token is only ever sent to Anthropic (the usage endpoint and its token refresh).

## Contributing

PRs welcome — bugfixes, new widgets, themes, extra integrations. Thanks to everyone who's chipped in:

- [@GeorgiK77](https://github.com/GeorgiK77) — quick-task global shortcut

If Claude Meter is useful to you, a star helps other people find it.

More from [@KrasimirKralev](https://github.com/KrasimirKralev): [Harvest Hollow](https://github.com/KrasimirKralev/harvest-hollow),
a cozy 3D farming game for two that runs in the browser.

## License

MIT — do whatever you like. Customize it, rebrand it, ship it.
