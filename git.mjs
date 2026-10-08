import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
const execute = promisify(execFile)
export async function git(repo, args) {
  const { stdout } = await execute('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], {
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
export async function history(repo) {
  const raw = await git(repo, [
    'log',
    '-100',
    '--topo-order',
    '--format=%H%x00%P%x00%h%x00%s%x00%an%x00%aI%x00%D%x00',
    'HEAD',
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
    '--',
    `:(literal)${path}`
  ])
}
