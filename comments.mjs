import { createHash, randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { commitDetails, fileDiff } from './git.mjs'
import { diffLines } from './web/diff-lines.mjs'

export function formatReview(repo, commit, notes) {
  return [
    `Please address these review comments for commit ${commit}.`,
    `Checkout: ${JSON.stringify(repo)}`,
    'Line numbers refer to this historical commit diff, not necessarily the current working tree.',
    ...notes.map((n) =>
      [
        `File: ${JSON.stringify(n.path)}`,
        n.line === 0
          ? 'Scope: file'
          : `Line: ${n.line} (${n.side === 'old' ? 'parent / removed side' : 'commit / new side'})`,
        ...(n.context !== undefined ? [`Diff line: ${JSON.stringify(n.context)}`] : []),
        `User comment: ${JSON.stringify(n.body)}`
      ].join('\n')
    )
  ].join('\n\n')
}

export function createComments({ get, set, cli }) {
  let queue = Promise.resolve()
  const key = (repo, commit) =>
    `comments-${createHash('sha256').update(repo).digest('hex')}-${commit}`
  const read = async (repo, commit) =>
    structuredClone((await get(key(repo, commit))) ?? { notes: [], deliveries: {} })
  const serial = (fn) => {
    const next = queue.catch(() => {}).then(fn)
    queue = next
    return next
  }
  async function targets(repo) {
    if (!cli) throw Error('Orca session connection is unavailable.')
    const result = await cli(['terminal', 'list', '--worktree', `path:${repo}`, '--limit', '200'])
    const targets = []
    for (const t of result.terminals ?? []) {
      if (!t.connected || !t.writable || !t.agentIdentity || !t.handle || t.orphaned) continue
      if ((await realpath(t.worktreePath).catch(() => null)) !== repo) continue
      targets.push({
        id: t.handle,
        label: `${t.title || t.agentIdentity} · ${t.agentIdentity} · ${t.handle}`
      })
    }
    return { targets, truncated: result.truncated === true }
  }
  async function deliver(repo, commit, state, delivery) {
    // Persist the exact request before sending. A lost reply never creates a new send.
    delivery.status = 'unconfirmed'
    delivery.message = 'Delivery not confirmed. Check delivery before trying another send.'
    await set(key(repo, commit), state)
    try {
      const result = await cli([
        'terminal',
        'send',
        '--terminal',
        delivery.target,
        '--text',
        delivery.prompt,
        '--enter',
        '--wait-submit',
        '3',
        '--retry-request',
        delivery.id
      ])
      const receipt = result.send
      delivery.receipt = receipt
      if (receipt?.accepted && receipt.prompt?.stages?.includes('turn_started')) {
        delivery.status = 'sent'
        delivery.message = 'Agent turn started.'
      } else if (receipt?.accepted) {
        delivery.status = 'accepted'
        delivery.message = 'Orca accepted the review; agent turn start is not confirmed.'
      } else {
        delivery.status = 'unconfirmed'
        delivery.message =
          'Orca did not confirm delivery. Comments retained; inspect the session before sending again.'
      }
    } catch {
      // Avoid exposing execFile's command line (which contains the user's comments).
      delivery.message =
        'Could not confirm delivery. Comments retained. Check delivery reuses the same request without duplicating it.'
    }
    await set(key(repo, commit), state)
    return state
  }
  return {
    targets,
    read: async (repo, commit) => {
      await commitDetails(repo, commit)
      return read(repo, commit)
    },
    change: (repo, commit, input) =>
      serial(async () => {
        const { files } = await commitDetails(repo, commit)
        const state = await read(repo, commit)
        if (input.action === 'delete') {
          const note = state.notes.find((n) => n.id === input.id)
          if (!note || note.deliveryId) throw Error('Only unsent draft comments can be deleted.')
          state.notes = state.notes.filter((n) => n.id !== input.id)
        } else if (input.action === 'add') {
          if (!files.some((f) => f.path === input.path))
            throw Error('File is not part of this commit.')
          if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 8000)
            throw Error('Enter a comment of 1–8000 characters.')
          if (
            !Number.isSafeInteger(input.line) ||
            input.line < 0 ||
            !['old', 'new', 'file'].includes(input.side) ||
            (input.line === 0) !== (input.side === 'file')
          )
            throw Error('Invalid line anchor.')
          let context
          if (input.line) {
            const row = diffLines(await fileDiff(repo, commit, input.path)).find(
              (r) => r[input.side] === input.line
            )
            if (!row) throw Error('Line is not in the displayed commit diff.')
            context = row.text
          }
          state.notes.push({
            id: randomUUID(),
            path: input.path,
            body: input.body.trim(),
            line: input.line,
            side: input.side,
            ...(context !== undefined ? { context } : {})
          })
        } else throw Error('Unknown comment action.')
        await set(key(repo, commit), state)
        return state
      }),
    send: (repo, commit, input) =>
      serial(async () => {
        await commitDetails(repo, commit)
        const state = await read(repo, commit)
        if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId))
          throw Error('Invalid send request.')
        const existing = state.deliveries[input.requestId]
        if (existing) {
          // Duplicate HTTP submits are read-only; only the Check delivery action replays a receipt.
          if (input.check === true && existing.status !== 'sent')
            return deliver(repo, commit, state, existing)
          return state
        }
        if (input.check) throw Error('Unknown delivery request.')
        const { targets: available } = await targets(repo)
        if (!available.some((t) => t.id === input.target))
          throw Error(
            'Choose a connected agent in this checkout. Refresh sessions if it has moved or closed.'
          )
        if (
          !Array.isArray(input.noteIds) ||
          !input.noteIds.length ||
          new Set(input.noteIds).size !== input.noteIds.length
        )
          throw Error('Choose draft comments to send.')
        const notes = input.noteIds.map((id) =>
          state.notes.find((n) => n.id === id && !n.deliveryId)
        )
        if (notes.some((n) => !n))
          throw Error('A comment is missing or already belongs to a send. Refresh the review.')
        const prompt = formatReview(repo, commit, notes)
        // Stay below Windows' command-line limit even with Unicode and CLI arguments.
        if (prompt.length > 10000)
          throw Error('Review is too long for one send. Send fewer comments at a time.')
        const delivery = {
          id: input.requestId,
          target: input.target,
          prompt,
          status: 'unconfirmed',
          createdAt: new Date().toISOString()
        }
        state.deliveries[delivery.id] = delivery
        for (const note of notes) note.deliveryId = delivery.id
        return deliver(repo, commit, state, delivery)
      })
  }
}
