/** Zoom factors of the chrome UI, as in Chromium's zoom steps between 50 % and 300 %. */
export const ZOOM_FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const

/** 1 zooms in, -1 zooms out, 0 resets to 100 %. */
export type ZoomDirection = 1 | -1 | 0

/**
 * The zoom factor after one step from `current`: the next listed factor in that direction (from a
 * factor between steps too), `current` at the ends, 1 for a reset.
 */
export function nextZoomFactor(current: number, direction: ZoomDirection): number {
  if (direction === 0) return 1
  const epsilon = 0.001
  const next =
    direction > 0
      ? ZOOM_FACTORS.find((factor) => factor > current + epsilon)
      : ZOOM_FACTORS.findLast((factor) => factor < current - epsilon)
  return next ?? current
}
