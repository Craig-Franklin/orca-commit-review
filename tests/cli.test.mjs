import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { cliInvocation, createCli } from '../cli.mjs'

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
