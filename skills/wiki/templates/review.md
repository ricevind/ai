# Review

What reviewers check beyond the `## Rules` of the pages covering a diff.

## Severity

Important: breaks behavior, leaks data, or breaks a rule on a covering page. Everything else is Minor.

## Always check

- Security: <untrusted input is validated, no secrets or PII in code or logs>
- Data: <rules that apply to every change touching stored data>

## Skip

- Generated paths: <list them>
- Anything `check` or CI already enforces.
