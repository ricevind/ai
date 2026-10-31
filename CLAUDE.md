# AI Tools Repository

Central repository for Claude Code and pi customizations. `setup.mjs` installs it on any machine; see `README.md`.

## Rules

- Create new skills, commands, agents, and extensions in this repo, never directly in harness directories.
- Keep each skill self-contained in its own directory under `skills/`, with `metadata.harness` and `metadata.scope` in its frontmatter.
- Add third-party skills and packages to `upstream.json`, not as copies.
- Don't edit `.claude-plugin/marketplace.json` or `package.json` by hand. Run `node setup.mjs generate`, and commit the result.
- Never commit credentials. This repo is public.
- Run `node --test setup.test.mjs` after changing `setup.mjs`.
