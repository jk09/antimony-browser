// A minimal MCP server (streamable HTTP transport, JSON responses only, no SDK) that offers the
// browser tools to the Claude Code CLI for one run. Loopback only, behind a per-run bearer token.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const MCP_PATH = '/mcp'
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY_BYTES = 1024 * 1024

export interface McpTool {
  name: string
  description: string
  inputSchema: object
}

export type McpContent =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

export interface McpServerOptions {
  name: string
  tools(): McpTool[]
  call(name: string, args: unknown): Promise<McpToolResult>
}

export interface McpServer {
  /** http://127.0.0.1:<port>/mcp */
  url: string
  token: string
  close(): Promise<void>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function send(response: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    response.writeHead(status).end()
    return
  }
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new RpcError(-32600, 'Request too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function parseRequest(body: string): JsonRpcRequest {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new RpcError(-32700, 'Parse error')
  }
  const record = value as Partial<JsonRpcRequest> | null
  if (
    typeof record !== 'object' ||
    record === null ||
    Array.isArray(record) ||
    record.jsonrpc !== '2.0' ||
    typeof record.method !== 'string'
  ) {
    throw new RpcError(-32600, 'Invalid request')
  }
  return record as JsonRpcRequest
}

/** Starts the server on a random loopback port. */
export async function startMcpServer(options: McpServerOptions): Promise<McpServer> {
  const token = randomBytes(32).toString('hex')
  let host = ''

  const dispatch = async (rpc: JsonRpcRequest): Promise<unknown> => {
    const params = (rpc.params ?? {}) as Record<string, unknown>
    switch (rpc.method) {
      case 'initialize': {
        const asked = params['protocolVersion']
        return {
          protocolVersion:
            typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.name, version: '1.0.0' },
        }
      }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: options.tools() }
      case 'tools/call': {
        if (typeof params['name'] !== 'string') throw new RpcError(-32602, 'Missing tool name')
        return await options.call(params['name'], params['arguments'] ?? {})
      }
      default:
        throw new RpcError(-32601, `Method not found: ${rpc.method}`)
    }
  }

  const server = createServer((request, response) => {
    void (async () => {
      // Only the CLI may call: no browser (Origin), no DNS rebinding (Host), the run's token.
      if (request.headers.origin !== undefined || request.headers.host !== host) {
        return send(response, 403)
      }
      if (!sameSecret(request.headers.authorization ?? '', `Bearer ${token}`)) {
        return send(response, 401)
      }
      if (request.url !== MCP_PATH) return send(response, 404)
      // No server-initiated stream (GET) and no sessions to end (DELETE).
      if (request.method !== 'POST') return send(response, 405)

      let rpc: JsonRpcRequest
      try {
        rpc = parseRequest(await readBody(request))
      } catch (error) {
        const { code, message } =
          error instanceof RpcError ? error : new RpcError(-32603, 'Internal error')
        return send(response, 400, { jsonrpc: '2.0', id: null, error: { code, message } })
      }
      // Notifications (no id) get no answer.
      if (rpc.id === undefined) return send(response, 202)
      try {
        const result = await dispatch(rpc)
        send(response, 200, { jsonrpc: '2.0', id: rpc.id, result })
      } catch (error) {
        const { code, message } =
          error instanceof RpcError
            ? error
            : new RpcError(-32603, error instanceof Error ? error.message : String(error))
        send(response, 200, { jsonrpc: '2.0', id: rpc.id, error: { code, message } })
      }
    })().catch((error: unknown) => {
      console.error('MCP server request failed', error)
      if (!response.headersSent) send(response, 500)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('MCP server has no port')
  host = `127.0.0.1:${address.port}`

  return {
    url: `http://${host}${MCP_PATH}`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
