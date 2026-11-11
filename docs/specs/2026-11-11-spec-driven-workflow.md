# Spec-driven workflow preset

Status: draft · Project 2 of 3 (1: wiki tooling, shipped · 3: task MCP)

## Intent

The user wants spec-driven development, so that the gap between intent and code is written down and traceable. Memory comes in three layers:

| Layer | Holds | Lifetime |
|---|---|---|
| Wiki (`docs/wiki/`) | what the system is now, including review rules | updated in every change |
| Spec (`docs/specs/`) | intent, why, approaches, the option picked | frozen after merge |
| Commit | code, wiki update, a `Spec:` trailer | permanent |

Plans are disposable. Project 1 shipped the wiki layer. This project ships the flow that produces the other two layers. It's built on obra/superpowers skills, pinned and unmodified, with an overlay of the user's own rules on top. It is one general flow that any repo opts into, on Claude and on pi.

Project 1 served as a dry run of this flow, and the dry run showed where the gaps are. The skills were read from a scratchpad clone, and their `superpowers:` names didn't resolve. Running tasks in parallel worktrees meant merging between waves by hand. The finishing skill would have merged locally.

## Goals

- A `superpowers` preset gives a repo the whole flow: brainstorm, spec, plan, execute (TDD, subagents), review, close.
- Superpowers skills are pinned upstream and never copied or edited, and their cross-references resolve.
- The user's rules win over superpowers' defaults wherever the two conflict.
- Review checks a change against the wiki rules that cover the files it touches.
- Review findings that repeat become wiki rules, so the next review catches them.
- The pi agents work on their own, and superpowers reuses them on pi.

## Non-goals

- Changing superpowers upstream, or copying its skills into this repo.
- A SessionStart bootstrap hook.
- Committed plans, an `intent.md` file separate from the spec, gates that fire automatically on artifact acceptance, a hook that protects test files, a verifier agent, CI evals, or CI automation.
- Parallel sessions with their own previews. That's project 3.

## Anti-goals

- Agents making decisions about intent on the user's behalf. Rulings are about how to build something, never about what to build.
- Pushing, merging, deleting branches, or changing the user's machine setup without asking.
- An overlay so long or noisy that it buries the upstream skills it adjusts.

## Decisions (the user's)

1. **Superpowers pinned per skill** in `upstream.json`, enabled through an opt-in `superpowers` preset. `diagnosing-superpowers` is left out. There's no bootstrap hook.
2. **Names resolve natively (1b).** The pinned superpowers skills form one Claude plugin named `superpowers`, still pinned by SHA and still without the upstream hook, so `superpowers:<skill>` references work. This means a small change to how `setup.mjs` groups upstream entries.
3. **Overlay skill (2a).** A new opt-in skill, `spec-flow`, is part of the preset and is the entry point. It names the stages, says which superpowers skill runs each one, and lists the overrides in "where superpowers says X, do Y" form. One line in the global instructions (`config/instructions.md`) makes it load first in repos that use the preset.
4. **Artifacts.**
   - Specs go in `docs/specs/YYYY-MM-DD-<topic>.md`, committed, with a `Status:` line.
   - Plans go in `.superpowers/plans/`, kept out of git.
   - The SDD workspace stays in `.superpowers/sdd/`.
5. **Close.** Update the wiki, mark the spec `shipped`, then push and open a PR whose description ends with `Spec: docs/specs/<file>.md`. GitHub's squash merge does the squash, so nobody squashes locally. Pushing and opening the PR need the user's OK.
6. **Wiki-aware review.** Review rules live in the wiki, not in a `REVIEW.md`. Reviewers run `node scripts/wiki.mjs affected` on the changed files, then check the diff against those pages' `## Rules`. They also check a short root page, `docs/wiki/review.md`, which holds the rules that cut across the repo (the security bar, what counts as Important).
7. **Mistakes become wiki rules.** At close, two kinds of finding become candidate rules:
   - findings raised more than once within this change (by two reviewers, or still open after a fix round), read from the SDD ledger;
   - any Important finding about a convention the wiki doesn't yet state.

   The agent proposes each candidate as a `## Rules` line on the page that covers that code, or on `review.md` if it applies across the repo. The user picks which ones go in. No store of findings across changes.
8. **Plan interrogation.** The plan self-review also answers three questions: what could this break, which step is riskiest, and which options were rejected and why.
9. **Pi agents.** `pi/agents/` (scout, planner, worker, reviewer) become general enough to use without superpowers. On pi, superpowers' subagent roles map onto them.
10. **Sequential execution.** Tasks run one at a time in a single worktree on the feature branch. No parallel waves.
11. **Skipped:** the test-protection hook, gates that trigger on artifacts, `REVIEW.md`, and a verifier agent. For the verifier's job, `verification-before-completion` and Claude Code's `run` skill already cover it.

## Approaches considered

- **Names:** a name map written in the overlay text (no setup change, but agents must translate about 50 references) versus grouping the skills into one `superpowers` plugin. Picked: grouping.
- **Overrides:** an overlay skill, rewriting the upstream text at install, or hand-edited copies. Picked: the overlay skill. It's the only option that leaves upstream untouched, and superpowers itself defers to user instructions.

## The flow (what `spec-flow` describes)

| Stage | Runs | Override |
|---|---|---|
| Brainstorm | `superpowers:brainstorming` | The spec goes to `docs/specs/`. The builder check runs. The spec needs the user's approval. |
| Plan | `superpowers:writing-plans` | The plan goes to `.superpowers/plans/`. The self-review adds the three interrogation questions. |
| Execute | `superpowers:subagent-driven-development` (or `executing-plans`) with `test-driven-development` | Work happens on a feature branch in one worktree, never on main. Tasks run one at a time, as SDD prescribes. Rulings cover only how to build. Anything that changes the user's machine waits for their OK. |
| Review | per-task reviewers and the final review, via `requesting-code-review` and `receiving-code-review` | Wiki-aware, as in decision 6. |
| Debug | `superpowers:systematic-debugging` | (none) |
| Close | replaces the merge and cleanup options in `superpowers:finishing-a-development-branch` | As in decisions 5 and 7. |

## Calls made in design (the builder may revisit; flag if wrong)

- **Which skills.**
  - The preset includes brainstorming, writing-plans, executing-plans, subagent-driven-development, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, using-git-worktrees, finishing-a-development-branch, and dispatching-parallel-agents, plus `spec-flow`.
  - `using-superpowers` is out. `spec-flow` replaces it, and its "1% chance, you MUST" rule clashes with the user's preference for brevity.
  - `writing-skills` goes in the grouped `superpowers` plugin, so the 4 `superpowers:writing-skills` references inside other pinned skills resolve. It only triggers when someone creates a skill. No repo needs to list it separately.
- **Grouped plugin contents.** The `superpowers` plugin is every pinned superpowers skill: the preset list plus `writing-skills`. It uses git-subdir path `skills`, so the upstream `hooks/hooks.json` stays out and relative `../<skill>/scripts` paths keep working. Pinned at v7.0.2 (`22f0b46`) or later.
- **Squash message.** Close checks the repo's squash setting with `gh api repos/<owner>/<repo> --jq .squash_merge_commit_message`. If it isn't `PR_BODY` (title and description), close tells the user that the `Spec:` trailer won't reach the commit, and leaves the setting unchanged. ricevind/ai already squashes from the description (verified on #1).
- **Trigger.** The global instructions line says to load `spec-flow` first whenever it's available. That covers `apply`, machine-wide `install --preset superpowers`, and cloud sessions alike.
- **Plans out of git, without `apply`.** `spec-flow` checks `git check-ignore .superpowers/` before writing a plan. If the directory isn't ignored, it adds the entry to `.git/info/exclude` (the same check `using-git-worktrees` does for its own directory). `apply` also writes the entry when `spec-flow` is enabled.
- **No wiki.** The flow still works in a repo without `docs/wiki/`: the wiki steps are skipped and the spec and PR steps stay. `spec-flow` says this once.
- **The `review.md` template** ships with the `wiki` skill (`skills/wiki/templates/review.md`), because it is a wiki page. The `wiki` bootstrap steps gain one line to copy it.
- **Pi mapping**, which `spec-flow` states for pi:
  - "Invoke a skill" means `/skill:<name>`, or reading its `SKILL.md`.
  - "Dispatch a subagent" means the `subagent` tool: the implementer is `worker`, task and final reviewers are `reviewer`, the builder check is `planner`, and recon is `scout`.
  - "Todos" means the SDD ledger.
- **General pi agents.** Each agent follows the output format the task gives it, and uses its current format only when none is given. `reviewer` takes a diff file or range when one is given, instead of always running `git diff`. The `implement*` prompts keep working unchanged.
- **The global instructions line.** One sentence in `config/instructions.md`: when the `spec-flow` skill is available, load it before any other skill. Both Claude and pi read that file.

## Constraints

- Keep `upstream.json` as the only place upstream sources are declared, pinned in `upstream.lock.json`. Never edit `.claude-plugin/marketplace.json` or `package.json` by hand.
- Grouping must stay compatible with the existing per-skill entries (herdr, cloudflare, and so on). Opt-in and global scope, machine filtering, and pi package filtering keep working. Pi already groups skills from one repo into one package entry.
- Run `node --test setup.test.mjs` after changing `setup.mjs`. Test the grouped marketplace entry, the preset selection, the opt-in plugin enable and removal, and the `.superpowers/` exclude.
- `spec-flow` stays short. It points to the upstream skills and lists only deltas. It never restates them.
- The user's global rules hold throughout: concise, no comments except why-comments, no over-engineering, and stop for an OK before cloud resources, changes to the agreed approach, or the user's machine.
- The repo is public.

## Left to the builder

- The `upstream.json` shape for a grouped plugin (a `plugin` field on each skill, or a separate list), as long as `upstream.json` stays the only source, the lock stays per repo, and `air list` still shows each skill.
- How `apply` and `install` enable a grouped plugin when a preset or spec names only some of its skills. The likely answer: enabling any of them enables the plugin, with all its skills. Say how it's handled.
- The exact wording of `spec-flow`, within the limits above.
- Whether the pi agents' changes need tests (they are prompts), and how to smoke-test the pi mapping.

## Follow-up outside this repo

- gym-rice: add `"presets": [..., "superpowers"]` to `harness.json`, add `docs/wiki/review.md`, and run `air apply`. This needs the user's OK.
