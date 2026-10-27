# 0021. Prefetch linked pages without cookies and show their summaries in the page

- Status: Superseded by 0022 (the in-page link tooltips were reverted)
- Date: 2026-10-26
- Features: link-summaries
- Spec: linked-glimpse-t8w3qn

## Context
Link summaries need two things Antimony didn't do before: fetching pages the user hasn't opened, and changing a web page's DOM (marks on links, a tooltip). Fetching on the browsing session would send the user's cookies, so a prefetched "logout", "unsubscribe" or "delete" link could act as them, and sites would see visits that never happened. A tooltip has to sit next to the link while it scrolls, which a native popup or a `WebContentsView` can't follow without the page reporting hover positions – and pages have no channel to the app (CLAUDE.md security rules). Summaries of other pages shouldn't become readable to the page that links to them.

## Options considered
1. **Fetch on the browsing session, tooltip as a native popup** – summaries for logged-in pages; but GET side effects as the user, and hover needs a page → app channel (preload or IPC for web content), which the security rules forbid.
2. **Fetch on an in-memory session without credentials, tooltip drawn by an isolated-world script in a closed shadow root** – no user identity in prefetches, no new channel; pages behind a login get no summary, and the page sees marker attributes on its own links.
3. **Hidden page views that load each link** – real rendering and scripts, but runs linked sites' JavaScript, costs a renderer per link and carries the same cookie problem unless on its own session.

## Decision
Option 2. Prefetches are `GET` with `credentials: 'omit'` on `session.fromPartition('link-summaries', { cache: false })` (in memory, nothing shared with `persist:browsing`), HTML only, ≤ 1 MB, ≤ 4 at once, ≤ 20 per page, and only while the user has turned the mode on. Only the extracted gist (≤ 1,500 chars per linked page) goes to the selected model, marked untrusted. Fixed scripts in isolated world 1003 add a `data-antimony-summary` attribute, one `<style>` and one shadow host; the summary text lives only in a closed shadow root, whose reference stays in the isolated world. Turning the mode off removes all of it and clears the in-memory cache.

## Consequences
- Prefetching can't act as the user; linked sites still see a cookieless request from the user's address, which the "on" message states.
- The page can tell that links are marked (attributes, stylesheet), not what they say; a hostile page can hide or remove the marks, which only affects itself.
- Pages behind logins, and pages that render their text with JavaScript, get no or poor summaries; fetching with cookies or rendering would need a new ADR.
- Isolated-world ids now in use: 1001 (agent), 1002 (history), 1003 (link-summaries).
