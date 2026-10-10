#!/usr/bin/env node
// A stand-in for the Claude Code CLI (CLAUDE_CLI_PATH) in tests: answers `auth status --json`, and
// in print mode reads one stream-json user message, calls the MCP tools from --mcp-config like the
// real CLI, and prints stream-json events. "open <url>" calls navigate; anything else is echoed.
// With FAKE_CLAUDE_MODEL_URL it plays the model loop instead: it POSTs { model, hasApiKey, tools,
// messages } there for each step, prints the returned { content }, calls the tools it names over
// MCP and sends their results back, until a step calls no tools.
// FAKE_CLAUDE_LOGGED_IN=0 plays a logged-out CLI; FAKE_CLAUDE_LOG appends each run's arguments.
import { appendFileSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const loggedIn = process.env.FAKE_CLAUDE_LOGGED_IN !== '0'
const print = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

if (args[0] === 'auth' && args[1] === 'status') {
  print({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none' })
  process.exit(loggedIn ? 0 : 1)
}

let input = ''
for await (const chunk of process.stdin) input += chunk
const message = JSON.parse(input.split('\n')[0])
const content = message.message.content
const text = content.filter((block) => block.type === 'text').at(-1)?.text ?? ''

if (process.env.FAKE_CLAUDE_LOG) {
  const entry = { args, hasApiKey: 'ANTHROPIC_API_KEY' in process.env, cwd: process.cwd(), content }
  appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`)
}

const sessionId = flag('--resume') ?? `fake-session-${process.pid}`
const result = (fields) =>
  print({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, ...fields })

if (!loggedIn) {
  result({ is_error: true, result: 'Not logged in · Please run /login' })
  process.exit(1)
}

let tools = []
let call = async () => {
  throw new Error('no MCP server')
}
const configPath = flag('--mcp-config')
if (configPath) {
  const server = JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.antimony
  let id = 0
  const rpc = async (method, params, notification = false) => {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        ...server.headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(!notification && { id: ++id }), method, params }),
    })
    return notification ? null : (await response.json()).result
  }
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {} })
  await rpc('notifications/initialized', {}, true)
  tools = (await rpc('tools/list', {})).tools.map((tool) => `mcp__antimony__${tool.name}`)
  call = (name, input) => rpc('tools/call', { name, arguments: input })
}
print({ type: 'system', subtype: 'init', session_id: sessionId, tools, model: flag('--model') })

const assistant = (blocks) =>
  print({ type: 'assistant', parent_tool_use_id: null, message: { content: blocks } })
const modelUrl = process.env.FAKE_CLAUDE_MODEL_URL
const url = /\bopen (\S+)/.exec(text)?.[1]
const prefix = 'mcp__antimony__'
if (modelUrl && configPath) {
  const messages = [{ role: 'user', content }]
  let answer = ''
  for (;;) {
    const response = await fetch(modelUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: flag('--model'),
        hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
        tools: tools.map((name) => ({ name: name.slice(prefix.length) })),
        messages,
      }),
    })
    const step = (await response.json()).content
    messages.push({ role: 'assistant', content: step })
    assistant(
      step.map((block) =>
        block.type === 'tool_use' ? { ...block, name: `${prefix}${block.name}` } : block,
      ),
    )
    const uses = step.filter((block) => block.type === 'tool_use')
    if (uses.length === 0) {
      answer = step
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      break
    }
    const results = []
    for (const use of uses) {
      const output = await call(use.name, use.input)
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        ...(output.isError && { is_error: true }),
        content: output.content.map((item) =>
          item.type === 'image'
            ? {
                type: 'image',
                source: { type: 'base64', media_type: item.mimeType, data: item.data },
              }
            : item,
        ),
      })
    }
    messages.push({ role: 'user', content: results })
  }
  result({ result: answer })
} else if (url) {
  assistant([{ type: 'tool_use', id: 'toolu_1', name: 'mcp__antimony__navigate', input: { url } }])
  const output = await call('navigate', { url })
  const said = output.content.find((block) => block.type === 'text')?.text ?? ''
  const answer = `${output.isError ? 'Could not open' : 'Opened'} ${url} (${said.split('\n')[0]})`
  assistant([{ type: 'text', text: answer }])
  result({ result: answer })
} else {
  const answer = `CLI echo: ${text}`
  assistant([{ type: 'text', text: answer }])
  result({ result: answer })
}
