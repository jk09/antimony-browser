// Messages API content blocks: what the CLI's stream-json carries and the tools' results are made of.

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string | ContentBlock[]
      is_error?: boolean
    }
  | { type: 'thinking'; thinking: string; signature?: string }
  // Other blocks (redacted thinking …) are kept as-is.
  | { type: string; [key: string]: unknown }

/** A tool as the model sees it (served to the CLI over MCP). */
export interface ApiTool {
  name: string
  description: string
  input_schema: object
}
