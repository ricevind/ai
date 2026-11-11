---
name: spec-flow
description: The user's spec-driven workflow on top of superpowers. Load it before any other skill for any feature, change, design, bugfix or plan work in a repo where it is installed. Its rules win over superpowers' defaults.
metadata:
  harness: claude pi
  scope: opt-in
  machine: local remote
---

# Spec flow

Run the superpowers skills below as written. Where this file differs, this file wins. It lists only the differences.

## Memory

- The wiki (`docs/wiki/`) is what the system is now. Update it in every change.
- Specs (`docs/specs/`) are intent, frozen after merge.
- Commits carry code, the wiki update, and a `Spec:` trailer. Plans are disposable.

## Stages

| Stage | Runs | Delta |
|---|---|---|
| Brainstorm | `superpowers:brainstorming` | The spec goes to `docs/specs/`. The builder check runs. The spec needs the user's approval. |
| Plan | `superpowers:writing-plans` | The plan goes to `.superpowers/plans/`. The self-review adds three questions. |
| Execute | `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) with `superpowers:test-driven-development` | Feature branch, one worktree, never main. Tasks one at a time. Rulings cover only how to build. |
| Review | task and final reviewers, `superpowers:requesting-code-review`, `superpowers:receiving-code-review` | Wiki-aware, below. |
| Debug | `superpowers:systematic-debugging` | None. |
| Close | replaces the menu in `superpowers:finishing-a-development-branch` | Close, below. |

## Overrides

- Specs: `docs/specs/YYYY-MM-DD-<topic>.md`, not brainstorming's "Where it goes" path. Put a `Status: draft | approved | shipped` line under the title.
- Plans: `.superpowers/plans/YYYY-MM-DD-<feature>.md`, not writing-plans' "Save plans to" path. First run `git check-ignore -q .superpowers/`; if it fails, append `.superpowers/` to `.git/info/exclude`.
- Plan self-review also answers: what could this break, which step is riskiest, which options were rejected and why.
- Work on a feature branch in one worktree (`superpowers:using-git-worktrees`). Tasks run one at a time; no parallel implementers, no waves.
- Rulings ("Rulings, not stalls") cover only how something is built. Questions of intent, and anything that changes the user's machine, stop and ask.
- Never merge locally and never squash locally. GitHub's squash merge does it.
- Keep the SDD workspace after the final review. Close needs its ledger; it is deleted in Close (f).

## Wiki-aware review

Only when `docs/wiki/` exists. Before dispatching any task reviewer or the final reviewer, run:

```bash
git diff --name-only BASE HEAD | node scripts/wiki.mjs affected -
```

BASE is the task's base commit, or the merge base for the final review. Add this block to the reviewer's global constraints (`[GLOBAL_CONSTRAINTS]` for task reviewers, `[PLAN_OR_REQUIREMENTS]` for the final reviewer):

```
Wiki rules: <listed pages>, docs/wiki/review.md (if it exists).
Check the diff against each page's `## Rules`; a violation is Important.
```

## Close

Run finishing-a-development-branch's test verification, then do these instead of its options:

a. Wiki: `git diff --name-only BASE HEAD | node scripts/wiki.mjs affected -` against the base branch. Update those pages, then run `node scripts/wiki.mjs` and `node scripts/wiki.mjs check` until it reports `ok`.
b. Rule candidates: findings raised more than once in the SDD ledger (by two reviewers, or still open after a fix round), plus Important findings about conventions the wiki doesn't state. Propose each as a `## Rules` line on the page that covers the code, or on `docs/wiki/review.md` if it applies repo-wide. The user picks which go in.
c. Set the spec's `Status: shipped`. Commit a–c.
d. Run `gh api repos/{owner}/{repo} --jq .squash_merge_commit_message`. If it isn't `PR_BODY`, tell the user the `Spec:` trailer won't reach the squash commit. Don't change the setting.
e. Ask the user before pushing. With their OK, push and open a PR whose description ends with `Spec: docs/specs/<file>.md`.
f. After the merge, delete the plan and its SDD workspace.

Pushing, opening the PR, and anything that changes the user's machine always need the user's OK.

## Pi

- Invoke a skill: `/skill:<name>`, or read its `SKILL.md`.
- Dispatch a subagent: the `subagent` tool. Implementer is `worker`, task and final reviewers are `reviewer`, the builder check is `planner`, recon is `scout`.
- Todos: the SDD ledger.
- Pass long inputs as file paths.

## No wiki

Without `docs/wiki/`, skip Wiki-aware review and Close (a–b). The rest applies.
