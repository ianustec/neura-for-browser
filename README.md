# NEURA for Browser

AI-powered browser extension that brings contextual chat to any webpage, connected to your [OpenWebUI](https://github.com/open-webui/open-webui) / Neura instance.

**Current version:** `1.0`  
**Repository:** [ianustec/neura-for-browser](https://github.com/ianustec/neura-for-browser)  
**Branch:** `dev`

> **Note on versioning:** This public release starts at version **1.0** as a new Chrome Web Store listing. It is independent from any previous private or legacy extension builds.

---

## Why NEURA?

**NEURA** is the name of the AI infrastructure built at [IANUSTEC](https://ianustec.com): a self-hosted / sovereign AI stack that uses [Open WebUI](https://github.com/open-webui/open-webui) as a core frontend and orchestration layer.

**NEURA Office** is the Office layer of that stack — tools that turn model output into real file formats (`.docx`, `.pptx`, `.xlsx`), with a future assistant inside Microsoft 365 apps on the same backend.

### Why keep the name NEURA?

1. It ties the open tools to the product story — not just a random acronym.
2. It sparks curiosity ("what is NEURA?") so we can point people to the infrastructure behind the extension.
3. It lets the project grow beyond "another Open WebUI snippet" into a suite brand.

**Contact:** [ianustec.com](https://ianustec.com)

---

## Features

- **Contextual chat** — ask questions about the page you are viewing
- **OpenWebUI integration** — connect to your Neura / OpenWebUI instance
- **Account login** — sign in with email and password; session stored locally in the browser
- **Session management** — conversations organized around the sites you visit
- **Model selection** — pick available models from your instance
- **Knowledge & tools** — company knowledge and agent-style browser helpers when enabled on the server
- **Privacy-minded** — no analytics SDK; content is sent only to the AI endpoint you configure

---

## Install from source (Chrome / Edge)

1. Clone or download this repository.
2. Open the extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Enable **Developer mode**.
4. Click **Load unpacked** and select **this folder** (the one that contains `manifest.json`).
5. Pin **NEURA for Browser** from the toolbar if you want quick access.

### First-time setup

1. Open the extension settings (click the icon → settings).
2. Enter your Neura / OpenWebUI **email** and **password**.
3. Optionally set a custom server endpoint (defaults to your Neura OpenWebUI instance).
4. Sign in and start chatting on any page.

---

## Store release roadmap

Status of publication on each browser store. All channels are currently work in progress.

| Browser | Store | Status |
|---------|-------|--------|
| Google Chrome | [Chrome Web Store](https://chrome.google.com/webstore/devconsole) | WIP |
| Microsoft Edge | [Edge Add-ons](https://partner.microsoft.com/dashboard) | WIP |
| Brave | Chromium / Chrome Web Store listing | WIP |
| Mozilla Firefox | [Firefox Add-ons (AMO)](https://addons.mozilla.org/developers/) | WIP |
| Apple Safari | Mac App Store / Safari Extensions | WIP |
| Opera | [Opera addons](https://addons.opera.com/) | WIP |

---

## Repository layout

```text
.
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker entry
├── styles.css             # UI styles
├── styles-owui.css        # OpenWebUI-aligned styles
├── images/                # Extension icons
├── library/               # Bundled third-party assets (e.g. Prism, docx)
├── src/
│   ├── background/        # API, streaming, agent, auth, permissions
│   ├── content/           # Sidebar UI, chat, page tools
│   ├── offscreen/         # Offscreen helpers
│   └── permissions/       # Mic permission page
└── LICENSE
```

---

## Support

For product and account issues, contact your Neura administrator or the support channel published with the store listing.

---

## License

MIT with [Commons Clause](https://commonsclause.com/) — free to use, copy,
modify, and distribute (including internal use within a for-profit
organization), as long as you don't sell the software or offer it as a
paid product/service. See [LICENSE](./LICENSE) for the full text.
