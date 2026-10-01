# Feature Specification: Assistant side panel

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Assistant side panel (prompt docked on the right) |
| **Spec ID** | still-meridian-r4v8nc |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 02:45 +00:00 |
| **Last updated** | 2026-10-01 04:00 +00:00 |
| **Affected features** | prompt, agent, skills, navigation |
| **Target release** | 0.1.0 |
| **Related links** | [violet-harbinger-p7w3kd](./violet-harbinger-p7w3kd.md) (LLM prompt bar; its card-on-top layout is replaced by this) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The prompt card opens at the top of the window and grows with the conversation, attachments, suggestions and the skill form. Every line it grows pushes the page view down, so the page jumps and shrinks while the user talks to the assistant.
- **Desired outcome:** The prompt lives in a panel docked on the right side of the window, like the Claude Code side panel: the conversation fills the panel from the top, the prompt input sits at the bottom. The page view takes the rest of the window and keeps its size while the conversation grows.

## 3. Background and Context

- **Current behavior:** The toolbar at the top holds a collapsed bar (page title and URL). Ctrl/Cmd+L expands it into a card (conversation up to 40 vh, status, messages, attachments, input, suggestions, button row), and the "Save as skill" form opens under it. `PageArea` measures its box and reports insets, so the page view moves down by the card's height. Escape collapses the card; a URL submit collapses it.
- **Motivation:** Keep the page large and stable. Long answers and multi-step runs make the card tall (see the screenshot in the request: the page starts below a 700 px card).
- **Related issues or references:** The layout follows the Claude Code panel in a VS Code-like window: page on the left, the conversation in the panel above a prompt anchored to the panel's bottom.

## 4. Goals

- Goal 1: The page view's size depends only on the window size and on panels the user shows, hides or resizes, never on the conversation, input, suggestions or skill form.
- Goal 2: The conversation uses the full height of the panel; the prompt input stays at its bottom.
- Goal 3: Everything the prompt does today (classification, suggestions, attachments, approvals, commands, model picker, page access) keeps working unchanged.

## 5. Non-Goals

- Non-goal 1: Panel on the left, floating or undocked panels, several conversations or tabs in the panel.
- Non-goal 2: Remembering the panel width or hidden state across restarts (follow-up).
- Non-goal 3: Changing the agent, its tools, or the debugger's content.
- Non-goal 4: A separate address bar or toolbar (back/forward buttons). The page title and URL move into the panel header.

## 6. User Stories

- As a user, I want to chat with the assistant while the page stays where it is, so I can see what the assistant does to it.
- As a user, I want long answers to scroll inside the panel instead of pushing the page off screen.
- As a user, I want to hide the panel when I just want to read a page, and get it back with Ctrl/Cmd+L.

## 7. Functional Requirements

### Layout (app shell, `App.tsx`)
1. The top toolbar is removed. The window is one row: the page area (with the acting frame) on the left, then the assistant debugger when shown, then the assistant panel on the right edge.
2. The assistant panel is shown at startup, 400 px wide, and can be resized by dragging its left edge between 300 px and 720 px, but never so wide that the page area gets narrower than 240 px. Its width doesn't change by itself.
3. The page view is laid out over the page area as today (`PageArea` insets). Nothing inside the panel changes the page area's size.

### Panel (feature `prompt`)
4. From top to bottom the panel shows: a header, the conversation, the skill save form (when open), and the prompt card.
   - Header: the page title and URL (one line each, ellipsized; "New tab" with no page), and a hide (×) button.
   - Conversation: fills the remaining height and scrolls; it stays scrolled to the newest item while new items arrive, unless the user has scrolled up. With no conversation, the area shows a short hint ("Ask about this page, type a URL, or / for skills").
   - Skill save form: scrolls by itself, at most half the panel's height.
   - Prompt card: the existing card (status, message, attachments, preview, input or key field, button row), anchored to the bottom. The suggestion list opens above the input instead of below it.
5. The prompt card is always expanded while the panel is shown; there is no collapsed bar any more. The card's own height is capped (input ≤ 200 px as today, attachment preview ≤ 240 px), so a long input can't push the conversation off the panel.
6. Ctrl/Cmd+L (File → Prompt…) shows the panel if hidden and focuses the input, selecting its text; it does not change the panel width otherwise.
7. Hide (× in the header) hides the panel; the page area takes the full width. The panel shows again by itself when an approval is asked (as the card does today), and with Ctrl/Cmd+L.
8. Escape in the input closes the suggestion list, otherwise stops a running assistant, otherwise does nothing (it no longer hides anything).
9. Submitting a URL clears the input and leaves the panel as it is; the page view gets keyboard focus after the navigation starts, as after Enter in a browser's address bar.
10. The "Assistant is acting…" status shows in the card; the input row's send button turns into the Stop button while a run is active (no second Stop button in the status line). The page's accent frame (agent) is unchanged.

### Debugger (feature `agent`)
11. The debugger stays docked between the page area and the assistant panel and keeps its resize handle on its left edge; its width is computed from its own right edge (so it doesn't jump when the assistant panel is shown).

### Navigation (feature `navigation`)
12. `TOOLBAR_HEIGHT` is removed. The page view starts with no insets until the chrome UI reports them (it does so on mount, before any page can be loaded from the prompt).
13. `navigation:go` focuses the page view after starting the load (req. 9).

## 8. Non-Functional Requirements

- Performance: Resizing the panel reports insets at most once per animation frame; no extra IPC per conversation update (the page area's box doesn't change).
- Reliability: Window minimum width stays 480 px; at that width the panel shrinks to keep the 240 px page area, down to its 300 px minimum, after which the page area may get narrower (never negative).
- Security: No new IPC channels and no new capabilities for web content. `navigation:go` additionally calls `webContents.focus()` on the page view. `secureWebPreferences` unchanged.
- Privacy: Nothing new stored or sent.
- Accessibility: The panel is a `complementary` landmark labelled "Assistant"; the resize handle is a `separator` with `aria-orientation="vertical"` and arrow-key resizing (±16 px); the hide button is labelled "Hide assistant"; the prompt keeps its labels, combobox pattern and focus rules.
- Platforms: Same on all platforms.

## 9. UX / UI Notes

- User flow: App starts → page area on the left (placeholder until a page loads), panel on the right with the input at its bottom → type a URL, Enter → page loads, focus moves to the page, panel unchanged → Ctrl+L → type a question → conversation grows upward from the input and scrolls; the page doesn't move.
- Visual considerations: Panel background `--card-bg`, 1 px left border `--field-border`; header 40 px with the title in `--text` and URL in `--muted`; the card keeps its rounded accent border with 8–12 px margins inside the panel; the user turns keep their right-aligned bubbles (max 85 % of the panel width). Plain CSS, light and dark.
- Edge cases: Approval pending while hidden → panel shows. Skill save requested while hidden → panel shows. Window narrower than panel + 240 px → panel shrinks (req. 2). Debugger and panel both open on a small window → page area may shrink to its minimum; the debugger keeps its 280 px minimum.

## 10. Technical Notes

- Proposed approach: A new `AssistantPanel` component in `prompt/ui/` (the panel belongs to the prompt feature, which already hosts the conversation via a prop) renders the header, a `conversation` slot, a `form` slot (the skills form) and the existing card. `App.tsx` passes `<Conversation />` and `<SaveSkill />` into it, like `conversation` today, so the cross-feature rule holds. `Prompt.tsx` loses the collapsed state; its `open` state moves to the panel as `shown`. CSS: `.shell` becomes a row (`.workspace` + panel), the panel a flex column whose conversation part is `flex: 1; min-height: 0; overflow-y: auto`.
- Process split: UI only, except `navigation/main.ts` (initial insets, focus after `go`). No IPC added or changed in shape.
- Dependencies: none new.
- Risks / unknowns: Skill save form now lives in a narrow panel; its step rows already wrap. e2e tests that relied on the collapsed bar or on Escape hiding the prompt are updated.
- Open questions: –

## 11. Acceptance Criteria

- [x] The app renders the page area left and the assistant panel right, with no top toolbar; the page area's reported insets have `top: 0` (unit: `App.test.tsx`).
- [x] The prompt input is visible at startup without Ctrl+L; Ctrl+L focuses and selects it and shows a hidden panel (unit: `Prompt`/panel tests).
- [x] The panel header shows the page title and URL; × hides the panel; an approval or a skill save request shows it again (unit).
- [x] Escape closes suggestions, then stops a run, and otherwise leaves the panel shown (unit).
- [x] Suggestions render above the input (DOM order in the card) and keyboard navigation is unchanged (unit).
- [x] The panel resizes between its limits by pointer and arrow keys and never leaves the page area under 240 px when the window is wide enough (unit for the clamp function).
- [x] The conversation scrolls inside the panel and growing it doesn't change the page area's insets (unit: insets reported once for a growing conversation).
- [x] `navigation:go` focuses the page view; the page view starts with zero insets (unit: `navigation/main.test.ts`).
- [x] The debugger, docked between page and panel, resizes from its own right edge (unit).
- [x] e2e: typing a URL in the panel loads the page; a question runs the assistant and its answer shows in the panel; the page view's bounds don't change while the conversation grows (`e2e/prompt.spec.ts`, `e2e/navigation.spec.ts`, `e2e/app.spec.ts`).
- [x] prompt, agent, skills and navigation READMEs, `docs/architecture.md` UI notes and `docs/features.md` updated.

## 12. Testing / Verification

- Manual test plan: `npm run dev`; open a page; ask a question that produces a long answer and check the page doesn't move; resize the panel; hide it with × and bring it back with Ctrl+L; open the debugger with the panel shown; trigger an approval with the panel hidden; save a skill from the panel; check light and dark.
- Automated test coverage: Vitest for the panel, prompt, app, debugger and navigation changes; Playwright e2e updated for the new layout (CI runs it; cloud sessions lack the Electron binary).
- Regression considerations: Every prompt behaviour in `Prompt.test.tsx` and `e2e/prompt.spec.ts` except collapsing; navigation e2e that typed into the prompt after Ctrl+L.

## 13. Rollout / Follow-up

- Rollout plan: Ships enabled, with no flag; it replaces the top card outright.
- Follow-up work: Remember width and hidden state across restarts; Escape moves focus to the page; panel on the left as a setting; streaming answers into the panel.

## 14. Changes during implementation

- **Req. 13 needed no change:** `navigation:go` already focused the page view; the navigation e2e test now asserts it.
- **The page area's 240 px minimum is CSS** (`min-width` on the acting frame; the panel is a shrinkable flex item down to its 300 px minimum), not a JS clamp. `clampWidth` only keeps drags and arrow keys within 300–720 px.
- **The prompt card is capped at 60 % of the panel height and scrolls**, so many attachments or a long suggestion list can't squeeze the conversation to nothing.
- **The conversation also keeps its newest item in view when its box shrinks** (a `ResizeObserver`), e.g. when the suggestion list opens; found on a screenshot.
- **The status line lost its own Stop button** (req. 10): it duplicated the send button, which already turns into Stop while a run is active; found on a screenshot.
- **Suggestion labels keep at least 60 % of a row** in the narrower panel, so `/key` and `/model` aren't cut to `/…`.
- **e2e ran in this session** (the Electron binary could be downloaded): all 9 tests pass under `xvfb-run`. Screenshots at 1 400 × 800 confirmed the layout in light mode; dark mode uses the existing color tokens but couldn't be switched in Xvfb, so it wasn't checked visually.
- **History reloads after each submit**, not only when the prompt opens: the panel no longer closes and reopens, so suggestions would otherwise miss what was just typed.
