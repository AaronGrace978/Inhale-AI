export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) throw new Error('The model did not return JSON.')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(text.slice(start, index + 1)) as unknown
    }
  }
  throw new Error('The model did not return JSON.')
}
