import { diffLines, splitDiffLines } from './diff-lines.mjs'
const $ = (id) => document.getElementById(id)
const token = location.hash.slice(1)
const state = {
  repo: '',
  compareRef: null,
  diff: null,
  commits: [],
  review: {},
  commit: null,
  files: [],
  file: null,
  generation: 0,
  fileGeneration: 0,
  saving: false,
  reviewGeneration: 0,
  filesReady: false
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
  svg.setAttribute('viewBox', `0 0 ${12 * (Math.max(g.before.length, g.after.length, g.index + 1) + 1)} 54`)
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
    ? `${r.paths.length} / ${r.total} reviewed${r.complete === true ? ' ✓' : ''}`
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
    button.title = file.path
    const segments = file.path.split('/'), filename = segments.pop()
    const label = node('span', filename, 'file-path')
    if (segments.length) label.append(node('span', segments.join('/'), 'file-directory'))
    button.append(
      label,
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
  const record = state.review[state.commit?.id]
  $('complete-review').textContent = record?.complete ? 'Reopen commit review' : 'Complete commit review'
  $('complete-review').disabled = state.saving || !state.commit || !state.filesReady ||
    !record || (!record.complete && state.files.some((f) => !checked.has(f.path)))
  const i = state.files.findIndex((f) => f.path === state.file)
  $('previous').disabled = i <= 0
  $('next').disabled = i < 0 || i >= state.files.length - 1
}
async function loadRepo(repo, requestedCompare) {
  const generation = ++state.generation
  state.fileGeneration++
  state.repo = repo
  state.compareRef = null
  state.diff = null
  $('compare-branch').disabled = true
  resetComments()
  $('sessions').replaceChildren(node('option', 'Choose an agent session…'))
  $('sessions').firstChild.value = ''
  state.commit = null
  state.file = null
  state.files = []
  state.filesReady = false
  state.commits = []
  state.review = {}
  state.reviewGeneration++
  $('error').hidden = true
  $('diff').replaceChildren(node('p', 'Loading commits…', 'empty'))
  $('commit-heading').querySelector('h1').textContent = 'Loading repository'
  $('file-name').textContent = ''
  renderCommits()
  renderFiles()
  const compare = await api('comparison', { repo }, requestedCompare ? { ref: requestedCompare } : undefined)
  if (generation !== state.generation) return
  state.compareRef = compare.compareRef
  const placeholder = node('option', 'Choose compare branch…')
  placeholder.value = ''
  $('compare-branch').replaceChildren(placeholder)
  for (const ref of compare.refs) {
    const option = node('option', ref.name)
    option.value = ref.ref
    $('compare-branch').append(option)
  }
  $('compare-branch').value = compare.compareRef ?? ''
  $('compare-branch').disabled = false
  $('branch-name').textContent = compare.currentBranch
  if (compare.warning) error(Error(compare.warning))
  const result = await api('history', { repo, ...(compare.compareRef ? { compare: compare.compareRef } : {}) })
  if (generation !== state.generation) return
  state.repo = result.repo
  if (globalThis.history?.replaceState) {
    const url = new URL(location.href)
    url.searchParams.set('repo', result.repo)
    globalThis.history.replaceState(null, '', url.href)
  }
  refreshSessions().catch(error)
  state.commits = result.commits
  state.review = result.review
  $('repository-path').value = result.repo
  renderCommits()
  if (state.commits.length) await selectCommit(state.commits[0])
  else {
    const name = compare.refs.find((r) => r.ref === compare.compareRef)?.name
    $('commit-heading').querySelector('h1').textContent = name ? `No commits ahead of ${name}` : 'No commits to review'
    $('commit-meta').textContent = ''
    $('diff').replaceChildren(node('p', name ? `All commits on ${compare.currentBranch} are already in ${name}.` :
      compare.refs.length ? 'Choose a compare branch to see commits for review.' : 'No commits yet.', 'empty'))
  }
}
async function selectCommit(commit) {
  state.diff = null
  const generation = ++state.generation
  state.fileGeneration++
  state.commit = commit
  resetComments()
  loadComments(state.repo, commit.id).catch(error)
  state.file = null
  state.files = []
  state.filesReady = false
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
  state.filesReady = true
  state.review[commit.id] ??= { total: result.files.length, paths: [] }
  renderCommits()
  renderFiles()
  if (result.files.length) await selectFile(result.files[0].path)
  else $('diff').replaceChildren(node('p', 'This commit has no file changes.', 'empty'))
}
async function selectFile(path) {
  parkComposer(true)
  inlineSlots.clear()
  diffAnchors.clear()
  state.diff = null
  const generation = ++state.fileGeneration,
    commit = state.commit.id,
    repo = state.repo
  state.file = path
  $('file-name').textContent = path
  renderFiles()
  $('diff').replaceChildren(node('p', 'Loading diff…', 'empty'))
  const result = await api('diff', { repo, commit, path })
  if (generation !== state.fileGeneration) return
  state.diff = result.diff
  renderDiff(result.diff)
  $('diff').scrollTop = 0
}
const inlineSlots = new Map(), diffAnchors = new Map()
let diffLayout = localStorage.getItem('commit-review-diff-layout') === 'split' ? 'split' : 'unified'
function parkComposer(close = false) {
  const composer = $('comment-dialog')
  $('comment-parking').append(composer)
  if (close && !commentBusy) { composer.hidden = true; composer.open = false }
}
function attachComposer() {
  const composer = $('comment-dialog')
  if (!composer.open || !commentContext || !sameReview(commentContext.repo, commentContext.commit) || commentContext.path !== state.file) return
  const slot = inlineSlots.get(`${commentContext.side}:${commentContext.line}`)
  if (slot) slot.append(composer)
}
function renderInlineNotes() {
  parkComposer()
  for (const slot of new Set(inlineSlots.values())) slot.replaceChildren()
  for (const note of comments.notes.filter((n) => n.path === state.file)) {
    const slot = inlineSlots.get(`${note.side}:${note.line}`)
    if (!slot) continue
    const card = node('div', undefined, 'inline-note')
    card.append(node('strong', `Review note · ${comments.deliveries[note.deliveryId]?.status ?? 'draft'}`), node('p', note.body))
    slot.append(card)
  }
  attachComposer()
}
function lineNumber(side, number) {
  const cell = node(number === null ? 'span' : 'button', number ?? '', 'line-number')
  if (number !== null) {
    cell.title = `Add review note on ${side} line ${number}`
    cell.setAttribute('aria-label', cell.title)
    cell.onclick = () => composeComment(side, number)
  }
  return cell
}
function renderDiff(diff) {
  parkComposer()
  inlineSlots.clear()
  diffAnchors.clear()
  const fragment = document.createDocumentFragment()
  const fileSlot = node('div', undefined, 'inline-notes')
  inlineSlots.set('file:0', fileSlot)
  fragment.append(fileSlot)
  const rows = diffLayout === 'split' ? splitDiffLines(diff) : diffLines(diff).map((line) => ({ unified: line }))
  for (const model of rows) {
    const line = model.unified ?? model.header
    const row = node('div', undefined, 'diff-line ' + (line?.kind ?? 'split-row'))
    const slot = node('div', undefined, 'inline-notes')
    if (line) {
      for (const side of ['old', 'new']) {
        row.append(lineNumber(side, line[side]))
        if (line[side] !== null) { inlineSlots.set(`${side}:${line[side]}`, slot); diffAnchors.set(`${side}:${line[side]}`, row) }
      }
      row.append(node('code', line.text))
    } else {
      for (const side of ['old', 'new']) {
        const source = model[side], cell = node('div', undefined, 'split-cell ' + (source?.kind ?? ''))
        const number = source?.[side] ?? null
        cell.append(lineNumber(side, number), node('code', source ? source.text.slice(1) : ''))
        row.append(cell)
        if (number !== null) { inlineSlots.set(`${side}:${number}`, slot); diffAnchors.set(`${side}:${number}`, row) }
      }
    }
    fragment.append(row, slot)
  }
  $('diff').replaceChildren(fragment)
  renderInlineNotes()
}
$('diff-layout').value = diffLayout
$('diff-layout').onchange = () => {
  diffLayout = $('diff-layout').value === 'split' ? 'split' : 'unified'
  localStorage.setItem('commit-review-diff-layout', diffLayout)
  savePreferences({ layout: diffLayout })
  if (state.diff !== null) renderDiff(state.diff)
}
let wrapping = localStorage.getItem('commit-review-wrap') === 'true'
function applyWrap() {
  $('diff').classList.toggle('wrap', wrapping)
  $('wrap-lines').setAttribute('aria-pressed', String(wrapping))
}
applyWrap()
$('wrap-lines').onclick = () => {
  wrapping = !wrapping; applyWrap(); localStorage.setItem('commit-review-wrap', String(wrapping))
  savePreferences({ wrap: wrapping })
}
async function mark(path, reviewed, complete) {
  if (state.saving) return
  const commit = state.commit.id,
    repo = state.repo
  state.saving = true
  $('save-status').textContent = 'Saving…'
  renderFiles()
  try {
    const record = await api('review', { repo, commit }, complete === undefined ? { path, reviewed } : { complete })
    if (repo === state.repo) {
      state.reviewGeneration++
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
$('complete-review').onclick = () =>
  mark(undefined, undefined, !state.review[state.commit.id]?.complete).catch(error)
$('reviewed').onchange = () => mark(state.file, $('reviewed').checked).catch(error)
$('previous').onclick = () =>
  selectFile(state.files[state.files.findIndex((f) => f.path === state.file) - 1].path).catch(error)
$('next').onclick = () =>
  selectFile(state.files[state.files.findIndex((f) => f.path === state.file) + 1].path).catch(error)
$('refresh').onclick = () => loadRepo(state.repo).catch(error)
$('compare-branch').onchange = () => {
  if ($('compare-branch').value) loadRepo(state.repo, $('compare-branch').value).catch(error)
}
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
  savePreferences({ theme: document.documentElement.classList.contains('light') ? 'light' : 'dark' })
}
if (localStorage.getItem('commit-review-theme') === 'light')
  document.documentElement.classList.add('light')
const sizes = ['0.8', '0.9', '1', '1.1', '1.25', '1.5']
function applySize(value) {
  const size = sizes.includes(value) ? value : '0.9'
  document.documentElement.style.setProperty('--ui-scale', size)
  $('ui-size').value = size
  return size
}
applySize(localStorage.getItem('commit-review-size'))
let preferenceGeneration = 0
function savePreferences(values) {
  preferenceGeneration++
  api('preferences', {}, values).catch(error)
}
$('ui-size').onchange = () => {
  const size = applySize($('ui-size').value)
  localStorage.setItem('commit-review-size', size)
  savePreferences({ size })
}
async function start() {
  const generation = preferenceGeneration
  const preferences = await api('preferences')
  if (generation === preferenceGeneration) {
    if (preferences.size) applySize(preferences.size)
    if (preferences.layout) { diffLayout = preferences.layout; $('diff-layout').value = diffLayout }
    if (typeof preferences.wrap === 'boolean') { wrapping = preferences.wrap; applyWrap() }
    if (preferences.theme) document.documentElement.classList.toggle('light', preferences.theme === 'light')
  }
  const { repos, last } = await api('repos')
  for (const repo of repos) {
    const option = node('option', repo.name)
    option.value = repo.path
    $('repositories').append(option)
  }
  const initial = new URLSearchParams(location.search).get('repo') ||
    (repos.some((r) => r.path === last) ? last : repos[0]?.path)
  if (initial) {
    $('repositories').value = initial
    await loadRepo(initial)
  }
}

async function pollProgress() {
  if (!state.repo || state.saving) return
  const repo = state.repo, generation = state.reviewGeneration
  try {
    const result = await api('progress', { repo })
    if (repo === state.repo && !state.saving && generation === state.reviewGeneration) {
      state.review = { ...state.review, ...result }
      renderCommits()
      renderFiles()
    }
  } catch (e) {
    error(e)
  }
}
setInterval(pollProgress, 60000)

let comments = { notes: [], deliveries: {} },
  selectedNotes = new Set(),
  commentContext = null
let commentBusy = false,
  sessionGeneration = 0,
  commentsGeneration = 0
function resetComments() {
  commentsGeneration++
  parkComposer(true)
  inlineSlots.clear()
  diffAnchors.clear()
  comments = { notes: [], deliveries: {} }
  selectedNotes = new Set()
  renderComments()
}
function sameReview(repo, commit) {
  return repo === state.repo && commit === state.commit?.id
}
async function loadComments(repo, commit, recovery = false) {
  if (commentBusy && !recovery) return
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
    jump.onclick = async () => {
      try {
        await selectFile(note.path)
        diffAnchors.get(`${note.side}:${note.line}`)?.scrollIntoView?.({ block: 'center' })
      } catch (e) { error(e) }
    }
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
    if (!['sent', 'rejected'].includes(delivery.status)) {
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
  renderInlineNotes()
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
  if (!state.file || !state.commit || commentBusy) return
  commentContext = { repo: state.repo, commit: state.commit.id, path: state.file, side, line }
  $('comment-location').textContent =
    `${state.commit.short} · ${state.file}${line ? `:${line} (${side})` : ' · whole file'}`
  $('comment-body').value = ''
  $('comment-error').textContent = ''
  $('comment-dialog').hidden = false
  $('comment-dialog').open = true
  attachComposer()
  $('comment-body').focus()
}
async function commentMutation(
  route,
  body,
  context = { repo: state.repo, commit: state.commit?.id }
) {
  if (commentBusy) return
  commentBusy = true
  const generation = ++commentsGeneration
  renderComments()
  try {
    const result = await api(route, { repo: context.repo, commit: context.commit }, body)
    if (sameReview(context.repo, context.commit) && generation === commentsGeneration) {
      comments = result
      selectedNotes = new Set(result.notes.filter((n) => !n.deliveryId).map((n) => n.id))
    }
  } catch (e) {
    if (route === 'send' && sameReview(context.repo, context.commit)) {
      // Read the persisted attempt; never automatically resend after a lost HTTP reply.
      try {
        await loadComments(context.repo, context.commit, true)
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
    if (state.commit && generation !== commentsGeneration)
      loadComments(state.repo, state.commit.id).catch(error)
  }
}
$('comment-file').onclick = () => composeComment()
$('cancel-comment').onclick = () => parkComposer(true)
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
    parkComposer(true)
    $('comments-panel').open = true
  } catch (e) {
    $('comment-error').textContent = e.message
  } finally {
    $('save-comment').disabled = false
    $('cancel-comment').disabled = false
  }
}
$('comment-form').onkeydown = (e) => {
  if (e.isComposing) return
  if (e.key === 'Escape' && !commentBusy) { e.preventDefault(); parkComposer(true) }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !commentBusy) { e.preventDefault(); $('comment-form').requestSubmit() }
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
async function heartbeat() {
  try {
    const response = await fetch('/api/heartbeat', { headers: { 'X-Review-Token': token } })
    if (!response.ok) throw Error('Commit Review connection expired.')
    const reader = response.body.getReader()
    while (!(await reader.read()).done) { /* Worker owns the heartbeat timer. */ }
    throw Error('Commit Review disconnected.')
  } catch {
    error(Error('Commit Review disconnected. Reopen it from Orca’s command palette; saved reviews are retained.'))
  }
}
heartbeat()
start().catch(error)
