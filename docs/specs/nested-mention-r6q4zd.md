# Feature Specification: One-click `@` navigation to stacks and their pages

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | The prompt's `@` suggestions list stacks and their pages as a tree; a click (or Enter) on one goes there at once when nothing else is typed, and inserts the reference otherwise |
| **Spec ID** | nested-mention-r6q4zd |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-04 17:50 +00:00 |
| **Last updated** | 2026-10-05 04:05 +00:00 |
| **Affected features** | prompt, stacks |
| **Target release** | 0.1.0 |
| **Related links** | PR #42, specs fresh-anchor-w6p3jd (`@name` in the prompt), nimble-anchor-w3p8kd (stack switcher), ADR 0008 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Typing `@` suggests stacks, but picking one only fills `@name ` into the prompt; going there needs a second Enter or click. Single pages of a stack can't be reached from the prompt at all.
- **Desired outcome:** `@` suggests stacks and their pages in a tree like the stack header's. With nothing else in the prompt, one click (or Enter) on a stack switches to it and on a page opens that page in its stack. With other text in the prompt (`Mute all tabs in @xyz`), picking only inserts the reference.

## 3. Background and Context

- **Current behavior:** `suggestStacks` lists at most 8 stacks for the `@word` at the end of the input (`@name` + root title). Accepting fills `@name ` in; submitting `@name` alone switches; `@name` in a question attaches the stack's outline (`stacks:outline`). The UI only knows the current stack's rows (`StacksState.current.rows`); other stacks are summaries.
- **Motivation:** The `@` menu is the fastest keyboard path to a stack; it should be a jump list, not a two-step insert, and reach every page, not only stacks.
- **Related issues or references:** User request with screenshot (2026-10-04).

## 4. Goals

- One click or Enter in the `@` menu navigates, when the prompt holds nothing but the `@word`.
- Pages of every stack are referable as `@stack/page`.
- Stacks and pages look different and pages are indented under their stack in tree order.
- Long lists and long titles stay inside the card: the list scrolls, labels end in an ellipsis.

## 5. Non-Goals

- Fuzzy matching or ranking by recency within a stack.
- Acting on a referenced page in a question beyond attaching its title and URL (e.g. muting is the assistant's business).
- Changing the stack header's tree.

## 6. User Stories

- As a user, I want to type `@inf` and click `information-processing` to be there, without a second click.
- As a user, I want to type `@kent` and click the "Kent Beck…" page to open it, in whatever stack it lives.
- As a user, I want `Summarize @information-processing/kent-beck-software-engineering` to give the assistant that page, not jump to it.

## 7. Functional Requirements

1. **Reference syntax.** A stack is `@<stack-name>`; a page is `@<stack-name>/<page-ref>`. `<page-ref>` is the slug of the page's title (else its host), at most 32 characters, made unique within its stack with `-2`, `-3`… in tree order. Refs are computed from the current tree (not stored).
2. **Data.** New `stacks:pages` (UI → main, no argument) returns every named stack, most recently used first, with all its pages in depth-first tree order: `{ id, name, rootTitle, rows: (StackRow & { ref })[] }[]`. The UI asks for it only while an `@word` is being typed, and again after a stacks state change.
3. **Matching.** For the typed `@word` (letters, digits, `-`, optionally `/` and a page part):
   - `@` alone: every stack, each followed by its pages.
   - `@text`: stacks whose name contains `text` (prefix matches first) with all their pages; plus, in other stacks, pages whose ref, title or URL (without scheme) contains `text`, shown under their stack with their ancestors (so the tree shape is kept).
   - `@stack/text`: only that stack's pages whose ref, title or URL contains `text` (with ancestors).
   - The exact reference already typed is not suggested again.
4. **Order and limit.** Stacks in most-recently-used order, pages in tree order beneath their stack. At most 200 rows; when more match, a last non-selectable row says `⋯ N more – type to narrow`.
5. **Look.** Stack rows: a stack icon, `@name` in bold, root title and page count as detail. Page rows: indented by depth (capped at 6 levels), tree connectors `├`/`└` like the header, page title (else URL) as the label, the address without scheme as detail. The active page of the current stack is marked. Selection, hover and `aria-selected` work for both kinds.
6. **Overflow.** The suggestion list is at most 50 % of the window's height (and at most the space above the input), scrolls vertically, never horizontally; labels and details end with an ellipsis; the selected row is scrolled into view with ↑/↓.
7. **Picking with nothing else in the prompt** (the input is only the `@word`, ignoring spaces): click or Enter on a stack switches to it; on a page switches to its stack (if needed) and loads that page via the tree (like clicking it in the header). The prompt is cleared and the entry recorded in prompt history as `@name` / `@name/ref`. Refused while the assistant runs (same message as today).
8. **Picking with other text in the prompt:** click or Enter replaces the `@word` with `@name ` / `@name/ref ` and keeps the rest; nothing navigates.
9. **Tab / → (with a suggestion selected)** always only completes (inserts), in both cases.
10. **Typed references.** Submitting `@name/ref` alone opens that page like a pick; in a question, `@name/ref` attaches a text attachment `@name/ref` with the page's title, URL and its stack (`stacks:outline` accepts `name/ref`). Unknown references stay text.
11. **New IPC** `stacks:open-page` `{ stackId, nodeId }` (UI → main): validates an open stack and one of its nodes; switches to the stack if it isn't current, then goes to the node.

## 8. Non-Functional Requirements

- Performance: at most 50 stacks × 500 pages; `stacks:pages` is only called while typing `@` and its result cached until the next state change; matching runs in the UI on ≤ 25 000 rows, well under a frame.
- Reliability: a stack or page closed between listing and picking fails with an error message in the prompt, nothing else.
- Security: two new UI → main channels, both sender-checked through `ctx.ipc`; arguments validated (open stack id, node of that stack). No new access for web content. URLs load only through the existing tree navigation (http(s), checked by navigation).
- Privacy: nothing new stored; page titles and URLs already live in `stacks.json`.
- Accessibility: listbox semantics unchanged; stack/page kind exposed in each option's accessible name (`Stack …` / `Page …`); the overflow row is `aria-disabled`.
- Platforms: none.

## 9. UX / UI Notes

- User flow: `@` → tree of stacks and pages → click → there. `Ask about @inf` → click → `Ask about @information-processing ` stays in the prompt.
- Visual considerations: matches the stack header (connectors, indent), stack rows stand out (bold, icon), page rows lighter.
- Edge cases: stack without a name (not listed, as today); page without title (URL as label, host-based ref); duplicate titles (`-2` refs); a very deep tree (indent capped); hundreds of pages (scroll + `⋯ N more`).

## 10. Technical Notes

- Proposed approach: `stacks/shared/tree.ts` gets `pageRefs(rows)`; `stacks/main.ts` handles `stacks:pages`, `stacks:open-page` and `name/ref` in `stacks:outline`. `prompt/shared/suggest.ts` replaces `suggestStacks` with `suggestMentions(input, stackPages, limit)` returning stack/page suggestions with depth and connector info; `stackRefs` learns `name/ref`. `Suggestion` gets kinds `stack` and `page` (+ `depth`, `last`, `target`). `Prompt.tsx` decides navigate vs insert on accept; `SuggestionList.tsx` renders the tree rows and the overflow row and scrolls the selected row into view.
- Process split: main computes refs and validates; UI matches and renders.
- Dependencies: prompt → stacks (`ipc.ts` types and bridge), as today. No npm packages.
- Risks / unknowns: page refs change when titles change (the menu always shows current ones).
- Open questions: –

## 11. Acceptance Criteria

- [x] `@` lists stacks with their pages indented beneath in tree order; stacks and pages are visually distinct – `ui/Prompt.test.tsx`, `shared/suggest.test.ts`
- [x] With only `@word` in the prompt, a click or Enter on a stack calls `stacks.switch` once and clears the prompt – `ui/Prompt.test.tsx`
- [x] With only `@word` in the prompt, a click or Enter on a page calls `stacks.openPage` with its stack and node – `ui/Prompt.test.tsx`
- [x] With other text in the prompt, a pick inserts `@name ` / `@name/ref ` and navigates nothing – `ui/Prompt.test.tsx`
- [x] Tab completes without navigating – `ui/Prompt.test.tsx`
- [x] `@text` matches pages by ref, title or URL and keeps their ancestors; `@stack/text` searches only that stack; at most 200 rows plus a `⋯ N more` row – `shared/suggest.test.ts`
- [x] Page refs are slugs, unique per stack, ≤ 32 chars – `stacks/shared/tree.test.ts`
- [x] `stacks:open-page` switches and goes to the node; rejects unknown stacks and nodes; `stacks:pages` lists named stacks with refs; `stacks:outline` resolves `name/ref` – `stacks/main.test.ts`
- [x] `@name/ref` in a question attaches the page; alone it opens the page – `ui/Prompt.test.tsx`
- [x] The list scrolls vertically, labels ellipsize, the selected row is scrolled into view – `ui/Prompt.test.tsx` (scrollIntoView), CSS review

## 12. Testing / Verification

- Manual test plan: several stacks with deep trees and long titles; type `@`, scroll, narrow, click a stack, click a page in another stack; `Mute @x` + pick inserts.
- Automated test coverage: unit (Vitest) as listed above; existing e2e unchanged.
- Regression considerations: `@name` alone/in a question as before; Ctrl+Tab still not captured by Tab completion; URL/command suggestions unchanged.

## 13. Rollout / Follow-up

- Rollout plan: no flag; small, reversible UI change.
- Follow-up work: other `@` targets (history entries, bookmarks).

## 14. Changes during implementation

- Picking a stack or page in the field of view (nothing else typed) hands the reference to the sidebar prompt, which goes there; resolving `@name/ref` fetches the pages if the sidebar has none yet.
- Until `stacks:pages` answers, `@` lists the stacks alone (from the state summary), so the menu never flickers empty.
- Typing a stack's exact name still lists its pages (only the stack row itself is left out); Enter with no row selected switches as before.
- Page rows: the address shrinks first (≤ 35 % of the row) so titles keep their room; checked in a Chromium render of the list with long titles and deep trees (no horizontal scroll).
- e2e not run in the cloud session (no Electron binary); CI runs it.

