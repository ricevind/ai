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

## Commands

| Command | What it does |
|---|---|
| `install [--profile workstation\|sandbox] [--harness claude,pi] [--force]` | Sets up global skills, extensions, and config for the machine |
| `apply --spec <repo>/harness.json [--checkout] [--force]` | Adds a repo's opt-in skills to that repo only |
| `check [--spec <repo>/harness.json] [--harness claude,pi] [--approve]` | Compares what's loaded with what's expected, and exits non-zero on a mismatch |
| `update` | Refreshes `upstream.lock.json` and the generated manifests, for you to review and commit |
| `generate` | Rebuilds `.claude-plugin/marketplace.json` and `package.json` |

Without a terminal, `install` and `apply` fail instead of overwriting a locally edited config file. Pass `--force` to overwrite it.

## Adding a project spec

Commit a `harness.json` at the root of the project:

```json
{
  "version": 1,
  "harnesses": ["claude", "pi"],
  "skills": ["cloudflare", "stylex"],
  "env": ["CLOUDFLARE_ACCOUNT_ID"]
}
```

| Field | Meaning |
|---|---|
| `version` | Always `1` |
| `harnesses` | `claude`, `pi`, or both |
| `skills` | Skill names from this repo's catalog |
| `global` | `false` skips setting up global skills on a machine that doesn't have them |
| `aiRef` | The `ai` version this project needs. `--checkout` switches the clone to it, otherwise the clone must already contain it |
| `config` | Any of `instructions`, `pi-models`, `pi-mcp` |
| `workflows`, `extensions` | Pi only. Narrows which prompts and extensions load in this repo |
| `env` | Names of variables that must be set. Never values |

A spec can only pick names from this repo. URLs, paths, hooks, and settings are rejected, so a project can't make a machine install arbitrary code. To add a third-party source, add it to `upstream.json` here first.

Everything `apply` generates stays out of the project's git history through `.git/info/exclude`.

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
| `opt-in`, upstream | Plugin enabled for that project, such as `/cloudflare:wrangler` | Package pinned in `.pi/settings.json` |

Pi only loads project skills and packages once you trust the project. Headless runs need `pi --approve`. `setup.mjs` never grants trust itself, so a repo can't approve itself, and `check` only loads project resources when you pass `--approve`.

## Updating

```sh
node setup.mjs update
git diff upstream.lock.json
git commit -am "chore: update upstream skills"
node setup.mjs install --profile workstation
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
setup.mjs                         install, apply, check, update, generate
harness.schema.json               schema for project specs
skills/                           skills owned by this repo
commands/                         commands for Claude, prompts for pi
pi/                               pi extensions, local-only extensions, prompts, and agents
config/                           instructions, settings, and profiles
```
