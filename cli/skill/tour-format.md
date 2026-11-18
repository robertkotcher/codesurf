# CodeSurf tour format (schemaVersion 2)

A tour is JSON. CodeSurf reads the code itself from the repository, so you only give paths and line numbers (or symbol names). It checks every reference before anything is shown and rejects unknown properties at the top level.

```json
{
  "schemaVersion": 2,
  "title": "Short title of the answer",
  "question": "The user's question, verbatim",
  "answer": "Markdown. The direct answer in 1-3 sentences, shown above the tour. May cite [code](cs:src/a.ts#L10-L20).",
  "files": [{ "id": "client", "path": "src/api/client.ts" }],
  "cards": [{ "id": "request", "file": "client", "symbol": "request" }],
  "connections": [],
  "steps": [{
    "title": "Send the request",
    "explanation": [
      { "text": "The client " },
      { "text": "adds the auth header", "target": { "card": "request", "lines": [12, 14], "text": "Authorization" } },
      { "text": " before calling fetch." }
    ],
    "focus": { "card": "request", "lines": [10, 20] }
  }]
}
```

## files
`{ id, path }`, where path is relative to the repository root. CodeSurf reads the current working-tree file. Optional fields:
- `ref`: a git revision. CodeSurf reads `git show ref:path`. Use it for PR before/after: one file entry per side, each with its own id.
- `sourceUrl`, `revision`: shown in PR review comments.
- `source` with `startLine`: only for code that does not exist on disk. Hover and go-to-definition are disabled for it.

## cards
Pick the code to show. **All code cards from one file are merged into a single card.** The parts you pick become labeled sections with folded gaps between them, so you can make one card per function and let CodeSurf combine them.

- Code: `{ id, file, symbol? , range?, relevant?, title?, diff?, changedLines? }`
  - `symbol` is a function, class, method (`Class.method`), interface, type or variable name. CodeSurf finds its exact lines. Prefer this over counting lines. Use `codesurf locate <file> <symbol>` to check.
  - `range` `[first, last]` is inclusive, 1-based, and in real file line numbers. Use it when there is no symbol.
  - `relevant`: ranges that stay bright. Other lines are dimmed, and long dim runs fold. Defaults to the whole range.
  - `diff` is `"before"` or `"after"`, with `changedLines`, for PR comparisons.
- Screenshot: `{ id, kind: "screenshot", title, image, viewport: {width, height}, highlights: [{x, y, width, height, label?}], url?, caption? }`. Get every value from `codesurf shot`; never guess coordinates. `image` is relative to the tour JSON file.
- Note: `{ id, kind: "note", title, body }`, where body is markdown. Use notes for an overview box, a module in an architecture map, or a concept that has no single code location. Connect notes with arrows to draw diagrams.

## connections
`{ id, from, to, label, kind }`, where kind is one of `call`, `event`, `return`, `success`, `failure`, `data`.
Each endpoint is one of:
- `{ card, line, text? }`: a code line. Add `text`, a short substring that must appear on that line; CodeSurf rejects the tour if it doesn't, which catches off-by-one lines.
- `{ card, highlight: 0 }`: a circled element on a screenshot.
- `{ card }`: the whole card (notes and screenshots).

Labels describe the verified relationship in 2-5 words ("Reserve stock first", "Declined: throws").

## steps
`{ title, explanation, focus?, revealCards?, revealConnections? }`
- `explanation` is an array of `{ text, target? }` segments; a plain string also works. Targets look like endpoints but use `lines: [first, last]`. They become links that highlight and scroll to that code. Attach targets to meaningful phrases, generously.
- `focus` is the code (or screenshot highlight) the canvas centers on for the step.
- Any card that `focus`, a target or a revealed connection touches appears automatically. Connections you never list in `revealConnections` appear as soon as both of their cards are visible. List them explicitly to pace the story.
- One idea per step, 3-10 steps. Start where execution starts (often a UI action or a request). End at the outcome the user asked about.

## Good tours
- Answer first: `answer` states the conclusion. The steps show the evidence.
- Show only the code that answers the question. Every arrow must be a relationship you verified in source.
- Say what you did not verify (dynamic dispatch, config, network boundaries) in the answer or a step.
- Prefer symbols and `text` checks to bare line numbers.
