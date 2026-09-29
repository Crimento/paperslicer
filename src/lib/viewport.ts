import type { Point, Rect } from './types'

export function paddedBounds(bounds: Rect, padding = 0.15, zoom = 1): Rect {
  const width = Math.max(bounds.width, 100) * (1 + padding * 2) / zoom
  const height = Math.max(bounds.height, 100) * (1 + padding * 2) / zoom
  return { x: bounds.x + bounds.width / 2 - width / 2, y: bounds.y + bounds.height / 2 - height / 2, width, height }
}

export function viewBox(rect: Rect): string {
  return `${rect.x} ${rect.y} ${rect.width} ${rect.height}`
}

export function pointerInSvg(svg: SVGSVGElement, event: { clientX: number; clientY: number }): Point {
  const matrix = svg.getScreenCTM()
  if (!matrix) return { x: 0, y: 0 }
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

export function snapThreshold(svg: SVGSVGElement): number {
  const matrix = svg.getScreenCTM()
  return matrix ? 8 / Math.hypot(matrix.a, matrix.b) : 10
}
