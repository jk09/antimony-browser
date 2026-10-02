import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startMcpServer, type McpServer, type McpServerOptions } from './mcp-server'

let server: McpServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

async function start(overrides: Partial<McpServerOptions> = {}) {
  const call = vi.fn(async (name: string, args: unknown) => ({
    content: [{ type: 'text' as const, text: `${name} ${JSON.stringify(args)}` }],
  }))
  server = await startMcpServer({
    name: 'antimony',
    tools: () => [{ name: 'navigate', description: 'Open a URL', inputSchema: { type: 'object' } }],
    call,
    ...overrides,
  })
  return { server, call }
}

/** A raw HTTP request, so Host and Origin can be set (fetch won't let us set Host). */
function send(
  url: string,
  {
    method = 'POST',
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      let text = ''
      res.on('data', (chunk: Buffer) => (text += chunk.toString()))
      res.on('end', () =>
        resolve({ status: res.statusCode!, json: text ? JSON.parse(text) : null }),
      )
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))
  })
}

/** A JSON-RPC request; `id: null` makes it a notification. */
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({
  jsonrpc: '2.0',
  ...(id !== null && { id }),
  method,
  ...(params !== undefined && { params }),
})

describe('startMcpServer', () => {
  it('listens on loopback and speaks MCP: initialize, notifications, tools/list, tools/call', async () => {
    const { server, call } = await start()
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const auth = {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }

    const init = await send(server.url, {
      headers: auth,
      body: rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} }),
    })
    expect(init).toEqual({
      status: 200,
      json: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'antimony', version: '1.0.0' },
        },
      },
    })
    const newer = await send(server.url, {
      headers: auth,
      body: rpc('initialize', { protocolVersion: '2099-01-01' }),
    })
    expect(newer.json).toMatchObject({ result: { protocolVersion: '2025-06-18' } })

    expect(
      await send(server.url, {
        headers: auth,
        body: rpc('notifications/initialized', {}, null),
      }),
    ).toEqual({ status: 202, json: null })
    expect((await send(server.url, { headers: auth, body: rpc('ping') })).json).toMatchObject({
      result: {},
    })

    const list = await send(server.url, { headers: auth, body: rpc('tools/list') })
    expect(list.json).toMatchObject({
      result: { tools: [{ name: 'navigate', inputSchema: { type: 'object' } }] },
    })

    const result = await send(server.url, {
      headers: auth,
      body: rpc('tools/call', { name: 'navigate', arguments: { url: 'a.com' } }),
    })
    expect(call).toHaveBeenCalledWith('navigate', { url: 'a.com' })
    expect(result.json).toMatchObject({
      id: 1,
      result: { content: [{ type: 'text', text: 'navigate {"url":"a.com"}' }] },
    })
  })

  it('answers unknown methods, bad JSON and failing tools with JSON-RPC errors', async () => {
    const { server } = await start({
      call: async () => {
        throw new Error('boom')
      },
    })
    const headers = { authorization: `Bearer ${server.token}` }
    expect((await send(server.url, { headers, body: rpc('resources/list') })).json).toMatchObject({
      error: { code: -32601 },
    })
    expect(await send(server.url, { headers, body: '{not json' })).toMatchObject({
      status: 400,
      json: { error: { code: -32700 } },
    })
    expect(await send(server.url, { headers, body: [rpc('ping')] })).toMatchObject({
      status: 400,
      json: { error: { code: -32600 } },
    })
    expect(
      (await send(server.url, { headers, body: rpc('tools/call', { name: 'navigate' }) })).json,
    ).toMatchObject({ error: { code: -32603, message: 'boom' } })
  })

  it('rejects requests without the token, from a browser (Origin) or for another Host', async () => {
    const { server, call } = await start()
    const body = rpc('tools/call', { name: 'navigate', arguments: {} })
    const auth = `Bearer ${server.token}`
    expect((await send(server.url, { body })).status).toBe(401)
    expect(
      (await send(server.url, { headers: { authorization: 'Bearer nope' }, body })).status,
    ).toBe(401)
    expect(
      (
        await send(server.url, {
          headers: { authorization: auth, origin: 'https://evil.com' },
          body,
        })
      ).status,
    ).toBe(403)
    expect(
      (await send(server.url, { headers: { authorization: auth, host: 'evil.com' }, body })).status,
    ).toBe(403)
    expect(
      (await send(server.url.replace('/mcp', '/other'), { headers: { authorization: auth }, body }))
        .status,
    ).toBe(404)
    expect(
      (await send(server.url, { method: 'GET', headers: { authorization: auth } })).status,
    ).toBe(405)
    expect(call).not.toHaveBeenCalled()
  })

  it('stops accepting connections once closed', async () => {
    const { server } = await start()
    const { url, token } = server
    await server.close()
    await expect(
      send(url, { headers: { authorization: `Bearer ${token}` }, body: rpc('ping') }),
    ).rejects.toThrow()
  })
})
