// Shared by the viewer and comment validation, so old/new line anchors agree.
export function diffLines(diff) {
  let old = 0,
    current = 0,
    inHunk = false
  return diff.split('\n').map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    const row = { text, old: null, new: null, kind: '' }
    if (hunk) {
      old = Number(hunk[1])
      current = Number(hunk[2])
      inHunk = true
      row.kind = 'hunk'
    } else if (text.startsWith('diff ')) {
      inHunk = false
      row.kind = 'diff-header'
    } else if (inHunk && text.startsWith('+')) {
      row.new = current++
      row.kind = 'add'
    } else if (inHunk && text.startsWith('-')) {
      row.old = old++
      row.kind = 'del'
    } else if (inHunk && text.startsWith(' ')) {
      row.old = old++
      row.new = current++
    } else if (!inHunk) row.kind = 'diff-header'
    return row
  })
}

// Align contiguous replacement blocks without changing their old/new anchors.
export function splitDiffLines(diff) {
  const lines = diffLines(diff), rows = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (line.kind === 'del' || line.kind === 'add') {
      const old = [], current = []
      while (i < lines.length && ['del', 'add'].includes(lines[i].kind)) {
        const next = lines[i++]
        ;(next.kind === 'del' ? old : current).push(next)
      }
      for (let j = 0; j < Math.max(old.length, current.length); j++) rows.push({ old: old[j] ?? null, new: current[j] ?? null })
    } else {
      rows.push(line.old !== null || line.new !== null ? { old: line, new: line } : { header: line })
      i++
    }
  }
  return rows
}
