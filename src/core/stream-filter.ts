/**
 * Streams only the user-facing answer. Proposal JSON stays off the transcript.
 */
export function createAnswerFilter(): { push: (chunk: string) => string; flush: () => string } {
  let buffer = ''
  let mode: 'seek' | 'answer' | 'raw' | 'drop' = 'seek'

  const takeAnswer = (): string => {
    const lower = buffer.toLowerCase()
    const close = lower.indexOf('</answer>')
    if (close >= 0) {
      const output = buffer.slice(0, close)
      buffer = ''
      mode = 'drop'
      return output
    }
    const keep = Math.min(buffer.length, '</answer>'.length - 1)
    const output = buffer.slice(0, buffer.length - keep)
    buffer = buffer.slice(buffer.length - keep)
    return output
  }

  const takeRaw = (): string => {
    const lower = buffer.toLowerCase()
    const hidden = ['<proposal>', '<build>']
    let cut = -1
    for (const tag of hidden) {
      const found = lower.indexOf(tag)
      if (found >= 0 && (cut < 0 || found < cut)) cut = found
    }
    if (cut >= 0) {
      const output = buffer.slice(0, cut)
      buffer = ''
      mode = 'drop'
      return output
    }
    const keep = Math.min(buffer.length, '<proposal>'.length - 1)
    const output = buffer.slice(0, buffer.length - keep)
    buffer = buffer.slice(buffer.length - keep)
    return output
  }

  return {
    push(chunk: string): string {
      buffer += chunk
      let output = ''
      if (mode === 'seek') {
        const lower = buffer.toLowerCase()
        const open = lower.indexOf('<answer>')
        if (open >= 0) {
          mode = 'answer'
          buffer = buffer.slice(open + '<answer>'.length)
        } else if (buffer.length > 80 && !lower.includes('<ans') && !lower.includes('<pro') && !lower.includes('<bui')) {
          mode = 'raw'
        } else {
          return ''
        }
      }
      if (mode === 'answer') output += takeAnswer()
      if (mode === 'raw') output += takeRaw()
      return output
    },
    flush(): string {
      if (mode === 'drop') return ''
      const output = buffer
      buffer = ''
      return output
    }
  }
}
