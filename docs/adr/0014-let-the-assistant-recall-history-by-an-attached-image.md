# 0014. Let the assistant recall history by an attached image

- Status: Proposed
- Date: 2026-10-06
- Features: agent, history
- Spec: amber-orbit-q7t3vn

## Context
Recall (ADR 0010) sends a sketch and up to 16 small history screenshots to the selected model, but only when the user starts a Recall with a sketch on the Recall page. The assistant's `search_history` (ADR 0012) returns a list by text or meaning and can't look for a picture. Users paste images into the prompt ("which page had a picture like this?") and ask to see what they read as a cloud. Page content a run reads may carry prompt injection.

## Options considered
1. **A `recall_history` tool, kind `history`, that may use only images attached to the user's current request** – the image comes from the user, not from the page or the model; gated like `search_history` (history access, cross-site approval afterwards); screenshots leave only when the user attached an image to that request.
2. **Let the tool take any image (page screenshot, URL, earlier messages)** – more flexible, but an injected page could make the model send screenshots of the user's history with arbitrary images.
3. **Ask for approval on every `recall_history` call** – explicit, but an extra click for a request the user just made.

## Decision
Option 1 (chosen by the owner, together with showing the cloud and returning keywords). The tool's `image` is the number of an image attached to the current request; PNG and JPEG are converted to an 800 px JPEG sketch and Recall runs as from the Recall page (ADR 0010 limits). Results (up to 20 pages with score and keywords) reach the model as untrusted content, and the Recall page shows the same result unless `show` is false.

## Consequences
- With history access on, a request that has an image attached can make the model send that image and up to 16 small history screenshots to Anthropic (also through the CLI) or `OLLAMA_HOST`, without a further prompt; `/history-access off` prevents it.
- The model can open the Recall page over the page area at any time during a run (closed with Escape).
- Images from earlier messages or the current page aren't usable; adding them would need a new decision.
