import { describe, expect, it } from 'vitest'
import { defaultSettings, isValidMonitor, MAX_MONITORS, parseSettings } from './settings'

describe('monitor settings', () => {
  it('starts with the requested mixed-density pair and a bezel gap', () => {
    const settings = defaultSettings()
    expect(settings.monitors.map((m) => [m.diagonalInches, m.widthPx, m.heightPx])).toEqual([[27, 1920, 1080], [34, 3440, 1440]])
    expect(settings.monitors.every(isValidMonitor)).toBe(true)
    expect(parseSettings(JSON.stringify(settings))).toEqual(settings)
  })

  it('returns independent default objects', () => {
    const settings = defaultSettings()
    settings.monitors[0]!.name = 'changed'
    expect(defaultSettings().monitors[0]!.name).toBe('Full HD')
  })

  it.each(['', '{', 'null', '[]', '{"version":2}'])('rejects invalid persisted JSON: %s', (raw) => {
    expect(parseSettings(raw)).toBeNull()
  })

  it('rejects duplicate IDs and empty or excessive lists', () => {
    const settings = defaultSettings()
    settings.monitors[1]!.id = settings.monitors[0]!.id
    expect(parseSettings(JSON.stringify(settings))).toBeNull()
    settings.monitors = []
    expect(parseSettings(JSON.stringify(settings))).toBeNull()
    settings.monitors = Array.from({ length: MAX_MONITORS + 1 }, (_, i) => ({ ...defaultSettings().monitors[0]!, id: String(i) }))
    expect(parseSettings(JSON.stringify(settings))).toBeNull()
  })

  it.each([
    { widthPx: 0 }, { widthPx: 1.5 }, { widthPx: '1920' }, { widthPx: 16385 },
    { widthPx: 10000, heightPx: 10000 }, { heightPx: NaN }, { diagonalInches: 0 },
    { diagonalInches: Infinity }, { rotation: 45 }, { x: Infinity }, { y: -10001 },
    { name: ' ' }, { id: '' }, { physicalWidthMm: 500 },
    { physicalWidthMm: 0, physicalHeightMm: 300 },
  ])('rejects unsafe monitor values: %j', (patch) => {
    expect(isValidMonitor({ ...defaultSettings().monitors[0], ...patch })).toBe(false)
  })

  it('accepts measured portrait monitors at negative coordinates', () => {
    expect(isValidMonitor({ ...defaultSettings().monitors[0], rotation: 90, x: -500, y: -100, physicalWidthMm: 600, physicalHeightMm: 340 })).toBe(true)
  })

  it('rejects arbitrary CSS colors and invalid snapping values', () => {
    expect(parseSettings(JSON.stringify({ ...defaultSettings(), backgroundColor: 'url(https://example.com)' }))).toBeNull()
    expect(parseSettings(JSON.stringify({ ...defaultSettings(), snapping: 'true' }))).toBeNull()
  })
})
