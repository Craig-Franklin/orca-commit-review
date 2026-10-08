import { createCli } from './cli.mjs'
import { startReviewServer } from './server.mjs'
const cli = createCli()
let reviewServer
let startingServer
export default function activate(orca) {
  const get = async (key) => (await orca.host.call('storage.get', { key })).value
  const set = async (key, value) => orca.host.call('storage.set', { key, value })
  orca.commands.register('commit-review.open', async () => {
    const repos = async () => {
      const { repos = [] } = await cli(['repo', 'list'])
      return repos
        .filter((r) => r.kind !== 'folder' && !r.connectionId && !r.runtimeEnvironmentId)
        .map((r) => ({ path: r.path, name: r.displayName }))
    }
    if (!reviewServer) {
      startingServer ??= startReviewServer({ get, set, listRepositories: repos, cli })
      try {
        reviewServer = await startingServer
      } finally {
        startingServer = undefined
      }
    }
    const options = await repos()
    const last = await get('last-repository')
    const repo = options.find((r) => r.path === last) ?? options[0]
    if (!repo) throw Error('Add a local Git project to Orca first, then open Commit Review again.')
    await cli(['tab', 'create', '--url', reviewServer.url, '--worktree', `path:${repo.path}`])
    return { opened: true }
  })
}
export async function deactivate() {
  if (startingServer) await startingServer.catch(() => {})
  if (reviewServer) await reviewServer.close()
  reviewServer = undefined
}
