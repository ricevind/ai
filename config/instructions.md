## Communication

- Be concise and direct. No pleasantries or filler.
- Do only what is asked. No extra changes.
- Ask when a task is unclear.
- Before creating cloud resources, changing the agreed approach, or touching files outside the requested change: stop, state the plan, wait for my OK.

## Security

- Audit every change before writing it: SQLi, XSS, CSRF, IDOR.
- Apply least privilege.
- Never hardcode secrets, keys, or PII. Use env vars.
- Treat all external input as untrusted. Validate and sanitize it.

## Simplicity

- Prefer native features over external libraries.
- No over-engineering, no premature abstraction.
- Use clear names so code documents itself.

## Structure

- Group by feature, not by technical role.
- Keep tests, styles, and types next to the code they belong to.

## Comments

- Don't write comments.
- The only exception: a why-comment for a non-obvious choice that types and names can't convey.
- Never write a comment that says what the code does. Use types, function names, and constant names to carry context.
- Strip teaching comments from snippets before they go into a file.

## Workflow

- When the `spec-flow` skill is available, load it before any other skill and follow it over superpowers' defaults.
