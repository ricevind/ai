---
name: artifact-index
description: Keep an index of published Claude artifacts in ~/generated-docs/claude-artifacts.md. Use immediately after publishing or republishing a Claude artifact, or when the user asks which artifacts they have or where one is.
metadata:
  harness: claude
  scope: global
---

The index lists where artifacts are. It never stores their content.

After publishing, add one row to `~/generated-docs/claude-artifacts.md`, creating the file if it doesn't exist:

```markdown
| Date | Title | URL |
|---|---|---|
| 2026-11-01 | Artifact title | https://claude.ai/... |
```

- Use the title and URL returned by the publish result. If a row already has that URL, update its date and title instead of adding another.
- Escape any `|` in a title as `\|`.
- Keep rows sorted newest first.
- Only add the index entry; don't change who can see the artifact.
