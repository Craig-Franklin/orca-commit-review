// Execute the real UI module against a small in-memory DOM. No browser, desktop,
// installed Orca tab, or production session is opened or automated by these tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { diffLines, splitDiffLines } from '../web/diff-lines.mjs'

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.value = ''; this.open = false; this.textContent = ''; this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {}, contains: () => false } }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((n) => n !== node)
      node.parentNode = this
      this.children.push(node)
    }
  }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes) }
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
async function ui(search = '', storage = new Map()) {
  const elements = new Map()
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) },
    createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    createDocumentFragment: () => new Element(), documentElement: new Element()
  }
  const source = (await readFile(new URL('../web/app.js', import.meta.url), 'utf8'))
    .replace("import { diffLines, splitDiffLines } from './diff-lines.mjs'", '')
    .replace('\nheartbeat()\nstart().catch(error)', '')
  const context = vm.createContext({ document, diffLines, splitDiffLines, location: { hash: '#token', origin: 'http://test', search }, URL, URLSearchParams,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }, setInterval() {}, crypto: { randomUUID: () => 'test-id' } })
  vm.runInContext(source + '\nglobalThis.ui = { state, start, loadRepo, selectFile, selectCommit, composeComment, resetComments, commentMutation, loadComments, mark, renderFiles, pollProgress, getComments: () => comments };', context)
  return { ...context.ui, elements, setApi(fn) { context.testApi = fn; vm.runInContext('api = testApi', context) } }
}
const commit = (id) => ({ id, short: id, subject: id, author: 'Test', date: '2026-10-08', parents: [] })

test('each review tab loads its requested worktree even when another tab changed the last repository', async () => {
  for (const checkout of ['/worktrees/feature one', String.raw`C:\Projects\feature 🦎`]) {
    const view = await ui('?' + new URLSearchParams({ repo: checkout }))
    const histories = []
    view.setApi(async (route, params) => {
      if (route === 'preferences') return {}
      if (route === 'repos') return { repos: [{ path: '/first', name: 'First' }, { path: checkout, name: 'Feature' }], last: '/first' }
      if (route === 'comparison') return { refs: [{ ref: 'refs/heads/main', name: 'main' }], compareRef: 'refs/heads/main', currentBranch: 'feature' }
      if (route === 'history') { histories.push(params.repo); return { repo: params.repo, commits: [], review: {} } }
      if (route === 'sessions') return { targets: [] }
      throw Error('Unexpected request: ' + route)
    })
    await view.start()
    assert.deepEqual(histories, [checkout])
    assert.equal(view.state.repo, checkout)
    assert.equal(view.elements.get('repositories').value, checkout)
  }
})

test('a legacy tab ignores a stale saved checkout and opens an available project', async () => {
  const view = await ui()
  view.setApi(async (route, params) => {
    if (route === 'preferences') return {}
    if (route === 'repos') return { repos: [{ path: '/available', name: 'Available' }], last: '/removed' }
    if (route === 'comparison') return { refs: [{ ref: 'refs/heads/main', name: 'main' }], compareRef: 'refs/heads/main', currentBranch: 'feature' }
    if (route === 'history') return { repo: params.repo, commits: [], review: {} }
    if (route === 'sessions') return { targets: [] }
    throw Error('Unexpected request: ' + route)
  })
  await view.start()
  assert.equal(view.state.repo, '/available')
})

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

test('inline review composer keeps old/new context and its draft when switching diff layout', async () => {
  const storage = new Map(), view = await ui('', storage)
  view.state.repo = '/test'; view.state.commit = commit('one'); view.state.files = [{ path: 'a.txt' }]
  view.setApi(async () => ({ diff: '@@ -4 +8 @@\n-old text\n+new text\n' }))
  await view.selectFile('a.txt')
  view.composeComment('old', 4)
  const composer = view.elements.get('comment-dialog')
  assert.equal(composer.hidden, false)
  assert.equal(composer.parentNode.className, 'inline-notes')
  view.elements.get('comment-body').value = 'Keep this draft'
  view.elements.get('diff-layout').value = 'split'
  view.elements.get('diff-layout').onchange()
  assert.equal(view.elements.get('comment-body').value, 'Keep this draft')
  assert.match(view.elements.get('comment-location').textContent, /a.txt:4 \(old\)/)
  assert.equal(composer.parentNode.className, 'inline-notes')
  assert.equal(storage.get('commit-review-diff-layout'), 'split')
  const posts = []
  view.setApi(async (route, params, body) => {
    posts.push({ route, params, body })
    return { notes: [{ id: 'note', path: 'a.txt', side: 'old', line: 4, body: body.body }], deliveries: {} }
  })
  await view.elements.get('comment-form').onsubmit({ preventDefault() {} })
  assert.equal(posts[0].params.commit, 'one')
  assert.equal(posts[0].params.repo, '/test')
  assert.equal(posts[0].body.side, 'old')
  assert.equal(posts[0].body.line, 4)
  assert.equal(posts[0].body.body, 'Keep this draft')
  assert.equal(composer.hidden, true)
  assert.equal(composer.parentNode, view.elements.get('comment-parking'))
  view.composeComment('new', 8)
  assert.match(view.elements.get('comment-location').textContent, /a.txt:8 \(new\)/)
  view.elements.get('cancel-comment').onclick()
  assert.equal(composer.hidden, true)
})

test('changing compare branch saves the choice and filters history; stale compare loads cannot replace a newer checkout', async () => {
  const view = await ui(), oldCompare = deferred(), requests = []
  view.setApi(async (route, params, body) => {
    requests.push({ route, params, body })
    if (route === 'comparison') {
      if (params.repo === '/old') return oldCompare.promise
      return { refs: [{ ref: 'refs/heads/develop', name: 'develop' }], compareRef: 'refs/heads/develop', currentBranch: 'feature' }
    }
    if (route === 'history') return { repo: params.repo, commits: [], review: {} }
    if (route === 'sessions') return { targets: [] }
    throw Error('Unexpected request')
  })
  const old = view.loadRepo('/old')
  await view.loadRepo('/new', 'refs/heads/develop')
  oldCompare.resolve({ refs: [], compareRef: null, currentBranch: 'old' })
  await old
  assert.equal(view.state.repo, '/new')
  assert.equal(view.state.compareRef, 'refs/heads/develop')
  assert.equal(view.elements.get('branch-name').textContent, 'feature')
  assert.equal(requests.filter((r) => r.route === 'history').length, 1)
  assert.equal(requests.find((r) => r.route === 'history').params.compare, 'refs/heads/develop')
  assert.equal(requests.find((r) => r.params.repo === '/new').body.ref, 'refs/heads/develop')
})

test('UI size and wrapping choices are restored and saved independently of Orca browser zoom', async () => {
  const storage = new Map([['commit-review-size', '0.8']])
  const view = await ui('', storage)
  view.setApi(async () => ({}))
  assert.equal(view.elements.get('ui-size').value, '0.8')
  view.elements.get('ui-size').value = '1.25'
  view.elements.get('ui-size').onchange()
  view.elements.get('wrap-lines').onclick()
  assert.equal(storage.get('commit-review-size'), '1.25')
  assert.equal(storage.get('commit-review-wrap'), 'true')
})

test('a comment completing during a same-file reload cannot strand the composer in a detached diff', async () => {
  const view = await ui(), saving = deferred(), reloading = deferred()
  view.state.repo = '/test'; view.state.commit = commit('one'); view.state.files = [{ path: 'a.txt' }]
  view.setApi(async () => ({ diff: '@@ -1 +1 @@\n-old\n+new\n' }))
  await view.selectFile('a.txt')
  view.composeComment('new', 1)
  view.setApi((route) => route === 'diff' ? reloading.promise : saving.promise)
  const mutation = view.commentMutation('comments', { action: 'add' })
  const reload = view.selectFile('a.txt')
  saving.resolve({ notes: [], deliveries: {} })
  await mutation
  assert.equal(view.elements.get('comment-dialog').parentNode, view.elements.get('comment-parking'))
  reloading.resolve({ diff: '@@ -1 +1 @@\n-old\n+new\n' })
  await reload
  assert.equal(view.elements.get('comment-dialog').parentNode.className, 'inline-notes')
})
