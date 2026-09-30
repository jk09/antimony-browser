# Feature Specification Template

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | |
| **Spec ID** | |
| **Status** | Draft <!-- one of: Draft, Active, Done --> |
| **Author** | |
| **Owner** | |
| **Reviewers** | |
| **Created on** | YYYY-MM-DD HH:MM ±HH:MM |
| **Last updated** | YYYY-MM-DD HH:MM ±HH:MM |
| **Affected features** | <!-- folder names under src/features/, new ones included --> |
| **Target release** | |
| **Related links** | <!-- issues, PRs, designs, other specs --> |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary
Provide a concise overview of the feature and why it matters.

- **Problem statement:** 
- **Desired outcome:** 

## 3. Background and Context
Describe the context, current limitations, and any related work.

- **Current behavior:** 
- **Motivation:** 
- **Related issues or references:** 

## 4. Goals
List the primary outcomes this feature should achieve.

- Goal 1:
- Goal 2:
- Goal 3:

## 5. Non-Goals
List what is explicitly out of scope for this feature.

- Non-goal 1:
- Non-goal 2:

## 6. User Stories
Capture the expected user experience.

- As a <type of user>, I want <goal> so that <benefit>.
- As a <type of user>, I want <goal> so that <benefit>.

## 7. Functional Requirements
Define the expected behavior in clear, testable terms.

1. Requirement 1:
2. Requirement 2:
3. Requirement 3:

## 8. Non-Functional Requirements
Capture quality and system constraints.

- Performance: <!-- startup, memory per tab, UI responsiveness -->
- Reliability: <!-- crashed renderers, unresponsive pages, restart behaviour -->
- Security: <!-- new IPC channels, permissions or capabilities for web content, stored data -->
- Privacy: <!-- what is stored or sent, and how the user clears it -->
- Accessibility:
- Platforms: <!-- Windows / macOS / Linux differences -->

## 9. UX / UI Notes
Describe any interface expectations or user interaction details.

- User flow:
- Visual considerations:
- Edge cases:

## 10. Technical Notes
Capture implementation guidance, architecture, and dependencies.

- Proposed approach:
- Process split: <!-- what runs in main / preload / UI; IPC channels and their direction -->
- Dependencies: <!-- other features, Electron APIs, npm packages (shipped packages need an ADR) -->
- Risks / unknowns:
- Open questions:

## 11. Acceptance Criteria
Define how success will be measured.

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## 12. Testing / Verification
Describe how the feature will be validated.

- Manual test plan:
- Automated test coverage: <!-- unit (Vitest, next to the code) / end-to-end (Playwright, e2e/) -->
- Regression considerations:

## 13. Rollout / Follow-up
Note any rollout considerations or future enhancements.

- Rollout plan:
- Follow-up work:

## 14. Changes during implementation

Note any deviations from the original spec during implementation.