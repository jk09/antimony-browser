import { useEffect, useRef, type PointerEvent } from 'react'

/** A line drawn on the pad: points from 0 to 1 across its width and height. */
export type Stroke = [number, number][]

const PAD_WIDTH = 240
const PAD_HEIGHT = 160
/** Size of the JPEG sent to the model. */
const EXPORT_WIDTH = 480
const EXPORT_HEIGHT = 320

/** Paints the strokes black on white over the whole canvas. */
export function paintStrokes(canvas: HTMLCanvasElement, strokes: Stroke[]): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { width, height } = canvas
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#000000'
  context.lineWidth = Math.max(2, width / 120)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const stroke of strokes) {
    const [first, ...rest] = stroke
    if (!first) continue
    context.beginPath()
    context.moveTo(first[0] * width, first[1] * height)
    // A single point (a click) is drawn as a dot.
    for (const [x, y] of rest.length ? rest : [first]) context.lineTo(x * width, y * height)
    context.stroke()
  }
  return true
}

/** The strokes as a `data:image/jpeg;base64,` URL, or null without strokes or canvas support. */
export function sketchToJpeg(strokes: Stroke[]): string | null {
  if (strokes.length === 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_WIDTH
  canvas.height = EXPORT_HEIGHT
  if (!paintStrokes(canvas, strokes)) return null
  const url = canvas.toDataURL('image/jpeg', 0.8)
  return url.startsWith('data:image/jpeg;base64,') ? url : null
}

/** A small drawing surface for mouse, pen or touch. The parent keeps the strokes. */
export function SketchPad({
  strokes,
  onChange,
}: {
  strokes: Stroke[]
  onChange: (strokes: Stroke[]) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<Stroke | null>(null)
  /** The strokes before the one being drawn. */
  const before = useRef<Stroke[]>([])

  useEffect(() => {
    if (canvas.current) paintStrokes(canvas.current, strokes)
  }, [strokes])

  const point = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = rect.width ? (event.clientX - rect.left) / rect.width : 0
    const y = rect.height ? (event.clientY - rect.top) / rect.height : 0
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]
  }

  return (
    <div className="recall-sketch">
      <canvas
        ref={canvas}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        role="img"
        aria-label="Sketch pad: draw a picture you remember from a page"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          before.current = strokes
          drawing.current = [point(event)]
          onChange([...before.current, [...drawing.current]])
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return
          drawing.current.push(point(event))
          onChange([...before.current, [...drawing.current]])
        }}
        onPointerUp={() => {
          drawing.current = null
        }}
        onPointerCancel={() => {
          drawing.current = null
        }}
      />
      <button type="button" onClick={() => onChange([])} disabled={strokes.length === 0}>
        Clear sketch
      </button>
    </div>
  )
}
