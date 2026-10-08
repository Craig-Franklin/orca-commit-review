import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { cliInvocation, createCli, installedUserDataPath } from '../cli.mjs'

test('installed worker resolves its owning profile without APPDATA, including redirected Windows profiles', async () => {
  const hash = 'a'.repeat(64)
  for (const [paths, profile] of [
    [path.win32, String.raw`D:\Redirected profiles\Craig 🦎\orca`],
    [path.posix, '/Users/craig/Library/Application Support/orca']
  ]) {
    const modulePath = paths.join(profile, 'plugins', 'craig-franklin.commit-review', hash, 'cli.mjs')
    assert.equal(installedUserDataPath(modulePath, paths), profile)
    let observed
    const cli = createCli({ modulePath, paths, invoke: () => ['orca', []],
      env: { USERPROFILE: 'wrong-default-home', orca_user_data_path: 'other-instance', ORCA_REMOTE_PAIRING: 'unrelated-host' },
      executeFile: async (...args) => {
        observed = args[2].env
        return { stdout: JSON.stringify({ ok: true, result: { repos: [] } }) }
      } })
    await cli(['repo', 'list'])
    assert.deepEqual(observed, { USERPROFILE: 'wrong-default-home', ELECTRON_RUN_AS_NODE: '1', ORCA_USER_DATA_PATH: profile })
  }
})

test('development paths and other plugins cannot select an inferred Orca profile', () => {
  const hash = 'b'.repeat(64)
  for (const segments of [
    ['checkout', 'cli.mjs'], ['plugins', 'other.plugin', hash, 'cli.mjs'],
    ['plugins', 'craig-franklin.commit-review', 'not-a-content-hash', 'cli.mjs'],
    ['other', 'craig-franklin.commit-review', hash, 'cli.mjs']
  ]) {
    assert.equal(installedUserDataPath(path.join('/tmp/profile', ...segments)), undefined)
  }
})

test('packaged CLI discovery handles macOS Helper.app and Windows paths with spaces', () => {
  for (const [paths, executable, entry] of [
    [path.posix, '/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper', '/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/index.js'],
    [path.win32, String.raw`C:\Program Files\Orca\Orca.exe`, String.raw`C:\Program Files\Orca\resources\app.asar.unpacked\out\cli\index.js`]
  ]) {
    assert.deepEqual(cliInvocation(executable, paths, (p) => p === entry), [executable, [entry]])
    assert.throws(() => cliInvocation(executable, paths, () => false), /bundled Orca CLI/)
  }
})

test('CLI preserves argument boundaries and suppresses ambient remote and Node selectors', async () => {
  let observed
  const cli = createCli({ invoke: () => ['Orca.exe', ['C:/Program Files/cli.js']],
    env: { PATH: 'git', ORCA_ENVIRONMENT: 'other-host', orca_pairing_code: 'private', NODE_OPTIONS: '--inspect' },
    executeFile: async (...args) => { observed = args; return { stdout: JSON.stringify({ ok: true, result: { terminals: [] } }) } } })
  const text = '"quoted" \n$(do not execute) 😃'
  assert.deepEqual(await cli(['terminal', 'send', '--text', text]), { terminals: [] })
  assert.deepEqual(observed[1], ['C:/Program Files/cli.js', 'terminal', 'send', '--text', text, '--json'])
  assert.deepEqual(observed[2].env, { PATH: 'git', ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(observed[2].windowsHide, true)
})

test('normal nonzero refusal keeps its structured receipt; timeouts and malformed replies stay uncertain', async () => {
  const result = { send: { handle: 'term_test', accepted: false, bytesWritten: 0 } }
  let failure = { code: 1, stdout: JSON.stringify({ ok: true, result }) }
  const cli = createCli({ invoke: () => ['orca', []], executeFile: async () => { throw failure } })
  assert.deepEqual(await cli(['terminal', 'send']), result)
  for (const error of [
    { ...failure, killed: true }, { ...failure, signal: 'SIGTERM' },
    { ...failure, code: 'ETIMEDOUT' }, { code: 1, stdout: 'private partial text' },
    { code: 1, stdout: JSON.stringify({ ok: false, error: { message: 'private payload' } }) }
  ]) {
    failure = error
    await assert.rejects(() => cli([]), (e) => !/private/.test(e.message))
  }
})

test('real child-process transport preserves long Unicode, quotes, backslashes and multiline arguments', async () => {
  const fixture = new URL('./fixtures/cli-echo.mjs', import.meta.url)
  const { fileURLToPath } = await import('node:url')
  const cli = createCli({ invoke: () => [process.execPath, [fileURLToPath(fixture)]] })
  const text = 'Review 🦎 café\n"quoted" \\path\\ $(literal) '.repeat(180)
  assert.ok(text.length < 10000)
  const args = ['terminal', 'send', '--text', text, '--retry-request', 'designated-fixture-only']
  assert.deepEqual((await cli(args)).args, [...args, '--json'])
})
