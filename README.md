# Orca Commit Review

An experimental [Orca](https://github.com/stablyai/orca) plugin for reviewing agent changes **one commit at a time**. Git graph, per-commit diffs, reviewed-file checkboxes, saved progress, and review comments you can send back to a terminal agent—all in a dedicated Orca browser tab.

**No custom Orca build, npm install, or separate Node installation.**

## Install on macOS or Windows

Requires Orca **1.4.220+** and Git on PATH. On macOS, install Apple’s command-line tools if Git is missing. On Windows, install Git for Windows.

1. Open **Settings → Plugins → Install plugin → Git URL**.
2. Paste this URL, including the version tag:

   ```text
   https://github.com/Craig-Franklin/orca-commit-review.git#v0.2.0
   ```

3. Review and enable **Commit Review**.
4. Run **Commit Review: Open** from Orca’s command palette and choose a project.

If you installed the earlier local-folder preview, install this Git source for the same plugin. Reopen it from the command palette after updating or restarting Orca.

## Review and comment

Select a commit, inspect its files, and tick **Reviewed**. Click a diff line number for a line comment, or **Comment** for a file comment. Saved comments stay with that checkout and commit.

Select draft comments and an agent session, then **Send selected comments**. Feedback includes the commit hash, file, old/new line location, and code context. Only connected terminal agents in the selected checkout are listed. **Check delivery** reuses the original request when delivery is uncertain.

## Preview limits

- Local repositories and terminal agents only; no native chat, SSH, or WSL support yet.
- Latest 100 commits; merges compare with their first parent. Own inline diff viewer; renames appear as delete/add, binary files as summaries, and very large diffs may exceed 4 MB.
- Progress and saved comments stay on this computer. The plugin does not edit Git files. Sending feedback can prompt the selected agent to act.
- The worker reads Git, serves a local UI, stores progress, and uses Orca’s bundled CLI for session delivery.
- Earlier viewer tested in stock Orca on macOS. New comment delivery has automated simulated tests only; live delivery and Windows still need verification.

Development: `node --test tests/*.test.mjs` (Node 24). Continuation notes: [HANDOFF.md](HANDOFF.md).
