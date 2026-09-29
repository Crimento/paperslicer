import type { ExportRegion, Guide, ImageTransform, Monitor, Point, Rect, Size } from './types'

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`)
  }
}

function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`)
  }
}

function requireNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`)
  }
}

function validatePoint(point: Point, name: string): void {
  requireFinite(point.x, `${name}.x`)
  requireFinite(point.y, `${name}.y`)
}

function validateSize(size: Size, name: string): void {
  requirePositive(size.width, `${name}.width`)
  requirePositive(size.height, `${name}.height`)
}

function validateRect(rect: Rect, name: string, allowEmpty = false): void {
  validatePoint(rect, name)
  if (allowEmpty) {
    requireNonNegative(rect.width, `${name}.width`)
    requireNonNegative(rect.height, `${name}.height`)
  } else {
    validateSize(rect, name)
  }
  requireFinite(rect.x + rect.width, `${name} right edge`)
  requireFinite(rect.y + rect.height, `${name} bottom edge`)
}

function validateTransform(transform: ImageTransform): void {
  validatePoint(transform, 'transform')
  requirePositive(transform.scale, 'transform.scale')
}

function rotateSize(size: Size, rotation: Monitor['rotation']): Size {
  if (rotation === 90) return { width: size.height, height: size.width }
  if (rotation !== 0) throw new RangeError('monitor.rotation must be 0 or 90')
  return size
}

/** Active-area size in millimeters, after rotation. A measured override requires both dimensions. */
export function getMonitorSize(monitor: Monitor): Size {
  let size: Size
  if (monitor.physicalWidthMm !== undefined && monitor.physicalHeightMm !== undefined) {
    size = { width: monitor.physicalWidthMm, height: monitor.physicalHeightMm }
  } else {
    validateSize({ width: monitor.widthPx, height: monitor.heightPx }, 'monitor native size')
    requirePositive(monitor.diagonalInches, 'monitor.diagonalInches')
    const diagonalMm = monitor.diagonalInches * 25.4
    const diagonalPx = Math.hypot(monitor.widthPx, monitor.heightPx)
    size = {
      width: diagonalMm * (monitor.widthPx / diagonalPx),
      height: diagonalMm * (monitor.heightPx / diagonalPx),
    }
  }
  validateSize(size, 'monitor physical size')
  return rotateSize(size, monitor.rotation)
}

/** Monitor placement and active area in millimeters; x/y are its oriented top-left corner. */
export function getMonitorRect(monitor: Monitor): Rect {
  const rect = { x: monitor.x, y: monitor.y, ...getMonitorSize(monitor) }
  validateRect(rect, 'monitor rectangle')
  return rect
}

/** Output pixels are oriented to match the physical rectangle, not the unrotated native panel. */
export function getOutputSize(monitor: Monitor): Size {
  const size = { width: monitor.widthPx, height: monitor.heightPx }
  validateSize(size, 'monitor native size')
  return rotateSize(size, monitor.rotation)
}

/** Includes gaps between monitors, without forcing the origin into the bounds. */
export function getLayoutBounds(monitors: Monitor[]): Rect {
  if (monitors.length === 0) return { x: 0, y: 0, width: 0, height: 0 }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const monitor of monitors) {
    const rect = getMonitorRect(monitor)
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  const bounds = { x: left, y: top, width: right - left, height: bottom - top }
  validateRect(bounds, 'layout bounds')
  return bounds
}

/** Converts original image pixels to a physical rectangle using uniform mm/source-pixel scale. */
export function getImageRect(imageSize: Size, transform: ImageTransform): Rect {
  validateSize(imageSize, 'imageSize')
  validateTransform(transform)
  const rect = {
    x: transform.x,
    y: transform.y,
    width: imageSize.width * transform.scale,
    height: imageSize.height * transform.scale,
  }
  validateRect(rect, 'image rectangle')
  return rect
}

/** Centers the image in nonempty bounds. Cover crops; contain can leave uncovered background. */
export function fitImage(
  imageSize: Size,
  bounds: Rect,
  mode: 'cover' | 'contain',
): ImageTransform {
  validateSize(imageSize, 'imageSize')
  validateRect(bounds, 'bounds')
  const scaleX = bounds.width / imageSize.width
  const scaleY = bounds.height / imageSize.height
  const scale = mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  const image = getImageRect(imageSize, { x: 0, y: 0, scale })
  const transform = {
    x: bounds.x + (bounds.width - image.width) / 2,
    y: bounds.y + (bounds.height - image.height) / 2,
    scale,
  }
  validateTransform(transform)
  return transform
}

/** Changes scale while keeping the source-image point under the physical anchor stationary. */
export function scaleImageAtPoint(
  transform: ImageTransform,
  anchor: Point,
  nextScale: number,
): ImageTransform {
  validateTransform(transform)
  validatePoint(anchor, 'anchor')
  requirePositive(nextScale, 'nextScale')
  if (nextScale === transform.scale) return { ...transform }

  const ratio = nextScale / transform.scale
  const next = {
    x: anchor.x - (anchor.x - transform.x) * ratio,
    y: anchor.y - (anchor.y - transform.y) * ratio,
    scale: nextScale,
  }
  validateTransform(next)
  return next
}

/**
 * Clips in physical space, then maps to original source pixels and monitor-local output pixels.
 * Coordinates remain fractional. Uncovered output is left to the caller; touching edges return null.
 */
export function getExportRegion(
  monitor: Monitor,
  imageSize: Size,
  transform: ImageTransform,
): ExportRegion | null {
  const panel = getMonitorRect(monitor)
  const output = getOutputSize(monitor)
  const image = getImageRect(imageSize, transform)
  const left = Math.max(panel.x, image.x)
  const top = Math.max(panel.y, image.y)
  const right = Math.min(panel.x + panel.width, image.x + image.width)
  const bottom = Math.min(panel.y + panel.height, image.y + image.height)
  if (right <= left || bottom <= top) return null

  const width = right - left
  const height = bottom - top
  const source = {
    x: (left - image.x) / transform.scale,
    y: (top - image.y) / transform.scale,
    width: width / transform.scale,
    height: height / transform.scale,
  }
  const destination = {
    x: ((left - panel.x) / panel.width) * output.width,
    y: ((top - panel.y) / panel.height) * output.height,
    width: (width / panel.width) * output.width,
    height: (height / panel.height) * output.height,
  }
  validateRect(source, 'export source')
  validateRect(destination, 'export destination')
  return { source, destination }
}

function snapAxis(
  moving: Rect,
  targets: Rect[],
  axis: Guide['axis'],
  threshold: number,
): { position: number; guide: Guide | null } {
  const dimension = axis === 'x' ? 'width' : 'height'
  const start = moving[axis]
  const length = moving[dimension]
  let bestDelta: number | undefined
  let guide: Guide | null = null

  const consider = (from: number, to: number): void => {
    const delta = to - from
    if (Math.abs(delta) > threshold) return
    if (bestDelta === undefined || Math.abs(delta) < Math.abs(bestDelta)) {
      bestDelta = delta
      guide = { axis, position: to }
    }
  }

  for (const target of targets) {
    const targetStart = target[axis]
    const targetLength = target[dimension]
    consider(start, targetStart)
    consider(start, targetStart + targetLength)
    consider(start + length, targetStart)
    consider(start + length, targetStart + targetLength)
    // Centers only match centers: snapping an edge to a center tends to obscure useful alignments.
    consider(start + length / 2, targetStart + targetLength / 2)
  }
  return { position: start + (bestDelta ?? 0), guide }
}

/**
 * Returns an absolute proposed position, with at most one fixed-target guide per axis.
 * Threshold is inclusive, in the same units as the rectangles (normally mm). Ties retain the first
 * target/candidate; edges are considered before centers. Empty rectangles are allowed for snapping.
 */
export function snapRect(
  moving: Rect,
  targets: Rect[],
  threshold: number,
): { x: number; y: number; guides: Guide[] } {
  validateRect(moving, 'moving rectangle', true)
  targets.forEach((target, index) => validateRect(target, `targets[${index}]`, true))
  requireNonNegative(threshold, 'threshold')
  const x = snapAxis(moving, targets, 'x', threshold)
  const y = snapAxis(moving, targets, 'y', threshold)
  const guides: Guide[] = []
  if (x.guide) guides.push(x.guide)
  if (y.guide) guides.push(y.guide)
  validateRect({ ...moving, x: x.position, y: y.position }, 'snapped rectangle', true)
  return { x: x.position, y: y.position, guides }
}
