---
name: generated-docs
description: Save generated HTML pages, reports, guides, and other standalone documents to ~/generated-docs. Use whenever you produce a document the user will open or keep outside the current project, unless they name another location.
metadata:
  harness: pi
  scope: global
  machine: local remote
---

Save the document to `~/generated-docs/<descriptive-kebab-case-name>.<ext>`, creating the directory if it doesn't exist.

- Never overwrite an existing file unless the user asks to update it. Add a numeric suffix to the name instead.
- Tell the user the full path when you finish.
