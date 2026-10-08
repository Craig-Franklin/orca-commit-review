# Orca Commit Review

An experimental [Orca](https://github.com/stablyai/orca) plugin for reviewing agent changes **one commit at a time**. Git graph, per-commit diffs, reviewed-file checkboxes, saved progress, and review comments you can send back to a terminal agent—all in a dedicated Orca browser tab.

**No custom Orca build, npm install, or separate Node installation.**

## Install on macOS or Windows

Requires Orca **1.4.220+** and Git on PATH. On macOS, install Apple’s command-line tools if Git is missing. On Windows, install Git for Windows.

1. Open **Settings → Plugins → Install plugin → Git URL**.
2. Paste this URL, including the version tag:

   ```text
   https://github.com/Craig-Franklin/orca-commit-review.git#v0.3.0-preview.1
   ```

3. Review and enable **Commit Review**.
4. Run **Commit Review: Open** from Orca’s command palette and choose a project.

If you installed the earlier local-folder preview, install this Git source for the same plugin. Reopen it from the command palette after updating or restarting Orca.

## Review and comment

Select a commit, inspect its files, and tick **Reviewed** for each file, then **Complete commit review**. Unmarking a file reopens the commit. Empty commits can be completed explicitly. Click a diff line number for a line comment, or **Comment** for a file comment. Saved comments stay with that checkout and commit.

Select draft comments and an agent session, then **Send selected comments**. Feedback includes the commit hash, file, old/new line location, and code context. Only connected terminal agents in the selected checkout are listed. **Check delivery** reuses the original request when delivery is uncertain and refuses to send to a changed agent. A confirmed refusal with zero bytes written restores drafts; partial writes and unknown outcomes retain the original request. Input acceptance and an observed agent turn have separate statuses.

## Preview limits

- Local repositories and terminal agents only; no native chat, SSH, or WSL support yet.
- Latest 100 commits; merges compare with their first parent. Own inline diff viewer; renames appear as delete/add, binary files as summaries, and very large diffs may exceed 4 MB.
- Progress and saved comments stay on this computer. The plugin does not edit Git files. Sending feedback can prompt the selected agent to act.
- The worker reads Git, serves a local UI, stores progress, and uses Orca’s bundled CLI for session delivery.
- Earlier viewer tested in stock Orca on macOS. The current comment UI, Git URL installation in the app, and live delivery remain unverified. Automated tests cover Git, persistence, UI races with an in-memory DOM, and simulated sends. Read-only integration checks pass against stock Orca 1.4.220 on macOS. [All 39 automated tests pass on macOS and Windows CI](https://github.com/Craig-Franklin/orca-commit-review/actions/runs/37849713024); Windows Orca installation and live delivery remain open. The published Git tag also passes the suite under Orca’s bundled Node.
- Keep the tab open while reviewing. Its connection keeps the worker active. After disabling/updating the plugin, restarting Orca, or a connection loss, reopen from the command palette. Saved reviews remain local.
- `v0.2.0` remains the original experimental checkpoint. Its original unsigned commit is preserved by that tag; current `main` uses signed replacement history.

Development: `npm ci`, then `npm test` (Node 24). Development dependencies support release tooling only; installing the Orca plugin still needs no npm install. Use Conventional Commits; see [CONTRIBUTING.md](CONTRIBUTING.md). Pushes to `main` automatically publish semantic preview tags after macOS and Windows CI pass. Continuation notes and the remaining macOS/Windows acceptance checklist: [HANDOFF.md](HANDOFF.md).
