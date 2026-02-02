export interface SseMessage {
  id?: string
  event?: string
  data: string
}

export async function* parseEventStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  if (!response.body) {
    throw new Error('missing_response_body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let currentId: string | undefined
  let currentEvent: string | undefined
  let dataLines: string[] = []

  const flush = async () => {
    if (!dataLines.length) return
    const msg: SseMessage = {
      id: currentId,
      event: currentEvent,
      data: dataLines.join('\n'),
    }
    currentId = undefined
    currentEvent = undefined
    dataLines = []
    return msg
  }

  while (true) {
    if (signal?.aborted) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      return
    }

    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const newlineIdx = buffer.indexOf('\n')
      if (newlineIdx === -1) break

      let line = buffer.slice(0, newlineIdx)
      buffer = buffer.slice(newlineIdx + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)

      if (!line) {
        const msg = await flush()
        if (msg) yield msg
        continue
      }

      if (line.startsWith(':')) continue

      const colonIdx = line.indexOf(':')
      const field = (colonIdx === -1 ? line : line.slice(0, colonIdx)).trim()
      let valuePart = colonIdx === -1 ? '' : line.slice(colonIdx + 1)
      if (valuePart.startsWith(' ')) valuePart = valuePart.slice(1)

      if (field === 'data') dataLines.push(valuePart)
      else if (field === 'id') currentId = valuePart
      else if (field === 'event') currentEvent = valuePart
    }
  }

  const msg = await flush()
  if (msg) yield msg
}
