import { readCommits, parseCommit } from './release-plan.mjs'
const commits = await readCommits(process.cwd(), process.argv[2] || 'HEAD')
for (const commit of commits) {
  try { parseCommit(commit.message) } catch (e) { throw Error(`${commit.hash.slice(0, 7)}: ${e.message}`) }
}
console.log(`Validated ${commits.length} Conventional Commits.`)
