import { imageTypes, limits, type Attachment, type ImageType } from '../../agent/ipc'

/** Pasted text longer than this becomes a "Pasted text" chip, like in the Claude prompt. */
export const LONG_PASTE_CHARS = 1000
export const LONG_PASTE_LINES = 20

export const isLongPaste = (text: string) =>
  text.length > LONG_PASTE_CHARS || text.split('\n').length > LONG_PASTE_LINES

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

/** Reads image files into attachments; returns an error message for the ones it can't take. */
export async function readImages(
  files: File[],
  existing: number,
): Promise<{ attachments: Attachment[]; error: string | null }> {
  const attachments: Attachment[] = []
  const problems: string[] = []
  for (const file of files) {
    if (!imageTypes.includes(file.type as ImageType)) {
      problems.push(`${file.name || 'file'}: only PNG, JPEG, GIF and WebP images`)
    } else if (file.size > limits.imageBytes) {
      problems.push(`${file.name || 'image'}: larger than 5 MB`)
    } else if (existing + attachments.length >= limits.attachments) {
      problems.push(`at most ${limits.attachments} attachments`)
      break
    } else {
      attachments.push({
        kind: 'image',
        name: file.name || 'Pasted image',
        mediaType: file.type as ImageType,
        data: await readAsBase64(file),
      })
    }
  }
  return { attachments, error: problems.length ? problems.join('; ') : null }
}

export const imageUrl = (attachment: Attachment & { kind: 'image' }) =>
  `data:${attachment.mediaType};base64,${attachment.data}`
