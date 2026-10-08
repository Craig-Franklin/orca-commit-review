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
