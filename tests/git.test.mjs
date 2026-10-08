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
    assert.deepEqual(await save.json(), { total: 1, paths: [filename] })
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
    assert.deepEqual(result.review[commits[1].id], { total: 1, paths: [filename] })
    assert.equal(result.review[commits[0].id], undefined)
  } finally {
    await server?.close()
    await rm(repo, { recursive: true, force: true })
  }
})
