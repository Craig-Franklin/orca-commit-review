import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, comparison, history, commitDetails } from '../git.mjs'
import { startReviewServer } from '../server.mjs'
import { splitDiffLines } from '../web/diff-lines.mjs'

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'orca-compare-雪 '))
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'commit.gpgsign', 'false'])
  await git(repo, ['config', 'user.name', 'Test'])
  await git(repo, ['config', 'user.email', 'test@example.invalid'])
  const commit = async (subject) => {
    await git(repo, ['commit', '--allow-empty', '-m', subject])
    return (await git(repo, ['rev-parse', 'HEAD'])).trim()
  }
  const root = await commit('shared root')
  await git(repo, ['update-ref', 'refs/remotes/origin/main', root])
  await git(repo, ['checkout', '-b', 'feature'])
  const first = await commit('feature one'), second = await commit('feature two')
  await git(repo, ['checkout', 'main'])
  const base = await commit('base only')
  await git(repo, ['checkout', 'feature'])
  await git(repo, ['merge', '--no-ff', 'main', '-m', 'merge base'])
  const merge = (await git(repo, ['rev-parse', 'HEAD'])).trim()
  return { repo, root, first, second, base, merge }
}

test('compare filtering excludes every commit reachable from base and preserves parent-relative merge review', async () => {
  const f = await fixture()
  try {
    const settings = await comparison(f.repo, 'main')
    assert.equal(settings.compareRef, 'refs/heads/main')
    assert.equal(settings.currentBranch, 'feature')
    const commits = await history(f.repo, settings.compareRef)
    assert.deepEqual(new Set(commits.map((c) => c.id)), new Set([f.merge, f.second, f.first]))
    assert.ok(!commits.some((c) => [f.root, f.base].includes(c.id)))
    assert.equal((await commitDetails(f.repo, f.merge)).parent, f.second)
    await git(f.repo, ['branch', '-f', 'main', 'HEAD'])
    assert.deepEqual(await history(f.repo, 'refs/heads/main'), [])
    await git(f.repo, ['checkout', '--detach', f.second])
    assert.equal((await comparison(f.repo, 'origin/main')).currentBranch, 'Detached HEAD')
    assert.deepEqual((await history(f.repo, 'refs/remotes/origin/main')).map((c) => c.id), [f.second, f.first])
    for (const invalid of ['--all', 'main..HEAD', f.root, 'refs/heads/missing'])
      await assert.rejects(() => history(f.repo, invalid), /available compare branch/)
  } finally { await rm(f.repo, { recursive: true, force: true }) }
})

test('HTTP defaults to Orca base, persists a user override, and never returns unfiltered history', async () => {
  const f = await fixture(), data = new Map()
  let server
  const adapter = { get: async (key) => data.get(key), set: async (key, value) => data.set(key, value),
    listRepositories: async () => [{ path: f.repo, name: 'Feature', baseRef: 'main' }] }
  const request = async (route, body, params = {}) => {
    const url = new URL('/api/' + route, server.origin)
    url.searchParams.set('repo', f.repo)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return fetch(url, { method: body ? 'POST' : 'GET', headers: { 'X-Review-Token': server.token }, body: body ? JSON.stringify(body) : undefined })
  }
  try {
    server = await startReviewServer(adapter)
    assert.equal((await (await request('comparison')).json()).compareRef, 'refs/heads/main')
    const initial = await (await request('history')).json()
    assert.equal(initial.commits.length, 3)
    assert.ok(!initial.commits.some((c) => c.id === f.base))
    assert.equal((await request('comparison', { ref: '--all' })).status, 400)
    assert.equal((await request('comparison', { ref: 'refs/remotes/origin/main' })).status, 200)
    await server.close()
    server = await startReviewServer(adapter)
    assert.equal((await (await request('comparison')).json()).compareRef, 'refs/remotes/origin/main')
    assert.ok((await (await request('history')).json()).commits.some((c) => c.id === f.base))
    assert.equal((await request('history', undefined, { compare: '--all' })).status, 400)
    await git(f.repo, ['branch', 'review/雪', f.root])
    assert.equal((await request('comparison', { ref: 'refs/heads/review/雪' })).status, 200)
    assert.equal((await (await request('comparison')).json()).compareRef, 'refs/heads/review/雪')
    await git(f.repo, ['branch', '-d', 'main'])
    await git(f.repo, ['update-ref', '-d', 'refs/remotes/origin/main'])
    await git(f.repo, ['branch', '-d', 'review/雪'])
    // No saved/configured branch still exists: ask for a branch, never show all ancestors.
    const missing = await (await request('comparison')).json()
    assert.equal(missing.compareRef, null)
    assert.match(missing.warning, /unavailable/)
    assert.deepEqual((await (await request('history')).json()).commits, [])
  } finally { await server?.close(); await rm(f.repo, { recursive: true, force: true }) }
})

test('split diffs align unequal replacements while retaining precise old/new line anchors', () => {
  const rows = splitDiffLines('@@ -4,4 +8,3 @@\n same\n-old one\n-old two\n+new one\n tail\n')
  const pairs = rows.filter((r) => !r.header)
  assert.deepEqual(pairs.map((r) => [r.old?.old ?? null, r.new?.new ?? null]), [[4, 8], [5, 9], [6, null], [7, 10]])
  assert.equal(pairs[1].old.text, '-old one')
  assert.equal(pairs[1].new.text, '+new one')
  assert.equal(pairs[2].old.text, '-old two')
})

test('view preferences survive server restarts and concurrent changes without accepting unsupported values', async () => {
  const data = new Map(), adapter = { get: async (key) => data.get(key), set: async (key, value) => data.set(key, value) }
  let server = await startReviewServer(adapter)
  const request = (values, token = server.token) => fetch(new URL('/api/preferences', server.origin), {
    method: values ? 'POST' : 'GET', headers: { 'X-Review-Token': token }, body: values ? JSON.stringify(values) : undefined
  })
  try {
    assert.equal((await request({ size: '0.8' }, 'wrong-token')).status, 403)
    assert.equal((await request({ size: '5' })).status, 400)
    assert.equal((await request({ extra: true })).status, 400)
    const results = await Promise.all([request({ size: '0.8' }), request({ layout: 'split', wrap: true })])
    assert.ok(results.every((r) => r.status === 200))
    await server.close()
    server = await startReviewServer(adapter)
    assert.deepEqual(await (await request()).json(), { size: '0.8', layout: 'split', wrap: true })
  } finally { await server.close() }
})
