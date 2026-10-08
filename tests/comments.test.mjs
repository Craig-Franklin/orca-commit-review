import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { git } from '../git.mjs'
import { createComments, formatReview } from '../comments.mjs'
import { startReviewServer } from '../server.mjs'
import { diffLines } from '../web/diff-lines.mjs'

let repo, commit, parent
before(async () => {
  repo = await realpath(await mkdtemp(join(tmpdir(), 'orca-comment-test-')))
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'commit.gpgsign', 'false'])
  await git(repo, ['config', 'core.autocrlf', 'false'])
  await git(repo, ['config', 'user.name', 'Test'])
  await git(repo, ['config', 'user.email', 'test@example.invalid'])
  await writeFile(join(repo, 'file.txt'), 'before\nunchanged\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'parent'])
  parent = (await git(repo, ['rev-parse', 'HEAD'])).trim()
  await writeFile(join(repo, 'file.txt'), 'after\nunchanged\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'selected'])
  commit = (await git(repo, ['rev-parse', 'HEAD'])).trim()
})
after(async () => {
  await rm(repo, { recursive: true, force: true })
})

function setup() {
  const data = new Map(),
    calls = []
  const target = {
    handle: 'term_selected',
    worktreePath: repo,
    connected: true,
    writable: true,
    agentIdentity: 'codex',
    title: 'Fix bug',
    incarnationId: 'process-one',
    executionHostId: 'local'
  }
  let response = {
    send: { accepted: true, prompt: { stages: ['input_accepted', 'turn_started'] } }
  }
  const adapter = {
    get: async (k) => structuredClone(data.get(k)),
    set: async (k, v) => {
      data.set(k, structuredClone(v))
    },
    cli: async (args) => {
      calls.push(args)
      if (args[1] === 'list')
        return {
          terminals: [
            target,
            { ...target, handle: 'shell', agentIdentity: undefined },
            { ...target, handle: 'closed', connected: false },
            { ...target, handle: 'readonly', writable: false },
            { ...target, handle: 'orphaned', orphaned: true },
            { ...target, handle: 'elsewhere', worktreePath: tmpdir() }
          ]
        }
      if (response instanceof Error) throw response
      return { ...response, send: { handle: target.handle, bytesWritten: 0, ...response.send,
        ...(response.send?.prompt ? { prompt: { requestId: args[args.indexOf('--retry-request') + 1], ...response.send.prompt } } : {}) } }
    }
  }
  return {
    adapter,
    data,
    calls,
    target,
    service: createComments(adapter),
    respond: (value) => {
      response = value
    }
  }
}
const add = (service, fields = {}) =>
  service.change(repo, commit, {
    action: 'add',
    path: 'file.txt',
    side: 'new',
    line: 1,
    body: 'Please check this.',
    ...fields
  })
const request = (note) => ({ requestId: randomUUID(), target: 'term_selected', noteIds: [note.id] })

test('saved file and old/new line comments retain context and isolate commits', async () => {
  const { service, adapter } = setup()
  await add(service)
  await add(service, { side: 'old', body: 'Why remove this?' })
  await add(service, { side: 'file', line: 0, body: 'Whole file comment' })
  const reloaded = await createComments(adapter).read(repo, commit)
  assert.deepEqual(
    reloaded.notes.map((n) => n.context),
    ['+after', '-before', undefined]
  )
  assert.equal((await service.read(repo, parent)).notes.length, 0)
  await service.change(repo, commit, { action: 'delete', id: reloaded.notes[0].id })
  assert.equal((await service.read(repo, commit)).notes.length, 2)
})

test('invalid file, line, side, and empty comments never persist', async () => {
  const { service } = setup()
  for (const fields of [
    { path: '../outside.txt' },
    { line: 200 },
    { side: 'old', line: 0 },
    { side: 'file', line: 1 },
    { body: '  ' },
    { body: 'x'.repeat(8001) }
  ]) {
    await assert.rejects(() => add(service, fields))
  }
  assert.equal((await service.read(repo, commit)).notes.length, 0)
})

test('only a connected agent from this exact checkout is selectable; target is revalidated', async () => {
  const { service, target, calls } = setup()
  assert.deepEqual(
    (await service.targets(repo)).targets.map((t) => t.id),
    ['term_selected']
  )
  const state = await add(service)
  await assert.rejects(() =>
    service.send(repo, commit, { ...request(state.notes[0]), target: 'elsewhere' })
  )
  target.connected = false
  await assert.rejects(() => service.send(repo, commit, request(state.notes[0])))
  assert.equal(calls.filter((a) => a[1] === 'send').length, 0)
})

test('send includes exact historical context and submits once even for concurrent duplicate HTTP requests', async () => {
  const { service, calls } = setup()
  const state = await add(service, { body: 'Check "quoted"\n$(never execute)' })
  const input = request(state.notes[0])
  const [result] = await Promise.all([
    service.send(repo, commit, input),
    service.send(repo, commit, input)
  ])
  const sends = calls.filter((a) => a[1] === 'send')
  assert.equal(sends.length, 1)
  assert.equal(sends[0][sends[0].indexOf('--terminal') + 1], 'term_selected')
  assert.equal(sends[0][sends[0].indexOf('--retry-request') + 1], input.requestId)
  const prompt = sends[0][sends[0].indexOf('--text') + 1]
  assert.match(prompt, new RegExp(commit))
  assert.match(prompt, /Line: 1 \(commit \/ new side\)/)
  assert.match(prompt, /Diff line: "\+after"/)
  assert.ok(prompt.includes(JSON.stringify('Check "quoted"\n$(never execute)')))
  assert.equal(result.deliveries[input.requestId].status, 'sent')
  await assert.rejects(() => service.send(repo, commit, request(state.notes[0])))
  await assert.rejects(() =>
    service.change(repo, commit, { action: 'delete', id: state.notes[0].id })
  )
})

test('input accepted does not claim an agent turn started; check uses the original request', async () => {
  const { service, respond, calls } = setup()
  respond({ send: { accepted: true, prompt: { stages: ['input_accepted'] } } })
  const state = await add(service),
    input = request(state.notes[0])
  assert.equal(
    (await service.send(repo, commit, input)).deliveries[input.requestId].status,
    'accepted'
  )
  respond({ send: { accepted: true, prompt: { stages: ['input_accepted', 'turn_started'] } } })
  assert.equal(
    (await service.send(repo, commit, { requestId: input.requestId, check: true })).deliveries[
      input.requestId
    ].status,
    'sent'
  )
  assert.deepEqual(calls.filter((a) => a[1] === 'send')[0], calls.filter((a) => a[1] === 'send')[1])
})

test('lost reply preserves notes and request across restart without an automatic resend', async () => {
  const { service, adapter, respond, calls } = setup()
  respond(Error('timeout with private command text'))
  const state = await add(service),
    input = request(state.notes[0])
  const result = await service.send(repo, commit, input)
  assert.equal(result.deliveries[input.requestId].status, 'unconfirmed')
  assert.doesNotMatch(JSON.stringify(result), /private command text/)
  const restarted = createComments(adapter)
  assert.equal((await restarted.read(repo, commit)).notes.length, 1)
  await restarted.send(repo, commit, input)
  assert.equal(calls.filter((a) => a[1] === 'send').length, 1)
  await assert.rejects(() => restarted.send(repo, commit, request(state.notes[0])))
  await restarted.send(repo, commit, { requestId: input.requestId, check: true })
  assert.deepEqual(calls.filter((a) => a[1] === 'send')[0], calls.filter((a) => a[1] === 'send')[1])
})

test('storage failure before sending prevents any session mutation', async () => {
  const { service, adapter, calls } = setup()
  const state = await add(service)
  const broken = createComments({
    ...adapter,
    set: async () => {
      throw Error('disk full')
    }
  })
  await assert.rejects(() => broken.send(repo, commit, request(state.notes[0])), /disk full/)
  assert.equal(calls.filter((a) => a[1] === 'send').length, 0)
})

test('diff content starting with ++ or -- remains a commentable line; quoted paths are unambiguous', () => {
  const rows = diffLines(
    'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n---removed\n+++added\n'
  )
  assert.equal(rows[4].old, 1)
  assert.equal(rows[5].new, 1)
  const prompt = formatReview('/repo', 'abc', [
    { path: 'line\nbreak.txt', side: 'file', line: 0, body: 'Hi' }
  ])
  assert.ok(prompt.includes('File: "line\\nbreak.txt"'))
})

test('HTTP comments and send endpoints enforce token and origin before invoking Orca', async () => {
  const { adapter, calls } = setup()
  const server = await startReviewServer(adapter)
  try {
    const url = new URL('/api/send', server.origin)
    url.searchParams.set('repo', repo)
    url.searchParams.set('commit', commit)
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403)
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'X-Review-Token': server.token, Origin: 'https://other.invalid' },
          body: '{}'
        })
      ).status,
      403
    )
    assert.equal(calls.length, 0)
    url.pathname = '/api/comments'
    const headers = { 'X-Review-Token': server.token }
    const saved = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'add',
        path: 'file.txt',
        line: 1,
        side: 'old',
        body: 'Review this'
      })
    })
    assert.equal(saved.status, 200)
    const note = (await saved.json()).notes[0]
    url.pathname = '/api/send'
    const sent = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request(note)) })
    assert.equal(sent.status, 200)
    assert.equal(Object.values((await sent.json()).deliveries)[0].status, 'sent')
  } finally {
    await server.close()
  }
})


test('a zero-byte refusal restores drafts; checking it cannot replay a send', async () => {
  const { service, respond, calls } = setup()
  respond({ send: { accepted: false, bytesWritten: 0 } })
  const state = await add(service), input = request(state.notes[0])
  const result = await service.send(repo, commit, input)
  assert.equal(result.deliveries[input.requestId].status, 'rejected')
  assert.equal(result.notes[0].deliveryId, undefined)
  await service.send(repo, commit, { requestId: input.requestId, check: true })
  assert.equal(calls.filter((a) => a[1] === 'send').length, 1)
  respond({ send: { accepted: true, prompt: { stages: ['input_accepted'] } } })
  assert.equal((await service.send(repo, commit, request(result.notes[0]))).notes[0].deliveryId !== undefined, true)
})

test('partial writes and mismatched receipts keep comments locked and uncertain', async () => {
  for (const send of [
    { accepted: false, bytesWritten: 10 },
    { accepted: true, handle: 'wrong-terminal', prompt: { stages: ['turn_started'] } },
    { accepted: true, prompt: { requestId: randomUUID(), stages: ['turn_started'] } }
  ]) {
    const { service, respond } = setup()
    respond({ send })
    const state = await add(service), input = request(state.notes[0])
    const result = await service.send(repo, commit, input)
    assert.equal(result.deliveries[input.requestId].status, 'unconfirmed')
    assert.equal(result.notes[0].deliveryId, input.requestId)
  }
})

test('recovery never sends to a replaced, moved, or different agent', async () => {
  for (const change of [
    { incarnationId: 'process-two' }, { agentIdentity: 'claude' },
    { worktreePath: tmpdir() }, { executionHostId: 'remote' }
  ]) {
    const { service, respond, target, calls } = setup()
    respond(Error('lost reply'))
    const state = await add(service), input = request(state.notes[0])
    await service.send(repo, commit, input)
    Object.assign(target, change)
    await assert.rejects(() => service.send(repo, commit, { requestId: input.requestId, check: true }), /unavailable or has changed/)
    assert.equal(calls.filter((a) => a[1] === 'send').length, 1)
    assert.equal((await service.read(repo, commit)).notes[0].deliveryId, input.requestId)
  }
})

test('storage failure after send retains the original request for recovery', async () => {
  const { service, adapter, calls } = setup()
  const state = await add(service), input = request(state.notes[0])
  let writes = 0
  const broken = createComments({ ...adapter, set: async (...args) => {
    if (++writes === 2) throw Error('disk full after send')
    await adapter.set(...args)
  } })
  await assert.rejects(() => broken.send(repo, commit, input), /disk full after send/)
  const restarted = createComments(adapter)
  assert.equal((await restarted.read(repo, commit)).deliveries[input.requestId].status, 'unconfirmed')
  await restarted.send(repo, commit, input)
  assert.equal(calls.filter((a) => a[1] === 'send').length, 1)
  assert.equal((await restarted.send(repo, commit, { requestId: input.requestId, check: true })).deliveries[input.requestId].status, 'sent')
})

test('accepted input cannot be restored to drafts by a later zero-byte refusal', async () => {
  const { service, respond } = setup()
  respond({ send: { accepted: true, prompt: { stages: ['input_accepted'] } } })
  const state = await add(service), input = request(state.notes[0])
  await service.send(repo, commit, input)
  respond({ send: { accepted: false, bytesWritten: 0 } })
  const result = await service.send(repo, commit, { requestId: input.requestId, check: true })
  assert.equal(result.deliveries[input.requestId].status, 'unconfirmed')
  assert.equal(result.notes[0].deliveryId, input.requestId)
})


test('repeated zero-byte refusals cannot erase historical input acceptance', async () => {
  const { service, respond } = setup()
  respond({ send: { accepted: true, prompt: { stages: ['input_accepted'] } } })
  const state = await add(service), input = request(state.notes[0])
  await service.send(repo, commit, input)
  respond({ send: { accepted: false, bytesWritten: 0 } })
  for (let i = 0; i < 2; i++) {
    const result = await service.send(repo, commit, { requestId: input.requestId, check: true })
    assert.equal(result.deliveries[input.requestId].status, 'unconfirmed')
    assert.equal(result.notes[0].deliveryId, input.requestId)
  }
})


test('HTTP preserves Unicode comments split across network chunks and rejects non-hex tokens', async () => {
  const { adapter } = setup()
  const server = await startReviewServer(adapter)
  try {
    const url = new URL('/api/comments', server.origin)
    url.searchParams.set('repo', repo); url.searchParams.set('commit', commit)
    assert.equal((await fetch(url, { headers: { 'X-Review-Token': 'é'.repeat(64) } })).status, 403)
    const body = 'Please check 🦎 and café'
    const bytes = Buffer.from(JSON.stringify({ action: 'add', path: 'file.txt', line: 0, side: 'file', body }))
    const split = bytes.indexOf(Buffer.from('🦎')) + 2
    const result = await new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { 'X-Review-Token': server.token } }, (res) => {
        let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk })
        res.on('end', () => { try { assert.equal(res.statusCode, 200); resolve(JSON.parse(text)) } catch (e) { reject(e) } })
      })
      req.on('error', reject)
      req.write(bytes.subarray(0, split))
      setTimeout(() => req.end(bytes.subarray(split)), 20)
    })
    assert.equal(result.notes[0].body, body)
  } finally { await server.close() }
})
