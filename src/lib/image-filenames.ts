import type { Size } from './types'

/** Portable ASCII names: no paths, control characters, hidden files, or device names. */
export function sanitizeFilenamePart(value: string, fallback = 'wallpaper'): string {
  const sanitize = (text: string) => text.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64)
    .replace(/[-_]+$/g, '')
  const name = sanitize(value) || sanitize(fallback) || 'wallpaper'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `_${name}` : name
}

export function createWallpaperFilenames(
  imageName: string,
  monitors: (Size & { name: string })[],
): string[] {
  const image = sanitizeFilenamePart(imageName.replace(/\.(jpe?g|png)$/i, ''), 'image')
  const used = new Set<string>()
  return monitors.map((monitor) => {
    const name = sanitizeFilenamePart(monitor.name, 'monitor')
    const stem = `${image}-${name}-${monitor.width}x${monitor.height}`
    let filename = `${stem}.png`
    let suffix = 2
    // Also avoid collisions on case-insensitive filesystems and after sanitizing.
    while (used.has(filename.toLowerCase())) filename = `${stem}-${suffix++}.png`
    used.add(filename.toLowerCase())
    return filename
  })
}
