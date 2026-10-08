# Contributing and releases

Use Node 24, run `npm ci`, then `npm test` and `npm run lint:commits` before pushing. Release tools are development dependencies; the plugin installs in stock Orca from a Git URL without npm or a custom build.

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
feat(review): add a review action
fix(cli): preserve a refusal receipt
docs: clarify installation
feat(api)!: change the request format
```

A breaking-change footer can also request a major version:

```text
refactor(api): simplify requests

BREAKING CHANGE: callers must supply the commit hash.
```

The highest change in all commits since the last release wins:

| Commit | Stable SemVer change | Preview example from `0.2.1-preview.1` |
| --- | --- | --- |
| `fix:` or `perf:` | Patch | `0.2.1-preview.2` |
| `feat:` | Minor | `0.3.0-preview.1` |
| `!` or breaking-change footer | Major, including before 1.0 | `1.0.0-preview.1` |
| `docs:`, `test:`, `ci:`, `chore:`, other types | None unless breaking | No new version |

While a version is a preview, changes within that pending patch/minor/major increment its preview number. Releases stay on the `preview` channel until stock-Orca acceptance is complete. Switching `.release.json`'s `prerelease` to `null` enables stable versions for a later release-worthy commit; changing that setting is a separate acceptance decision.

CI checks all non-merge commit messages. Use squash merges with a Conventional Commit message, or ensure individual commits conform. Git-generated merge subjects are excluded, while commits inside the merge are checked. An invalid message fails CI and prevents a release. Keep developer commits signed.

On a push to `main`, GitHub Actions:

1. Checks Conventional Commits, runs the automated suite on macOS and Windows, and validates the proposed version.
2. Serializes release jobs and verifies that the tested source is still the branch head.
3. Updates `package.json`, `package-lock.json`, `orca-plugin.json`, `CHANGELOG.md`, and the README installation URL. Checks the generated package metadata.
4. Uses `createCommitOnBranch` to create a GitHub-signed `chore(release): v<version>` commit. It checks GitHub verification before tagging.
5. Creates `v<version>` as a lightweight tag pointing to the verified commit, then publishes a GitHub prerelease with notes. Existing tags are never moved. No npm package is published.

The generated version commit advances `main`; pull it before starting the next change.

Only the release job has `contents: write`. It uses the built-in `GITHUB_TOKEN`; no PAT, private signing key, paid service, or extra secret is needed. GitHub suppresses recursive push workflows from that token, so the generated version commit does not start another release loop. Both platform tests covered its source parent; the job also validates the generated metadata before committing.

Run `npm run release:plan` for a read-only preview. For a failed publication, use **Actions → Plugin tests and release → Run workflow** on `main`, or rerun the failed job. Recovery reuses a signed version commit and an existing tag/release. A partial release followed by a newer push is recovered before calculating that push's next version. A conflicting tag or unverified commit stops publication.

The first release after the Conventional Commit history rewrite uses the explicit bootstrap in `.release.json`. The rewritten bootstrap tree must match the preserved `v0.2.1-preview.1` tag. Do not move published tags to make rewritten history reachable. Rewriting history again requires an explicit baseline migration.

Automated tests and release publication do not prove plugin installation, comment UI behavior, real terminal-agent delivery, or Windows desktop acceptance. Those checks remain in `HANDOFF.md`.
