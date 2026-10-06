# Feature Specification: Let the assistant recall pages from history, also by an attached image

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | The assistant gets a `recall_history` tool: Recall's ranking with keywords and scores, by a request and/or an image the user attached, and shows the result as Recall's cloud |
| **Spec ID** | amber-orbit-q7t3vn |
| **Status** | Done <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-06 05:15 +00:00 |
| **Last updated** | 2026-10-06 05:30 +00:00 |
| **Affected features** | agent, history |
| **Target release** | 0.1.0 |
| **Related links** | specs drifting-nimbus-r8c3kw (Recall), patient-archive-h6q2wn (search_history); ADRs 0010, 0012, 0014; PR jk09/antimony-browser#47 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** Recall (keyword / picture cloud, recall by sketch) exists only on the Recall page, and the assistant's `search_history` returns a plain list by text or meaning. Asked "find the page that had a picture like this" with a pasted image, or "show me what I read about lions as a cloud", the assistant can't do it.
- **Desired outcome:** A `recall_history` tool that runs Recall from the assistant: by a request, by an image attached to the user's message (compared with history screenshots, as a sketch is), or both. The model gets the matching pages with relevance scores and keywords; the user sees the result as the cloud on the Recall page.

## 3. Background and Context

- **Current behavior:** History's `recall` (main) picks candidates, asks the selected model for pages, scores and keywords, and with a sketch sends the sketch plus up to 16 scaled screenshots (ADR 0010). The assistant reaches history only through `provideHistorySearch` (`search_history`, kind `history`, ADR 0012). The prompt sends pasted images as attachments of the run (PNG, JPEG, GIF, WebP).
- **Motivation:** The user asked for a `recall_history` assistant tool (Recall spec follow-up); they chose all three parts: recall by an attached image, show the cloud, and keywords for the model.

## 4. Goals

- Goal 1: `recall_history` with `query` and/or `image` (which attached image of the current request to use as the sketch).
- Goal 2: The model gets up to 20 pages (title, URL, last visit, score, keywords, note) and the heaviest keywords, as untrusted data.
- Goal 3: Unless the model passes `show: false`, the Recall page opens with the request and the same result (no second model request), in the view the model asked for or Recall suggested.
- Goal 4: Same gating as `search_history`.

## 5. Non-Goals

- Non-goal 1: Images from earlier messages of the conversation, from the page or from URLs; only images attached to the current request.
- Non-goal 2: Showing the attached image on the Recall page's sketch pad.
- Non-goal 3: Replacing `search_history` (it stays the cheap list search).

## 6. User Stories

- As a user, I want to paste a photo and ask "which page in my history had a picture like this?" and get the page.
- As a user, I want to ask "show me everything I read about lions" and see the keyword cloud, then open a page.
- As a user, I want the assistant to know what my recalled pages were about (keywords, scores) so it can answer follow-up questions.

## 7. Functional Requirements

1. Tool `recall_history`, kind `history`: input `query` (string, ≤ 500 chars, optional), `image` (integer ≥ 1: the n-th image attached to the current request, optional), `view` (`words` | `images`, optional), `show` (boolean, default true). At least one of `query` and `image` is required.
2. Offered and allowed only while history access is on; needs no page access or approval; like `search_history` it counts as reading content, so a later cross-site navigation in the run needs approval (ADR 0012).
3. `image` that doesn't exist in the current request → tool error naming how many images are attached. PNG or JPEG images are converted to JPEG (scaled to at most 800 px wide) and used as the sketch; other formats → tool error.
4. History runs its existing `recall` (same candidates, prompt, ADR 0010 image rules, fallback to text matches with a notice). The tool result lists at most 20 pages, best first, and at most 20 keywords with weights, inside `<untrusted_page_content>`; the notice (fallback, failure) comes first. A recall the user starts on the Recall page meanwhile doesn't abort the tool's recall, and vice versa.
5. With `show` (default), main sends the request text and result to the chrome UI (`history:recall-shown`); the Recall page opens with them, shows the cloud in `view` (else the result's suggested view) and a line saying the assistant recalled it (and that an attached image was used). Opening a page from there works as on the Recall page.
6. The conversation shows the call as `Recall history for "<query>"` (plus ` by your image <n>` when an image is used).

## 8. Non-Functional Requirements

- Performance: one model request per call (as Recall); image conversion in main with `nativeImage`.
- Reliability: the tool's recall is aborted when the run is stopped.
- Security: new main → UI event `history:recall-shown`; no new UI → main channel. The tool's input is validated in the agent; history validates the image (type, size ≤ 5 MB as prompt attachments) again. No new web-content capability.
- Privacy: as Recall (ADRs 0006, 0010): with an image, the image and up to 16 small screenshots go to the selected model; history data reaches the model in the run as with `search_history` (ADR 0012). Off with `/history-access off`.
- Accessibility: as the Recall page.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: paste a photo, type "which page in my history had a picture like this?" → the assistant calls `recall_history { image: 1 }` → Recall opens with the picture cloud → the assistant answers with the best match.
- Edge cases: no image attached; GIF/WebP image; history access off; nothing matches (Recall shows "Nothing in history matches."); run stopped mid-recall.

## 10. Technical Notes

- Proposed approach: `HistoryPort` gains `recall({ query, image, view, show }, signal)`; history's `recall` gets an optional `AbortSignal` and separate controllers for the UI and the assistant. The agent keeps the current request's image attachments and hands them to the tool through `ToolPorts.images`.
- Process split: all in main; one new main → UI event; `RecallView` subscribes via the bridge (`onRecallShown`).
- Dependencies: agent ↔ history only through `provideHistorySearch` (existing); Electron `nativeImage`.
- Risks / unknowns: Ollama models without vision ignore the image.
- Open questions: none.

## 11. Acceptance Criteria

- [x] `recall_history` is offered only with history access on, validates its input (query or image required, limits, view enum) – unit tests.
- [x] The tool uses the n-th attached image of the current request, errors for a missing image or an unsupported format – unit tests.
- [x] The tool result lists pages with scores and keywords, keywords with weights, inside `<untrusted_page_content>`, notice first – unit test.
- [x] A cross-site navigation after `recall_history` in the run needs approval – unit test.
- [x] History converts the image to JPEG, runs recall with it as the sketch and sends `history:recall-shown` unless `show` is false – unit tests.
- [x] The Recall page opens with a shown result in the requested view and says the assistant recalled it – UI test.
- [x] Stopping the run aborts the recall; a UI recall doesn't abort the assistant's – unit test.

## 12. Testing / Verification

- Manual test plan: with summaries on, visit pages with distinctive images for ≥ 30 s; paste a similar picture and ask the assistant to find the page; ask "show me pages about <topic> as a cloud".
- Automated test coverage: unit (agent tools, agent run, history main), UI (RecallView).
- Regression considerations: `search_history`, Recall page behaviour unchanged.

## 13. Rollout / Follow-up

- Rollout plan: ships enabled, follows `/history-access`.
- Follow-up work: images from earlier messages or the current page.

## 14. Changes during implementation

Note any deviations from the original spec during implementation.

- The tool's privacy change (the assistant can start an image Recall) is recorded in ADR 0014 (Proposed).
- Tool schemas may now use `integer` (`validateInput` accepts whole numbers for it), for `image`.
- End-to-end tests were not run in the cloud session (no Electron binary); CI runs them.
