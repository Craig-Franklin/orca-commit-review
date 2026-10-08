import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlugin, launchContext } from '../main.mjs'

function harness({ platform = 'darwin', root = '/projects/repo', child = '/worktrees/feature', active = true } = {}) {
  const repos = [{ id: 'repo', path: root, displayName: 'Project', kind: 'git' }]
  const snapshot = { worktrees: [{ repoId: 'repo', repo: 'Project', worktreeId: `repo::${child}`, path: child,
    displayName: 'Feature', workspaceKind: 'git', terminalPlatform: platform, hostId: 'local', isActive: active }], truncated: false }
  const tabs = [], servers = []
  const cli = async (args) => {
    if (args[0] === 'repo') return { repos }
    if (args[0] === 'worktree') return snapshot
    if (args[0] === 'tab') { tabs.push(args); return {} }
    throw Error('Unexpected CLI call')
  }
  let command
  const plugin = createPlugin({ cli, platform, startServer: async (options) => {
    servers.push(options); return { url: 'http://127.0.0.1:1234/#private-token', close: async () => {} }
  } })
  plugin.activate({ commands: { register(_id, handler) { command = handler } },
    host: { call: async () => ({ value: root }) } })
  return { plugin, open: () => command(), cli, repos, snapshot, tabs, servers }
}

test('Open attaches to the focused child worktree and passes that exact checkout to each review tab', async () => {
  for (const options of [{}, { platform: 'win32', root: String.raw`C:\Projects\repo`, child: String.raw`D:\Worktrees\feature 🦎` }]) {
    const app = harness(options)
    try {
      await app.open()
      const first = app.tabs[0], child = app.snapshot.worktrees[0]
      assert.equal(first[first.indexOf('--worktree') + 1], `id:${child.worktreeId}`)
      const url = new URL(first[first.indexOf('--url') + 1])
      assert.equal(url.searchParams.get('repo'), child.path)
      assert.equal(url.hash, '#private-token')
      assert.ok((await app.servers[0].listRepositories()).some((r) => r.path === child.path))
      child.path += '-second'; child.worktreeId += '-second'
      await app.open()
      assert.equal(app.servers.length, 1)
      assert.equal(new URL(app.tabs[1][3]).searchParams.get('repo'), child.path)
      assert.notEqual(new URL(app.tabs[0][3]).searchParams.get('repo'), child.path)
    } finally { await app.plugin.deactivate() }
  }
})

test('without a focused worktree Open falls back to a registered project', async () => {
  const app = harness({ active: false })
  try {
    await app.open()
    assert.equal(app.tabs[0].at(-1), 'path:/projects/repo')
    assert.equal(new URL(app.tabs[0][3]).searchParams.get('repo'), '/projects/repo')
  } finally { await app.plugin.deactivate() }
})

test('unsupported, ambiguous, or truncated focus cannot open an unrelated project', async () => {
  for (const change of [
    (w) => { w.workspaceKind = 'folder-workspace' },
    (w) => { w.hostId = 'remote-server' },
    (w) => { w.terminalPlatform = 'linux' },
    (_w, s) => { s.worktrees.push({ ...s.worktrees[0], worktreeId: 'another' }) },
    (w, s) => { w.isActive = false; s.truncated = true }
  ]) {
    const app = harness()
    change(app.snapshot.worktrees[0], app.snapshot)
    await assert.rejects(() => app.open(), /local Git|multiple active|incomplete/)
    assert.equal(app.tabs.length, 0)
    assert.equal(app.servers.length, 0)
  }
})

test('local worktree options exclude remote repositories and retain their configured base ref', async () => {
  const app = harness()
  app.repos[0].worktreeBaseRef = 'origin/develop'
  app.repos.push({ id: 'remote', path: '/remote', connectionId: 'ssh', kind: 'git' })
  app.snapshot.worktrees.push({ repoId: 'remote', path: '/remote/feature', hostId: 'server', workspaceKind: 'git' })
  const context = await launchContext(app.cli)
  assert.ok(!context.repos.some((r) => r.path.startsWith('/remote')))
  // The compare default belongs to the project, including its child worktrees.
  assert.equal(context.repos.find((r) => r.path === '/worktrees/feature').baseRef, 'origin/develop')
})
