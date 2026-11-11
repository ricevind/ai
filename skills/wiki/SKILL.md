---
name: wiki
description: Work with a project wiki in docs/wiki/: read it before a task, keep it current after changes, or set one up. Use when working in a repo that has docs/wiki/, or when asked to set up, bootstrap, or add a wiki or knowledge base.
metadata:
  harness: claude pi
  scope: opt-in
  machine: local remote
---

# Wiki

The wiki describes the project as it is now. `docs/README.md` holds the page format and style rules; follow it.

## Before a task

Read `docs/wiki/*.md` and every `docs/wiki/*/glossary.md`. Use their words in code, names and replies. Read topic pages on demand.

## After a change

1. `node scripts/wiki.mjs affected [files]` lists the pages covering the changed files. Update them.
2. `node scripts/wiki.mjs` regenerates `docs/index/`.
3. `node scripts/wiki.mjs check` must report `ok`.

## Set up a wiki

In order:

1. Add `"wiki": {"sourceDirs": ["app", "worker"]}` to `harness.json`. `sourceDirs` are relative directories the index mirrors and `check` requires coverage for; use the project's own.
2. Run `air apply`. It installs `scripts/wiki.mjs`.
3. Copy `templates/docs-README.md` to `docs/README.md` and fill in the topics line. Copy `templates/index-README.md` to `docs/index/README.md`.
4. Write the root pages in `docs/wiki/`: `vision.md`, `personas.md`, `architecture.md`, `facts.md`, `glossary.md`. Keep them short.
5. Add one topic at a time: a directory with `glossary.md` and pages whose `covers` list the source files.
6. Run `node scripts/wiki.mjs`, then `node scripts/wiki.mjs check`. Fix what it reports and repeat until it reports `ok`.
7. Point the project's agent instructions (`AGENTS.md` or `CLAUDE.md`) at `docs/README.md`.
8. Suggest npm scripts `wiki`, `wiki:check` and `wiki:affected` wrapping the three commands, and `wiki:check` in the pre-commit hook. Don't add them unasked.
