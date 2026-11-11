---
name: cloudflare-effect
description: Stop before changing a Cloudflare account and write an effects list for the user to run instead. Use whenever a task would create, change, or delete anything on the Cloudflare platform, including deploys, secrets, DNS, routes, remote D1 migrations, KV, R2, Queues, Durable Object migrations, Access, or account settings. Code and local config changes don't need it.
metadata:
  harness: claude pi
  scope: opt-in
  machine: local remote
---

# Cloudflare effects

Never change the Cloudflare account yourself. The user applies platform changes, so you hand them a list of exact steps.

## What you may do

- Edit code and config files, including `wrangler.*` and `cloudflare.config.ts`.
- Run local dev, tests, and builds.
- Run read-only commands against the account, such as `list`, `get`, `info`, and `whoami`, to base the list on the real state. If they aren't available, state what you assumed.

## What goes on the list

Anything that changes the account. Don't run these, and don't trigger them indirectly through package scripts, CI workflows, or pushes that you know deploy:

- Deploys, version uploads, and rollbacks
- Secrets and environment variables on Workers
- Creating, changing, or deleting resources such as D1, KV, R2, Queues, and Hyperdrive
- Remote migrations, or anything else that writes to remote data
- DNS, routes, custom domains, Access, WAF, and account settings

If you're unsure whether something changes the account, put it on the list.

## How to choose the instructions

For each effect, use the first of these that can make the change:

1. `wrangler`, when the repo has a `wrangler.jsonc`, `wrangler.json`, or `wrangler.toml`
2. `cf`, when the repo has no Wrangler config
3. Numbered dashboard steps, when no command can make the change

Check commands against the installed `wrangler` or `cf` skill rather than from memory. Use only project-specific names that you've confirmed in the repo or from a read-only command, and mark anything else as a placeholder such as `<ACCOUNT_ID>`. Never put a secret value in the list; give the command that prompts for it.

## Where to write it

Put the list in your final reply. If you create a pull request, put the same list in its description. Don't commit it to the repo.

## Format

Number the effects in the order they must run, and note when code has to be deployed before or after a step.

```markdown
## Cloudflare effects

1. **Create the `sessions` D1 database.** Needed because the new login code stores sessions there.
   Run: `wrangler d1 create sessions`
   Check: `wrangler d1 list` shows `sessions`.

2. **Add the `app.example.com` custom domain.** No command can do this in this project.
   In the dashboard:
   1. Open Workers & Pages and select the `app` Worker.
   2. Open Settings, then Domains & Routes, and select Add.
   3. Enter `app.example.com` and save.
   Check: `https://app.example.com` responds.
```

If the task needs no platform changes, don't add the section.
