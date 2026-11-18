---
name: codesurf
description: Visually answer a question about a codebase with CodeSurf. The user explores the answer in a local viewer with source cards, arrows, real types on hover, go-to-definition, and follow-up chat, plus screenshots of the app when UI is involved. Use when the user says "surf", "codesurf", "show me how X works", "walk me through", "trace what happens when", or asks to learn or review unfamiliar code visually.
---

# CodeSurf

CodeSurf turns your investigation into a visual tour that the user explores in their browser at http://127.0.0.1:4319. You investigate and write a small tour JSON file. CodeSurf reads the real source, checks every reference, and opens the viewer. From there the user can hover for types, click any symbol to open its definition, and ask follow-up questions. A read-only Claude Code session in the repository answers those and can draw new views.

The `codesurf` command is on PATH (`codesurf --help`). The full tour format is in `tour-format.md`, next to this file (`codesurf guide` prints both). Read it before writing your first tour in a session.

## Workflow

1. **Investigate.** Find the real entry point for the user's question and follow it through the actual source to the outcome. Note exact files, symbols and lines. Verify each hop; don't infer from names.
2. **Decide whether UI is involved.** If the flow starts with or produces something the user sees (a button, a form, a page, an error message), capture it (next section). Otherwise skip to step 4.
3. **Capture the UI.** Run the app locally with dummy data, then screenshot the interaction.
4. **Write the tour** to a scratch file outside the repo, such as `$TMPDIR/codesurf/<slug>/tour.json`. Use `answer` for the direct answer, then 3-10 steps of evidence. Prefer `symbol` cards and endpoint `text` checks.
5. **Open it:** `codesurf open /path/to/tour.json --repo <repo root>`. If it prints problems, fix the JSON and run it again. Never "fix" a check by removing the `text` guard; look at the real line instead.
6. **Reply briefly:** one or two sentences with the answer and the URL it printed. Mention anything you could not verify. Do not repeat the whole tour in chat.

## Capturing UI (screenshots with the interaction circled)

When the flow involves user input, show the real screen:

1. **Start the app** the way the project documents it (README, package.json scripts, Procfile, docker-compose, Makefile). Use dummy or seed data: the project's seed/fixture scripts, a local SQLite or dev database, mock or sandbox env values from `.env.example`. Never use production credentials or real customer data. Run it in the background and wait until it responds.
2. **Capture the interaction** with `codesurf shot`. Actions run in order; the element(s) passed with `--highlight` are measured and circled. Actions after the last `--highlight` run afterwards, and `--after` captures the result:
   ```bash
   codesurf shot --url http://localhost:3000/login \
     --fill "#email=demo@example.com" --fill "#password=demo-password" \
     --highlight "button[type=submit]" --label "Sign in" \
     --click "button[type=submit]" --wait-for ".dashboard" --after shots/after.png \
     --out shots/login.png --viewport 1280x800
   ```
   It prints ready-to-use screenshot cards (`card`, `afterCard`) with exact highlight boxes. Fill in their titles. Use selectors from the real markup (ids, labels, roles, `text=Pay now`). `--hover SELECTOR` captures tooltips and menus.
3. **Connect the screenshot to code.** Draw an `event` connection from `{ "card": "<screenshot>", "highlight": 0 }` to the handler line, and a `return` connection from the code that renders the result to the after-screenshot.
4. **Stop the app** when you are done, unless the user wants it running.

If the app cannot run locally (it needs cloud services, secrets or hardware), say so and make the tour without screenshots. Don't fake one.

## Choosing the picture

- A flow across functions or files: code cards connected by `call`/`return`/`failure` arrows.
- "How is this repo organized" or "what are the main parts": note cards, one per module, each body linking to its entry file with `[name](cs:path#L1-L40)`, connected by `data`/`call` arrows. Optionally add one code card for the most important entry point.
- A user-facing flow: screenshot, then code, then the resulting screenshot.
- A PR or bug fix: before and after files (`ref`), cards with `diff` and `changedLines`, plus `"review": {"url": ...}` only when the user asked for a PR review.

## Follow-ups

The user may come back to you with "explain X in the tour", or paste PR review comments copied from the viewer. Tours for a repository are listed at http://127.0.0.1:4319 (Tours button). For a revised view, write a new tour and run `codesurf open` again; each tour is saved separately.

## Commands

- `codesurf check <tour.json> --repo DIR`: validate only.
- `codesurf locate <file> <symbol> --repo DIR`: print a symbol's exact lines.
- `codesurf status` / `codesurf stop`: manage the background viewer server.
- `codesurf example`: open the bundled demo.
