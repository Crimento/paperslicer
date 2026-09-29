import { describe, expect, it } from 'vitest'
import {
  fitImage,
  getExportRegion,
  getImageRect,
  getLayoutBounds,
  getMonitorRect,
  getMonitorSize,
  getOutputSize,
  scaleImageAtPoint,
  snapRect,
} from './geometry'
import type { ExportRegion, ImageTransform, Monitor, Rect, Size } from './types'

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 'monitor',
    name: '27-inch FHD',
    widthPx: 1920,
    heightPx: 1080,
    diagonalInches: 27,
    rotation: 0,
    x: 0,
    y: 0,
    ...overrides,
  }
}

function expectRectCloseTo(actual: Rect, expected: Rect): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], 9)
  }
}

function expectRegion(actual: ExportRegion | null, expected: ExportRegion): void {
  expect(actual).not.toBeNull()
  expectRectCloseTo(actual!.source, expected.source)
  expectRectCloseTo(actual!.destination, expected.destination)
}

const invalidPositiveNumbers = [0, -1, NaN, Infinity, -Infinity]

describe('physical monitor geometry', () => {
  it('derives millimeters from the diagonal and native aspect, not resolution magnitude', () => {
    const fhd = getMonitorSize(makeMonitor())
    const uhd = getMonitorSize(makeMonitor({ widthPx: 3840, heightPx: 2160 }))
    expect(Math.hypot(fhd.width, fhd.height)).toBeCloseTo(27 * 25.4, 9)
    expect(fhd.width / fhd.height).toBeCloseTo(16 / 9, 9)
    expect(fhd.height).toBeGreaterThan(336)
    expect(fhd.height).toBeLessThan(337)
    expect(uhd).toEqual(fhd)
  })

  it('places 27-inch FHD and 34-inch ultrawide panels at nearly the same physical height', () => {
    const fhd = getMonitorSize(makeMonitor())
    const ultrawide = getMonitorSize(makeMonitor({
      widthPx: 3440,
      heightPx: 1440,
      diagonalInches: 34,
    }))
    // Nominal diagonals make these close, not exactly equal; measured overrides can make them exact.
    expect(Math.abs(fhd.height - ultrawide.height)).toBeLessThan(3)
    expect(ultrawide.width).toBeGreaterThan(fhd.width)
    expect(ultrawide.height / fhd.height).toBeCloseTo(1, 1)
    expect(Math.hypot(ultrawide.width, ultrawide.height)).toBeCloseTo(34 * 25.4, 9)
  })

  it('uses paired active-area measurements independently of diagonal and pixel aspect', () => {
    const monitor = makeMonitor({
      diagonalInches: 0,
      physicalWidthMm: 600,
      physicalHeightMm: 340,
    })
    expect(getMonitorSize(monitor)).toEqual({ width: 600, height: 340 })
    expect(getOutputSize(monitor)).toEqual({ width: 1920, height: 1080 })
    expect(getMonitorSize({ ...monitor, widthPx: 0, heightPx: 0 }))
      .toEqual({ width: 600, height: 340 })
  })

  it.each([{ physicalWidthMm: 123 }, { physicalHeightMm: 456 }])(
    'ignores an incomplete measured override: %o',
    (override) => {
      expect(getMonitorSize(makeMonitor(override))).toEqual(getMonitorSize(makeMonitor()))
    },
  )

  it('swaps derived physical dimensions and native output dimensions for portrait', () => {
    const landscape = getMonitorSize(makeMonitor())
    const monitor = makeMonitor({ rotation: 90 })
    expect(getMonitorSize(monitor)).toEqual({ width: landscape.height, height: landscape.width })
    expect(getOutputSize(monitor)).toEqual({ width: 1080, height: 1920 })
  })

  it('rotates measured dimensions without changing the top-left placement', () => {
    expect(getMonitorRect(makeMonitor({
      physicalWidthMm: 600,
      physicalHeightMm: 340,
      rotation: 90,
      x: -340,
      y: -25,
    }))).toEqual({ x: -340, y: -25, width: 340, height: 600 })
  })

  it.each(invalidPositiveNumbers)('rejects invalid native dimensions and diagonals: %s', (value) => {
    for (const field of ['widthPx', 'heightPx'] as const) {
      const monitor = makeMonitor({ [field]: value })
      expect(() => getMonitorSize(monitor)).toThrow(/monitor native size.*positive finite/)
      expect(() => getOutputSize(monitor)).toThrow(/monitor native size.*positive finite/)
    }
    expect(() => getMonitorSize(makeMonitor({ diagonalInches: value })))
      .toThrow(/monitor.diagonalInches.*positive finite/)
  })

  it.each(invalidPositiveNumbers)('rejects invalid paired measurements: %s', (value) => {
    expect(() => getMonitorSize(makeMonitor({ physicalWidthMm: value, physicalHeightMm: 340 })))
      .toThrow(/monitor physical size.width.*positive finite/)
    expect(() => getMonitorSize(makeMonitor({ physicalWidthMm: 600, physicalHeightMm: value })))
      .toThrow(/monitor physical size.height.*positive finite/)
  })

  it('rejects nonfinite monitor positions', () => {
    expect(() => getMonitorRect(makeMonitor({ x: NaN }))).toThrow(/monitor rectangle.x.*finite/)
    expect(() => getMonitorRect(makeMonitor({ y: Infinity }))).toThrow(/monitor rectangle.y.*finite/)
  })
})

describe('layout bounds', () => {
  it('returns a zero rectangle for an empty layout', () => {
    expect(getLayoutBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('includes negative coordinates, gaps, and rotated monitor extents', () => {
    const monitors = [
      makeMonitor({ x: -650, y: -360, physicalWidthMm: 600, physicalHeightMm: 340 }),
      makeMonitor({ x: 40, y: 10, physicalWidthMm: 500, physicalHeightMm: 300, rotation: 90 }),
    ]
    expect(getLayoutBounds(monitors)).toEqual({ x: -650, y: -360, width: 990, height: 870 })
    expect(getLayoutBounds([...monitors].reverse())).toEqual(getLayoutBounds(monitors))
  })

  it('does not expand a single monitor to include the origin', () => {
    const size = { physicalWidthMm: 600, physicalHeightMm: 340 }
    expect(getLayoutBounds([makeMonitor({ ...size, x: 100, y: 200 })]))
      .toEqual({ x: 100, y: 200, width: 600, height: 340 })
    expect(getLayoutBounds([makeMonitor({ ...size, x: -800, y: -500 })]))
      .toEqual({ x: -800, y: -500, width: 600, height: 340 })
  })
})

describe('image placement', () => {
  const imageSize: Size = { width: 1000, height: 500 }
  const bounds: Rect = { x: -200, y: -100, width: 600, height: 400 }

  it('maps source pixels to millimeters with a uniform scale', () => {
    expect(getImageRect(imageSize, { x: -125, y: 25, scale: 0.25 }))
      .toEqual({ x: -125, y: 25, width: 250, height: 125 })
  })

  it('covers bounds by centering and cropping the excess width', () => {
    const transform = fitImage(imageSize, bounds, 'cover')
    expect(transform).toEqual({ x: -300, y: -100, scale: 0.8 })
    expect(getImageRect(imageSize, transform))
      .toEqual({ x: -300, y: -100, width: 800, height: 400 })
  })

  it('contains the entire image with equal uncovered space above and below', () => {
    const transform = fitImage(imageSize, bounds, 'contain')
    expect(transform).toEqual({ x: -200, y: -50, scale: 0.6 })
    expect(getImageRect(imageSize, transform))
      .toEqual({ x: -200, y: -50, width: 600, height: 300 })
  })

  it('also fits tall images correctly', () => {
    const tall = { width: 500, height: 1000 }
    expect(fitImage(tall, bounds, 'cover')).toEqual({ x: -200, y: -500, scale: 1.2 })
    expect(fitImage(tall, bounds, 'contain')).toEqual({ x: 0, y: -100, scale: 0.4 })
  })

  it.each(['cover', 'contain'] as const)('exact aspect matches have no extra space in %s mode', (mode) => {
    expect(fitImage({ width: 1200, height: 800 }, bounds, mode))
      .toEqual({ x: -200, y: -100, scale: 0.5 })
  })

  it.each([
    { width: 0, height: 100 },
    { width: 100, height: 0 },
    { width: -1, height: 100 },
    { width: NaN, height: 100 },
    { width: 100, height: Infinity },
  ])('rejects invalid source dimensions: %o', (invalidSize) => {
    expect(() => getImageRect(invalidSize, { x: 0, y: 0, scale: 1 })).toThrow(/imageSize.*positive finite/)
    expect(() => fitImage(invalidSize, bounds, 'contain')).toThrow(/imageSize.*positive finite/)
    expect(() => getExportRegion(makeMonitor(), invalidSize, { x: 0, y: 0, scale: 1 }))
      .toThrow(/imageSize.*positive finite/)
  })

  it.each([
    { ...bounds, width: 0 },
    { ...bounds, height: 0 },
    { ...bounds, width: -1 },
    { ...bounds, height: Infinity },
    { ...bounds, x: NaN },
  ])('rejects invalid fitting bounds rather than dividing by zero: %o', (invalidBounds) => {
    expect(() => fitImage(imageSize, invalidBounds, 'cover')).toThrow(/bounds.*finite/)
    expect(() => fitImage(imageSize, invalidBounds, 'contain')).toThrow(/bounds.*finite/)
  })

  it.each<ImageTransform>([
    { x: 0, y: 0, scale: 0 },
    { x: 0, y: 0, scale: -1 },
    { x: 0, y: 0, scale: Infinity },
    { x: 0, y: 0, scale: NaN },
    { x: NaN, y: 0, scale: 1 },
    { x: 0, y: Infinity, scale: 1 },
  ])('rejects invalid transforms consistently: %o', (transform) => {
    expect(() => getImageRect(imageSize, transform)).toThrow(/transform.*finite/)
    expect(() => getExportRegion(makeMonitor(), imageSize, transform)).toThrow(/transform.*finite/)
    expect(() => scaleImageAtPoint(transform, { x: 0, y: 0 }, 1)).toThrow(/transform.*finite/)
  })
})

describe('anchor zoom', () => {
  const transform: ImageTransform = { x: -100, y: 50, scale: 0.5 }
  const anchor = { x: 25, y: -25 }

  it.each([0.1, 0.5, 2])('preserves the source point under an anchor at scale %s', (scale) => {
    const next = scaleImageAtPoint(transform, anchor, scale)
    expect(next.scale).toBe(scale)
    expect((anchor.x - next.x) / next.scale).toBeCloseTo((anchor.x - transform.x) / transform.scale, 9)
    expect((anchor.y - next.y) / next.scale).toBeCloseTo((anchor.y - transform.y) / transform.scale, 9)
  })

  it('returns absolute coordinates, and leaves a top-left anchor stationary', () => {
    expect(scaleImageAtPoint(transform, anchor, 1)).toEqual({ x: -225, y: 125, scale: 1 })
    expect(scaleImageAtPoint(transform, transform, 2)).toEqual({ x: -100, y: 50, scale: 2 })
  })

  it('returns a new unchanged transform for a no-op zoom', () => {
    const next = scaleImageAtPoint(transform, anchor, transform.scale)
    expect(next).toEqual(transform)
    expect(next).not.toBe(transform)
  })

  it.each(invalidPositiveNumbers)('rejects invalid next scales: %s', (scale) => {
    expect(() => scaleImageAtPoint(transform, anchor, scale)).toThrow(/nextScale.*positive finite/)
  })

  it('rejects nonfinite anchor coordinates', () => {
    expect(() => scaleImageAtPoint(transform, { x: Infinity, y: 0 }, 1)).toThrow(/anchor.x.*finite/)
    expect(() => scaleImageAtPoint(transform, { x: 0, y: NaN }, 1)).toThrow(/anchor.y.*finite/)
  })
})

describe('export regions', () => {
  it('maps equal physical panels to equal source crops but different native resolutions', () => {
    const fhd = makeMonitor({ physicalWidthMm: 600, physicalHeightMm: 337.5 })
    const uhd = { ...fhd, id: 'uhd', x: 600, widthPx: 3840, heightPx: 2160 }
    const image = { width: 2400, height: 675 }
    const transform = { x: 0, y: 0, scale: 0.5 }
    expectRegion(getExportRegion(fhd, image, transform), {
      source: { x: 0, y: 0, width: 1200, height: 675 },
      destination: { x: 0, y: 0, width: 1920, height: 1080 },
    })
    expectRegion(getExportRegion(uhd, image, transform), {
      source: { x: 1200, y: 0, width: 1200, height: 675 },
      destination: { x: 0, y: 0, width: 3840, height: 2160 },
    })
  })

  it('keeps measured FHD/ultrawide heights equal while skipping a physical gap at negative coordinates', () => {
    const fhd = makeMonitor({ x: -600, y: -337.5, physicalWidthMm: 600, physicalHeightMm: 337.5 })
    const ultrawide = makeMonitor({
      x: 50,
      y: -337.5,
      diagonalInches: 34,
      widthPx: 3440,
      heightPx: 1440,
      physicalWidthMm: 800,
      physicalHeightMm: 337.5,
    })
    const image = { width: 2900, height: 675 }
    const transform = { x: -600, y: -337.5, scale: 0.5 }
    expectRegion(getExportRegion(fhd, image, transform), {
      source: { x: 0, y: 0, width: 1200, height: 675 },
      destination: { x: 0, y: 0, width: 1920, height: 1080 },
    })
    expectRegion(getExportRegion(ultrawide, image, transform), {
      source: { x: 1300, y: 0, width: 1600, height: 675 },
      destination: { x: 0, y: 0, width: 3440, height: 1440 },
    })
  })

  it('clips a partial intersection in both spaces without stretching over uncovered background', () => {
    const monitor = makeMonitor({
      x: -100,
      y: -50,
      physicalWidthMm: 400,
      physicalHeightMm: 200,
      widthPx: 1600,
      heightPx: 800,
    })
    expectRegion(getExportRegion(monitor, { width: 1200, height: 400 }, { x: 100, y: -100, scale: 0.25 }), {
      source: { x: 0, y: 200, width: 800, height: 200 },
      destination: { x: 800, y: 0, width: 800, height: 200 },
    })
  })

  it('leaves contain-mode margins uncovered', () => {
    const monitor = makeMonitor({ physicalWidthMm: 600, physicalHeightMm: 300, widthPx: 1200, heightPx: 600 })
    const image = { width: 200, height: 200 }
    const transform = fitImage(image, getMonitorRect(monitor), 'contain')
    expectRegion(getExportRegion(monitor, image, transform), {
      source: { x: 0, y: 0, width: 200, height: 200 },
      destination: { x: 300, y: 0, width: 600, height: 600 },
    })
  })

  it('crops cover-mode source pixels while filling the entire output', () => {
    const monitor = makeMonitor({ x: -100, y: -50, physicalWidthMm: 400, physicalHeightMm: 200, widthPx: 1600, heightPx: 800 })
    const image = { width: 400, height: 400 }
    const transform = fitImage(image, getMonitorRect(monitor), 'cover')
    expectRegion(getExportRegion(monitor, image, transform), {
      source: { x: 0, y: 100, width: 400, height: 200 },
      destination: { x: 0, y: 0, width: 1600, height: 800 },
    })
  })

  it('uses oriented output axes for portrait monitors without rotating source pixels', () => {
    const monitor = makeMonitor({
      x: -100,
      y: 20,
      physicalWidthMm: 400,
      physicalHeightMm: 200,
      widthPx: 1600,
      heightPx: 800,
      rotation: 90,
    })
    expectRegion(getExportRegion(monitor, { width: 400, height: 800 }, { x: -50, y: 120, scale: 0.25 }), {
      source: { x: 0, y: 0, width: 400, height: 800 },
      destination: { x: 200, y: 400, width: 400, height: 800 },
    })
  })

  it('retains fractional source and destination coordinates rather than rounding', () => {
    const monitor = makeMonitor({ physicalWidthMm: 100, physicalHeightMm: 100, widthPx: 300, heightPx: 200 })
    expectRegion(getExportRegion(monitor, { width: 100, height: 100 }, { x: 0.5, y: 0.25, scale: 2.5 }), {
      source: { x: 0, y: 0, width: 39.8, height: 39.9 },
      destination: { x: 1.5, y: 0.5, width: 298.5, height: 199.5 },
    })
  })

  it.each([
    { x: 200, y: 0 },
    { x: -200, y: 0 },
    { x: 0, y: 200 },
    { x: 0, y: -200 },
    { x: 100, y: 0 },
    { x: -100, y: 0 },
    { x: 0, y: 100 },
    { x: 0, y: -100 },
    { x: 100, y: 100 },
  ])('returns null for separated rectangles or touching edges/corners: %o', (position) => {
    const monitor = makeMonitor({ physicalWidthMm: 100, physicalHeightMm: 100 })
    expect(getExportRegion(monitor, { width: 100, height: 100 }, { ...position, scale: 1 })).toBeNull()
  })

  it('rejects zero native output dimensions even when physical measurements are available', () => {
    const monitor = makeMonitor({ physicalWidthMm: 100, physicalHeightMm: 100, widthPx: 0 })
    expect(() => getExportRegion(monitor, { width: 100, height: 100 }, { x: 0, y: 0, scale: 1 }))
      .toThrow(/monitor native size.width.*positive finite/)
  })
})

describe('snapping', () => {
  const target: Rect = { x: 0, y: 0, width: 100, height: 100 }

  it('snaps adjacent edges on independent axes and reports absolute positions and fixed guides', () => {
    expect(snapRect({ x: 96, y: 104, width: 50, height: 40 }, [
      { x: 0, y: 250, width: 100, height: 20 },
      { x: 300, y: 150, width: 30, height: 40 },
    ], 6)).toEqual({
      x: 100,
      y: 110,
      guides: [{ axis: 'x', position: 100 }, { axis: 'y', position: 150 }],
    })
  })

  it('aligns matching far edges with negative coordinates', () => {
    expect(snapRect({ x: -46, y: -164, width: 50, height: 40 }, [
      { x: -100, y: -200, width: 100, height: 80 },
    ], 5)).toEqual({
      x: -50,
      y: -160,
      guides: [{ axis: 'x', position: 0 }, { axis: 'y', position: -120 }],
    })
  })

  it('aligns matching centers, placing guides on the fixed target center', () => {
    expect(snapRect({ x: 39, y: 28, width: 40, height: 20 }, [
      { x: 10, y: 0, width: 100, height: 80 },
    ], 3)).toEqual({
      x: 40,
      y: 30,
      guides: [{ axis: 'x', position: 60 }, { axis: 'y', position: 40 }],
    })
  })

  it('chooses the nearest target, not the first target within the threshold', () => {
    expect(snapRect({ x: 104, y: 500, width: 10, height: 10 }, [
      target,
      { x: 107, y: 100, width: 100, height: 100 },
    ], 5)).toEqual({ x: 107, y: 500, guides: [{ axis: 'x', position: 107 }] })
  })

  it('chooses a closer center over an edge that is also within the threshold', () => {
    expect(snapRect({ x: 40, y: 500, width: 24, height: 10 }, [target], 50))
      .toEqual({ x: 38, y: 500, guides: [{ axis: 'x', position: 50 }] })
  })

  it.each([{ x: 49, width: 10 }, { x: 95, width: 8 }])(
    'does not confuse edge-to-center or center-to-edge proximity with matching alignment: %o',
    ({ x, width }) => {
      expect(snapRect({ x, y: 500, width, height: 10 }, [target], 2))
        .toEqual({ x, y: 500, guides: [] })
    },
  )

  it('uses an inclusive threshold, including exact alignment at threshold zero', () => {
    const moving = { x: 106, y: 500, width: 20, height: 20 }
    const snapped = { x: 100, y: 500, guides: [{ axis: 'x', position: 100 }] }
    expect(snapRect(moving, [target], 6)).toEqual(snapped)
    expect(snapRect(moving, [target], 5.99)).toEqual({ x: 106, y: 500, guides: [] })
    expect(snapRect({ ...moving, x: 100 }, [target], 0)).toEqual(snapped)
  })

  it('breaks equal-distance ties consistently using target order', () => {
    const moving = { x: 100, y: 500, width: 10, height: 10 }
    const left = { ...target, width: 98 }
    const right = { ...target, x: 102 }
    expect(snapRect(moving, [left, right], 2).x).toBe(98)
    expect(snapRect(moving, [right, left], 2).x).toBe(102)
  })

  it('leaves an unmatched position unchanged and allows empty rectangles', () => {
    expect(snapRect({ x: -20, y: 30, width: 0, height: 0 }, [], 5))
      .toEqual({ x: -20, y: 30, guides: [] })
    expect(snapRect({ x: -20, y: 30, width: 0, height: 0 }, [{ x: -18, y: 32, width: 0, height: 0 }], 2))
      .toEqual({ x: -18, y: 32, guides: [{ axis: 'x', position: -18 }, { axis: 'y', position: 32 }] })
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid thresholds: %s', (threshold) => {
    expect(() => snapRect(target, [], threshold)).toThrow(/threshold.*non-negative finite/)
  })

  it('rejects invalid moving and target rectangles', () => {
    expect(() => snapRect({ ...target, x: NaN }, [], 5)).toThrow(/moving rectangle.x.*finite/)
    expect(() => snapRect({ ...target, width: -1 }, [], 5)).toThrow(/moving rectangle.width.*non-negative finite/)
    expect(() => snapRect(target, [{ ...target, height: Infinity }], 5)).toThrow(/targets\[0\].height.*finite/)
  })
})

describe('numeric safety and purity', () => {
  it('rejects arithmetic overflow rather than returning nonfinite geometry', () => {
    expect(() => getMonitorSize(makeMonitor({ diagonalInches: Number.MAX_VALUE }))).toThrow(RangeError)
    expect(() => getImageRect({ width: 2, height: 2 }, { x: 0, y: 0, scale: Number.MAX_VALUE }))
      .toThrow(RangeError)
    expect(() => fitImage({ width: Number.MIN_VALUE, height: 1 }, { x: 0, y: 0, width: 100, height: 100 }, 'cover'))
      .toThrow(RangeError)
    expect(() => scaleImageAtPoint({ x: 1, y: 2, scale: Number.MIN_VALUE }, { x: 0, y: 0 }, 1))
      .toThrow(RangeError)
    expect(() => getLayoutBounds([
      makeMonitor({ x: -Number.MAX_VALUE, physicalWidthMm: 1, physicalHeightMm: 1 }),
      makeMonitor({ x: Number.MAX_VALUE, physicalWidthMm: 1, physicalHeightMm: 1 }),
    ])).toThrow(RangeError)
  })

  it('does not mutate monitors, images, transforms, anchors, rectangles, or target arrays', () => {
    const monitor = Object.freeze(makeMonitor({ physicalWidthMm: 600, physicalHeightMm: 340 }))
    const monitors = [monitor]
    Object.freeze(monitors)
    const image = Object.freeze({ width: 1000, height: 500 })
    const transform = Object.freeze({ x: -10, y: -20, scale: 0.5 })
    const anchor = Object.freeze({ x: 100, y: 100 })
    const moving = Object.freeze({ x: 95, y: 105, width: 100, height: 100 })
    const targets = [Object.freeze({ x: 0, y: 0, width: 100, height: 100 })]
    Object.freeze(targets)

    expect(() => {
      getMonitorSize(monitor)
      getMonitorRect(monitor)
      getOutputSize(monitor)
      getLayoutBounds(monitors)
      getImageRect(image, transform)
      fitImage(image, moving, 'cover')
      scaleImageAtPoint(transform, anchor, 1)
      getExportRegion(monitor, image, transform)
      snapRect(moving, targets, 10)
    }).not.toThrow()
  })
})
