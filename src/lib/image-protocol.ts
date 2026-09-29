import type { ImageHeader } from './image-headers'
import type { ExportedWallpaper, ExportRegion, Size } from './types'

export interface WallpaperPlan extends Size {
  monitorId: string
  filename: string
  region: ExportRegion | null
}

export type ImageJob = {
  kind: 'preview'
  file: File
  header: ImageHeader
} | {
  kind: 'export'
  file: File
  header: ImageHeader
  imageSize: Size
  plans: WallpaperPlan[]
  backgroundColor: string
}

export type ImageJobResult = {
  kind: 'preview'
  width: number
  height: number
  blob: Blob
} | {
  kind: 'export'
  wallpapers: ExportedWallpaper[]
}

export type ImageProgress = (completed: number, total: number) => void

export type ImageWorkerMessage =
  | { kind: 'ready' }
  | { kind: 'progress'; completed: number; total: number }
  | { kind: 'result'; result: ImageJobResult }
  | { kind: 'error'; message: string; unavailable: boolean }

export class ImageBackendUnavailableError extends Error {
  constructor(message = 'Background image processing is unavailable in this browser.') {
    super(message)
    this.name = 'ImageBackendUnavailableError'
  }
}
