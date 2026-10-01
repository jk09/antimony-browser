# Feature Specification: Ctrl/Cmd+B shows and hides the assistant panel

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Keyboard shortcut Ctrl/Cmd+B toggles the assistant panel (the sidebar with the prompt) |
| **Spec ID** | amber-switch-b6t1qx |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-01 18:40 +00:00 |
| **Last updated** | 2026-10-01 18:55 +00:00 |
| **Affected features** | prompt |
| **Target release** | 0.1.0 |
| **Related links** | ADR 0003 (application menu from feature contributions), spec slate-compass-m5t2rw (`/menu`) |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** The assistant panel can be hidden only with its × button with the mouse, and shown only with Ctrl/Cmd+L, which also moves focus into the prompt. There is no single key to get the page full width and back.
- **Desired outcome:** Ctrl+B (Cmd+B on macOS) hides the panel when it's shown and shows it when it's hidden, from anywhere in the window, like the sidebar toggle in editors.

## 3. Background and Context

- **Current behavior:** `AssistantPanel` keeps `shown` state; × hides it, Ctrl/Cmd+L (File → Prompt…, `prompt:open`) shows it and focuses the prompt, an approval / skill save / history view shows it. While an approval is pending it can't be hidden.
- **Motivation:** Quick switching between a full-width page and the assistant with the keyboard.
- **Related issues or references:** prompt README; `src/features/prompt/main.ts` (File → Prompt…).

## 4. Goals

- Goal 1: One shortcut, Ctrl/Cmd+B, toggles the panel, whether the page or the chrome UI has focus.
- Goal 2: Keyboard focus ends up where the user can keep typing: in the prompt when shown, in the page when hidden.

## 5. Non-Goals

- Non-goal 1: Remembering the panel's visibility across restarts.
- Non-goal 2: Configurable shortcuts.
- Non-goal 3: Changing Ctrl/Cmd+L or the × button.

## 6. User Stories

- As a user, I want to press Ctrl+B to hide the assistant so that the page uses the whole window, and press it again to bring the assistant back with the prompt ready to type.

## 7. Functional Requirements

1. File menu gets **Toggle Assistant** with accelerator `CmdOrCtrl+B`, after Prompt…; it is also reachable as `/menu file toggle-assistant`.
2. If the panel is hidden, the shortcut shows it and focuses the prompt (same as Ctrl/Cmd+L).
3. If the panel is shown, the shortcut hides it and gives keyboard focus to the page (if one exists).
4. While an approval is pending the panel stays shown (existing rule); the shortcut then does nothing.
5. The shortcut works when the page has focus and when the chrome UI has focus (including while typing in the prompt).
6. The × button's tooltip mentions the shortcut: "Hide (Ctrl+B)".

## 8. Non-Functional Requirements

- Performance: none.
- Reliability: no page → hiding just leaves focus in the chrome UI.
- Security: two IPC channels, both without payload: `prompt:toggle` (main → UI) and `prompt:focus-page` (UI → main, via `ctx.ipc`, sender-checked). Web content gets nothing.
- Privacy: nothing stored or sent.
- Accessibility: keyboard-only toggle; the panel's `hidden` attribute keeps it out of the accessibility tree.
- Platforms: Ctrl+B on Windows/Linux, Cmd+B on macOS. As an application accelerator it takes precedence over pages' own Ctrl/Cmd+B (e.g. bold in web editors).

## 9. UX / UI Notes

- User flow: reading a page → Ctrl+B → panel gone, page full width, page keeps focus → Ctrl+B → panel back, cursor in the prompt.
- Visual considerations: no new UI.
- Edge cases: pending approval (no-op); no page loaded yet; panel hidden with ×, then Ctrl+B shows it.

## 10. Technical Notes

- Proposed approach: `prompt/main.ts` pushes the menu item; its click focuses the chrome UI's webContents and sends `prompt:toggle`. `AssistantPanel` toggles `shown` (ignoring it while an approval is pending): when showing, it bumps `focusRequest`; when hiding, it calls `window.antimony.prompt.focusPage()`, which main handles with `getPage()?.contents().focus()`.
- Process split: main – menu item, `prompt:focus-page` handler; preload – `onToggle`, `focusPage` on `promptBridge`; UI – `AssistantPanel`.
- Dependencies: navigation (`getPage` from its `main.ts`). No npm packages.
- Risks / unknowns: none known.
- Open questions: none.

## 11. Acceptance Criteria

- [x] File menu has Toggle Assistant with `CmdOrCtrl+B` that focuses the chrome UI and sends `prompt:toggle` – unit (`main.test.ts`).
- [x] `prompt:focus-page` focuses the page's webContents and is safe without a page – unit.
- [x] Toggle hides a shown panel and asks main to focus the page; on a hidden panel it shows it and focuses the prompt – unit (`AssistantPanel.test.tsx`).
- [x] Toggle does nothing while an approval is pending – unit.
- [x] Ctrl+B pressed in the page hides and then shows the panel – e2e.

## 12. Testing / Verification

- Manual test plan: load a page, Ctrl+B (panel hides, page scrolls with arrow keys), Ctrl+B (panel shows, typing goes to the prompt); Ctrl+B while typing in the prompt hides it; `/menu file toggle-assistant`.
- Automated test coverage: `prompt/main.test.ts`, `prompt/ui/AssistantPanel.test.tsx`, `e2e/prompt.spec.ts`.
- Regression considerations: Ctrl/Cmd+L and × behaviour unchanged; `app.spec`/menu tests that list File items.

## 13. Rollout / Follow-up

- Rollout plan: ships on by default, no flag.
- Follow-up work: remember the panel's visibility; the × button could also return focus to the page.

## 14. Changes during implementation

- **e2e ran in this session** under `xvfb-run` (Electron binary downloaded with curl): all 12 tests pass; Ctrl+B is checked in `e2e/prompt.spec.ts › the menu bar is hidden…` with `sendInputEvent` in the page.
