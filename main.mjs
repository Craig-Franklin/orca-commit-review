import path from 'node:path'
import { createCli } from './cli.mjs'
import { startReviewServer } from './server.mjs'

export async function launchContext(cli, platform = process.platform, requireSupportedFocus = true) {
  const [{ repos = [] }, snapshot] = await Promise.all([cli(['repo', 'list']), cli(['worktree', 'ps'])])
  const localRepos = repos.filter((r) => r.kind !== 'folder' && !r.connectionId && !r.runtimeEnvironmentId)
  const localIds = new Set(localRepos.map((r) => r.id))
  const localWorktree = (w) => w.workspaceKind !== 'folder-workspace' && !w.isArchived &&
    (!w.hostId || w.hostId === 'local') && (!w.terminalPlatform || w.terminalPlatform === platform) &&
    localIds.has(w.repoId)
  const active = snapshot.worktrees.filter((w) => w.isActive)
  if (requireSupportedFocus && active.length > 1) throw Error('Orca reports multiple active worktrees. Select one local Git worktree and try again.')
  if (requireSupportedFocus && active.length && !localWorktree(active[0]))
    throw Error('Select a local Git worktree in Orca. Commit Review does not support folders, SSH, or WSL workspaces.')
  if (requireSupportedFocus && !active.length && snapshot.truncated)
    throw Error('Orca’s worktree list is incomplete, so the current worktree could not be identified.')
  const key = (p) => platform === 'win32' ? path.win32.normalize(p).toLowerCase() : p
  const options = new Map(localRepos.map((r) => [key(r.path), { path: r.path, name: r.displayName, baseRef: r.worktreeBaseRef ?? null }]))
  for (const w of snapshot.worktrees.filter(localWorktree)) {
    options.set(key(w.path), { path: w.path, name: `${w.repo} — ${w.displayName}`, baseRef: localRepos.find((r) => r.id === w.repoId)?.worktreeBaseRef ?? null })
  }
  return { repos: [...options.values()], current: active.length === 1 && localWorktree(active[0]) ? active[0] : null }
}

export function createPlugin({ cli = createCli(), startServer = startReviewServer, platform = process.platform } = {}) {
  let reviewServer
  let startingServer
  return {
    activate(orca) {
      const get = async (key) => (await orca.host.call('storage.get', { key })).value
      const set = async (key, value) => orca.host.call('storage.set', { key, value })
      orca.commands.register('commit-review.open', async () => {
        // Capture UI focus before starting a server or opening any tab. CLI
        // worktree current/active means shell cwd, which is unrelated in a worker.
        const context = await launchContext(cli, platform)
        const last = await get('last-repository')
        const repo = context.current ?? context.repos.find((r) => r.path === last) ?? context.repos[0]
        if (!repo) throw Error('Add a local Git project to Orca first, then open Commit Review again.')
        if (!reviewServer) {
          startingServer ??= startServer({ get, set, listRepositories: async () => (await launchContext(cli, platform, false)).repos, cli })
          try {
            reviewServer = await startingServer
          } finally {
            startingServer = undefined
          }
        }
        const url = new URL(reviewServer.url)
        // Each tab owns its initial checkout; global last-repository must not
        // override it or make concurrently opened worktrees review each other.
        url.searchParams.set('repo', repo.path)
        const selector = context.current ? `id:${context.current.worktreeId}` : `path:${repo.path}`
        await cli(['tab', 'create', '--url', url.href, '--worktree', selector])
        return { opened: true }
      })
    },
    async deactivate() {
      if (startingServer) await startingServer.catch(() => {})
      if (reviewServer) await reviewServer.close()
      reviewServer = undefined
    }
  }
}
const plugin = createPlugin()
export default plugin.activate
export const deactivate = plugin.deactivate
