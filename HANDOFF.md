# Orca Commit Review: implementation and acceptance handoff

## Conventional Commits and automatic releases — 2026-10-08

This update supersedes the earlier `main` commit identities below; the published `v0.2.0` and `v0.2.1-preview.1` tags stay unchanged. All five existing mainline commits were rewritten with identical trees, preserved author identity/date, Conventional Commit subjects, and fresh SSH signatures:

| Previous main commit | Conventional replacement | Subject |
| --- | --- | --- |
| `9412a7a` | `f9560a2` | `feat: add installable Orca commit review plugin` |
| `d30df24` | `5b25b10` | `docs: document implementation and verification handoff` |
| `5417c66` | `109b172` | `fix: harden review persistence and delivery recovery` |
| `7a46531` | `7a2d912` | `test: cover CLI transport and Unicode checkout paths` |
| `0da4499` | `227f06b` | `docs: record signed preview and acceptance evidence` |

- `.github/workflows/test.yml` validates Conventional Commits, runs tests on macOS and Windows, then publishes only from the exact personal repository's `main` branch. `npm ci` is required for development/CI; the stock-Orca plugin runtime remains dependency-free and needs no npm install.
- `.release.json` keeps automated publication on the `preview` channel while runtime acceptance is open. `fix`/`perf` request patch, `feat` minor, and `!` or `BREAKING CHANGE`/`BREAKING-CHANGE` major. Documentation/test/chore-only changes do not create a new version. See `CONTRIBUTING.md` for version examples and recovery.
- The release job updates package, lockfile, plugin manifest, changelog and pinned README URL. It creates `chore(release): v<version>` through GitHub's signing API with an expected-HEAD fence, verifies the resulting signature, then creates an immutable lightweight version tag and a GitHub prerelease. No private signing key or extra secret is stored in CI; it uses the repository-scoped `GITHUB_TOKEN`.
- Bootstrap commit `7a2d91296ada7b0ebe45bcdb0a142582aedf0284` is the rewritten equivalent of the preserved preview. Its tree must match the published preview tag before the first automated release. Subsequent releases use reachable semantic tags, so old history retained by published tags cannot inflate version calculation.
- Release jobs are serialized. A stale tested source skips publication. Reruns recover an accepted release commit, tag or release without moving an existing tag; if newer source arrived after an interrupted version commit, recovery publishes that version first and then plans the newer changes.
- Local release tests are being completed; GitHub CI, rewritten signature verification and the first actual automatic tag/release will be recorded after pushing. Existing desktop/browser and designated-session restrictions remain in force. A published prerelease does not close any plugin runtime acceptance gate.

## Current status — 2026-10-08

**Implementation improved; required runtime acceptance remains open. Do not call the plugin finished.** Version `0.2.1-preview.1` is a preview. The sections below preserve predecessor evidence and requirements; this update supersedes their test count and architecture details where stated.

- Verified clean checkout and exact personal remote `https://github.com/Craig-Franklin/orca-commit-review.git` before edits. No custom Orca build or desktop/browser control used. No terminal input sent to any session.
- Replaced the two unsigned commits on `main` with SSH-signed equivalents, preserving their trees, messages, authors and author dates. Original `c62294538eeac6a3f5eaac1c3dd41eae0cb234b7` becomes `9412a7a84c6e6f965202fd447bd8c069da818de9`; original `5a390b6e9cca910f58d2555b2076d86abd29b71d` becomes `d30df24192ba0b1a33dad4f865cc8d79c1223b38`. Keep the original `v0.2.0` tag at `c62294538eeac6a3f5eaac1c3dd41eae0cb234b7`: its unsigned ancestor is the deliberate exception to preserving all historical refs. GitHub reports all published commits on `main` through `7a46531fbf2c5b0b01db869cd43de6a4e59e1919` as verified (`reason: valid`). The final documentation commit must also be checked after push. Local recovery bundle and mapping are ignored under `.tmp/`.

Implemented fixes and behavior:

- `cli.mjs` owns packaged CLI discovery and invocation. It preserves structured exit-1 refusal receipts, hides command-line/comment content from errors, keeps argument arrays, and clears ambient remote selectors and Node injection flags.
- Sends bind receipts to the target handle and request ID. Only a confirmed zero-byte refusal restores drafts. Partial writes, missing/mismatched receipts, and transport failures remain uncertain. Once input acceptance is known, later refusals cannot restore drafts. Delivery checks revalidate checkout, agent and process incarnation before replaying the exact request. Predecessor attempts lacking identity are deliberately kept uncertain.
- Explicit commit completion requires every file mark, supports empty commits, persists locally, and reopens when a file is unmarked. Earlier marks remain; completion is now explicit.
- Empty repositories open successfully. History excludes Git notes/signature/color output; merge diffs compare first parent. Submodules use summaries rather than nested patches that could mis-anchor comments.
- UI guards stale diff/comment/progress responses. The heartbeat streams while a page is connected and calls host storage independently of background-page timer throttling; disconnect releases it. Connection loss explains how to reopen from the command palette. The lifecycle test is synthetic, not a stock-worker idle/sleep test.
- HTTP bodies decode UTF-8 across chunk boundaries and token checks reject non-hex input.
- Added macOS/Windows Node 24 CI. All 29 tests passed on both platforms, including real child-process argument transport and Unicode/space-containing Git checkout paths. [Final implementation CI](https://github.com/Craig-Franklin/orca-commit-review/actions/runs/37848228072) tested `7a46531fbf2c5b0b01db869cd43de6a4e59e1919` with Node 24.21.0; the Windows runner image was `windows-2025-vs2026`. Windows desktop/Orca integration remains separate.

Verification at this point:

- 29 tests passed with local Node 24.13.0 and again from a fresh clone of the published preview with Orca’s bundled Node 24.21.0. Tests use real temporary Git histories and HTTP, an in-memory DOM, and a simulated send adapter. These are not installed-plugin or real-delivery acceptance.
- `scripts/verify-runtime.mjs` passed read-only checks under the installed Orca executable: packaged Node 24.21.0, stock Orca 1.4.220, bundled CLI discovery, local runtime connectivity, durable prompt capability, repo JSON and exact-checkout session enumeration. The probe performs no sends, opens no tabs, and controls no desktop/browser. An enumerated agent is not a designated test target.
- Published signed annotated tag [`v0.2.1-preview.1`](https://github.com/Craig-Franklin/orca-commit-review/tree/v0.2.1-preview.1) resolves to `7a46531fbf2c5b0b01db869cd43de6a4e59e1919`. GitHub verified both tag signature and commit signature. A fresh Git URL clone of that exact tag passed all 29 tests under bundled Orca Node and contained every required runtime file, with no build/dependency directories or private `.tmp` artifacts tracked. `main` has newer acceptance documentation; the pinned preview code is unchanged. Cloning is not proof of Settings installation, consent, activation or visual usability.

Remaining acceptance checks (macOS and Windows):

1. Install the published `#v0.2.1-preview.1` Git URL through stock Orca Settings, enable it, and open from the command palette. Verify the installed version; do not reuse the old immutable local-folder snapshot.
2. Use an explicitly designated disposable checkout and terminal agent. Select a historical commit with added and removed lines. Save a file comment and both old/new line comments; reload and confirm bodies/anchors persist.
3. Select the designated agent; send those drafts once. Record the accepted request ID and independently inspect the receiving session for the exact commit hash, checkout, file, old/new side, line, context and text. Check delivery using the same request and confirm no duplicate feedback appears. Acceptance receipts alone do not prove correct receipt by the agent.
4. Mark every changed file, complete the commit, reload and verify both persist. Unmark a file and confirm reopening. Complete an empty commit.
5. Keep a background tab open beyond five minutes and check it remains usable; close tabs and verify the worker can idle; restart Orca and reopen to confirm persisted state. This specifically requires stock-app observation.
6. Repeat Git URL installation, discovery, Unicode/space-containing paths, Git/diff/review loop, and real delivery on Windows with Git for Windows on PATH. CI proves only the automated parts.

The desktop/browser prohibition blocks Settings installation, visual acceptance and stock UI lifecycle checks. Live delivery also requires a designated test target; the user explicitly confirmed “No designated test target yet” during this execution. No test send was attempted. Do not bypass the prohibition via CDP or renderer evaluation. User-performed steps can supply evidence without lifting the restriction; otherwise request permission for those specific checks only.

## Objective

Finish and verify a small stock-Orca plugin for reviewing agent work one commit at a time. Work through implementation and meaningful tests; do not stop after producing another plan. Report blockers precisely and never call a simulated test end-to-end proof.

The public repository is `Craig-Franklin/orca-commit-review`. The initial implementation is commit `c62294538eeac6a3f5eaac1c3dd41eae0cb234b7`, tagged `v0.2.0`. That tag is an experimental checkpoint, not a verified finished release. Start from current `main`, which also contains this handoff; preserve the existing tag.

## User requirements and constraints

- Stock Orca installation from a Git URL. A custom Orca build is unacceptable.
- A Git graph, per-commit file diffs, explicit reviewed-file marks, and commit completion. Compare a commit to its parent, not the branch base; merges currently use the first parent.
- File and line comments that can be sent back to the selected Orca **terminal agent** are non-negotiable. Native chat support is not required for this iteration.
- macOS and Windows, local persistence; no sync needed. The current browser-tab approach is a prototype awaiting hands-on acceptance, not approval of every UI choice.
- Keep the README and installation simple. Give concise progress updates during sustained work.
- **Do not control the desktop or browser.** Another session is using computer control. Do not switch tabs, click, screenshot, reload, open/focus apps, or drive the user's embedded browser unless the user explicitly lifts that constraint. Shell, source inspection, and isolated noninteractive tests are available.
- Do not send test feedback to unrelated or production sessions. Before a live send, identify an explicitly designated test target. This handoff does not designate any existing session as that target.
- Only modify this plugin repository. The earlier `Orca-Commit-Review` checkout contains the rejected custom-build prototype and unrelated dirty work: use its Orca API source for reference only.
- Keep GitHub operations under the personal `Craig-Franklin/orca-commit-review` repository. Do not alter organization access, credentials, or other projects.

## Start here

1. Read this file and `README.md`; inspect `git status`, `git remote -v`, and current `HEAD`. Preserve any newer user changes.
2. For development checks, run `npm ci` then `npm test` with Node 24; `npm run lint:commits` checks commit subjects. No build or dependency installation is required for the installed plugin runtime.
3. Read `main.mjs`, `comments.mjs`, `server.mjs`, and `web/app.js` before changing behavior. Audit the implementation rather than assuming passing mocks prove compatibility.
4. Read the `orca-cli` skill and its version-matched guide before runtime operations. Use the installed production Orca CLI, not a development instance. On this Mac it was `/Applications/Orca.app/Contents/Resources/bin/orca`; verify it still exists.

## Architecture and API findings

- `orca-plugin.json`: plugin identity `craig-franklin.commit-review`, worker entry `main.mjs`, storage capability, minimum Orca 1.4.220.
- `main.mjs` and `cli.mjs`: trusted Node worker starts the loopback server and opens its UI as an Orca browser tab. It finds Orca's bundled CLI by walking ancestors of `process.execPath`, including the macOS Helper.app case, then uses `execFile` with `ELECTRON_RUN_AS_NODE=1`.
- `git.mjs`: reads local Git history and historical file diffs. Uses argument arrays and literal pathspecs, disables external diff/textconv, limits output to 4 MB, and does not edit repository files.
- `server.mjs`: authenticated loopback HTTP API. Random token supplied in URL fragment and API header; exact Host/Origin checks, no CORS, restrictive CSP. Review progress uses Orca plugin storage.
- `comments.mjs`: stored draft comments keyed by checkout and commit; validates file/old/new line anchors. Enumerates connected writable agents from `terminal list --worktree path:<checkout>`, checks the canonical checkout path, and sends to an explicit runtime-issued handle.
- Sending persists the exact prompt, target, and request ID before calling `terminal send --text ... --enter --wait-submit 3 --retry-request <id>`. Duplicate HTTP submissions do not create another send. Explicit Check delivery uses the same original command/request. Distinguishes input acceptance from observed `turn_started`; uncertain delivery retains comments.
- `web/`: vanilla browser UI, Git graph, inline diff, review marks, file/line comment dialog, draft selection, session picker, and delivery status. `diff-lines.mjs` is shared by rendering and server line validation.
- A connected-page heartbeat calls host storage to keep the plugin worker active; Orca otherwise reaps idle workers. Review worker lifecycle and reconnect behavior before declaring reliability.
- Sandboxed plugin panels lack the bridge/API access needed for this implementation. The trusted worker plus local web UI avoids changes to Orca. Do not rebuild the old native sidebar solution.
- Orca's source references: `src/renderer/src/lib/agent-message-send.ts`, `active-agent-note-send.ts`, `src/shared/diff-comments-format.ts`, `src/cli/handlers/terminal-send.ts`, and `src/shared/runtime-terminal-contracts.ts`. The local source reference predates the installed app; verify behavior against the actual installed version when needed.

## Evidence already obtained

- Earlier graph/diff/review-mark viewer was installed and exercised in stock Orca 1.4.220 on macOS; review persistence survived a page reload.
- The predecessor had ten passing Node tests. They cover real temporary Git histories, literal filenames, historical/root diffs, stored comments, old/new anchors, checkout/session filtering, simulated delivery, duplicate submissions, uncertain replies across service restart, storage failure before send, and HTTP authentication/origin checks.
- Source and tag were pushed to the public repo. The predecessor Git install URL was `https://github.com/Craig-Franklin/orca-commit-review.git#v0.2.0`; the new preview uses `#v0.2.1-preview.1`.
- The plugin checkout has been registered as an Orca project named `orca-commit-review-plugin`. No new agent was launched; the user will start a Sol session and paste a prompt.

## Not yet proven

- The new comment UI has not been exercised inside stock Orca.
- No real review comment has been sent to any live agent during development. The send tests use a fake CLI adapter.
- Installation from the published Git URL has not been exercised in the app.
- Windows desktop installation, bundled Orca CLI discovery in a real plugin worker, and live delivery have not been runtime-tested. Windows CI has exercised real Git invocation, HTTP/persistence, Unicode paths, and generic child-process argument transport.
- The previously installed local-folder plugin is an immutable snapshot of the earlier viewer. Editing this checkout does not update that installation. Do not mistake an old working tab for the new implementation.

## Execution order and acceptance

1. **Audit and finish the implementation.** Check session targeting and revalidation, actual CLI JSON/error/receipt shapes, safe recovery when a send is rejected or uncertain, persistence failures, browser state races while changing files/commits, Windows argument/path handling, and worker lifetime. These are review targets, not predeclared defects. Add focused regression tests for confirmed problems and keep scope small.
2. **Verify packaging without touching the desktop.** Check the manifest, published/ref-resolved files, source exclusions, and absence of build/runtime dependencies beyond Git and Orca. Add useful cross-platform automated checks if available; do not describe them as a Windows desktop test.
3. **Verify live integration when permitted.** If installation/UI testing requires desktop or embedded-browser control, finish all independent work first and explicitly report the remaining restriction. Do not bypass it through CDP or renderer evaluation. Have the user perform the install/test steps or obtain permission for a later controlled test.
4. **Prove the key review loop.** On a designated test checkout/session: choose a historical commit; add file, added-line, and removed-line comments; reload to verify persistence; send selected drafts to the chosen agent; confirm exact commit/path/side/line/text in the receiving session; exercise delivery checks without duplicate messages. Verify marked files and commit completion persist. Report both acceptance receipts and actual observed results accurately.
5. **Check Windows.** Use an available Windows environment or give a short explicit test checklist and keep this item open. Do not claim it passed based on macOS or mocks.
6. **Record and deliver.** Update this handoff with fixes, tests, and remaining blockers. Keep the README's verification claims accurate. Commit and push scoped changes to the personal repo; do not rewrite `v0.2.0`. If publishing a new version, bump manifest/package together and use a new tag only with an accurate preview/verified status.

Completion means the agreed review loop works in stock Orca with real comment delivery and evidence for the supported platforms. If a runtime or user restriction prevents full verification, clearly state what is implemented, what is proven, and what remains. The user specifically asked whether this was actually done: do not repeat an overstatement of completion.
