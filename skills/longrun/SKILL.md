---
name: longrun
description: Run a long-running command (dev server, file watcher, log tail, database) in a persistent Herdr pane instead of the blocking bash tool. Use when longrun-guard blocks a bash command, when a command would not return on its own, or when asked to start something that must keep running after the turn ends.
metadata:
  harness: pi
  scope: global
  machine: local
---

# Long-running commands in Herdr panes

Pi's `bash` tool blocks until the command exits, and cancelling the call kills
its whole process tree. `nohup cmd &` appears to work but orphans the process
under PID 1: output is lost and stopping it means hunting PIDs.

A Herdr pane is a real terminal that outlives the turn. You control it with
`pane run` (type a command), `pane read` (look at output), and `pane wait-output`
(block until a pattern appears). Use it for anything that does not return on
its own.

## Precondition

```bash
test "${HERDR_ENV:-}" = 1 || echo "not in herdr"
```

If this is not `1`, you are not inside a Herdr-managed pane. Do not try to
drive Herdr from outside it — say so and use the bash tool's own `timeout`
parameter instead.

## Procedure

Split off a sibling pane, keep the user's focus and working directory:

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
```

Use `down` instead of `right` if the calling pane is narrow or tall. Read the
new pane id from the response — never guess it:

```bash
# .result.pane.pane_id  ->  e.g. wC:p7
```

Start the command. Pass it verbatim; the pane's shell runs it, so shell
operators, quoting, and `cd` all behave normally:

```bash
herdr pane run <pane-id> "npm run dev"
```

Wait for a readiness marker rather than sleeping:

```bash
herdr pane wait-output <pane-id> --match "listening on" --timeout 60000
```

`wait-output` searches the current snapshot immediately, so output that already
exists can match. Use `--regex` for a Rust regular expression. Omitting
`--timeout` waits indefinitely.

Read what happened:

```bash
herdr pane read <pane-id> --source recent-unwrapped --lines 120
```

Prefer `recent-unwrapped` for logs and transcripts; it joins soft wraps.
Use `visible` for exactly what is on screen, and `--format ansi` only when
colors or styling are the evidence.

## Working with the process afterwards

| Goal | Command |
|---|---|
| Check progress | `herdr pane read <id> --source recent-unwrapped --lines 120` |
| Wait for a new line | `herdr pane wait-output <id> --match "ERROR" --timeout 300000` |
| Type into it | `herdr pane run <id> "rs"` (adds Enter) |
| Send a raw key | `herdr pane send-keys <id> ctrl+c` |
| Stop it | `herdr pane send-keys <id> ctrl+c`, then confirm the prompt returned |
| Find it again | `herdr pane list --workspace "$HERDR_WORKSPACE_ID"` |

Report the pane id to the user so they can look at the terminal themselves.

## Rules

- Always pass `--no-focus` for background work. Do not steal the user's cursor.
- Always target an explicit pane id. Omitting a target may act on the
  UI-focused pane, which can belong to the user or another client.
- Never use `&`, `nohup`, `disown`, or `setsid` here. The pane already detaches
  the process from the turn; those verbs only make it unmanageable.
- Do not close panes you did not create. Leave the pane running when the turn
  ends — that is the point — and tell the user how to stop it.
- A pane is a terminal, not a sandbox. It runs with your full user permissions.

## Example: dev server, then a later check

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
# -> wC:p7

herdr pane run wC:p7 "npm run dev"
herdr pane wait-output wC:p7 --match "Local:" --timeout 60000
herdr pane read wC:p7 --source recent-unwrapped --lines 40
```

```bash
# later, after editing code
herdr pane read wC:p7 --source recent-unwrapped --lines 40
herdr pane wait-output wC:p7 --match "compiled" --timeout 30000
```

## When the command is finite

Do not reach for a pane for ordinary builds and test runs that exit on their
own — `npm run build`, `pytest`, `cargo test`. Use the `bash` tool with a
generous `timeout`; it streams output and truncates sensibly. A pane is for
commands that never return.
