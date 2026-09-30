---
name: spec
description: Create or refine a feature spec before implementation. Use when starting a new feature or a change without an active spec.
---
1. Ask clarifying questions until scope is unambiguous.
2. Create docs/specs/<slug>-<code>.md (<slug> are two random words separated by a hyphen, <code> is a unique identifier consisting of random lowercase letters and numbers). The format should follow the feature spec template in docs/specs/feature-spec-template.md.
   - **Spec ID** = the file name without `.md`. Commits and feature docs reference it (`Spec: <spec-id>`).
   - **Affected features** = the feature folders the change touches (new ones included), so `document-feature` knows what to update.
   - Acceptance criteria must be testable; the `ship` skill ticks them off.
   - Keep **Status** `Draft`.
3. Stop and ask the user to approve. On approval set **Status** to `Active` in the metadata table and update **Last updated**.
   The SessionStart hook (`.claude/scripts/active-spec.ps1`) loads the first `Active` spec into every new session; keep one spec active at a time.
4. Do not write implementation code in this skill.
