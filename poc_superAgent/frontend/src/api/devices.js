const BASE = "http://localhost:8000/api/devices"

export async function listDevices() {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`List failed: ${res.status}`)
  return res.json()
}

export async function addDevice(device) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(device),
  })
  if (!res.ok) throw new Error(`Add failed: ${res.status}`)
  return res.json()
}

export async function getDevice(id) {
  const res = await fetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error(`Get failed: ${res.status}`)
  return res.json()
}

export async function updateDevice(id, updates) {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`Update failed: ${res.status}`)
  return res.json()
}

export async function deleteDevice(id) {
  const res = await fetch(`${BASE}/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
  return res.json()
}

export async function testConnection(params) {
  const res = await fetch(`${BASE}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`Test failed: ${res.status}`)
  return res.json()
}
