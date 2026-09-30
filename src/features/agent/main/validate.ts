import {
  imageTypes,
  limits,
  type Attachment,
  type Decision,
  type ImageType,
  type RunInput,
} from '../ipc'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseAttachment(value: unknown): Attachment {
  if (!isRecord(value)) throw new TypeError('attachment must be an object')
  const name = value['name']
  if (typeof name !== 'string' || name.length > 200) throw new TypeError('attachment name')
  if (value['kind'] === 'image') {
    const { mediaType, data } = value
    if (!imageTypes.includes(mediaType as ImageType)) throw new TypeError('unsupported image type')
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new TypeError('image data must be base64')
    }
    if ((data.length * 3) / 4 > limits.imageBytes) throw new TypeError('image is too large')
    return { kind: 'image', name, mediaType: mediaType as ImageType, data }
  }
  if (value['kind'] === 'text') {
    const text = value['text']
    if (typeof text !== 'string' || text.length > limits.textAttachmentChars) {
      throw new TypeError('pasted text is too long')
    }
    return { kind: 'text', name, text }
  }
  throw new TypeError('unknown attachment kind')
}

/** Throws unless `value` is a prompt with valid attachments. */
export function parseRunInput(value: unknown): RunInput {
  if (!isRecord(value)) throw new TypeError('expected { text, attachments }')
  const { text, attachments } = value
  if (typeof text !== 'string' || text.length > limits.promptChars) throw new TypeError('text')
  if (!Array.isArray(attachments) || attachments.length > limits.attachments) {
    throw new TypeError(`at most ${limits.attachments} attachments`)
  }
  const input = { text, attachments: attachments.map(parseAttachment) }
  if (!text.trim() && input.attachments.length === 0) throw new TypeError('empty prompt')
  return input
}

export function parseDecision(value: unknown): Decision {
  if (value === 'allow' || value === 'allow-run' || value === 'deny') return value
  throw new TypeError('decision must be allow, allow-run or deny')
}
