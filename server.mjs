import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { repository, history, commitDetails, fileDiff } from './git.mjs'
import { createComments } from './comments.mjs'
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/diff-lines.mjs', ['diff-lines.mjs', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']]
])
export async function startReviewServer({ get, set, listRepositories = async () => [], cli, heartbeatMs = 60000 }) {
  const comments = createComments({ get, set, cli })
  const token = randomBytes(32).toString('hex')
  let origin,
    writeQueue = Promise.resolve()
  const validToken = (value) =>
    typeof value === 'string' &&
    /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token))
  const keyFor = (repo) => `review-${createHash('sha256').update(repo).digest('hex')}`
  const streams = new Set()
  const server = http.createServer(async (req, res) => {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, {
        'Content-Type': type + '; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
      })
      res.end(type === 'application/json' ? JSON.stringify(data) : data)
    }
    try {
      if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Invalid host.' })
      const url = new URL(req.url, origin)
      if (assets.has(url.pathname) && req.method === 'GET') {
        const [name, type] = assets.get(url.pathname)
        return send(200, await readFile(new URL(`./web/${name}`, import.meta.url)), type)
      }
      if (
        !validToken(req.headers['x-review-token']) ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        return send(403, { error: 'Reopen Commit Review from Orca’s command palette.' })
      if (req.method === 'GET' && url.pathname === '/api/repos')
        return send(200, { repos: await listRepositories(), last: await get('last-repository') })
      if (req.method === 'GET' && url.pathname === '/api/heartbeat') {
        // Keep the worker active while a page is connected, including background tabs.
        // No timer remains after the page disconnects, so Orca can reap unused workers.
        await get('last-repository')
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
        res.write(': connected\n\n')
        streams.add(res)
        let busy = false
        const timer = setInterval(async () => {
          if (busy) return
          busy = true
          try {
            await get('last-repository')
            if (!res.destroyed) res.write(': active\n\n')
          } catch {
            res.end()
          } finally { busy = false }
        }, heartbeatMs)
        timer.unref()
        res.once('close', () => { clearInterval(timer); streams.delete(res) })
        return
      }
      if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Unsupported method.' })
      const repo = await repository(url.searchParams.get('repo'))
      if (url.pathname === '/api/history' && req.method === 'GET') {
        const commits = await history(repo)
        await set('last-repository', repo)
        return send(200, { repo, commits, review: (await get(keyFor(repo))) ?? {} })
      }
      if (url.pathname === '/api/progress' && req.method === 'GET')
        return send(200, (await get(keyFor(repo))) ?? {})
      const id = url.searchParams.get('commit')
      if (url.pathname === '/api/sessions' && req.method === 'GET')
        return send(200, await comments.targets(repo))
      if (url.pathname === '/api/comments' && req.method === 'GET')
        return send(200, await comments.read(repo, id))
      if (['/api/comments', '/api/send'].includes(url.pathname) && req.method === 'POST') {
        let body = ''
        req.setEncoding('utf8')
        for await (const chunk of req) {
          body += chunk
          if (Buffer.byteLength(body) > 65536) throw Error('Request too large.')
        }
        const result = await comments[url.pathname === '/api/send' ? 'send' : 'change'](
          repo,
          id,
          JSON.parse(body)
        )
        return send(200, result)
      }
      if (url.pathname === '/api/files' && req.method === 'GET')
        return send(200, await commitDetails(repo, id))
      if (url.pathname === '/api/diff' && req.method === 'GET')
        return send(200, { diff: await fileDiff(repo, id, url.searchParams.get('path')) })
      if (url.pathname === '/api/review' && req.method === 'POST') {
        let body = ''
        req.setEncoding('utf8')
        for await (const chunk of req) {
          body += chunk
          if (Buffer.byteLength(body) > 16384) throw Error('Request too large.')
        }
        const { path, reviewed, complete } = JSON.parse(body)
        const completion = complete !== undefined
        if (completion ? typeof complete !== 'boolean' : typeof reviewed !== 'boolean')
          throw Error('Invalid review state.')
        const { files } = await commitDetails(repo, id)
        if (!completion && !files.some((f) => f.path === path)) throw Error('File is not part of this commit.')
        const write = writeQueue
          .catch(() => {})
          .then(async () => {
            const state = (await get(keyFor(repo))) ?? {}
            const paths = new Set(state[id]?.paths ?? [])
            if (completion) {
              if (complete && !files.every((file) => paths.has(file.path)))
                throw Error('Mark every changed file reviewed before completing this commit.')
            } else reviewed ? paths.add(path) : paths.delete(path)
            const wasComplete = state[id]?.complete === true
            state[id] = { total: files.length, paths: [...paths],
              complete: completion ? complete : wasComplete && reviewed }
            await set(keyFor(repo), state)
            return state[id]
          })
        writeQueue = write
        return send(200, await write)
      }
      return send(404, { error: 'Not found.' })
    } catch (error) {
      if (!res.headersSent) send(400, { error: error.message || 'Request failed.' })
    }
  })
  server.requestTimeout = 30000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    url: `${origin}/#${token}`,
    origin,
    token,
    close: () =>
      new Promise((resolve) => {
        for (const stream of streams) stream.end()
        server.close(resolve)
        server.closeAllConnections()
      })
  }
}
