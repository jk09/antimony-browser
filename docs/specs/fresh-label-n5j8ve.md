# Feature Specification: The assistant renames stacks

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | `rename_stack` tool: the assistant gives a stack a new `@name` |
| **Spec ID** | fresh-label-n5j8ve |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-11 11:00 +00:00 |
| **Last updated** | 2026-10-11 11:40 +00:00 |
| **Affected features** | agent, stacks |
| **Target release** | 0.1.0 |
| **Related links** | the other stack tools: specs open-roster-v5n9qk, steady-helm-q2w7xd, brief-pruner-z8k3mf, settled-row-h4n6tp; PRs #71–#75; PR #76 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Stack names are derived once from the first page's title (`@the-mathocalypse-hacker-news`) and can't be changed.
- **Desired outcome:** "Call this stack work" → the assistant's `rename_stack` gives it `@work`.

## 3. Background and Context

- **Current behavior:** `deriveName` sets a slug of the root title (else host), ≤ 32 characters, unique with `-2`…, only while the name is null; nothing renames.

## 4. Goals

- Rename any open stack by name, with the same name rules as derived names.

## 5. Non-Goals

- Renaming in the switcher UI (follow-up); renaming pages (refs are derived).

## 6. User Stories

- As a user, I want to rename `@1000-build-your-own-newsfeed-ino` to `@news` so I can type `@news`.

## 7. Functional Requirements

1. **Port** `StackPort.rename(name, wanted)`: `wanted` is slugged (`slug`, ≤ 32); if another stack has it, `-2`, `-3`… is added (`uniqueName`, the stack's own name doesn't count). Returns `{ name, asked }` (the name it now has, the slug asked for); `asked` '' (no letters or digits) changes nothing; null for an unknown stack. Saved and published.
2. A renamed stack keeps its name (derivation only fills a null name).
3. **Tool** `rename_stack { stack, name }` (kind `stack`): no approval (undone by renaming back), not replayable, no page or history access. Results: `Renamed @a to @b.`, `… to @b-2 (@b is taken by another stack).`, `@a already has that name.`; errors for unknown stacks and unusable names.

## 8. Non-Functional Requirements

- Security: no new IPC. A macro step `switch_stack { stack: "old" }` stops matching after a rename (it fails with "No stack is named"), as it would after closing that stack.
- Privacy: the name is stored in `stacks.json` as before.

## 9. UX / UI Notes

- Decision (user): a taken name gets a suffix instead of being refused.

## 10. Technical Notes

- `stacks/main.ts` (`rename` on the port), `agent/main/tools.ts` (definition, `describeCall`, `renameStack`), system prompt line.

## 11. Acceptance Criteria

- [x] Renames are slugged, made unique with -2, unchanged for an unusable or equal name, capped at 32, kept after later visits – `stacks/main.test.ts › lets the assistant rename a stack…`.
- [x] The tool reports the new name, a suffix and why, errors on unknown stacks and unusable names, needs no approval, isn't replayable – `agent/main/tools.test.ts › rename_stack`, `agent/main/agent.test.ts › renames stacks without approval`.
- [x] `npm run check` and e2e pass.

## 12. Testing / Verification

- Manual test plan: "rename this stack to work", then type `@work` in the prompt.

## 13. Rollout / Follow-up

- Rollout plan: no flag.
- Follow-up work: rename in the switcher (double-click the name).

## 14. Changes during implementation
