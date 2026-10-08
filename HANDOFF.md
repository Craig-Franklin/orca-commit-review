# Continuation

Paused at the v0.2.0 plugin checkpoint. This is an independent installable plugin, not the earlier custom Orca sidebar prototype.

## Required behavior

- Per-commit Git graph and diff, explicit file review marks, commit completion.
- File/line review comments sent to a chosen Orca terminal agent are essential.
- macOS and Windows, local persistence; no sync needed.
- Keep setup simple and documentation short.

## Current state

- `main.mjs`: trusted plugin worker, bundled Orca CLI, local browser tab.
- `git.mjs` / `server.mjs`: read-only Git access and authenticated loopback API.
- `comments.mjs`: saved comment drafts, exact-checkout session selection, durable send IDs, retained delivery receipts, explicit delivery checks.
- `web/`: graph, inline diff, review progress, comment composer, session picker.
- Ten Node tests pass, including real temporary Git histories and simulated session delivery, duplicate requests, timeout recovery, checkout isolation, storage failure, and HTTP authentication.

## Next work

1. Install this Git version in stock Orca and evaluate the comment UI.
2. With explicit user approval, send one real review to a chosen test terminal agent and confirm receipt in that session. No live review messages have been sent during development.
3. Verify Windows installation, bundled CLI discovery, and session delivery.
4. Refine based on hands-on feedback. Native chat, remote checkouts, line ranges, and native sidebar integration are outside this preview.

The running local-folder installation is still the earlier viewer version. Source edits do not change Orca’s installed snapshot. This Git URL installation has not been exercised in the app yet.

Do not control the desktop or browser: the user has another session using computer control. No automation should switch tabs, click, screenshot, reload, or open the app unless the user changes that constraint. Resume with source inspection and local tests.
