# 0001. Build on Electron with TypeScript and React

- Status: Proposed
- Date: 2026-09-30
- Features: – (whole app)
- Spec: –

## Context
Antimony is a minimal Chromium-based browser developed mostly by one person with Claude Code agents. It must render the web with an up-to-date Chromium, run on Windows, macOS and Linux, and stay small enough that features can be added and removed as self-contained slices. The toolchain should be one language end to end, fast to build, and well known to agents.

## Options considered
1. **Electron (TypeScript, React for the chrome UI)** – Chromium + Node in one runtime, `WebContentsView` for pages, `session` APIs for cookies/downloads/permissions; builds in seconds; one language. Cons: ~100 MB bundle, Chromium updates follow Electron's release cadence (every 8 weeks), no access to Chromium internals (e.g. no Chrome extension store, limited `chrome://` pages).
2. **Chromium Embedded Framework (C++, or CefSharp / JCEF / cefpython bindings)** – finer control over the browser process, smaller than a fork. Cons: C++ build toolchain per platform, UI toolkit to pick separately, slower iteration, far more code for tabs, downloads and permissions.
3. **Qt WebEngine (C++ / PySide)** – Chromium inside a native Qt UI. Cons: Chromium version lags Chrome, heavy Qt dependency and licensing questions, two languages for UI and logic.
4. **Fork Chromium (C++, like Brave or Vivaldi)** – full control. Cons: 100+ GB checkout, hours-long builds, continuous rebasing; not "minimal".
5. **Tauri / system webview** – small bundles. Cons: uses WebKit on macOS and Linux, so not Chromium-based everywhere.

## Decision
Option 1: Electron, TypeScript in every process, React for the chrome UI, built with electron-vite (Vite), tested with Vitest and Playwright. Web pages run in sandboxed `WebContentsView`s on a separate session; the chrome UI talks to the main process only through a typed `contextBridge` API.

## Consequences
- One language and one package manager; agents can run lint, typecheck and unit tests anywhere without the Electron binary.
- Browser behaviour is limited to what Electron exposes. Needing Chromium internals (e.g. full Chrome extension support, custom network stack) would mean revisiting this in favour of CEF or a fork.
- Security depends on keeping Electron current and on the rules in `CLAUDE.md` (sandbox, context isolation, no Node or IPC for web content).
- Packaging and auto-update (e.g. electron-builder) are follow-up work with their own spec.
