import { getMonitorSize } from './geometry'
import { validateOutputSize } from './image-headers'
import type { Monitor } from './types'

export const SETTINGS_KEY = 'paperslicer.settings.v1'
export const MAX_MONITORS = 8
export const MONITOR_COLORS = ['#87baf5', '#b7a1ef', '#88d9b4', '#edb785', '#ef99ad', '#86d6df', '#ddd28f', '#abaef2']

export interface Settings {
  version: 1
  monitors: Monitor[]
  backgroundColor: string
  snapping: boolean
}

export function defaultSettings(): Settings {
  const first: Monitor = {
    id: 'monitor-1', name: 'Full HD', widthPx: 1920, heightPx: 1080,
    diagonalInches: 27, rotation: 0, x: 0, y: 0,
  }
  const second: Monitor = {
    id: 'monitor-2', name: 'Ultrawide', widthPx: 3440, heightPx: 1440,
    diagonalInches: 34, rotation: 0, x: 0, y: 0,
  }
  const a = getMonitorSize(first)
  const b = getMonitorSize(second)
  second.x = a.width + 18
  second.y = (a.height - b.height) / 2
  return { version: 1, monitors: [first, second], backgroundColor: '#11161d', snapping: true }
}

export function isValidMonitor(value: unknown): value is Monitor {
  if (!value || typeof value !== 'object') return false
  const monitor = value as Monitor
  if (typeof monitor.id !== 'string' || !monitor.id || monitor.id.length > 100) return false
  if (typeof monitor.name !== 'string' || !monitor.name.trim() || monitor.name.length > 60) return false
  if (!Number.isFinite(monitor.diagonalInches) || monitor.diagonalInches < 1 || monitor.diagonalInches > 150) return false
  if (monitor.rotation !== 0 && monitor.rotation !== 90) return false
  if (![monitor.x, monitor.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 10000)) return false
  const measured = [monitor.physicalWidthMm, monitor.physicalHeightMm]
  if (measured.some((n) => n !== undefined) && !measured.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 10 && n <= 4000)) return false
  try {
    validateOutputSize({ width: monitor.widthPx, height: monitor.heightPx })
    getMonitorSize(monitor)
    return true
  } catch {
    return false
  }
}

export function parseSettings(raw: string): Settings | null {
  try {
    const value = JSON.parse(raw) as Settings
    if (!value || value.version !== 1 || !Array.isArray(value.monitors)) return null
    if (value.monitors.length < 1 || value.monitors.length > MAX_MONITORS) return null
    if (!value.monitors.every(isValidMonitor)) return null
    if (new Set(value.monitors.map((m) => m.id)).size !== value.monitors.length) return null
    if (typeof value.backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.backgroundColor)) return null
    if (typeof value.snapping !== 'boolean') return null
    return { version: 1, monitors: value.monitors, backgroundColor: value.backgroundColor, snapping: value.snapping }
  } catch {
    return null
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY) ?? '') ?? defaultSettings()
  } catch {
    return defaultSettings()
  }
}
