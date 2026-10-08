// Execute the real UI module against a small in-memory DOM. No browser, desktop,
// installed Orca tab, or production session is opened or automated by these tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { diffLines } from '../web/diff-lines.mjs'

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.value = ''; this.open = false; this.textContent = ''; this.classList = { add() {}, toggle() {}, contains: () => false } }
  append(...nodes) { this.children.push(...nodes) }
  replaceChildren(...nodes) { this.children = nodes }
  setAttribute() {}
  querySelector() { return this.heading ??= new Element('h1') }
  get firstChild() { return this.children[0] }
  showModal() { this.open = true }
  close() { this.open = false }
  focus() {}
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function ui() {
  const elements = new Map()
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) },
    createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    createDocumentFragment: () => new Element(), documentElement: new Element()
  }
  const source = (await readFile(new URL('../web/app.js', import.meta.url), 'utf8'))
    .replace("import { diffLines } from './diff-lines.mjs'", '')
    .replace('\nheartbeat()\nstart().catch(error)', '')
  const context = vm.createContext({ document, diffLines, location: { hash: '#token', origin: 'http://test' }, URL,
    localStorage: { getItem() {}, setItem() {} }, setInterval() {}, crypto: { randomUUID: () => 'test-id' } })
  vm.runInContext(source + '\nglobalThis.ui = { state, selectFile, selectCommit, composeComment, resetComments, commentMutation, loadComments, mark, renderFiles, pollProgress, getComments: () => comments };', context)
  return { ...context.ui, elements, setApi(fn) { context.testApi = fn; vm.runInContext('api = testApi', context) } }
}
const commit = (id) => ({ id, short: id, subject: id, author: 'Test', date: '2026-10-08', parents: [] })

test('changing files while diffs load never renders a stale diff or anchors comments to the old file', async () => {
  const view = await ui(), a = deferred(), b = deferred()
  view.state.repo = '/test'; view.state.commit = commit('one')
  view.state.files = [{ path: 'a.txt' }, { path: 'b.txt' }]
  view.setApi((_, params) => params.path === 'a.txt' ? a.promise : b.promise)
  const first = view.selectFile('a.txt'), second = view.selectFile('b.txt')
  b.resolve({ diff: '@@ -1 +1 @@\n-old B\n+new B\n' }); await second
  a.resolve({ diff: '@@ -1 +1 @@\n-old A\n+new A\n' }); await first
  const rendered = view.elements.get('diff').children[0].children
  assert.ok(rendered.some((row) => row.children.some((cell) => cell.textContent === '+new B')))
  assert.ok(!rendered.some((row) => row.children.some((cell) => cell.textContent === '+new A')))
  view.composeComment('new', 1)
  assert.match(view.elements.get('comment-location').textContent, /b.txt:1 \(new\)/)
})

test('navigating away and back during a comment write reloads drafts after the write settles', async () => {
  const view = await ui(), writing = deferred()
  view.state.repo = '/test'; view.state.commit = commit('one')
  const requests = []
  view.setApi(async (route, params, body) => {
    requests.push({ route, commit: params.commit, body })
    if (body) return writing.promise
    if (route === 'files') return { files: [] }
    return { notes: [{ id: 'new-note', path: 'a.txt', body: 'Persisted after write', line: 0, side: 'file' }], deliveries: {} }
  })
  const mutation = view.commentMutation('comments', { action: 'add' })
  await view.selectCommit(commit('two'))
  await view.selectCommit(commit('one'))
  writing.resolve({ notes: [], deliveries: {} })
  await mutation
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(view.getComments().notes[0].body, 'Persisted after write')
  assert.equal(requests.filter((r) => r.route === 'comments' && !r.body).length, 1)
})

test('empty commits can complete; file marks alone do not complete a commit; failed marks roll back', async () => {
  const view = await ui()
  view.state.repo = '/test'; view.state.commit = commit('one'); view.state.files = []; view.state.filesReady = true
  view.state.review.one = { total: 0, paths: [], complete: false }
  view.renderFiles()
  assert.equal(view.elements.get('complete-review').disabled, false)
  view.state.files = [{ path: 'a.txt' }]; view.state.file = 'a.txt'
  view.state.review.one = { total: 1, paths: ['a.txt'], complete: false }
  view.renderFiles()
  assert.equal(view.elements.get('complete-review').textContent, 'Complete commit review')
  view.setApi(async () => { throw Error('disk full') })
  await assert.rejects(() => view.mark('a.txt', false), /disk full/)
  assert.equal(view.elements.get('reviewed').checked, true)
  assert.equal(view.elements.get('save-status').textContent, 'Not saved')
})


test('a progress poll started before saving cannot overwrite the saved review marks', async () => {
  const view = await ui(), polling = deferred()
  view.state.repo = '/test'; view.state.commit = commit('one'); view.state.file = 'a.txt'
  view.state.files = [{ path: 'a.txt' }]; view.state.review.one = { total: 1, paths: [] }
  view.setApi((route) => route === 'progress' ? polling.promise : Promise.resolve({ total: 1, paths: ['a.txt'], complete: false }))
  const poll = view.pollProgress()
  await view.mark('a.txt', true)
  polling.resolve({ one: { total: 1, paths: [], complete: false } })
  await poll
  assert.equal(view.elements.get('reviewed').checked, true)
})
