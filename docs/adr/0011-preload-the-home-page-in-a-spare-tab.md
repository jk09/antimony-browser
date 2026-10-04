# 0011. Preload the home page in a spare tab

- Status: Proposed
- Date: 2026-10-04
- Features: navigation, stacks
- Spec: warm-harbor-p3v9sk

## Context
The home page is usually a search page, used instead of an omnibox: right after Ctrl/Cmd+N the user wants to type into it. A new stack created a page view, started a renderer and loaded the page over the network, so the search box appeared only after a full cold load. Other features (history, stacks) record every page event of the active tab, so a page loaded ahead of time must not be recorded before the user sees it.

## Options considered
1. **One spare tab preloaded at the home page, its events held until shown** – the page is ready the moment it is shown; costs one renderer process and a background fetch of the home page, refreshed every 15 minutes.
2. **A warm, empty renderer only** – skips the process start but still waits for the network; less memory, much smaller gain.
3. **Reload the spare when shown** – always fresh, but gives back most of the gain.

## Decision
Option 1. navigation offers `TabControls.prepare(url)`: a tab loaded in the background, sized to the page area, whose page events are held and emitted in order after its first `activated`, so history and stacks see it as a typed visit when it is shown. stacks keeps one spare while a home page is set (prepared 1 s after the page it follows, replaced when 15 minutes old or when the home page changes, closed by `/home clear`) and takes it for a new stack unless its load failed. The new stack's page gets keyboard focus.

## Consequences
- One extra renderer process while a home page is set; the home page is fetched in the background every 15 minutes even when no new stack is opened (`/home clear` stops it).
- The held-events mechanism can serve other preloads (predicted links) later.
- If the shown spare is often stale (logged-out search, expired tokens), shorten the age or reload on show.
