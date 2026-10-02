# Feature Specification: Recall – find pages from history as a word or image cloud

## 1. Metadata

| Field | Value |
| --- | --- |
| **Feature name** | Recall: pages from history by a prompt or a sketch, shown as a keyword or image cloud |
| **Spec ID** | drifting-nimbus-r8c3kw |
| **Status** | Active <!-- one of: Draft, Active, Done --> |
| **Author** | Claude Code |
| **Owner** | jk09 |
| **Reviewers** | jk09 |
| **Created on** | 2026-10-02 20:10 +00:00 |
| **Last updated** | 2026-10-02 20:40 +00:00 |
| **Affected features** | history, prompt, agent |
| **Target release** | 0.1.0 |
| **Related links** | ember-ledger-h3x8vq (history), ADR 0006, ADR 0010 |

**Status definitions:**
- **Draft:** The spec is being written or reviewed. The scope may still change.
- **Active:** The spec is approved and being implemented.
- **Done:** The feature is shipped. Record any changes from the spec in section 14.

## 2. Summary

- **Problem statement:** History can be searched by words or by meaning, but only as a narrow list in the assistant panel. There is no way to see *what* a set of pages was about at a glance, and no way to look for a page by what an image on it looked like.
- **Desired outcome:** A Recall page that takes a natural-language request ("show all pages about lions") and optionally a sketch ("pages which contain an image like this sketch"), asks the selected model which pages in history match, and shows the result as a cloud: either a keyword cloud (words sized by how strongly the matching pages are about them) or an image cloud (the pages' screenshots sized by relevance). Clicking a keyword lists its pages; clicking a page opens it.

## 3. Background and Context

- **Current behavior:** `history` keeps pages in SQLite with FTS5, screenshots (≥ 30 s dwell) and opt-in summaries that include a one-sentence visual description (`LOOKS:`). Meaning search sends up to 180 candidates' titles, URLs, descriptions, summaries, visual descriptions and notes to the selected model and gets back ranked ids (`main/semantic.ts`). `agent.complete` sends one optional JPEG with the text.
- **Motivation:** Re-finding a page often starts from a vague memory: the topic, or a picture that was on it. A cloud shows the shape of what was read; a sketch is the natural way to say "it had a picture like this".
- **Related issues or references:** ADR 0006 (history search by the selected model).

## 4. Goals

- Goal 1: Recall pages by a free-text request using the existing candidate selection plus model ranking, extended so the model also returns keywords per page and a relevance score.
- Goal 2: Recall pages by a sketch drawn in the Recall page: the sketch goes to the model as an image together with small copies of the candidates' screenshots (and their visual descriptions), so it can compare what the pages actually looked like.
- Goal 3: Show the result as a keyword cloud or an image cloud (the model suggests which fits the request; the user can switch), laid out without overlaps, largest items in the middle.
- Goal 4: Reach the Recall page with `/recall <request>` and from File → Recall from History….

## 5. Non-Goals

- Non-goal 1: Embeddings or a local vision model (ADR 0006 option 2 stays open).
- Non-goal 2: Storing or matching individual images inside pages; visual matching uses the stored page screenshot (the visible part of the page at high dwell).
- Non-goal 3: Sending screenshots without a sketch: a text-only Recall sends no images.
- Non-goal 4: An assistant tool for recall (follow-up, see section 13).

## 6. User Stories

- As a user, I want to type "show all pages about lions" and see the words those pages were about, so I can pick the one I meant.
- As a user, I want to sketch the picture I remember and see the pages whose screenshot looked like it.
- As a user, I want to switch between words and pictures for the same result.

## 7. Functional Requirements

1. `/recall <request>` and File → Recall from History… (Ctrl/Cmd+Shift+Y) open the Recall page over the page area; Escape or its Close button returns to the page. The page view is hidden while Recall is open.
2. The Recall page has a request field, a sketch pad (draw with mouse, pen or touch; Clear), a Words / Pictures switch and a Recall button. Requests with neither text nor sketch are not sent.
3. Main picks candidates like Meaning search (FTS `OR` matches of the request plus the most recent described pages); with a sketch it adds the most recent pages that have a screenshot, and sends the sketch plus up to 16 of the candidates' screenshots (text matches first, then most recent), each scaled to 320 px wide and labelled with its page id.
4. The model answers with JSON: a suggested view (`words` / `images`) and up to 40 pages, each with a relevance score (0–1) and up to 6 short keywords. Only known candidate ids are kept; scores are clamped; keywords are trimmed, lower-cased, de-duplicated and capped in length.
5. Keyword cloud: each keyword's weight is the sum of the scores of the pages that carry it; the 60 heaviest are shown, font size by weight. Clicking a keyword lists its pages (title, URL, thumbnail); clicking a page opens it in the current tab and closes Recall.
6. Image cloud: every recalled page with a screenshot is a tile sized by its score; pages without a screenshot appear as title tiles. Clicking a tile opens the page.
7. The cloud layout is deterministic: items placed in descending weight along an outward spiral from the centre, never overlapping, scaled to fit the area.
8. When the model fails or no model is usable, Recall falls back to text search (no sketch match) with keywords taken from page titles and says so; with only a sketch and no model it shows the error.

## 8. Non-Functional Requirements

- Performance: one model request per Recall; candidates capped as in Meaning search (+ 60 visual candidates); layout of 60 words in under 20 ms.
- Reliability: a request in flight is aborted when a new one starts or Recall closes (stale answers ignored); model timeout 60 s like Meaning search.
- Security: one new IPC channel `history:recall` (UI → main), arguments validated (request ≤ 500 chars, sketch a `data:image/jpeg;base64,` URL ≤ 1 MB, view enum). No new web-content capability. Screenshots reach the UI as `data:` URLs as before (CSP `img-src 'self' data:`).
- Privacy: same as Meaning search (ADR 0006); with a sketch, the sketch and up to 16 small screenshots of history pages go to the selected model (ADR 0010). Nothing new is stored. Recall is only sent on the user's explicit Recall action; the sketch pad says that screenshots are sent.
- Accessibility: cloud items are buttons with accessible names (keyword and page count, or page title); the sketch pad has a label and the request field alone is enough to use Recall.
- Platforms: no differences.

## 9. UX / UI Notes

- User flow: `/recall lions` → Recall page opens with "lions" in the field and starts recalling → keyword cloud → click "savanna" → list of three pages → click one → page opens.
- Visual considerations: plain CSS with the existing custom properties, light and dark; keywords coloured by a small fixed palette; image tiles with rounded corners and title on hover.
- Edge cases: empty history; model returns no pages ("Nothing in history matches."); sketch-only request; very long keywords (truncated to 32 chars); window resize relays out.

## 10. Technical Notes

- Proposed approach: inside the `history` feature (it owns the database and Meaning search): `main/recall.ts` (prompt, answer parsing, keyword aggregation, fallback), `shared/cloud-layout.ts` (pure spiral layout), `ui/RecallView.tsx` + `ui/SketchPad.tsx`; `HistoryDb.recentVisual(limit)` for sketch candidates.
- Process split: UI → main `history:recall` (invoke, returns `RecallResult`); main → UI `history:open` gains `recall?: string` to open the page from the menu or `/recall`. Opening a page uses `navigation.go`.
- Dependencies: agent (`complete`, extended with `images: { label, jpegBase64 }[]` sent as labelled image blocks), navigation (`go` from the UI API), Electron `nativeImage` to scale screenshots; no new npm packages.
- Risks / unknowns: only pages with ≥ 30 s dwell have screenshots, so short visits can't be matched by a sketch; local Ollama models without vision ignore images.
- Open questions: none.

## 11. Acceptance Criteria

- [x] `/recall <request>` and File → Recall from History… open the Recall page with the request and the page view hidden; Escape closes it.
- [x] `history:recall` validates its argument (request length, sketch data URL and size, view) – unit tests.
- [x] The recall prompt carries candidates as untrusted data and, with a sketch, sends the sketch and at most 16 labelled, scaled screenshots; without a sketch no images – unit tests.
- [x] `agent.complete` sends labelled images as image blocks after their label – unit test.
- [x] Answer parsing keeps only known ids, clamps scores, normalises and caps keywords, and rejects unreadable answers – unit tests.
- [x] Keywords are aggregated by summed score, heaviest first, capped at 60 – unit tests.
- [x] Cloud layout places items without overlap, heaviest nearest the centre, deterministically – unit tests.
- [x] A failed model request falls back to text matches with title keywords and a notice – unit test.
- [x] Recall view: keyword cloud, keyword → page list, Words/Pictures switch, page click opens it – UI tests.
- [x] Sketch pad exports a JPEG data URL and Clear empties it – UI test.

## 12. Testing / Verification

- Manual test plan: visit a few pages about one topic (with summaries on and ≥ 30 s each), `/recall <topic>`, check the cloud; sketch a simple shape seen on one page, Recall, check the image cloud; switch views; open a page.
- Automated test coverage: unit (Vitest) for `recall.ts`, `cloud-layout.ts`, `db.recentVisual`, `parseRecall`; UI tests for `RecallView` and `SketchPad`.
- Regression considerations: Meaning search and the history panel unchanged; `history:open` keeps its existing fields.

## 13. Rollout / Follow-up

- Rollout plan: ships enabled, no flag (opt-in by use, like Meaning search).
- Follow-up work: an assistant tool `recall_history` (needs an agent tool registry to avoid an agent ↔ history import cycle); embeddings for image similarity; matching individual page images.

## 14. Changes during implementation

Note any deviations from the original spec during implementation.

- `history:recall` takes `{ query, sketch }` only; the Words / Pictures switch is client-side, so the request has no view field.
- Opening Recall uses its own channels instead of extending `history:open`: `history:request-recall` (UI → main, from `/recall`) and `history:open-recall` (main → UI, also from the menu item), so the history panel doesn't react to it. `history:cancel-recall` aborts a recall in flight when Recall closes.
- With a sketch, screenshots go to the model (decided at approval: "also send screenshots"); recorded in ADR 0010. `agent.complete` gained `images: { label, jpegBase64 }[]`.
- The page view is hidden by collapsing the acting frame / page area to zero width with CSS (`.workspace:has(> .recall-view)`), so navigation needs no change.
- End-to-end tests were not run in the cloud session (no Electron binary); CI runs them.
