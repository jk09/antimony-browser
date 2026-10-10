# Feature Specification: The assistant sees all stacks; a clearer stack switcher with search

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | A `list_stacks` tool and a stack count in `<browser_state>` so the assistant can answer about every open stack; a switcher that looks clickable and opens with a focused search over all stacks and their pages |
| **Spec ID** | open-roster-v5n9qk |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-10 18:00 +00:00 |
| **Last updated** | 2026-10-10 18:45 +00:00 |
| **Affected features** | agent, stacks |
| **Target release** | 0.1.0 |
| **Related links** | specs quiet-speaker-m8v3tz, nested-mention-r6q4zd (stack pages for `@`), spoken-macro-m4q7zt (`new_stack`) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Asked "count the number of tab stacks", the assistant answers "1 … I don't have a way to see if there are other stacks open": `<browser_state>` only describes the current page and no tool lists stacks. In the header, the switcher (`@name ▾`) is small grey text that doesn't read as a menu, and once opened the list (often dozens of stacks) can only be scrolled.
- **Desired outcome:** The assistant knows how many stacks are open and can list them and their pages. The switcher looks like a drop-down button with the stack count; opening it puts focus in a highlighted search box that filters the stacks and finds pages in any stack.

## 3. Background and Context

- **Current behavior:** `agent/main/tools.ts` has `new_stack` only (`StackOpener.open`, provided by stacks via `provideStackOpener`). `StackHeader.tsx` renders `.stack-name` (transparent, muted, 11 px) and a `.stack-list` dialog of stacks; the header's search box searches only the current stack's pages.
- **Motivation:** Stacks are the browser's tabs; "how many tabs do I have", "which stack had the Spotify player", "close-ish duplicates" are natural requests. The switcher is the only place listing them and is easy to miss.
- **Related issues or references:** screenshots in the request (assistant's wrong count; the switcher).

## 4. Goals

- The model can count, list and inspect all stacks without page access.
- The switcher is recognisably a drop-down showing how many stacks there are.
- Opening it by click (or Enter/Space) focuses a visibly outlined search box: typing filters stacks by name or root title and lists matching pages of all stacks.

## 5. Non-Goals

- Tools to switch, close or rename stacks for the model (only reading; opening stays `new_stack`).
- Changing the header's per-stack search box or Ctrl+Tab cycling.
- Fuzzy matching; the search uses the existing every-word substring match (`shared/search.ts`).

## 6. User Stories

- As a user, I want to ask the assistant "how many stacks do I have?" or "which stack has the BAE Tempest page?" and get a correct answer.
- As a user, I want to see at a glance that the stack name is a menu holding all my stacks, and type right away to find one.

## 7. Functional Requirements

1. **Port**: `StackOpener` becomes `StackPort` (`provideStacks`, replacing `provideStackOpener`): `open()` as before, plus `list(): StackListing[]` – every stack, most recently used first: `name` ('' unnamed), `rootTitle`, `pages` (count), `current`, `imported`, `lastUsedAt`, and `rows` (depth, title, URL, `ref`, active).
2. **`<browser_state>`** gets a line `Open stacks: N (current: @name)` (or `Open stacks: 0`); names are slugs, the count needs no access.
3. **Tool `list_stacks`** (kind `history`: no page access, not offered with history access off, reading it makes later cross-site navigation in the run ask first; not replayable). Input `stack?: string` (`@name` or `name`).
   - Without `stack`: `N open stacks (most recently used first):` then one line per stack `@name – <root title> – K pages[ – current][ – imported]` (unnamed: `New tab`).
   - With `stack`: that stack's pages as an indented outline, one line per page `- <title> – <url> (@name/ref)[ ← current page]`, at most 200 pages (`… M more`); unknown name → a `ToolError` listing nothing.
   - Titles and URLs are inside `<untrusted_page_content>`.
   - Approval row / conversation: `List stacks` / `List the pages of @name`.
4. **System prompt**: the stacks line mentions `list_stacks` for questions about other stacks.
5. **Switcher button**: styled as a drop-down (border, field background, normal text colour, bigger chevron) and shows the number of stacks as a badge (`@name 37 ▾`); title `All stacks (37): click to switch or search (Ctrl+Tab)`.
6. **Search in the list**: the stack list starts with a search box (`aria-label="Search stacks and pages"`, placeholder `Search stacks and pages`). Opening the list by click/keyboard focuses it, with a focus ring (2 px `--focus` outline). Opening it with Ctrl+Tab doesn't move focus.
   - Typing filters the stacks to those whose name or root title contains every word, and below lists up to 50 matching pages from all stacks (`api.stacks.pages()`, loaded when the list opens), each with its title, URL and `@stack`, matches marked.
   - ↑ ↓ move a selection over the shown stacks then pages; Enter switches to the stack / opens the page (`openPage`) and closes the list; Escape clears a non-empty query, else closes the list and returns focus to the switcher button.
   - While the assistant runs, the list can be searched but nothing is switched or opened (as now).

## 8. Non-Functional Requirements

- Performance: `list()` is computed on call (≤ 50 stacks × 500 nodes); the tool output is clipped (stack list ≤ 50 lines, pages ≤ 200).
- Reliability: unchanged.
- Security: no new IPC channel (the UI already has `stacks:pages`). The model gets titles and URLs of all open stacks – the same kind of data `search_history` exposes – so the tool is gated by history access and wrapped as untrusted.
- Privacy: page titles/URLs of stacks go to the model only when it calls `list_stacks` with history access on; the count and names in `<browser_state>` always. Documented in the agent README's security surface.
- Accessibility: the search box is a combobox over a listbox with `aria-activedescendant`; the switcher keeps `aria-haspopup`/`aria-expanded`; the badge has an accessible label (`37 stacks`).
- Platforms: all.

## 9. UX / UI Notes

- User flow: click `@open-webui-github 37 ▾` → list opens, search focused and outlined → type `tempest` → `@bae-systems-tempest-wikipedia` and its page appear → Enter.
- Visual considerations: in light and dark themes the button reads as a control (border `--field-border`, hover `--hover`).
- Edge cases: no matches (`No matching stacks or pages`); a single stack (badge `1`); unnamed stacks match on their root title; list reopened clears the query.

## 10. Technical Notes

- Proposed approach: stacks `main.ts` builds `StackListing[]` from existing `rows`/`pageRefs`/`nodeCount`; agent `tools.ts` formats it (`formatStackList`, `formatStackPages`); `agent.ts` adds the state line. UI: a `StackSearch` part inside the list in `StackHeader.tsx`, reusing `searchPages`/`matchRanges`.
- Process split: main (port, tool), renderer (switcher). No new IPC.
- Dependencies: agent ↔ stacks through `provideStacks` (agent exports it, stacks calls it). No package.
- Risks / unknowns: changing `SYSTEM_PROMPT` and the tool list (agent `CLAUDE.md` asks to keep them stable – this is a deliberate one-off addition).
- Open questions: none.

## 11. Acceptance Criteria

- [x] `<browser_state>` states the number of open stacks and the current one – `agent/main/agent.test.ts`.
- [x] `list_stacks` lists all stacks, or one stack's pages, with untrusted titles; unknown stack is an error; not offered with history access off; sets the read flag – `agent/main/tools.test.ts`, `agent/main/agent.test.ts`.
- [x] Stacks provide `list()` with every stack, current flag and page refs – `stacks/main.test.ts`.
- [x] The switcher shows the stack count; opening by click focuses the list's search box; Ctrl+Tab doesn't – `stacks/ui/StackHeader.test.tsx`.
- [x] Typing filters stacks and finds pages in other stacks; arrows + Enter switch / open; Escape clears then closes – `StackHeader.test.tsx`.
- [x] `npm run check` passes; e2e stacks tests pass.

## 12. Testing / Verification

- Manual test plan: with several stacks, ask "count the number of stacks" and "which stack has X"; click the switcher, type, Enter.
- Automated test coverage: unit tests above; existing e2e `stacks.spec.ts`.
- Regression considerations: Ctrl+Tab cycle (list opens without focus change), closing stacks from the list, `new_stack`.

## 13. Rollout / Follow-up

- Rollout plan: no flag.
- Follow-up work: tools to switch/close stacks for the model.

## 14. Changes during implementation

- The stack list shows stack names and root titles with the query's words marked, like the header search; page hits show `@stack · URL`.
- Without the stacks port (tests, before stacks registers) `<browser_state>` has no stacks line.
- `npm run test:e2e` was run in the cloud session (Electron available); the switcher's e2e locator now matches its new title `All stacks (N): …`.
