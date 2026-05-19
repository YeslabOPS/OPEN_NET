const BASE_URL = "http://localhost:8000/api/agent"

export async function chat(message, sessionId) {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId || null }),
  })
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`)
  return res.json()
}

export async function streamChat(message, sessionId, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${BASE_URL}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId || null }),
    })

    if (!res.ok) {
      onError(`HTTP ${res.status}`)
      return null
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let newSessionId = sessionId

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (!data) continue

        try {
          const parsed = JSON.parse(data.replace(/'/g, '"'))
          if (parsed.type === "start") {
            newSessionId = parsed.session_id
          } else if (parsed.type === "chunk") {
            onChunk(parsed.content.replace(/\\n/g, "\n"), newSessionId)
          } else if (parsed.type === "end") {
            onDone(newSessionId)
          } else if (parsed.type === "error") {
            onError(parsed.error)
          }
        } catch {
          // ignore parse errors for partial lines
        }
      }
    }

    onDone(newSessionId)
    return newSessionId
  } catch (err) {
    onError(err.message)
    return null
  }
}

export async function getSession(sessionId) {
  const res = await fetch(`${BASE_URL}/session/${sessionId}`)
  if (!res.ok) throw new Error(`Get session failed: ${res.status}`)
  return res.json()
}

export async function plan(message) {
  const res = await fetch(`${BASE_URL}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error(`Plan failed: ${res.status}`)
  return res.json()
}
