# ai

Portable setup for Claude Code and [pi](https://pi.dev): skills, commands, extensions, agents, and config in one repo.

## Quick start

Requires `git`, Node, and the harness you want, already installed and logged in.

```sh
git clone https://github.com/ricevind/ai ~/ai
```

Your own machine, with personal settings:

```sh
node ~/ai/setup.mjs install --profile workstation
```

A remote machine or container, driven by a project's spec:

```sh
node ~/ai/setup.mjs apply --spec /path/to/project/harness.json --checkout
```

`apply` sets up the global skills first if this machine doesn't have them yet.

Installing also adds the `air` command to `~/.local/bin`, a short form of `node setup.mjs` that works from any directory.

## Commands

| Command | What it does |
|---|---|
| `air install [--profile workstation\|sandbox] [--preset a,b] [--harness claude,pi] [--force]` | Sets up global skills, extensions, and config for the machine, plus any presets. Repeat runs reuse the last profile, presets, and harnesses |
| `air apply [--spec <path>] [--checkout] [--force]` | Applies the nearest `harness.json` to its repo only |
| `air check [--spec <path>] [--preset a,b] [--harness claude,pi] [--approve]` | Compares what's loaded with what's expected for this machine and the current repo, and exits non-zero on a mismatch |
| `air update` | Refreshes `upstream.lock.json` and the generated manifests, for you to review and commit |
| `air generate` | Rebuilds `.claude-plugin/marketplace.json` and `package.json` |
| `air list` | Shows all skills and presets |
| `air status` | Shows this machine's setup, the repos that opted in, and whether this clone is behind |
| `air init [--preset a,b] [--harness claude,pi]` | Creates a `harness.json` in the current repo |

`air` looks for `harness.json` from the current directory up to the repo root.

Without a terminal, `install` and `apply` fail instead of overwriting a locally edited config file. Pass `--force` to overwrite it.

## Adding a project spec

Run `air init`, or commit a `harness.json` at the root of the project yourself:

```json
{
  "version": 1,
  "harnesses": ["claude", "pi"],
  "presets": ["cloudflare", "astryx"],
  "skills": ["web-perf"],
  "env": ["CLOUDFLARE_ACCOUNT_ID"]
}
```

| Field | Meaning |
|---|---|
| `version` | Always `1` |
| `harnesses` | `claude`, `pi`, or both |
| `presets` | Named skill sets from this repo's `presets/` directory |
| `skills` | More skill names from this repo's catalog |
| `global` | `false` skips setting up global skills on a machine that doesn't have them |
| `aiRef` | The `ai` version this project needs. `--checkout` switches the clone to it, otherwise the clone must already contain it |
| `config` | Any of `instructions`, `pi-models`, `pi-mcp` |
| `workflows`, `extensions` | Pi only. Narrows which prompts and extensions load in this repo |
| `env` | Names of variables that must be set. Never values |
| `wiki` | `{ "sourceDirs": [...] }`. Turns on the wiki tooling for this repo. See [Wiki](#wiki) |

A spec can only pick names from this repo. URLs, paths, hooks, and settings are rejected, so a project can't make a machine install arbitrary code. To add a third-party source, add it to `upstream.json` here first.

Everything `apply` generates stays out of the project's git history through `.git/info/exclude`.

## Wiki

`"wiki": { "sourceDirs": ["src", "packages/api"] }` in `harness.json` turns on the `wiki` skill for the repo. `apply` then writes a generated `scripts/wiki.mjs`, which you commit, and installs the Claude Stop hook and the pi extension. `sourceDirs` lists the repo-relative directories whose changes the wiki tracks. It must be non-empty, with no absolute paths and no `..`.

## Presets

A preset is a named list of catalog skills in `presets/`, such as `cloudflare` or `astryx`. A project's `harness.json` can use presets through `apply`, which enables them for that repo only. `install --preset` enables them for the whole machine, which suits a machine that serves one kind of project.

## Claude cloud sessions

Cloud sessions don't read this machine's setup, and `harness.json` can't change a cloud environment, so the environment's setup script chooses the presets. Paste this into the environment's **Setup script**, with a commit from this repo:

```bash
#!/bin/bash
AI_REF=<commit>
{
  git clone https://github.com/ricevind/ai "$HOME/ai" &&
    git -C "$HOME/ai" checkout --detach "$AI_REF" &&
    node "$HOME/ai/setup.mjs" install --profile sandbox --preset cloudflare,astryx --harness claude </dev/null
  echo "setup exit=$?"
} > /var/tmp/ai-setup.log 2>&1
exit 0
```

- The script exits 0 so that a failed install doesn't block the session. If skills are missing, read `/var/tmp/ai-setup.log` or run `node ~/ai/setup.mjs check --preset cloudflare,astryx --harness claude`.
- The environment caches the result, so a new `AI_REF` only arrives when you edit the script.
- Writing to `~/.claude` from a setup script works, but Claude's docs don't describe it for skills and plugins, so it could change.

## Skills

Every skill says which harness it's for, when it loads, and which machines get it. For skills in this repo, that goes in the `SKILL.md` frontmatter:

```yaml
metadata:
  harness: claude pi
  scope: global
  machine: local remote
```

Upstream skills and pi packages declare the same fields in `upstream.json`.

`machine` follows the install profile: `workstation` is `local` and `sandbox` is `remote`. A spec can list a skill the machine doesn't get, and `apply` skips it with a message, so one `harness.json` works everywhere. Pi extensions have no frontmatter, so local-only ones go in `pi/extensions-local/`.

| Scope | Claude | Pi |
|---|---|---|
| `global`, this repo | `/ai:<skill>`, or `/ai-local:<skill>` and `/ai-remote:<skill>` for machine-specific skills | Part of this package |
| `global`, upstream | Its own plugin, such as `/herdr:herdr` | Package pinned in user settings |
| `opt-in`, this repo | Copied to the project's `.claude/skills/` | Copied to the project's `.pi/skills/` |
| `opt-in`, upstream | One plugin per skill, enabled for that project, such as `/wrangler:wrangler` | Package filtered to the chosen skills, pinned in `.pi/settings.json` |

Pi only loads project skills and packages once you trust the project. Headless runs need `pi --approve`. `setup.mjs` never grants trust itself, so a repo can't approve itself, and `check` only loads project resources when you pass `--approve`.

## Updating

```sh
air update
git diff upstream.lock.json
git commit -am "chore: update upstream skills"
air install
```

Upstream sources are pinned to commits, so nothing changes until you commit a new lock and re-run `install` or `apply`.

Edits to config files in this repo reach the machine on the next `install`. Edits to skills in `skills/` and extensions in `pi/` load directly from the clone on the next session or `/reload-plugins`, except opt-in skills, which refresh on the next `apply`.

## Environment variables

| Variable | Used by |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID` | `config/pi/models.json` |
| `TAVILY_API_KEY`, `BRAVE_API_KEY` | `pi/extensions/web-search.ts` |

Credentials never go in this repo. Log in with each harness instead.

## Testing

```sh
node --test setup.test.mjs
```

## Layout

```text
.claude-plugin/marketplace.json   generated
package.json                      generated pi manifest
upstream.json                     third-party skills and packages
upstream.lock.json                pinned commits and versions
presets/                          named skill sets
setup.mjs                         the air command
harness.schema.json               schema for project specs
skills/                           skills owned by this repo
commands/                         commands for Claude, prompts for pi
pi/                               pi extensions, local-only extensions, prompts, and agents
config/                           instructions, settings, and profiles
```
