import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('manifest and dependency-free runtime files form a consistent Git-installable package', async () => {
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url)))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.publisher + '.' + manifest.id, 'craig-franklin.commit-review')
  assert.equal(manifest.main, 'main.mjs')
  assert.equal(manifest.engines.orca, '>=1.4.220')
  assert.equal(manifest.repository, 'https://github.com/Craig-Franklin/orca-commit-review')
  assert.deepEqual(manifest.capabilities, [{ kind: 'storage' }])
  assert.deepEqual(pkg.dependencies ?? {}, {})
  const files = ['main.mjs', 'cli.mjs', 'comments.mjs', 'git.mjs', 'server.mjs', 'web/app.js', 'web/diff-lines.mjs', 'web/index.html', 'web/style.css']
  for (const file of files) {
    const content = await readFile(new URL('../' + file, import.meta.url), 'utf8')
    assert.ok(content.length > 0)
    for (const match of content.matchAll(/from ['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('./'))
      if (specifier.startsWith('./')) await readFile(new URL(specifier, new URL('../' + file, import.meta.url)))
    }
  }
})
