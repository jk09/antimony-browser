# 0010. Send history screenshots to the model when recalling by sketch

- Status: Proposed
- Date: 2026-10-02
- Features: history, agent
- Spec: drifting-nimbus-r8c3kw

## Context
Recall finds pages from history by a request or by a sketch of a picture the user remembers. ADR 0006 lets a Meaning search send candidates' titles, URLs, summaries, visual descriptions and notes to the selected model, but no images. A one-line visual description (only with summaries on) is a weak basis for comparing a drawing. Screenshots are stored locally for pages with ≥ 30 s dwell; there is no embedding or local vision model (ADR 0006).

## Options considered
1. **Compare the sketch with stored visual descriptions only** – no history images leave the machine; weak matches, nothing without summaries on.
2. **Send the sketch plus small screenshots of candidate pages** – the model compares real pictures; screenshots of browsing history go to Anthropic or Ollama, more tokens per request.
3. **Local image embeddings** – private and cheap per query; needs a new model or package and an embedding store.

## Decision
Option 2, chosen by the owner. Only when the user starts a Recall with a sketch, the sketch and up to 16 candidate screenshots (text matches first, then most recent; scaled to 320 px wide, JPEG) go to the selected model with the candidate list, each labelled with its page id. A text-only Recall sends no images. Sensitive pages never have a screenshot. `agent.complete` takes labelled images for this.

## Consequences
- Screenshots of pages the user dwelt on reach Anthropic (Claude models, also through the CLI) or `OLLAMA_HOST`; the Recall page says so next to the sketch pad.
- Each sketch Recall costs one request with up to 17 images; only 16 pages can be compared visually, so older screenshots can be missed. Embeddings (option 3) remain the way to scale.
- Ollama models without vision ignore the images; matches then come from text only.
