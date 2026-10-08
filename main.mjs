import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { startReviewServer } from './server.mjs'
const execute = promisify(execFile)
let reviewServer
function cliInvocation() {
  // macOS workers may run from Orca Helper.app inside the main app bundle.
  let directory = dirname(process.execPath)
  while (true) {
    for (const resources of ['Resources', 'resources']) {
      const entry = join(directory, resources, 'app.asar.unpacked', 'out', 'cli', 'index.js')
      if (existsSync(entry)) return [process.execPath, [entry]]
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw Error(
    'Cannot find the bundled Orca CLI. This plugin requires a packaged desktop Orca installation.'
  )
}
async function cli(args) {
  const [program, prefix] = cliInvocation()
  const { stdout } = await execute(program, [...prefix, ...args, '--json'], {
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  const data = JSON.parse(stdout)
  if (data.ok === false) throw Error(data.error?.message || 'Orca command failed.')
  return data.result ?? data
}
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
    reviewServer ??= await startReviewServer({ get, set, listRepositories: repos, cli })
    const options = await repos()
    const last = await get('last-repository')
    const repo = options.find((r) => r.path === last) ?? options[0]
    if (!repo) throw Error('Add a local Git project to Orca first, then open Commit Review again.')
    await cli(['tab', 'create', '--url', reviewServer.url, '--worktree', `path:${repo.path}`])
    return { opened: true }
  })
}
export async function deactivate() {
  if (reviewServer) await reviewServer.close()
  reviewServer = undefined
}
