# 0018. Group imported pages by address, refined by topic with the assistant

- Status: Accepted
- Date: 2026-10-10
- Features: import, stacks, agent, skills
- Spec: tidy-compass-k7r2vb
- Supersedes: the grouping by 30-minute session in 0017

## Context
ADR 0017 made one stack per browsing session. A real export has thousands of visits, so that flooded the stack list (dozens of tiny stacks, only the newest 50 kept) and split one subject across many stacks. Stacks should be "what I was doing about X". Relatedness can be read from the addresses alone; meaning (a trip planned over booking, maps and weather sites) needs the model.

## Options considered
1. **Time sessions (0017)** – no model, but fragments topics and floods the list.
2. **Addresses only** – local and deterministic (site, then path); keeps the count low, but can't join different sites about one subject.
3. **Addresses, then the model on top** – the model merges groups, places single pages and names stacks, validated and with the address grouping as the fallback.

## Decision
Option 3. Pages are grouped by registrable domain (a site over 60 pages is split by the first path part), the 30 largest groups of at least two pages become candidates, and single pages join the closest group by shared distinctive words. When the Claude CLI works, one `complete` request (60 s) sends the groups' labels, counts and sample titles and up to 300 single pages (title and `host/path` only, no query string or fragment) and gets JSON back; unknown or repeated ids, too small stacks and more than 30 stacks are dropped, and any failure falls back to the address grouping and is reported in the result. The welcome step discloses what is sent; a typed `/import-edge` is the user's own command and a model-called import is approved (0017). The model's names are slugged; nothing it returns is executed or used as an address. A group already (80 %) in an imported stack is skipped, so importing a file twice adds no stacks. `/import-edge` without a path, and `import_browsing_data` without `path`, open a native file dialog.

## Consequences
- An import with the CLI available sends up to about 330 page titles and addresses to the model (ADR 0009, 0015); without it nothing leaves the machine and the stacks follow the addresses.
- At most 30 stacks per import; leftovers that fit nowhere stay in history only.
- Stack names come from the model or the site, not from the first page's title.
- A stack the user closed returns when the same file is imported again.
- Sessions by time are gone; there is no way to group by time.
