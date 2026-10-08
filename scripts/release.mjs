import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { git, planRelease } from './release-plan.mjs'
import { githubApi, publishRelease } from './release-publish.mjs'
const cwd = process.cwd()
const config = JSON.parse(await readFile(join(cwd, '.release.json'), 'utf8'))
let plan = await planRelease(cwd, config)
if (!process.argv.includes('--publish')) {
  console.log(JSON.stringify({ ...plan, ...(plan.files ? { files: Object.keys(plan.files) } : {}) }, null, 2))
} else {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== config.repository ||
      process.env.GITHUB_REF !== `refs/heads/${config.branch}` || process.env.GITHUB_SHA !== plan.head ||
      !process.env.GITHUB_TOKEN) throw Error('Publishing requires the exact configured GitHub Actions repository, branch, tested SHA and token.')
  if ((await git(cwd, ['status', '--porcelain']))) throw Error('Release checkout must be clean.')
  const api = githubApi(process.env.GITHUB_TOKEN)
  // A preceding failed run may have left a version commit before newer source changes.
  // Publish that same commit first, then plan this push against its recovered tag.
  if (plan.recovery && plan.pending && plan.releaseCommit !== plan.head) {
    const result = await publishRelease({ api, config, plan })
    console.log(JSON.stringify(result, null, 2))
    if (result.skip) process.exit(0)
    await git(cwd, ['fetch', '--no-tags', `https://github.com/${config.repository}.git`, `refs/tags/${result.tag}:refs/tags/${result.tag}`])
    plan = await planRelease(cwd, config)
  }
  if (plan.files) {
    for (const [name, text] of Object.entries(plan.files)) await writeFile(join(cwd, name), text)
    // Validate the generated installation metadata before creating any remote commit.
    await promisify(execFile)(process.execPath, ['--test', 'tests/package.test.mjs'], { cwd })
  }
  console.log(JSON.stringify(await publishRelease({ api, config, plan }), null, 2))
}
