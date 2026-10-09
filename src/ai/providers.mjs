import { RetouchError } from '../server/util.mjs'

// Fixed destinations: a project or model cannot redirect a user's credential.
export const PROVIDERS = Object.freeze([
  { id: 'gemini', name: 'Gemini', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/api-keys' },
  { id: 'claude', name: 'Claude', model: 'claude-sonnet-5-5', keyUrl: 'https://platform.claude.com/settings/keys' },
  { id: 'openai', name: 'OpenAI', model: 'gpt-6.1-sol', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'zai', name: 'Z.ai', model: 'glm-5.3', keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
])

export function wiringCredentials(input) {
  const provider = PROVIDERS.find((p) => p.id === input?.provider)
  if (!provider) throw new RetouchError('Choose Gemini, Claude, OpenAI, DeepSeek or Z.ai.')
  const apiKey = String(input.apiKey ?? '').trim()
  if (!apiKey || apiKey.length > 4096 || /[\r\n\x00-\x1f]/.test(apiKey)) throw new RetouchError('Enter a valid provider API key.')
  const model = String(input.model || provider.model).trim()
  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(model)) throw new RetouchError('Enter the provider’s model ID.')
  return { provider: provider.id, apiKey, model, codingPlan: input.codingPlan === true }
}

/** Native tool protocols, with opaque reasoning/signatures carried back unchanged. */
export function createProvider({ provider, apiKey, model, codingPlan }, { system, prompt, tools, signal, fetchImpl = fetch }) {
  const history = provider === 'gemini' ? [{ role: 'user', parts: [{ text: prompt }] }]
    : provider === 'openai' ? [{ role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }]
  const fn = (t) => ({ name: t.name, description: t.description, parameters: t.input_schema })
  function request() {
    if (provider === 'openai') return { url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${apiKey}` }, body: { model, instructions: system, input: history, tools: tools.map((t) => ({ type: 'function', ...fn(t), strict: false })), store: false, include: ['reasoning.encrypted_content'], max_output_tokens: 8192 } }
    if (provider === 'claude') return { url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: { model, system, messages: history, tools, max_tokens: 8192 } }
    if (provider === 'gemini') return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers: { 'x-goog-api-key': apiKey }, body: { systemInstruction: { parts: [{ text: system }] }, contents: history, tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }], generationConfig: { maxOutputTokens: 8192 } } }
    const url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : `https://api.z.ai/api/${codingPlan ? 'coding/' : ''}paas/v4/chat/completions`
    return { url, headers: { Authorization: `Bearer ${apiKey}` }, body: { model, messages: [{ role: 'system', content: system }, ...history], tools: tools.map((t) => ({ type: 'function', function: fn(t) })), max_tokens: 8192, stream: false } }
  }
  return {
    async next() {
      signal?.throwIfAborted()
      const { url, headers, body } = request()
      let res, data
      try {
        res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]) })
        if (!res.ok) {
          // Never forward raw upstream bodies (they may echo credentials or file text).
          const why = res.status === 401 || res.status === 403 ? 'Check the API key and model access.' : res.status === 429 ? 'Check your provider’s quota or billing, then retry.' : res.status === 400 || res.status === 404 ? 'Check the model ID supports tool calling on this API.' : 'The provider is unavailable; try again.'
          throw new RetouchError(`${PROVIDERS.find((p) => p.id === provider).name} returned HTTP ${res.status}. ${why}`)
        }
        data = await res.json()
      } catch (e) {
        if (signal?.aborted) throw new RetouchError('Wiring cancelled.')
        if (e instanceof RetouchError) throw e
        throw new RetouchError('Could not reach the provider within two minutes. Check your connection and retry.')
      }
      let calls, text
      if (provider === 'openai') {
        if (data.error || data.status === 'incomplete' || !Array.isArray(data.output)) throw new RetouchError('OpenAI did not return a complete response. Try a different model or retry.')
        history.push(...data.output)
        calls = data.output.filter((p) => p.type === 'function_call').map((p) => ({ id: p.call_id, name: p.name, args: p.arguments }))
        text = data.output.filter((p) => p.type === 'message').flatMap((p) => p.content ?? []).filter((p) => p.type === 'output_text').map((p) => p.text).join('\n')
      } else if (provider === 'claude') {
        if (!Array.isArray(data.content) || data.stop_reason === 'max_tokens') throw new RetouchError('Claude did not return a complete response. Try a different model or retry.')
        history.push({ role: 'assistant', content: data.content })
        calls = data.content.filter((p) => p.type === 'tool_use').map((p) => ({ id: p.id, name: p.name, args: p.input }))
        text = data.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      } else if (provider === 'gemini') {
        const candidate = data.candidates?.[0]
        if (!candidate?.content || !['STOP', undefined].includes(candidate.finishReason)) throw new RetouchError('Gemini did not return a complete response. Try a different model or retry.')
        history.push(candidate.content)
        calls = candidate.content.parts.filter((p) => p.functionCall).map((p) => ({ id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args }))
        text = candidate.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n')
      } else {
        const choice = data.choices?.[0]
        if (!choice?.message || choice.finish_reason === 'length') throw new RetouchError('The provider did not return a complete response. Try a different model or retry.')
        history.push(choice.message)
        calls = (choice.message.tool_calls ?? []).map((p) => ({ id: p.id, name: p.function.name, args: p.function.arguments }))
        text = choice.message.content || ''
      }
      return { calls, text }
    },
    results(results) {
      if (provider === 'openai') history.push(...results.map((r) => ({ type: 'function_call_output', call_id: r.id, output: r.output })))
      else if (provider === 'claude') history.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })) })
      else if (provider === 'gemini') history.push({ role: 'user', parts: results.map((r) => ({ functionResponse: { ...(r.id ? { id: r.id } : {}), name: r.name, response: { result: r.output } } })) })
      else history.push(...results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.output })))
    },
    continue(text) {
      history.push(provider === 'gemini' ? { role: 'user', parts: [{ text }] } : { role: 'user', content: text })
    },
  }
}
