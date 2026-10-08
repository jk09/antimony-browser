# Feature Specification: Chrome UI redesign (graphite window, floating page card, vermilion accent)

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Redesign of the chrome UI: floating rounded page card, assistant panel as cards, vermilion accent |
| **Spec ID** | graphite-vermilion-d6n2hy |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-08 10:45 +00:00 |
| **Last updated** | 2026-10-08 14:00 +00:00 |
| **Affected features** | navigation, prompt, stacks, agent, history, skills |
| **Target release** | 0.1.0 |
| **Related links** | Claude Design canvas "Antimony Redesign" (https://claude.ai/artifact/7m5SaVUq9YekoijyotUpcD); spec ember-console-k5w9tb (/config page) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The chrome UI is a flat toolbar-grey strip with a clay accent; the page, stack tree, conversation and prompt are not visually separated.
- **Desired outcome:** A graphite window in which the page is a rounded card inset 10 px, and the assistant panel is three cards (stack tree, conversation, prompt) with one vermilion accent, in light and dark themes, with the `/config` page restyled to match. Styling only; no behaviour change.

## 3. Background and Context

- **Current behavior:** `src/app/renderer/styles.css` (custom properties, `prefers-color-scheme`) styles a flat layout; accent `#c96442` / `#d97757`; page view fills the page area edge to edge.
- **Motivation:** The user asked for a redesign made with Claude Design; the canvas has light, dark and `/config` screens.
- **Related issues or references:** architecture.md "UI notes" (plain CSS, no UI library).

## 4. Goals

- Goal 1: New palette tokens (graphite ground, surfaces, vermilion accent) for light and dark, used by every feature's UI through the existing custom properties.
- Goal 2: The page area is inset 10 px from the window edges and from the assistant panel, and the page view has rounded corners (14 px).
- Goal 3: Assistant panel: stack header, conversation and prompt each render as a separate rounded card/area as in the canvas; approval card, tool-step lines and `/config` page restyled.

## 5. Non-Goals

- Non-goal 1: Behaviour, IPC, layout logic or keyboard shortcuts.
- Non-goal 2: Bundling IBM Plex fonts (system-ui / ui-monospace stay; no new package, no ADR).
- Non-goal 3: A UI library, icon set or new components.

## 6. User Stories

- As a user, I want the page to read as its own card so that the browser chrome recedes.
- As a user, I want clear separation of stacks, conversation and prompt so that I find them at a glance.
- As a user, I want dark and light themes to look equally finished.

## 7. Functional Requirements

1. Custom properties in `:root` and the dark media query are updated to the canvas palette (light: ground `#dfe2e5`, panel `#f6f7f8`, ink `#16181b`, muted `#4f565d`, accent `#b8381a` on white; dark: ground `#0c0d0f`, panel `#17191c`, ink `#e8eaec`, muted `#9aa1a9`, accent `#ff7a52` on `#1a0d08`).
2. `.shell` has 10 px padding and gap; the page area is inset accordingly and the main process applies a 14 px border radius to every page `WebContentsView`.
3. `.assistant-panel` has no left border and no resize-edge regression: it keeps its width logic and resize handle; its children (stack header, conversation, prompt card) are rounded cards with a 1 px outline.
4. Approval card, user turn and tool-step lines, prompt card and send button follow the canvas; focus rings stay visible (`--focus`).
5. Existing class names, DOM structure and test ids are unchanged except where a wrapper is needed for the card.

## 8. Non-Functional Requirements

- Performance: no change.
- Security: `secureWebPreferences` untouched; `setBorderRadius` is a visual-only call on the view.
- Accessibility: text contrast ≥ 4.5:1 for the palette (muted `#4f565d` on `#f6f7f8` and `#9aa1a9` on `#17191c` checked); focus rings and `prefers-reduced-motion` handling kept.
- Platforms: border radius on `WebContentsView` works on all three; if unsupported the page is simply square.

## 9. UX / UI Notes

- User flow: unchanged.
- Visual considerations: per the canvas; the acting frame (agent) keeps its accent ring around the page card.
- Edge cases: Recall, history, debug panel and `/config` overlays must follow the page card's inset and radius; zoom of the chrome UI still reports correct insets.

## 10. Technical Notes

- Proposed approach: restyle `styles.css`; add the inset in `.shell`/`.workspace`; in `navigation/main.ts` call `view.setBorderRadius(14 * zoom)` when creating a page view and when zoom changes; adjust only what tests assert.
- Process split: CSS in the chrome UI; one visual call in navigation main. No IPC change.
- Dependencies: Electron `WebContentsView.setBorderRadius` (Electron 44).
- Risks / unknowns: bounds math in navigation tests assumes insets from the UI; the inset moves from CSS only, so reported insets change but not the logic.
- Open questions: none.

## 11. Acceptance Criteria

- [x] Light and dark tokens match the canvas palette – CSS review plus UI tests still green.
- [x] Page views get a 14 px border radius on creation – unit test (navigation main).
- [x] The page area is inset 10 px and `setInsets` reports it – UI test (PageArea / App).
- [x] Stack header, conversation and prompt render as separate cards; class names and test ids unchanged – existing UI tests pass.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: run `npm run dev` (CI/desktop, not the cloud session) in light and dark; check page card corners, resize handle, approval card, `/config`, Recall, history, debug panel, zoom.
- Automated test coverage: unit (navigation main), existing UI tests.
- Regression considerations: page bounds with chrome zoom; acting frame ring.

## 13. Rollout / Follow-up

- Rollout plan: ships enabled, no flag.
- Follow-up work: bundle IBM Plex (needs an ADR); empty-state illustration.

## 14. Changes during implementation

Note any deviations from the original spec during implementation.

- Not run in the cloud session (no Electron binary): `npm run dev`, e2e and a visual check of the result; CI runs e2e. The page card's inset comes from `.shell` padding, so no change to `PageArea` or its test was needed.
- Also restyled: debug panel, Recall, History and `/config` as rounded cards (same tokens).
- The e2e layout assertions in `e2e/prompt.spec.ts` assumed an edge-to-edge page view; they now expect the 10 px frame (`FRAME`) around and between the page card and the panel.
- The debugger e2e test now polls until the panel width (`400 + 3 * FRAME`) is reached before it measures, because a single read once saw an unsettled layout in CI (404 instead of 400).
