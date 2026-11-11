# Knowledge base

What the project is and how it works, as it is now. History lives in git.

## Layout

```
docs/
  wiki/
    vision.md         what the project is and isn't         ┐
    personas.md       who uses it                           │ always in context
    architecture.md   how the system fits together          │
    facts.md          technical choices in force            │
    glossary.md       terms used across topics              │
    <topic>/                                                │
      glossary.md     the topic's terms, linked to pages    ┘
      <page>.md       one subject: what it does, rules, code   read on demand
  index/              generated, mirrors the source directories
  specs/              frozen, dated specs; exempt from these rules
```

Topics: <list the topic directory names here>.

## Pages

```md
---
covers:
  - path/to/file.ts
---

# Title

What it does, for the person using it, in a few sentences.

## Rules

## Code
```

- `covers` lists the files and globs the page describes. The index is built from it.
- One page per subject. A topic with one subject has one page.
- **Rules**: constraints, one fact per line. Add a reason clause only where the rule looks wrong without it.
- **Code**: key files, data and flows. Point to code; don't restate it.

## Glossaries

- One line per term: `- **UI name** · `code name` — definition. [→](page.md#anchor)`. Give the code name where one exists.
- At most 160 characters per line. Detail belongs on the page.
- A term lives in the topic that owns its data; other pages link to it.
- Every page is linked from at least one term.

## facts.md

One line per choice: what it is and, where it matters, what it is not.

```md
- **Routing:** TanStack Router with code-based routes. Not file-based.
```

## Scripts

- `node scripts/wiki.mjs` regenerates `docs/index/`. Run it after changing a page's `covers`, a glossary or the files in the source directories; commit the result.
- `node scripts/wiki.mjs check` fails on anything this file rules out that a script can see. Run it in the pre-commit hook.
- `node scripts/wiki.mjs affected [files]` lists the pages to update for a change.

## Style

- Present tense, statements of fact. Describe what is.
- No history or narration: no "decided", "previously", "used to", "no longer", "was changed", "going forward", no dates.
- Use the glossary's words.
- Root files stay short: they are always in context.
