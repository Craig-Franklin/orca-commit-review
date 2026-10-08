import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const execute = promisify(execFile)

export function installedUserDataPath(modulePath = fileURLToPath(import.meta.url), paths = path) {
  // Stock installs live at <userData>/plugins/<pluginKey>/<contentHash>/.
  // Resolve the actual owning profile rather than guessing Windows APPDATA:
  // Orca deliberately omits that variable from trusted worker environments.
  const root = paths.dirname(modulePath)
  const plugin = paths.dirname(root)
  const plugins = paths.dirname(plugin)
  if (/^[a-f0-9]{64}$/.test(paths.basename(root)) &&
      paths.basename(plugin) === 'craig-franklin.commit-review' &&
      paths.basename(plugins) === 'plugins') return paths.dirname(plugins)
  return undefined
}

export function cliInvocation(execPath = process.execPath, paths = path, exists = existsSync) {
  // Include macOS Helper.app ancestors and Windows resources beside Orca.exe.
  let directory = paths.dirname(execPath)
  while (true) {
    for (const resources of ['Resources', 'resources']) {
      const entry = paths.join(directory, resources, 'app.asar.unpacked', 'out', 'cli', 'index.js')
      if (exists(entry)) return [execPath, [entry]]
    }
    const parent = paths.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw Error('Cannot find the bundled Orca CLI. This plugin requires a packaged desktop Orca installation.')
}

export function createCli({ invoke = cliInvocation, executeFile = execute, env = process.env,
  modulePath = fileURLToPath(import.meta.url), paths = path } = {}) {
  return async (args) => {
    const [program, prefix] = invoke()
    // This plugin supports local desktop terminals only. Ambient remote selectors must
    // never redirect feedback to a different host. Mirror the bundled launcher for Node.
    const childEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' }
    for (const key of Object.keys(childEnv)) {
      if (['ORCA_ENVIRONMENT', 'ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'NODE_OPTIONS', 'NODE_REPL_EXTERNAL_MODULE']
        .includes(key.toUpperCase())) delete childEnv[key]
    }
    const userData = installedUserDataPath(modulePath, paths)
    if (userData) {
      for (const key of Object.keys(childEnv)) {
        if (key.toUpperCase() === 'ORCA_USER_DATA_PATH') delete childEnv[key]
      }
      childEnv.ORCA_USER_DATA_PATH = userData
    }
    let stdout
    try {
      ;({ stdout } = await executeFile(program, [...prefix, ...args, '--json'], {
        windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: childEnv
      }))
    } catch (error) {
      // A refused send exits 1 but still carries a structured receipt. Only normal
      // exits can supply that receipt; truncated output/timeouts remain uncertain.
      if (error.code !== 1 || error.killed || error.signal || !error.stdout)
        throw Error('Orca command did not return a complete receipt.')
      stdout = error.stdout
    }
    let data
    try { data = JSON.parse(stdout) } catch { throw Error('Orca returned an unreadable receipt.') }
    if (data?.ok !== true || !data.result || typeof data.result !== 'object')
      throw Error('Orca command failed. Check that the local desktop runtime is available.')
    return data.result
  }
}
