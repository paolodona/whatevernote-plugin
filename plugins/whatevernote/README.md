# whatevernote for Claude

Work with your whatevernote notes by just asking Claude.

## What you can do

- "Find my notes about the Lisbon trip"
- "Add this to my Groceries note: oat milk, bread"
- "Save this as a note" (paste anything)
- "Capture these meeting notes" (turns a call or transcript into one note with checkbox action items)
- "Update Alice's and the Atlas notes from that 1:1" (Claude shows exactly what it would add to each
  person and project note, and adds it only after you say yes; needs write access)
- "What are my open tasks?"
- "Give me a recap of my week"
- "Change the second step in my Launch plan note" (edits the middle of a note, not just the end)
- "Star my Groceries note" / "Move my old Lisbon note to the trash"
- "Tidy up my to-do list" (removes duplicate tasks, fixes checkboxes and list formatting)
- "Merge my two Lisbon notes" (combines them into one and trashes the other)

When Claude carries a meeting over to other notes it only adds to the end of them, and it treats your
meeting notes and captures as read-only unless you ask it to change one. For notes about a person or
project, name the note with the full name or project name so Claude can find it again;
you can put a nickname in the title like `Alice Johnson (aka Ali)`. Claude refers to other notes by
exact title as `[[Title]]`.

## Getting started

1. Install the plugin.
2. The first time Claude uses it, your browser opens so you can sign in to whatevernote and
   choose what to allow: read only, or read plus write (create, edit, star, trash).
3. Ask away.

## Good to know

- Claude can read, search, create, edit, star and trash notes. Trashing is a soft delete: you can
  restore the note in the app. Claude cannot delete a note permanently.
- Edits Claude makes show up as "Updated 1 minute ago by claude.ai" in the note, so you can tell
  them apart from your own. There is no undo history for an edit, so ask Claude to be careful
  with notes you cannot recreate.
- You can disconnect any time in the app under Settings -> Connected apps.
- Using claude.ai or the mobile app? Add `https://mcp.whatevernote.com/mcp` under
  Settings -> Connectors instead.
