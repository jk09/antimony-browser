# Feature Specification: Sound indicators and one-click mute for stacks

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Each stack (tab) whose page plays sound shows a speaker indicator in the stack header and the stack list; one click on it mutes or unmutes that tab |
| **Spec ID** | quiet-speaker-m8v3tz |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-04 17:00 +00:00 |
| **Last updated** | 2026-10-04 17:50 +00:00 |
| **Affected features** | navigation, stacks |
| **Target release** | 0.1.0 |
| **Related links** | PR #37, specs branching-trail-k4w9zp, nimble-anchor-w3p8kd (stack switcher), ADR 0008 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** A video or audio playing in a background stack can't be found without switching through the stacks, and there is no way to silence a tab short of pausing it in the page or closing it.
- **Desired outcome:** Every stack that plays sound shows a speaker icon; clicking the icon mutes the tab (the icon shows it muted), clicking again unmutes it.

## 3. Background and Context

- **Current behavior:** Tabs are stacks (ADR 0008). The header shows the current stack's name (`@name ▾`), the list it opens shows all stacks. Nothing reflects audio.
- **Motivation:** Standard browser behaviour (Chrome, Firefox tab audio indicators).
- **Related issues or references:** Electron `webContents` `audio-state-changed`, `isCurrentlyAudible()`, `setAudioMuted()`, `isAudioMuted()`.

## 4. Goals

- See at a glance which stacks play sound, the current one included.
- Mute or unmute a stack with one click, without switching to it.

## 5. Non-Goals

- Remembering mute across restarts or across a stack's tab being recreated.
- Muting a site everywhere, a global mute, or a keyboard shortcut / menu item for mute.
- Indicators per page (tree row) – audio belongs to the tab, i.e. the stack.
- Indicators for camera/microphone use.

## 6. User Stories

- As a user, I want to see which stack is playing a video so that I can go to it or silence it.
- As a user, I want to mute a noisy stack with one click so that I can keep it open without hearing it.

## 7. Functional Requirements

1. Navigation reports each tab's audio: `TabControls.audio(id)` returns `{ audible, muted }` (null for an unknown tab) and a page event `{ type: 'audio', audible, muted }` is emitted when Chromium reports the tab became audible or inaudible, or when its mute changes. `TabControls.setMuted(id, muted)` mutes or unmutes a tab.
2. Stacks adds `audio: 'playing' | 'muted' | null` to each `StackSummary`: `muted` while the stack's tab is muted, `playing` while it is audible and not muted, null otherwise (also for a stack without a live tab).
3. New channel `stacks:set-muted` (UI → main) with `{ stackId, muted }`: `stackId` must name an open stack, `muted` must be a boolean; a stack without a live tab is ignored.
4. The header shows the indicator next to the current stack's name; the stack list shows it on every stack's row. It's a button: a speaker icon while playing ("Mute tab"), a struck-through speaker while muted ("Unmute tab"); a click toggles mute and doesn't switch stacks or close the list.
5. Muting is allowed while the assistant runs (it neither switches nor closes stacks).
6. Audio changes publish the stacks state but don't rewrite `stacks.json`.

## 8. Non-Functional Requirements

- Performance: audio events are rare (Chromium debounces audibility by ~2 s); state is batched by the existing 16 ms publish.
- Reliability: a tab whose renderer is gone or that was closed reports no audio.
- Security: one new IPC channel, validated (open stack id, boolean). Web content gains nothing.
- Privacy: nothing stored.
- Accessibility: the indicator is a real button with an `aria-label` naming the action and the stack (`Mute @name` / `Unmute @name`) and `aria-pressed` for the muted state; title tooltip.
- Platforms: all.

## 9. UX / UI Notes

- User flow: a video starts in a background stack → its row in the stack list and, if current, the header show 🔊 → click → 🔇, sound stops → click → sound returns.
- Visual considerations: small inline SVG icon (currentColor) in the existing header style, between the name and the stack's details.
- Edge cases: muted tab that stops playing keeps the muted icon (so it can be unmuted); a stack switched away and back keeps its mute (same tab); a stack whose tab is recreated (restart) starts unmuted.

## 10. Technical Notes

- Proposed approach: navigation listens to `audio-state-changed` per tab and emits an `audio` page event (held like other events for a prepared tab); `setMuted` calls `setAudioMuted` and emits the event. Stacks keeps the last audio per tab in a map, computes `audio` in `state()`, and publishes on change.
- Process split: main (navigation events, stacks state and channel), preload (`setMuted` bridge), UI (`StackHeader`).
- Dependencies: Electron `webContents` audio APIs; no npm package.
- Risks / unknowns: Chromium reports audibility with a delay of a couple of seconds after sound stops.
- Open questions: none.

## 11. Acceptance Criteria

- [x] Navigation emits `audio` events from `audio-state-changed` and after `setMuted`, and `audio(id)` reports the tab's state – `navigation/main.test.ts`.
- [x] Stacks state shows `playing` / `muted` / null per stack, and `stacks:set-muted` mutes the stack's tab and rejects invalid arguments – `stacks/main.test.ts`.
- [x] The header and the list show the indicator only for stacks with audio, and a click calls `setMuted` with the toggled value without switching stacks – `stacks/ui/StackHeader.test.tsx`.
- [x] `npm run check` passes.

## 12. Testing / Verification

- Manual test plan: play a YouTube video, switch to another stack, open the list → speaker on the video's stack; click → muted icon, silent; click again → sound; current-stack indicator in the header does the same.
- Automated test coverage: unit tests above; e2e not added (audio output is unreliable in headless CI).
- Regression considerations: prepared spare tab events, stack switching, the Ctrl+Tab cycle list.

## 13. Rollout / Follow-up

- Rollout plan: no flag.
- Follow-up work: a mute shortcut / menu item; a hint on the `@name ▾` button when another stack plays.

## 14. Changes during implementation

- None in behaviour. Navigation's `setMuted` emits the `audio` event itself (Chromium sends `audio-state-changed` only for audibility). e2e not run in the cloud session (no Electron binary); CI runs it.
