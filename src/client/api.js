/** The editor's line to its dev server. Every call carries the page's token. */
export function createApi(boot) {
  const base = boot.api || '/__retouch'
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-retouch-token': boot.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let data
    try {
      data = await res.json()
    } catch {
      data = { ok: false, error: `The editor server answered ${res.status}.` }
    }
    if (!data.ok) {
      const err = new Error(data.error || 'Request failed')
      Object.assign(err, { code: data.code, op: data.op, candidates: data.candidates })
      throw err
    }
    return data
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body ?? {}),
  }
}
