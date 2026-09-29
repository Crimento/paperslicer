import { describe, expect, it } from 'vitest'
import { createWallpaperFilenames, sanitizeFilenamePart } from './image-filenames'

describe('safe wallpaper filenames', () => {
  it('removes paths, control characters, punctuation, and leading dots', () => {
    expect(sanitizeFilenamePart('../../My: display\\bad\u0000name?')).toBe('My-display-bad-name')
    expect(sanitizeFilenamePart('.hidden')).toBe('hidden')
    expect(sanitizeFilenamePart('   ')).toBe('wallpaper')
    expect(sanitizeFilenamePart('🖥️', 'monitor')).toBe('monitor')
    expect(sanitizeFilenamePart('', '../unsafe/name')).toBe('unsafe-name')
    expect(sanitizeFilenamePart('', '')).toBe('wallpaper')
  })

  it('normalizes accents, bounds length, and avoids Windows device names', () => {
    expect(sanitizeFilenamePart('Café')).toBe('Cafe')
    expect(sanitizeFilenamePart('CON')).toBe('_CON')
    expect(sanitizeFilenamePart('lpt1')).toBe('_lpt1')
    expect(sanitizeFilenamePart('a'.repeat(300))).toHaveLength(64)
  })

  it('makes case-insensitive collisions unique and always writes a PNG extension', () => {
    const names = createWallpaperFilenames('../Photo.JPEG', [
      { name: 'Desk / left', width: 3840, height: 2160 },
      { name: 'desk : LEFT', width: 3840, height: 2160 },
      { name: 'Desk / left', width: 3840, height: 2160 },
      { name: 'portrait', width: 2160, height: 3840 },
    ])
    expect(names).toEqual([
      'Photo-Desk-left-3840x2160.png',
      'Photo-desk-LEFT-3840x2160-2.png',
      'Photo-Desk-left-3840x2160-3.png',
      'Photo-portrait-2160x3840.png',
    ])
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length)
  })

  it('uses useful fallback names and tolerates collisions after truncation', () => {
    expect(createWallpaperFilenames('.png', [{ name: '', width: 1920, height: 1080 }]))
      .toEqual(['image-monitor-1920x1080.png'])
    const prefix = 'long'.repeat(100)
    const names = createWallpaperFilenames(prefix, [
      { name: `${prefix}a`, width: 1, height: 1 },
      { name: `${prefix}b`, width: 1, height: 1 },
    ])
    expect(names[0]).not.toBe(names[1])
    expect(names.every((name) => name.length < 200)).toBe(true)
  })
})
