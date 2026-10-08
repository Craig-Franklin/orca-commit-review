import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, history, commitDetails, fileDiff } from '../git.mjs'
import { startReviewServer } from '../server.mjs'

test('historical diffs, literal filenames, review persistence, and HTTP isolation', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'orca-review-test-'))
  const data = new Map()
  let server
  try {
    await git(repo, ['init', '-b', 'main'])
    await git(repo, ['config', 'commit.gpgsign', 'false'])
    await git(repo, ['config', 'core.autocrlf', 'false'])
    await git(repo, ['config', 'user.name', 'Review Test'])
    await git(repo, ['config', 'user.email', 'review@example.invalid'])
    const filename = process.platform === 'win32' ? '-file [one].txt' : ':(glob)*.txt'
    for (const value of ['parent-A', 'selected-B', 'latest-C']) {
      await writeFile(join(repo, filename), value + '\n')
      await git(repo, ['add', '--', `:(literal)${filename}`])
      await git(repo, ['commit', '-m', value])
    }
    const commits = await history(repo)
    assert.equal(commits.length, 3)
    assert.equal(commits[1].subject, 'selected-B')
    const diff = await fileDiff(repo, commits[1].id, filename)
    assert.match(diff, /-parent-A/)
    assert.match(diff, /\+selected-B/)
    assert.doesNotMatch(diff, /latest-C/)
    assert.equal((await commitDetails(repo, commits[2].id)).files[0].status, 'A')
    assert.match(await fileDiff(repo, commits[2].id, filename), /\+parent-A/)
    await assert.rejects(() => fileDiff(repo, commits[1].id, 'other-file'))
    server = await startReviewServer({
      get: async (k) => data.get(k),
      set: async (k, v) => data.set(k, structuredClone(v))
    })
    const url = new URL('/api/review', server.origin)
    url.searchParams.set('repo', repo)
    url.searchParams.set('commit', commits[1].id)
    const headers = { 'X-Review-Token': server.token, 'Content-Type': 'application/json' }
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403)
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://example.com' },
          body: '{}'
        })
      ).status,
      403
    )
    const save = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: filename, reviewed: true })
    })
    assert.equal(save.status, 200)
    assert.deepEqual(await save.json(), { total: 1, paths: [filename], complete: false })
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ path: 'other-file', reviewed: true })
        })
      ).status,
      400
    )
    await server.close()
    server = await startReviewServer({
      get: async (k) => data.get(k),
      set: async (k, v) => data.set(k, structuredClone(v))
    })
    const reload = new URL('/api/history', server.origin)
    reload.searchParams.set('repo', repo)
    const result = await (
      await fetch(reload, { headers: { 'X-Review-Token': server.token } })
    ).json()
    assert.deepEqual(result.review[commits[1].id], { total: 1, paths: [filename], complete: false })
    assert.equal(result.review[commits[0].id], undefined)
  } finally {
    await server?.close()
    await rm(repo, { recursive: true, force: true })
  }
})


test('unborn histories, first-parent merges, and configured Git notes remain unambiguous', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'orca-history-test-'))
  try {
    await git(repo, ['init', '-b', 'main'])
    await git(repo, ['config', 'user.name', 'Test'])
    await git(repo, ['config', 'user.email', 'test@example.invalid'])
    await git(repo, ['config', 'commit.gpgsign', 'false'])
    await git(repo, ['config', 'core.autocrlf', 'false'])
    assert.deepEqual(await history(repo), [])
    await writeFile(join(repo, 'first.txt'), 'initial\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'root'])
    await git(repo, ['checkout', '-b', 'side'])
    await writeFile(join(repo, 'second.txt'), 'side change\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'side'])
    await git(repo, ['checkout', 'main'])
    await writeFile(join(repo, 'first.txt'), 'main change\n')
    await git(repo, ['commit', '-am', 'main change'])
    const parent = (await git(repo, ['rev-parse', 'HEAD'])).trim()
    await git(repo, ['merge', '--no-ff', 'side', '-m', 'merge'])
    await git(repo, ['notes', 'add', '-m', 'This note must not become a commit hash'])
    await git(repo, ['config', 'notes.displayRef', 'refs/notes/commits'])
    await git(repo, ['config', 'color.ui', 'always'])
    const commits = await history(repo)
    assert.equal(commits.length, 4)
    assert.ok(commits.every((c) => /^[a-f0-9]{40}$/.test(c.id)))
    const details = await commitDetails(repo, commits[0].id)
    assert.equal(details.parent, parent)
    assert.deepEqual(details.files, [{ status: 'A', path: 'second.txt' }])
    assert.match(await fileDiff(repo, commits[0].id, 'second.txt'), /\+side change/)
  } finally { await rm(repo, { recursive: true, force: true }) }
})

test('completion requires every file, persists across restart, and unmarking reopens the commit', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'orca-completion-test-'))
  const data = new Map()
  const adapter = { get: async (key) => structuredClone(data.get(key)), set: async (key, value) => data.set(key, structuredClone(value)) }
  let server
  try {
    await git(repo, ['init', '-b', 'main'])
    await git(repo, ['config', 'user.name', 'Test'])
    await git(repo, ['config', 'user.email', 'test@example.invalid'])
    await git(repo, ['config', 'commit.gpgsign', 'false'])
    for (const file of ['a.txt', 'b.txt']) await writeFile(join(repo, file), 'text\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'two files'])
    const commit = (await git(repo, ['rev-parse', 'HEAD'])).trim()
    await git(repo, ['commit', '--allow-empty', '-m', 'empty'])
    const empty = (await git(repo, ['rev-parse', 'HEAD'])).trim()
    server = await startReviewServer(adapter)
    const post = (body, id = commit) => {
      const url = new URL('/api/review', server.origin)
      url.searchParams.set('repo', repo)
      url.searchParams.set('commit', id)
      return fetch(url, { method: 'POST', headers: { 'X-Review-Token': server.token }, body: JSON.stringify(body) })
    }
    assert.equal((await post({ complete: true })).status, 400)
    const saves = await Promise.all(['a.txt', 'b.txt'].map((path) => post({ path, reviewed: true })))
    assert.ok(saves.every((r) => r.status === 200))
    assert.equal((await (await post({ complete: true })).json()).complete, true)
    assert.equal((await (await post({ complete: true }, empty)).json()).complete, true)
    await server.close()
    server = await startReviewServer(adapter)
    const url = new URL('/api/progress', server.origin)
    url.searchParams.set('repo', repo)
    const progress = await (await fetch(url, { headers: { 'X-Review-Token': server.token } })).json()
    assert.deepEqual({ ...progress[commit], paths: progress[commit].paths.sort() }, { total: 2, paths: ['a.txt', 'b.txt'], complete: true })
    assert.equal(progress[empty].complete, true)
    assert.equal((await (await post({ path: 'a.txt', reviewed: false })).json()).complete, false)
    assert.equal((await post({ complete: true })).status, 400)
  } finally { await server?.close(); await rm(repo, { recursive: true, force: true }) }
})

test('authenticated page heartbeat keeps storage active and releases it on disconnect', async () => {
  let reads = 0
  const server = await startReviewServer({ get: async () => { reads++ }, set: async () => {}, heartbeatMs: 10 })
  const controller = new AbortController()
  try {
    const url = new URL('/api/heartbeat', server.origin)
    assert.equal((await fetch(url)).status, 403)
    assert.equal(reads, 0)
    const response = await fetch(url, { headers: { 'X-Review-Token': server.token }, signal: controller.signal })
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.match(new TextDecoder().decode(first.value), /connected/)
    await reader.read()
    assert.ok(reads >= 2)
    controller.abort()
    // Allow the socket-close event to clear its interval, then ensure reads stop.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const stopped = reads
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(reads, stopped)
  } finally { controller.abort(); await server.close() }
})
