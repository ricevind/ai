---
name: astryx-setup
description: Set up Meta's Astryx design system (React 19 + StyleX) in a new or existing project, and install the computer-level `astryx` agent skill. Use when the user asks to add, install, init, or bootstrap Astryx or @astryxdesign packages, or to make agents aware of Astryx. Not for day-to-day component work once Astryx is set up; the installed `astryx` skill and the `astryx` CLI cover that.
metadata:
  harness: claude pi
  scope: opt-in
  machine: local remote
---

# Astryx setup

Astryx is Meta's open-source React design system, built on StyleX. Its CLI (`@astryxdesign/cli`) is the source of truth for components, tokens, themes and templates, and it writes the agent guidance itself. This skill drives the CLI; it does not replace its docs.

## Rules

- Never run `npx astryx`. The unscoped name is an unrelated npm package. Use `npx @astryxdesign/cli ...` until the CLI is installed, then the project's runner (`pnpm exec astryx`, `npm run astryx --`).
- Use the project's package manager, detected from its lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `package-lock.json`). Ask only when there is none.
- `astryx init` is non-interactive and only manages a marked block in agent files. Text outside the block is never changed, so it is safe to re-run.
- Prefer CLI output over memory: `astryx <command> --help`, `astryx docs <topic>`, `astryx manifest --json`.

## 1. Check the project

- `react` and `react-dom` must be >= 19. If they are older, stop and tell the user. Upgrading React is their call.
- A new project needs a React app first. Scaffold one with the user's framework of choice (Vite or Next.js), or start from an official example under https://github.com/facebook/astryx/tree/main/apps (`example-nextjs`, `example-nextjs-stylex`, `example-nextjs-tailwind`, `example-vite-tailwind`).

## 2. Install packages

```bash
pnpm add @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral
pnpm add -D @astryxdesign/cli
```

Add a script so agents can always call the project's own CLI:

```json
"scripts": {
  "astryx": "node node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs"
}
```

## 3. Write project agent docs

```bash
pnpm exec astryx init --all
```

This writes the Astryx block to `AGENTS.md` and `CLAUDE.md` (or `.claude/CLAUDE.md`), adds an `AGENTS.md` import to `GEMINI.md`, writes `theme.template.ts`, and prints the theme and page-building workflows. Use `--agent claude|cursor|codex|all` to limit which files are written. Read the generated block before writing UI code.

## 4. Theme and base CSS

Ask the user what look they want, then:

```bash
pnpm exec astryx theme list
pnpm exec astryx theme add neutral
```

Import the base styles in global CSS:

```css
@import '@astryxdesign/core/reset.css';
@import '@astryxdesign/core/astryx.css';
```

Wrap the app with the generated theme module:

```tsx
import {Theme} from '@astryxdesign/core/theme';
import {themes, defaultThemeSlug} from './astryx-themes';

<Theme theme={themes[defaultThemeSlug]}><App /></Theme>
```

The stylesheets use cascade layers (`reset`, `astryx-base`). With existing global CSS or Tailwind, declare the layer order explicitly. Read `astryx docs migration` before building screens.

Custom StyleX styles (`stylex.create` passed through `xstyle`) need the StyleX compiler in the bundler. Copy the setup from `apps/example-nextjs-stylex` rather than writing it from memory, and load the `stylex` skill if it is installed.

## 5. Install the computer-level `astryx` skill

```bash
npm i -g @astryxdesign/cli
astryx init --user
```

`init --user` writes `~/.agents/skills/astryx/SKILL.md` and links it into `~/.claude/skills/astryx`, plus other agents' skill folders that exist. The global CLI refreshes this file after each upgrade. To remove it: `astryx init --user --remove-agents`.

On this machine `~/.claude/skills` is a symlink to `~/ai/skills`, so the link lands at `~/ai/skills/astryx`:

- Check that it resolves: `ls -L ~/.claude/skills/astryx/SKILL.md`.
- It is machine-local and managed by Astryx. Make sure `skills/astryx` is in `~/ai/.gitignore`, and do not edit it, because Astryx keeps a file it finds edited.

## 6. Verify

```bash
pnpm exec astryx doctor
```

It exits 1 on any failure. Fix every `[fail]` and report the `[warn]` items. A smoke test is to render one component, imported from its own entry:

```tsx
import {Button} from '@astryxdesign/core/Button';
```

Finish by telling the user which files were written: agent docs, theme module, CSS imports, and the skill link.
