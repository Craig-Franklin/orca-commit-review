import { diffLines } from './diff-lines.mjs'
const $ = (id) => document.getElementById(id)
const token = location.hash.slice(1)
const state = {
  repo: '',
  commits: [],
  review: {},
  commit: null,
  files: [],
  file: null,
  generation: 0,
  fileGeneration: 0,
  saving: false
}
function node(tag, text, className) {
  const el = document.createElement(tag)
  if (text !== undefined) el.textContent = text
  if (className) el.className = className
  return el
}
function error(e) {
  $('error').textContent = e.message || String(e)
  $('error').hidden = false
}
async function api(route, params = {}, body) {
  const url = new URL('/api/' + route, location.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Review-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const value = await response.json()
  if (!response.ok) throw Error(value.error)
  return value
}
const colors = ['#3794ff', '#be8cf4', '#e5b567', '#76c7bd', '#e887af']
function graphs(commits) {
  let lanes = [],
    counter = 0
  return commits.map((commit) => {
    const before = lanes.map((l) => ({ ...l }))
    let index = lanes.findIndex((l) => l.id === commit.id)
    if (index < 0) {
      index = lanes.length
      lanes.push({ id: commit.id, color: colors[counter++ % colors.length] })
    }
    const color = lanes[index].color
    lanes.splice(index, 1)
    commit.parents.forEach((id, i) => {
      if (!lanes.some((l) => l.id === id))
        lanes.splice(Math.min(index + i, lanes.length), 0, {
          id,
          color: i ? colors[counter++ % colors.length] : color
        })
    })
    return { before, after: lanes.map((l) => ({ ...l })), index, color }
  })
}
function graphSVG(g, commit) {
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg')
  svg.classList.add('graph')
  svg.setAttribute(
    'width',
    String(12 * (Math.max(g.before.length, g.after.length, g.index + 1) + 1))
  )
  svg.setAttribute('aria-hidden', 'true')
  const x = (i) => 12 * (i + 1)
  function path(d, color) {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d)
    p.setAttribute('stroke', color)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke-width', '1.4')
    svg.append(p)
  }
  for (let i = 0; i < g.before.length; i++) {
    const lane = g.before[i],
      j = lane.id === commit.id ? g.index : g.after.findIndex((l) => l.id === lane.id)
    if (j >= 0)
      path(
        `M${x(i)} 0 C${x(i)} 27 ${x(j)} 0 ${x(j)} 27${lane.id === commit.id ? '' : ` L${x(j)} 54`}`,
        lane.color
      )
  }
  for (const parent of commit.parents) {
    const i = g.after.findIndex((l) => l.id === parent)
    if (i >= 0) path(`M${x(g.index)} 27 C${x(g.index)} 54 ${x(i)} 27 ${x(i)} 54`, g.after[i].color)
  }
  const dot = document.createElementNS(ns, 'circle')
  dot.setAttribute('cx', x(g.index))
  dot.setAttribute('cy', '27')
  dot.setAttribute('r', commit.parents.length > 1 ? '5' : '4')
  dot.setAttribute('fill', g.color)
  svg.append(dot)
  return svg
}
function progress(id) {
  const r = state.review[id]
  return r
    ? `${r.paths.length} / ${r.total} reviewed${r.total > 0 && r.paths.length === r.total ? ' ✓' : ''}`
    : ''
}
function renderCommits() {
  const fragment = document.createDocumentFragment(),
    models = graphs(state.commits)
  state.commits.forEach((commit, i) => {
    const button = node(
      'button',
      undefined,
      'commit' + (state.commit?.id === commit.id ? ' selected' : '')
    )
    button.title = commit.subject
    button.setAttribute('aria-label', commit.subject)
    button.append(graphSVG(models[i], commit))
    const copy = node('span', undefined, 'commit-copy')
    copy.append(node('span', commit.subject, 'subject'))
    const meta = node('span', undefined, 'metadata')
    meta.append(node('span', commit.short, 'hash'))
    const p = progress(commit.id)
    if (p) meta.append(node('span', p, p.endsWith('✓') ? 'done' : ''))
    else if (commit.refs) {
      const ref = node('span', commit.refs.replace('HEAD -> ', ''), 'ref')
      ref.title = commit.refs
      meta.append(ref)
    }
    copy.append(meta)
    button.append(copy)
    button.onclick = () => selectCommit(commit).catch(error)
    fragment.append(button)
  })
  $('commits').replaceChildren(fragment)
  $('count').textContent = state.commits.length === 100 ? 'Latest 100' : state.commits.length
}
function renderFiles() {
  const fragment = document.createDocumentFragment()
  const checked = new Set(state.review[state.commit?.id]?.paths ?? [])
  for (const file of state.files) {
    const row = node('div', undefined, 'file-row'),
      box = node('input')
    box.type = 'checkbox'
    box.checked = checked.has(file.path)
    box.disabled = state.saving
    box.setAttribute('aria-label', `Reviewed: ${file.path}`)
    box.onchange = () => mark(file.path, box.checked).catch(error)
    const button = node('button', undefined, 'file' + (state.file === file.path ? ' selected' : ''))
    button.append(
      node('span', file.path, 'file-path'),
      node('span', file.status, 'status ' + file.status)
    )
    button.onclick = () => selectFile(file.path).catch(error)
    row.append(box, button)
    fragment.append(row)
  }
  $('files').replaceChildren(fragment)
  $('progress').textContent = state.commit ? progress(state.commit.id) : ''
  $('reviewed').checked = checked.has(state.file)
  $('reviewed').disabled = state.saving
  $('review-label').hidden = !state.file
  $('comment-file').disabled = !state.file
  const i = state.files.findIndex((f) => f.path === state.file)
  $('previous').disabled = i <= 0
  $('next').disabled = i < 0 || i >= state.files.length - 1
}
async function loadRepo(repo) {
  const generation = ++state.generation
  state.fileGeneration++
  state.repo = repo
  resetComments()
  $('sessions').replaceChildren(node('option', 'Choose an agent session…'))
  $('sessions').firstChild.value = ''
  state.commit = null
  state.file = null
  state.files = []
  state.commits = []
  state.review = {}
  $('error').hidden = true
  $('diff').replaceChildren(node('p', 'Loading commits…', 'empty'))
  $('commit-heading').querySelector('h1').textContent = 'Loading repository'
  $('file-name').textContent = ''
  renderCommits()
  renderFiles()
  const result = await api('history', { repo })
  if (generation !== state.generation) return
  state.repo = result.repo
  refreshSessions().catch(error)
  state.commits = result.commits
  state.review = result.review
  $('repository-path').value = result.repo
  renderCommits()
  if (state.commits.length) await selectCommit(state.commits[0])
  else $('diff').replaceChildren(node('p', 'No commits yet.', 'empty'))
}
async function selectCommit(commit) {
  const generation = ++state.generation
  state.fileGeneration++
  state.commit = commit
  resetComments()
  loadComments(state.repo, commit.id).catch(error)
  state.file = null
  state.files = []
  $('error').hidden = true
  $('file-name').textContent = ''
  $('commit-heading').querySelector('h1').textContent = commit.subject
  $('commit-meta').textContent =
    `${commit.short} · ${commit.author} · ${new Date(commit.date).toLocaleString()}${commit.parents.length > 1 ? ' · Merge: comparing first parent' : ''}`
  $('diff').replaceChildren(node('p', 'Loading changed files…', 'empty'))
  renderCommits()
  renderFiles()
  const result = await api('files', { repo: state.repo, commit: commit.id })
  if (generation !== state.generation) return
  state.files = result.files
  state.review[commit.id] ??= { total: result.files.length, paths: [] }
  renderCommits()
  renderFiles()
  if (result.files.length) await selectFile(result.files[0].path)
  else $('diff').replaceChildren(node('p', 'This commit has no file changes.', 'empty'))
}
async function selectFile(path) {
  const generation = ++state.fileGeneration,
    commit = state.commit.id,
    repo = state.repo
  state.file = path
  $('file-name').textContent = path
  renderFiles()
  $('diff').replaceChildren(node('p', 'Loading diff…', 'empty'))
  const result = await api('diff', { repo, commit, path })
  if (generation !== state.fileGeneration) return
  renderDiff(result.diff)
  $('diff').scrollTop = 0
}
function renderDiff(diff) {
  const fragment = document.createDocumentFragment()
  for (const line of diffLines(diff)) {
    const row = node('div', undefined, 'diff-line ' + line.kind)
    for (const side of ['old', 'new']) {
      const number = line[side]
      const cell = node(number === null ? 'span' : 'button', number ?? '', 'line-number')
      if (number !== null) {
        cell.title = `Comment on ${side} line ${number}`
        cell.setAttribute('aria-label', cell.title)
        cell.onclick = () => composeComment(side, number)
      }
      row.append(cell)
    }
    row.append(node('code', line.text))
    fragment.append(row)
  }
  $('diff').replaceChildren(fragment)
}
async function mark(path, reviewed) {
  if (state.saving) return
  const commit = state.commit.id,
    repo = state.repo
  state.saving = true
  $('save-status').textContent = 'Saving…'
  renderFiles()
  try {
    const record = await api('review', { repo, commit }, { path, reviewed })
    if (repo === state.repo) {
      state.review[commit] = record
      renderCommits()
    }
    $('save-status').textContent = 'Saved on this computer'
  } catch (e) {
    $('save-status').textContent = 'Not saved'
    throw e
  } finally {
    state.saving = false
    renderFiles()
  }
}
$('reviewed').onchange = () => mark(state.file, $('reviewed').checked).catch(error)
$('previous').onclick = () =>
  selectFile(state.files[state.files.findIndex((f) => f.path === state.file) - 1].path).catch(error)
$('next').onclick = () =>
  selectFile(state.files[state.files.findIndex((f) => f.path === state.file) + 1].path).catch(error)
$('refresh').onclick = () => loadRepo(state.repo).catch(error)
$('repositories').onchange = () => loadRepo($('repositories').value).catch(error)
$('repository-form').onsubmit = (e) => {
  e.preventDefault()
  loadRepo($('repository-path').value).catch(error)
}
$('theme').onclick = () => {
  document.documentElement.classList.toggle('light')
  localStorage.setItem(
    'commit-review-theme',
    document.documentElement.classList.contains('light') ? 'light' : 'dark'
  )
}
if (localStorage.getItem('commit-review-theme') === 'light')
  document.documentElement.classList.add('light')
async function start() {
  const { repos, last } = await api('repos')
  for (const repo of repos) {
    const option = node('option', repo.name)
    option.value = repo.path
    $('repositories').append(option)
  }
  const initial = last || repos[0]?.path
  if (initial) {
    $('repositories').value = initial
    await loadRepo(initial)
  }
}

setInterval(async () => {
  if (!state.repo || state.saving) return
  const repo = state.repo
  try {
    const result = await api('progress', { repo })
    if (repo === state.repo && !state.saving) {
      state.review = { ...state.review, ...result }
      renderCommits()
      renderFiles()
    }
  } catch (e) {
    error(e)
  }
}, 60000)

let comments = { notes: [], deliveries: {} },
  selectedNotes = new Set(),
  commentContext = null
let commentBusy = false,
  sessionGeneration = 0,
  commentsGeneration = 0
function resetComments() {
  commentsGeneration++
  comments = { notes: [], deliveries: {} }
  selectedNotes = new Set()
  renderComments()
}
function sameReview(repo, commit) {
  return repo === state.repo && commit === state.commit?.id
}
async function loadComments(repo, commit) {
  const generation = ++commentsGeneration
  const result = await api('comments', { repo, commit })
  if (!sameReview(repo, commit) || generation !== commentsGeneration) return
  comments = result
  selectedNotes = new Set(comments.notes.filter((n) => !n.deliveryId).map((n) => n.id))
  renderComments()
}
function renderComments() {
  const fragment = document.createDocumentFragment()
  for (const note of comments.notes) {
    const row = node('div', undefined, 'review-comment')
    const heading = node('div', undefined, 'comment-heading')
    if (!note.deliveryId) {
      const box = node('input')
      box.type = 'checkbox'
      box.checked = selectedNotes.has(note.id)
      box.disabled = commentBusy
      box.setAttribute('aria-label', `Include comment: ${note.path}`)
      box.onchange = () => {
        box.checked ? selectedNotes.add(note.id) : selectedNotes.delete(note.id)
        updateSendButton()
      }
      heading.append(box)
    }
    const location = note.line ? `${note.path}:${note.line} (${note.side})` : note.path
    const jump = node('button', location, 'comment-location')
    jump.onclick = () => selectFile(note.path).catch(error)
    heading.append(jump)
    const delivery = comments.deliveries[note.deliveryId]
    heading.append(
      node('span', delivery?.status ?? 'draft', delivery?.status === 'sent' ? 'done' : '')
    )
    if (!note.deliveryId) {
      const remove = node('button', 'Delete')
      remove.disabled = commentBusy
      remove.onclick = () =>
        commentMutation('comments', { action: 'delete', id: note.id }).catch(error)
      heading.append(remove)
    }
    row.append(heading, node('p', note.body))
    fragment.append(row)
  }
  for (const delivery of Object.values(comments.deliveries)) {
    const row = node('div', undefined, 'delivery')
    row.append(node('span', `${delivery.target}: ${delivery.message}`))
    if (delivery.status !== 'sent') {
      const check = node('button', 'Check delivery')
      check.title = 'Check the same request; never create a duplicate send.'
      check.disabled = commentBusy
      check.onclick = () =>
        commentMutation('send', { requestId: delivery.id, check: true }).catch(error)
      row.append(check)
    }
    fragment.append(row)
  }
  $('comments-list').replaceChildren(fragment)
  $('comment-count').textContent = comments.notes.length ? `(${comments.notes.length})` : ''
  updateSendButton()
}
function updateSendButton() {
  $('send-review').disabled =
    commentBusy || !state.commit || !selectedNotes.size || !$('sessions').value
  $('send-review').textContent = commentBusy
    ? 'Working…'
    : `Send selected comments${selectedNotes.size ? ` (${selectedNotes.size})` : ''}`
}
async function refreshSessions() {
  const repo = state.repo,
    generation = ++sessionGeneration
  const result = await api('sessions', { repo })
  if (repo !== state.repo || generation !== sessionGeneration) return
  const previous = $('sessions').value
  const empty = node(
    'option',
    result.targets.length
      ? 'Choose an agent session…'
      : 'No connected terminal agents in this checkout'
  )
  empty.value = ''
  $('sessions').replaceChildren(empty)
  for (const target of result.targets) {
    const option = node('option', target.label)
    option.value = target.id
    $('sessions').append(option)
  }
  $('sessions').value = result.targets.some((t) => t.id === previous) ? previous : ''
  if (result.truncated)
    $('delivery-status').textContent = 'Session list is truncated; showing the first 200 terminals.'
  updateSendButton()
}
function composeComment(side = 'file', line = 0) {
  if (!state.file || !state.commit) return
  commentContext = { repo: state.repo, commit: state.commit.id, path: state.file, side, line }
  $('comment-location').textContent =
    `${state.commit.short} · ${state.file}${line ? `:${line} (${side})` : ' · whole file'}`
  $('comment-body').value = ''
  $('comment-error').textContent = ''
  $('comment-dialog').showModal()
  $('comment-body').focus()
}
async function commentMutation(
  route,
  body,
  context = { repo: state.repo, commit: state.commit?.id }
) {
  if (commentBusy) return
  commentBusy = true
  commentsGeneration++
  renderComments()
  try {
    const result = await api(route, { repo: context.repo, commit: context.commit }, body)
    if (sameReview(context.repo, context.commit)) {
      comments = result
      selectedNotes = new Set(result.notes.filter((n) => !n.deliveryId).map((n) => n.id))
    }
  } catch (e) {
    if (route === 'send' && sameReview(context.repo, context.commit)) {
      // Read the persisted attempt; never automatically resend after a lost HTTP reply.
      try {
        await loadComments(context.repo, context.commit)
      } catch {
        /* Keep drafts visible. */
      }
      $('delivery-status').textContent =
        'Delivery is uncertain. Refresh comments before another send; nothing was automatically resent.'
    }
    throw e
  } finally {
    commentBusy = false
    renderComments()
  }
}
$('comment-file').onclick = () => composeComment()
$('cancel-comment').onclick = () => $('comment-dialog').close()
$('comment-form').onsubmit = async (e) => {
  e.preventDefault()
  if (commentBusy) return
  $('save-comment').disabled = true
  $('cancel-comment').disabled = true
  try {
    await commentMutation(
      'comments',
      {
        action: 'add',
        path: commentContext.path,
        side: commentContext.side,
        line: commentContext.line,
        body: $('comment-body').value
      },
      commentContext
    )
    $('comment-dialog').close()
    $('comments-panel').open = true
  } catch (e) {
    $('comment-error').textContent = e.message
  } finally {
    $('save-comment').disabled = false
    $('cancel-comment').disabled = false
  }
}
$('comment-dialog').oncancel = (e) => {
  if (commentBusy) e.preventDefault()
}
$('refresh-sessions').onclick = async () => {
  try {
    await refreshSessions()
    if (state.commit) await loadComments(state.repo, state.commit.id)
  } catch (e) {
    error(e)
  }
}
$('sessions').onchange = updateSendButton
$('send-review').onclick = () => {
  if (commentBusy || !selectedNotes.size || !$('sessions').value) return
  commentMutation('send', {
    requestId: crypto.randomUUID(),
    target: $('sessions').value,
    noteIds: [...selectedNotes]
  }).catch(error)
}
start().catch(error)
