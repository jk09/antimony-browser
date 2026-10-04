# Feature Specification: Field-of-view prompt (Ctrl/Cmd+I) and drop the back/forward skills

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | A "field of view" prompt that opens over the middle of the page on Ctrl/Cmd+I and hands what is entered to the sidebar prompt; the sidebar prompt moves to Ctrl/Cmd+Alt+I; the `/back` and `/forward` built-in skills are removed |
| **Spec ID** | glass-meridian-f5y2nq |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-03 12:00 +00:00 |
| **Last updated** | 2026-10-04 09:00 +00:00 |
| **Affected features** | prompt, navigation, skills |
| **Target release** | 0.1.0 |
| **Related links** | spec amber-switch-b6t1qx (Ctrl/Cmd+B), ADR 0003 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The only prompt is at the bottom of the right-hand panel, far from where the user looks while reading a page. `/back` and `/forward` as skills duplicate what the mouse buttons and the assistant's `go_back`/`go_forward` tools already do.
- **Desired outcome:** Ctrl/Cmd+I opens a prompt that looks exactly like the sidebar prompt, centred over the page. Pressing Enter flies it into the sidebar prompt, which carries on (URL, command or question). Ctrl/Cmd+Alt+I reaches the sidebar prompt directly. The `back` and `forward` built-in skills are gone.

## 3. Background and Context

- **Current behavior:** Ctrl/Cmd+L shows the panel and focuses its prompt; Ctrl/Cmd+B toggles the panel. The built-in skills are `back`, `forward`, `reload`, `stop`. Pages are native views above the chrome UI, so chrome UI cannot draw over a page.
- **Motivation:** Ask without moving the eyes to the edge of the window.
- **Related issues or references:** docs/architecture.md (pages sit above the chrome UI).

## 4. Goals

- Remove the `back` and `forward` built-in skills (`/back`, `/forward`).
- Ctrl/Cmd+I opens a field-of-view prompt, identical in look and behaviour of input (suggestions, attachments, model picker) to the sidebar prompt, centred over the page.
- Submitting hands the entry to the sidebar prompt, with a visible movement of the card into the sidebar.
- Ctrl/Cmd+Alt+I shows the sidebar and focuses its prompt.

## 5. Non-Goals

- Removing the `go_back`/`go_forward` assistant tools or the mouse/menu back and forward.
- Removing Ctrl/Cmd+L (it stays as an alias of Ctrl/Cmd+Alt+I).
- A live (non-snapshot) page behind the overlay.

## 6. User Stories

- As a user, I press Ctrl+I while reading, type a question and press Enter, and the answer streams in the sidebar.
- As a user, I press Ctrl+Alt+I to jump to the sidebar prompt.

## 7. Functional Requirements

1. The built-in skills are `reload` and `stop` only.
2. Ctrl/Cmd+I opens the field-of-view prompt from anywhere in the window (page focused too); pressing it again, Escape, or a click outside the card closes it without running anything.
3. It is the same `Prompt` component as the sidebar's, in a card over the middle of the page area (horizontally centred, a little above the vertical middle).
4. Enter (or accepting a suggestion that runs) hands text and attachments to the sidebar prompt, which runs them as if typed there. Empty input does nothing. The sidebar is shown if hidden.
5. While it flies, the card moves and scales onto the sidebar prompt's card; then the overlay closes and the sidebar prompt runs the entry.
6. Ctrl/Cmd+Alt+I shows the sidebar and focuses its prompt (like Ctrl/Cmd+L).
7. While the overlay is open the page view is hidden and its snapshot is shown in its place; the page is visible again after the overlay closes, whichever way it closes.

## 8. Non-Functional Requirements

- Performance: opening captures one page screenshot (≤ 1280 px wide JPEG); the animation is ≤ 400 ms and skipped with `prefers-reduced-motion`.
- Reliability: no page, or a failed capture, opens the overlay without a backdrop; the page view is never left hidden.
- Security: two new IPC channels, sender-checked through `ctx.ipc`: `prompt:cover-page` (hides the page view, returns a snapshot data URL or null) and `prompt:uncover-page`; one main → UI event `prompt:field-of-view`. The snapshot goes only to the chrome UI. Web content still gets no IPC. Main reads Ctrl/Cmd+I and Ctrl/Cmd+Alt+I in pages (`before-input-event`), which pages no longer receive.
- Privacy: nothing stored; the snapshot lives in memory while the overlay is open.
- Accessibility: the overlay is a labelled dialog; focus goes into the prompt; Escape closes it.
- Platforms: Cmd on macOS, Ctrl elsewhere; the Alt+I key is matched by physical key (macOS Option+I types a different character).

## 9. UX / UI Notes

- User flow: Ctrl+I → card appears, dimmed page snapshot behind → type → Enter → card flies into the sidebar → the sidebar shows the conversation.
- Visual considerations: `.prompt-card` styling is reused unchanged.
- Edge cases: sidebar hidden (shown first); a run already active (the sidebar prompt reports it); no page loaded; window resize while open (the overlay follows the page area).

## 10. Technical Notes

- Proposed approach: `PageControls.setHidden(hidden)` in navigation hides the active tab's view (`View.setVisible`) without changing its bounds, so the page does not reflow. Prompt main captures the page and hides it in `prompt:cover-page`. `FieldOfView.tsx` renders the overlay inside `AssistantPanel`, which owns the handoff to its `Prompt`.
- Process split: main (`before-input-event`, menu items `Field of View Prompt…` Ctrl/Cmd+I and `Assistant Prompt` Ctrl/Cmd+Alt+I, capture); UI (overlay, handoff, animation).
- Dependencies: navigation (`getPage`, new `setHidden`).
- Risks / unknowns: the snapshot can differ slightly from the live page (video, animation).
- Open questions: none.

## 11. Acceptance Criteria

- [x] `/back` and `/forward` no longer exist; `/reload` and `/stop` still do.
- [x] Ctrl/Cmd+I opens the overlay with a focused prompt; Ctrl/Cmd+I again, Escape or a click outside closes it.
- [x] Enter in the overlay runs the entry through the sidebar prompt (URL, command and question), showing the sidebar if hidden.
- [x] The overlay card moves to the sidebar's prompt card before closing.
- [x] The page view is hidden while the overlay is open and visible again afterwards.
- [x] Ctrl/Cmd+Alt+I shows the sidebar and focuses its prompt.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: Ctrl+I over a loaded page, ask a question, watch the flight; Ctrl+Alt+I with the sidebar hidden.
- Automated test coverage: unit – key matchers and menu items (`prompt/main.test.ts`), cover/uncover, `setHidden` (`navigation/main.test.ts`), overlay open/close/handoff (`prompt/ui/FieldOfView.test.tsx`). The Electron e2e suite does not run in cloud sessions; CI runs it.
- Regression considerations: Ctrl/Cmd+B and Ctrl/Cmd+L unchanged.

## 13. Rollout / Follow-up

- Rollout plan: none (no flag).
- Follow-up work: a live page behind the overlay via a popup `WebContentsView`.

## 14. Changes during implementation

- The field of view is rendered inside `AssistantPanel` (which owns the handoff to its `Prompt`), not mounted separately in `App.tsx`.
- Opening the sidebar prompt (Ctrl/Cmd+L, Ctrl/Cmd+Alt+I) while the field of view is open closes it.
- The flight takes 160 ms (not ≤ 400 ms); on landing the entry is copied into the sidebar prompt, which runs it 140 ms later, so the copy is seen.
- Reopened (Active) for the handoff follow-up; Done again since its PR (#31) merged.
- Prior spec drifting-nimbus-r8c3kw was set to Done (its PR is merged) so only this spec is Active.
