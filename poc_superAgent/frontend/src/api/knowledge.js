const BASE = "http://localhost:8000/api/agent/knowledge"

export async function listDocuments() {
  const res = await fetch(`${BASE}/list`)
  if (!res.ok) throw new Error(`List failed: ${res.status}`)
  return res.json()
}

export async function compileAll() {
  const res = await fetch(`${BASE}/compile`, { method: "POST" })
  if (!res.ok) throw new Error(`Compile failed: ${res.status}`)
  return res.json()
}

export async function compileOne(docId) {
  const res = await fetch(`${BASE}/compile/${docId}`, { method: "POST" })
  if (!res.ok) throw new Error(`Compile one failed: ${res.status}`)
  return res.json()
}

export async function queryKnowledge(question) {
  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error(`Query failed: ${res.status}`)
  return res.json()
}

export async function getWikiContent(docId) {
  const res = await fetch(`${BASE}/wiki/${docId}`)
  if (!res.ok) throw new Error(`Wiki content failed: ${res.status}`)
  return res.json()
}

export async function indexWiki() {
  const res = await fetch(`${BASE}/index`, { method: "POST" })
  if (!res.ok) throw new Error(`Index failed: ${res.status}`)
  return res.json()
}
