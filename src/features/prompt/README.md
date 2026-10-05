# prompt

The assistant panel docked on the right of the window, with a location bar shaped like the Claude prompt at its bottom: Ctrl/Cmd+L or Ctrl/Cmd+Alt+I focuses it, Ctrl/Cmd+B shows or hides it, Ctrl/Cmd+I opens the same prompt over the middle of the page (the field of view) and hands what is entered to the sidebar prompt, a URL loads the page, `/command` runs a command or skill (`/menu` reaches the application menu), and anything else is a request for the assistant. `@` suggests navigation stacks with their pages beneath as a tree (`@stack`, `@stack/page`): with nothing else typed, one click or Enter goes to the stack or page; with other text it only inserts the reference, which in a question attaches the stack's outline or the page's title and URL. It suggests past URLs and visited pages (by address prefix, from history), questions, commands, skill arguments and menu items level by level, and takes pasted images and long text as attachments. The page keeps its size while the conversation grows.

## Entry points
- UI: `ui/AssistantPanel.tsx` – mounted on the right edge in `App.tsx`: a `header` slot (stacks' tree; page title and URL without it), the `conversation` slot (left empty, without a hint, until there is a conversation: the input's placeholder is the hint) and the `form` slot (agent's `Conversation`, skills' `SaveSkill`), then `ui/Prompt.tsx`, plus an `overlay` slot over the conversation (history's view); 400 px, resizable 300–720 px, no close button (it is only ever hidden), Ctrl/Cmd+B hides it (focusing the page) or shows it (focusing the prompt), Ctrl/Cmd+L, an approval, a skill save or opening history shows it
- UI: `ui/FieldOfView.tsx` – rendered by `AssistantPanel` over the page area: the same `Prompt` as a composer (`compose`: Enter sends the entry on instead of running it) in a card at the page's middle, over a dimmed snapshot of the page; entering flies the card onto the sidebar's prompt card (160 ms, none with reduced motion), then the entry is copied into the sidebar `Prompt` (text and attachments, `handoff`), which runs it as if typed there after a further 140 ms
- UI: `ui/Prompt.tsx` – the card at the panel's bottom, suggestions above the input; while a run is active the status line shows what the assistant is doing and the send button becomes Stop; its model picker groups Claude (API key), Claude Code CLI and installed Ollama models (`agent.models()`, the CLI and Ollama groups show why they're empty; refreshed at start, on Ctrl/Cmd+L and on focus); `ui/commands.ts` built-in commands (incl. `/history-access`, which turns the assistant's history search on or off in agent settings, `/history`, `/recall`, `/note`, `/history-clear`, `/history-summaries`, which call history, `/menu`, which calls menu, and `/home` (`clear`, `reset` to bing.com), which calls stacks), `ui/attachments.ts`, `ui/SuggestionList.tsx` (stack rows bold with an icon, page rows indented with `├`/`└`, the current page marked; the list scrolls inside the card, at most 50 % of the window high, labels ellipsized, the selected row kept in view; over 200 `@` rows end in `⋯ N more`)
- IPC: `prompt:history`, `prompt:record`, `prompt:clear-history`, `prompt:focus-page` (UI → main), `prompt:cover-page` (hides the page view, returns a JPEG data URL snapshot or null), `prompt:uncover-page` (UI → main), `prompt:open`, `prompt:toggle`, `prompt:field-of-view` (main → UI, no payload) – `ipc.ts`
- Main: `register` in `main.ts` – File → Prompt… (Ctrl/Cmd+L), File → Assistant Prompt (Ctrl/Cmd+Alt+I, the same action), File → Field of View Prompt… (Ctrl/Cmd+I), File → Toggle Assistant (Ctrl/Cmd+B); Ctrl/Cmd+B, +I and +Alt+I (matched by key code) are also caught in `before-input-event` of the chrome UI and every browsing-session webContents, because a focused page view doesn't reliably reach the menu accelerator on Windows; page snapshot and hiding for the field of view; prompt history store
- Shared: `shared/classify.ts` (URL / command / query, no network), `shared/suggest.ts` (also nested arguments: `SuggestCommand.tree`, and `@` stacks and pages: `suggestMentions`, `mentionOnly`, `stackRefs`; the pages come from `stacks.pages()` while an `@word` is typed, until stacks change), `shared/history.ts`

## Invariants
- `/…` is a command, `?…` a model query, URL-like text without attachments navigates, the rest goes to the model – `shared/classify.test.ts`
- URLs and commands never call the model – `e2e/prompt.spec.ts › a URL navigates without any model request`, `ui/Prompt.test.tsx`
- Visited pages from history come after typed URLs and before questions, never for `/…` – `shared/suggest.test.ts › withVisited`, `ui/Prompt.test.tsx › suggests visited pages…`
- Nested arguments are suggested level by level; a node with children fills in with a trailing space instead of running – `shared/suggest.test.ts › suggests nested arguments…`, `ui/Prompt.test.tsx › /menu suggests…`
- History is capped at 500, de-duplicated, never holds attachments or a key typed after `/key` – `shared/history.test.ts`, `main.test.ts`
- `@` lists matching stacks with all their pages, other stacks' matching pages with their ancestors (`@stack/…` searches one stack), most recently used stack first, pages in tree order – `shared/suggest.test.ts › suggestMentions`, `ui/Prompt.test.tsx › suggests stacks and their pages…`
- Picking a stack or page goes there (no model) only when the input is nothing but the `@word`; otherwise, and always with Tab or →, it only inserts `@name ` / `@name/ref `; `@name` or `@name/ref` submitted alone goes there too; in a question each adds a text attachment; unknown `@words` stay text – `ui/Prompt.test.tsx › goes to a stack or page in one click…`, `› inserts the reference…`, `› goes to a typed…`, `ui/FieldOfView.test.tsx › hands a stack or page…`
- Command and skill suggestions show no icon of their own: the label already starts with `/` – `ui/SuggestionList.tsx`
- Tab completes a suggestion, Ctrl+Tab doesn't (it switches stacks) – `ui/Prompt.test.tsx › suggests stacks after @…`
- Escape closes suggestions, then stops a running assistant; it never hides the panel – `ui/Prompt.test.tsx`
- The panel shows itself for an approval or a skill save, and Ctrl/Cmd+B can't hide it while an approval is pending – `ui/AssistantPanel.test.tsx › shows itself…`, `› stays shown on Ctrl/Cmd+B…`
- Ctrl/Cmd+B works with the page focused, and hiding leaves the page focused – `e2e/prompt.spec.ts › the menu bar is hidden…`
- Each Ctrl/Cmd+B press toggles exactly once (no menu double-fire; a held key's repeats are swallowed, not toggled), even when toggles arrive before a render; the panel has no close button – `main.test.ts › toggles once on Ctrl/Cmd+B…`, `ui/AssistantPanel.test.tsx › toggles every time…`, `› has no close button…`
- Shown again, the panel never stays under the page view: the page view spans the full width while the panel is hidden and ends at the panel's edge when it is shown. The chrome UI window has `backgroundThrottling: false`, so it keeps rendering while the page covers it – `e2e/prompt.spec.ts › Ctrl+B hides and shows the assistant…`
- The page area's size depends only on the window and the panels' widths, never on the conversation or the prompt – `e2e/prompt.spec.ts › a question runs the assistant…`
- Queries need an Anthropic key only for API-key Claude models (not CLI or Ollama); the picker always shows the selected model, even when the CLI or Ollama doesn't list it – `ui/Prompt.test.tsx › sends queries to an Ollama model…`, `› sends queries to a Claude Code CLI model…`, `› shows the CLI's and Ollama's errors…`, `› keeps a selected CLI model…`
- The field of view runs nothing itself: its entry is handed to the sidebar prompt after the card has flown to it, in any form (URL, command, question, attachments); Enter on nothing does nothing; Escape, Ctrl/Cmd+I again, a click outside it, or opening the sidebar prompt closes it without running anything – `ui/FieldOfView.test.tsx`
- The page view is hidden (not resized, so the page doesn't reflow) exactly while the field of view is open, whichever way it closes, even when closed before the snapshot arrived – `ui/FieldOfView.test.tsx`, `main.test.ts › covers the page…`

## Dependencies
- Features: navigation (`navigation.go`, `toUrl`, state events via `window.antimony`; `getPage` in main to focus, capture and hide (`setHidden`) the active tab's page), agent, skills, history, menu and stacks (their `ipc.ts` types and bridges; their UI comes in as panel slots from `App.tsx`)
- App: `createJsonStore` (`src/app/main/json-store.ts`), `ctx.fileMenu` (ADR 0003)
- Stored data: `userData/prompt-history.json` (URLs, queries, commands; `/forget-history` clears it)

## Security surface
- IPC: the chrome UI reads and writes its own prompt history and can move keyboard focus to the page view.
- IPC: the chrome UI can hide the page view and receive a snapshot of it (kept in memory only while the field of view is open).
- Web content: main reads key presses in pages (`before-input-event`) only to catch Ctrl/Cmd+B, +I and +Alt+I (repeats included), which pages no longer receive.

## Feature flags
| Flag | Default | Owner | Remove by |
|---|---|---|---|
| – | | | |

Spec: violet-harbinger-p7w3kd, copper-lantern-o7l4ma, still-meridian-r4v8nc, ember-ledger-h3x8vq, slate-compass-m5t2rw, amber-switch-b6t1qx, branching-trail-k4w9zp, fresh-anchor-w6p3jd, quartz-relay-c8m2vt, drifting-nimbus-r8c3kw, glass-meridian-f5y2nq, quiet-ledger-t9m4rx, nested-mention-r6q4zd · ADRs: 0003, 0004, 0005, 0006, 0007, 0008, 0009
