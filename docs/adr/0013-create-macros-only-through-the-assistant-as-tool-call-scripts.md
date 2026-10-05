# 0013. Create macros only through the assistant, as scripts of browser tool calls

- Status: Proposed
- Date: 2026-10-05
- Features: skills, agent, prompt, stacks
- Spec: spoken-macro-m4q7zt

## Context
Skills (`/name`) were saved from the last assistant run through a form (`/save`, "Save as skill", ADR 0004). Users want to say "do X and store it as /x" in the prompt, with parameters and hints, and run it later by typing `/x`. A macro could be JavaScript the model writes, but the agent rule is that model-provided code never runs in a page, and running it in the app would need a sandboxed interpreter (a new shipped package) plus its own permission model.

## Options considered
1. **Model-written JavaScript macros** – flexible (loops, conditions), but arbitrary code from a model that may have read prompt-injected pages; needs a sandbox, an API surface and an audit of it.
2. **Scripts of the browser's own tool calls (JSON), saved by an assistant tool** – the same tools, validation, page-access and approval rules as a live run; no new package; no control flow.
3. **Keep the form and add the tool** – two ways to create the same thing; the form exposes raw steps to edit by hand.

## Decision
Option 2. The assistant gets `save_macro`, `list_macros` and `delete_macro` (provided by skills) and `new_stack` (provided by stacks). A macro is `{ name, description, params: [{ name, hint }], steps: [{ tool, input }] }`; steps must be replayable tools whose inputs pass the tool schema, `{{param}}` placeholders only in strings. The form, `/save`, "Save as skill" and the save IPC are removed. Saving or deleting after page or history content was read in the run needs the user's approval, like leaving the site (ADR 0004).

## Consequences
- Macros can't loop, branch or read values; a request needing that stays a question to the assistant.
- Replays keep ADR 0004's rules: page steps need page access and one approval; navigation steps run without approval, so a macro's URL with the user's arguments is reviewed when it is saved (approval after untrusted content, and the conversation shows the save).
- The list of macro signatures is sent with every model request (`<browser_state>`).
- Changing a macro means asking the assistant; there is no hand editor.
