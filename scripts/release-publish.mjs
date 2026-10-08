export function githubApi(token, request = fetch) {
  return async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await request(`https://api.github.com${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'orca-commit-review-release', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000)
    })
    if (response.status === 404 && method === 'GET') return null
    if (!response.ok) throw Error(`GitHub ${method} ${path} failed (${response.status}).`)
    const result = await response.json()
    if (result.errors?.length) throw Error('GitHub GraphQL rejected the release commit. Check branch rules and expected HEAD.')
    return result
  }
}
async function ensureTag(api, root, tag, commit) {
  const path = `${root}/git/ref/tags/${encodeURIComponent(tag)}`
  const existing = await api(path)
  if (existing) {
    let object = existing.object
    while (object.type === 'tag') object = (await api(`${root}/git/tags/${object.sha}`)).object
    if (object.sha !== commit) throw Error(`Tag ${tag} already exists at a different commit; it will not be moved.`)
    return
  }
  await api(`${root}/git/refs`, { ref: `refs/tags/${tag}`, sha: commit })
}
export async function publishRelease({ api, config, plan }) {
  const root = `/repos/${config.repository}`
  const branch = await api(`${root}/git/ref/heads/${encodeURIComponent(config.branch)}`)
  if (branch?.object.sha !== plan.head) return { skip: true, reason: 'Branch advanced while checks ran; the newer push will release.' }
  if (plan.skip) return plan
  let commit = plan.releaseCommit ?? plan.head
  if (!plan.recovery) {
    const result = await api('/graphql', {
      query: 'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}',
      variables: { input: {
        branch: { repositoryNameWithOwner: config.repository, branchName: config.branch },
        expectedHeadOid: plan.head,
        message: { headline: `chore(release): ${plan.tag}`, body: `Release-Source: ${plan.head}\nRelease-Base: ${plan.base}\nRelease-Type: ${plan.bump}` },
        fileChanges: { additions: Object.entries(plan.files).map(([path, text]) => ({ path, contents: Buffer.from(text).toString('base64') })) }
      } }
    })
    commit = result?.data?.createCommitOnBranch?.commit?.oid
    if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw Error('GitHub did not confirm the release commit. Rerun to recover it.')
  }
  // GitHub signs createCommitOnBranch commits. Refuse to tag an unverified commit.
  const receipt = await api(`${root}/commits/${commit}`)
  if (receipt?.commit.verification?.verified !== true) throw Error('Release commit is not GitHub Verified. No release tag was created; rerun once verification is available.')
  await ensureTag(api, root, plan.tag, commit)
  let release = await api(`${root}/releases/tags/${encodeURIComponent(plan.tag)}`)
  if (!release) release = await api(`${root}/releases`, {
    tag_name: plan.tag, target_commitish: commit, name: plan.tag, body: plan.notes,
    draft: false, prerelease: Boolean(config.prerelease), make_latest: config.prerelease ? 'false' : 'true'
  })
  return { version: plan.version, tag: plan.tag, commit, url: release.html_url, recovered: Boolean(plan.recovery) }
}
