---
name: ios-notes-and-reminders
description: Create notes in Apple Notes and reminders in Apple Reminders using osascript on macOS. Use this skill when the user explicitly asks to create a note or reminder in Apple Notes, Apple Reminders, iOS, or macOS native apps. Trigger on phrases like "add a reminder", "create a note in Apple Notes", "remind me to...", "make a note on my Mac", or any request that mentions Notes/Reminders in an Apple/macOS/iOS context.
metadata:
  harness: claude pi
  scope: global
  machine: local remote
---

# Apple Notes & Reminders via osascript

Create notes and reminders in native macOS apps using `osascript` (AppleScript). This avoids any third-party dependencies — just the built-in apps that sync across all Apple devices via iCloud.

## Creating a Reminder

```bash
osascript -e 'tell application "Reminders"
  set targetList to list "Reminders"
  tell targetList
    make new reminder with properties {name:"TITLE", body:"NOTES"}
  end tell
end tell'
```

### With a due date

AppleScript date math works in seconds from `current date`. Build the date expression based on what the user asks for:

| User says | AppleScript expression |
|---|---|
| in 1 hour | `(current date) + 3600` |
| in 3 days | `(current date) + (3 * 86400)` |
| tomorrow at 9am | Build a specific date object (see below) |

For a specific date/time, construct it explicitly:

```bash
osascript -e 'set d to current date
set year of d to 2026
set month of d to 3
set day of d to 10
set hours of d to 9
set minutes of d to 0
set seconds of d to 0
tell application "Reminders"
  tell list "Reminders"
    make new reminder with properties {name:"TITLE", due date:d}
  end tell
end tell'
```

### With a specific list

If the user mentions a list name, use it. Otherwise default to "Reminders" (the default list).

```bash
osascript -e 'tell application "Reminders"
  tell list "Shopping"
    make new reminder with properties {name:"Buy milk"}
  end tell
end tell'
```

### With priority

AppleScript priority values: 0 (none), 1 (high), 5 (medium), 9 (low).

```bash
osascript -e 'tell application "Reminders"
  tell list "Reminders"
    make new reminder with properties {name:"TITLE", priority:1}
  end tell
end tell'
```

## Creating a Note

```bash
osascript -e 'tell application "Notes"
  tell folder "Notes"
    make new note with properties {name:"TITLE", body:"<html><body>CONTENT</body></html>"}
  end tell
end tell'
```

The `body` property expects HTML. For plain text, just wrap it in basic HTML tags. For richer content, use standard HTML formatting (`<h1>`, `<ul>`, `<b>`, etc.).

### With a specific folder

If the user mentions a folder, use it. Otherwise default to "Notes".

```bash
osascript -e 'tell application "Notes"
  tell folder "Work"
    make new note with properties {name:"Meeting notes", body:"<html><body>Discussion points...</body></html>"}
  end tell
end tell'
```

## Handling user input

When the user asks to create a note or reminder:

1. Extract the title, content/body, and any metadata (due date, list/folder, priority) from their message
2. If anything is ambiguous, ask — don't guess dates or list names
3. Build the osascript command and run it via Bash
4. Confirm what was created: "Done — added reminder 'Buy milk' to your Reminders list, due tomorrow at 9am."

Keep it simple. One `osascript -e` call per item. If the user wants multiple items, run them sequentially.
