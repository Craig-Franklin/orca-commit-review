import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseCommit, releaseType, nextVersion, planRelease, git } from '../scripts/release-plan.mjs'
import { publishRelease, githubApi } from '../scripts/release-publish.mjs'

const commits = (...messages) => messages.map((message, i) => ({ hash: String(i).padStart(40, 'a'), message }))
test('Conventional Commit analysis selects the highest semantic change and recognizes both breaking forms', () => {
  for (const message of ['feat: support sessions', 'fix(cli): handle failures', 'docs: update notes', 'custom-type(scope): detail']) assert.ok(parseCommit(message).type)
  assert.equal(releaseType(commits('fix: one', 'feat: two', 'perf: three')), 'minor')
  for (const message of ['fix!: incompatible input', 'feat(api)!: new protocol', 'refactor: update\n\nBREAKING CHANGE: input removed', 'chore: change\n\nBREAKING-CHANGE: input removed']) assert.equal(releaseType(commits(message)), 'major')
  assert.equal(releaseType(commits('perf: reduce reads')), 'patch')
  assert.equal(releaseType(commits('docs: explain', 'test: cover', 'ci: update', 'chore(release): v0.3.0-preview.1')), null)
  for (const message of ['Add a feature', 'feat:no space', 'feat: ', 'Feat: wrong case', 'fix(): empty scope']) assert.throws(() => parseCommit(message), /Not a Conventional Commit/)
})

test('preview versions increase monotonically and keep major semantics even before 1.0', () => {
  assert.equal(nextVersion('0.2.1-preview.1', 'patch', 'preview'), '0.2.1-preview.2')
  assert.equal(nextVersion('0.2.1-preview.1', 'minor', 'preview'), '0.3.0-preview.1')
  assert.equal(nextVersion('0.2.1-preview.1', 'major', 'preview'), '1.0.0-preview.1')
  assert.equal(nextVersion('0.3.0-preview.2', 'minor', 'preview'), '0.3.0-preview.3')
  assert.equal(nextVersion('1.2.3', 'patch', null), '1.2.4')
  assert.equal(nextVersion('1.2.3', 'minor', null), '1.3.0')
  assert.equal(nextVersion('1.2.3', 'major', null), '2.0.0')
  assert.equal(nextVersion('0.3.0-preview.2', 'patch', null), '0.3.0')
})

async function fixture(fn) {
  const cwd = await mkdtemp(join(tmpdir(), 'orca-release-雪 space-'))
  try {
    await git(cwd, ['init', '-b', 'main'])
    for (const [key, value] of [['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.autocrlf', 'false'], ['user.name', 'Test'], ['user.email', 'test@example.invalid']]) await git(cwd, ['config', key, value])
    const pkg = { name: 'fixture', version: '0.2.1-preview.1' }
    for (const [name, value] of Object.entries({ 'package.json': pkg, 'package-lock.json': { ...pkg, packages: { '': pkg } }, 'orca-plugin.json': { version: pkg.version } })) await writeFile(join(cwd, name), JSON.stringify(value))
    await writeFile(join(cwd, 'README.md'), 'Install https://github.com/Craig-Franklin/orca-commit-review.git#v0.2.1-preview.1\n')
    await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'feat: original'])
    await git(cwd, ['tag', 'v0.2.1-preview.1'])
    const base = await git(cwd, ['rev-parse', 'HEAD'])
    const config = { repository: 'Craig-Franklin/orca-commit-review', branch: 'main', prerelease: 'preview', bootstrap: { version: pkg.version, commit: base, tag: 'v0.2.1-preview.1' } }
    await fn({ cwd, config, base })
  } finally { await rm(cwd, { recursive: true, force: true }) }
}
const emptyCommit = (cwd, message) => git(cwd, ['commit', '--allow-empty', '-m', message])

test('planning skips docs, synchronizes all installation metadata, and recovers after tag creation', async () => fixture(async ({ cwd, config, base }) => {
  await emptyCommit(cwd, 'docs: explain')
  assert.equal((await planRelease(cwd, config)).skip, true)
  await emptyCommit(cwd, 'feat: add option')
  const plan = await planRelease(cwd, config)
  assert.equal(plan.version, '0.3.0-preview.1')
  for (const name of ['package.json', 'package-lock.json', 'orca-plugin.json']) assert.equal(JSON.parse(plan.files[name]).version, plan.version)
  assert.equal(JSON.parse(plan.files['package-lock.json']).packages[''].version, plan.version)
  assert.match(plan.files['README.md'], /#v0.3.0-preview.1/)
  assert.match(plan.notes, /acceptance remain open/)
  for (const [name, text] of Object.entries(plan.files)) await writeFile(join(cwd, name), text)
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-m', `chore(release): ${plan.tag}`, '-m', `Release-Source: ${plan.head}\nRelease-Base: ${base}\nRelease-Type: minor`])
  assert.equal((await planRelease(cwd, config)).recovery, true)
  await git(cwd, ['tag', plan.tag])
  const recovered = await planRelease(cwd, config)
  assert.equal(recovered.recovery, true)
  assert.match(recovered.notes, /feat: add option/)
  await emptyCommit(cwd, 'docs: more evidence')
  assert.equal((await planRelease(cwd, config)).skip, true)
}))

test('an unrelated preserved tag cannot inflate the next release; manifest disagreement blocks publication', async () => fixture(async ({ cwd, config, base }) => {
  await git(cwd, ['checkout', '--orphan', 'unrelated'])
  await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'feat: other history'])
  await git(cwd, ['tag', 'v99.0.0'])
  await git(cwd, ['checkout', 'main'])
  await emptyCommit(cwd, 'fix: repair')
  assert.equal((await planRelease(cwd, config)).version, '0.2.1-preview.2')
  await writeFile(join(cwd, 'orca-plugin.json'), JSON.stringify({ version: '9.0.0' }))
  await assert.rejects(() => planRelease(cwd, config), /versions disagree/)
}))

const hash = 'a'.repeat(40), released = 'b'.repeat(40)
function publisher() {
  const calls = [], config = { repository: 'Craig-Franklin/orca-commit-review', branch: 'main', prerelease: 'preview' }
  const state = { head: hash, verified: true, tag: null, release: null, commits: 0 }
  const api = async (path, body) => {
    calls.push({ path, body })
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: state.head } }
    if (path === '/graphql') { assert.equal(body.variables.input.expectedHeadOid, hash); state.head = released; state.commits++; return { data: { createCommitOnBranch: { commit: { oid: released } } } } }
    if (path.includes('/commits/')) return { commit: { verification: { verified: state.verified } } }
    if (path.includes('/git/ref/tags/')) return state.tag ? { object: { type: 'commit', sha: state.tag } } : null
    if (path.endsWith('/git/refs')) { state.tag = body.sha; return {} }
    if (path.includes('/releases/tags/')) return state.release
    if (path.endsWith('/releases')) { state.release = { html_url: 'https://github.com/Craig-Franklin/orca-commit-review/releases/tag/v0.3.0-preview.1' }; return state.release }
    throw Error('Unexpected API call')
  }
  const plan = { head: hash, base: 'c'.repeat(40), bump: 'minor', version: '0.3.0-preview.1', tag: 'v0.3.0-preview.1', notes: 'Preview', files: { 'package.json': '{}' } }
  return { calls, config, state, api, plan }
}

test('publication requires a verified signed commit before tagging and marks the GitHub release as preview', async () => {
  const f = publisher()
  const result = await publishRelease(f)
  assert.equal(result.commit, released)
  assert.equal(f.state.tag, released)
  assert.equal(f.state.commits, 1)
  const created = f.calls.find((c) => c.path.endsWith('/releases')).body
  assert.equal(created.prerelease, true)
  assert.equal(created.make_latest, 'false')
})

test('stale source heads and unsigned release commits cannot create tags', async () => {
  const stale = publisher(); stale.state.head = released
  assert.equal((await publishRelease(stale)).skip, true)
  assert.equal(stale.calls.length, 1)
  const unsigned = publisher(); unsigned.state.verified = false
  await assert.rejects(() => publishRelease(unsigned), /not GitHub Verified/)
  assert.equal(unsigned.state.tag, null)
})

test('recovery reuses a release commit and tag; conflicting tags are never moved', async () => {
  const f = publisher()
  f.state.head = released; f.state.tag = released
  f.plan = { ...f.plan, head: released, recovery: true }
  await publishRelease(f); await publishRelease(f)
  assert.equal(f.state.commits, 0)
  assert.equal(f.calls.filter((c) => c.path.endsWith('/git/refs')).length, 0)
  assert.equal(f.calls.filter((c) => c.path.endsWith('/releases')).length, 1)
  f.state.tag = 'c'.repeat(40)
  await assert.rejects(() => publishRelease(f), /will not be moved/)
})

test('API errors never expose credentials and failed writes are not retried', async () => {
  let calls = 0
  const api = githubApi('private-token', async () => { calls++; return { status: 403, ok: false } })
  await assert.rejects(() => api('/graphql', {}), (e) => !e.message.includes('private-token'))
  assert.equal(calls, 1)
})


test('rewritten history bootstraps from matching preserved content, and rejects a different tree', async () => fixture(async ({ cwd, config }) => {
  await git(cwd, ['checkout', '--orphan', 'rewritten'])
  await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'feat: rewritten original'])
  config.bootstrap.commit = await git(cwd, ['rev-parse', 'HEAD'])
  await emptyCommit(cwd, 'fix: repair')
  assert.equal((await planRelease(cwd, config)).version, '0.2.1-preview.2')
  await writeFile(join(cwd, 'README.md'), 'different baseline')
  await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'docs: changed'])
  config.bootstrap.commit = await git(cwd, ['rev-parse', 'HEAD'])
  await assert.rejects(() => planRelease(cwd, config), /does not match/)
}))

test('pending release recovery survives a newer source push and then plans the remaining change', async () => fixture(async ({ cwd, config, base }) => {
  await emptyCommit(cwd, 'feat: option')
  const plan = await planRelease(cwd, config)
  for (const [name, text] of Object.entries(plan.files)) await writeFile(join(cwd, name), text)
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-m', `chore(release): ${plan.tag}`, '-m', `Release-Source: ${plan.head}\nRelease-Base: ${base}`])
  const releaseCommit = await git(cwd, ['rev-parse', 'HEAD'])
  await emptyCommit(cwd, 'fix: follow-up')
  const recovery = await planRelease(cwd, config)
  assert.equal(recovery.releaseCommit, releaseCommit)
  assert.equal(recovery.pending, true)
  assert.notEqual(recovery.head, recovery.releaseCommit)
  await git(cwd, ['tag', recovery.tag, recovery.releaseCommit])
  assert.equal((await planRelease(cwd, config)).version, '0.3.0-preview.2')
  config.prerelease = null
  assert.equal((await planRelease(cwd, config)).version, '0.3.0')
}))
