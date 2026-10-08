import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
const execute = promisify(execFile)
export async function git(repo, args) {
  const { stdout } = await execute('git', ['--no-pager', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'log.showSignature=false', ...args], {
    cwd: repo,
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  })
  return stdout
}
export async function repository(input) {
  if (typeof input !== 'string' || !input) throw Error('Choose a repository first.')
  const root = (await git(input, ['rev-parse', '--show-toplevel'])).trim()
  return realpath(root)
}
export async function comparison(repo, preferredRef) {
  const raw = await git(repo, ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'])
  const refs = raw.trim().split('\n').filter(Boolean).map((line) => line.split('\0'))
    .filter(([, symbolic]) => !symbolic).map(([ref]) => ({
      ref, name: ref.replace(/^refs\/(heads|remotes)\//, '')
    }))
  const match = (value) => refs.find((r) => r.ref === value) ??
    (refs.filter((r) => r.name === value).length === 1 ? refs.find((r) => r.name === value) : undefined)
  let currentBranch = 'Detached HEAD'
  try { currentBranch = (await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() }
  catch (error) { if (error.code !== 1) throw error }
  let originHead
  try { originHead = (await git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])).trim() }
  catch (error) { if (error.code !== 1) throw error }
  const selected = match(preferredRef) ?? match(originHead) ??
    ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']
      .map(match).find(Boolean)
  return { refs, currentBranch, compareRef: selected?.ref ?? null,
    warning: preferredRef && !match(preferredRef) ? `Compare branch ${preferredRef} is unavailable. Choose an available branch.` : null }
}
export async function history(repo, compareRef) {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  } catch (error) {
    if (error.code === 1) return [] // Unborn branch.
    throw error
  }
  let exclusion = []
  if (compareRef) {
    const { refs } = await comparison(repo)
    if (!refs.some((r) => r.ref === compareRef)) throw Error('Choose an available compare branch.')
    const hash = (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${compareRef}^{commit}`])).trim()
    exclusion = [`^${hash}`]
  }
  const raw = await git(repo, [
    'log',
    '-100',
    '--topo-order',
    '--no-notes',
    '--format=%H%x00%P%x00%h%x00%s%x00%an%x00%aI%x00%D%x00',
    'HEAD',
    ...exclusion,
    '--'
  ])
  const parts = raw.split('\0'),
    commits = []
  for (let i = 0; i + 6 < parts.length; i += 7) {
    commits.push({
      id: parts[i].trim(),
      parents: parts[i + 1].split(' ').filter(Boolean),
      short: parts[i + 2],
      subject: parts[i + 3],
      author: parts[i + 4],
      date: parts[i + 5],
      refs: parts[i + 6]
    })
  }
  return commits
}
export async function commitDetails(repo, id) {
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(id ?? '')) throw Error('Invalid commit.')
  const parents = (await git(repo, ['show', '-s', '--format=%P', id, '--']))
    .trim()
    .split(' ')
    .filter(Boolean)
  const range = parents[0]
    ? ['diff', parents[0], id]
    : ['diff-tree', '--root', '--no-commit-id', '-r', id]
  const fields = (await git(repo, [...range, '--no-renames', '--name-status', '-z', '--'])).split(
    '\0'
  )
  const files = []
  for (let i = 0; i + 1 < fields.length; i += 2)
    if (fields[i]) files.push({ status: fields[i], path: fields[i + 1] })
  return { id, parent: parents[0] ?? null, files }
}
export async function fileDiff(repo, id, path) {
  const commit = await commitDetails(repo, id)
  if (!commit.files.some((f) => f.path === path)) throw Error('File is not part of this commit.')
  const range = commit.parent ? ['diff', commit.parent, id] : ['show', '--format=', '--root', id]
  return git(repo, [
    ...range,
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--unified=5',
    '--submodule=short',
    '--',
    `:(literal)${path}`
  ])
}
