import {
  getPreviewSize,
  validateDecodedSize,
  validateFileSize,
  validateOutputSize,
  validateSourceSize,
} from './image-headers'
import { ImageBackendUnavailableError } from './image-protocol'
import type { ImageJob, ImageJobResult, ImageProgress, WallpaperPlan } from './image-protocol'
import type { ExportedWallpaper, Rect, Size } from './types'

type ProcessingMode = 'worker' | 'main'
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface DecodedImage extends Size {
  source: ImageBitmap | HTMLImageElement
  dispose: () => void
}

interface Surface {
  context: Context2D
  encode: () => Promise<Blob>
  dispose: () => void
}

const DECODE_ERROR = 'The JPEG or PNG could not be decoded. It may be damaged, unsupported by this browser, or too large for available memory. Try re-saving a smaller image.'
const CANVAS_ERROR = 'The browser could not allocate or encode this image canvas. Try a smaller image or monitor resolution, or close other memory-intensive tabs.'

async function decodeImage(blob: Blob, mode: ProcessingMode): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap
    try {
      // Keep the decoder's oriented dimensions. Applying EXIF rotation again would
      // distort crops. Resizing a preview does not avoid full decoder memory use.
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch (cause) {
      throw new Error(DECODE_ERROR, { cause })
    }
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    }
  }
  if (mode === 'worker') throw new ImageBackendUnavailableError()
  if (typeof document === 'undefined') throw new Error('Image processing requires a browser with canvas support.')

  // HTMLImageElement is the fallback for browsers without createImageBitmap.
  // Modern browsers also apply embedded orientation to its natural dimensions.
  const image = document.createElement('img')
  let url: string | undefined
  const dispose = () => {
    image.onload = null
    image.onerror = null
    image.removeAttribute('src')
    if (url !== undefined) URL.revokeObjectURL(url)
  }
  try {
    url = URL.createObjectURL(blob)
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(DECODE_ERROR))
      image.src = url!
    })
    image.onload = null
    image.onerror = null
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose }
  } catch (cause) {
    dispose()
    throw new Error(DECODE_ERROR, { cause })
  }
}

function createSurface(size: Size, mode: ProcessingMode, probe = false): Surface {
  let canvas: HTMLCanvasElement | OffscreenCanvas | undefined
  const dispose = () => {
    // Drop backing stores immediately instead of waiting for garbage collection.
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
  try {
    if (mode === 'worker') {
      canvas = new OffscreenCanvas(size.width, size.height)
    } else {
      canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
    }
    const context = canvas.getContext('2d') as Context2D | null
    if (!context) throw new Error('A 2D canvas context is unavailable.')
    const target = canvas
    return {
      context,
      dispose,
      encode: async () => {
        try {
          const blob = 'convertToBlob' in target
            ? await target.convertToBlob({ type: 'image/png' })
            : await new Promise<Blob | null>((resolve) => target.toBlob(resolve, 'image/png'))
          if (!blob || blob.size === 0 || blob.type !== 'image/png') throw new Error('PNG encoding failed.')
          return blob
        } catch (cause) {
          throw new Error(CANVAS_ERROR, { cause })
        }
      },
    }
  } catch (cause) {
    dispose()
    if (probe && mode === 'worker') throw new ImageBackendUnavailableError()
    throw new Error(CANVAS_ERROR, { cause })
  }
}

function setBackground(context: Context2D, color: string): void {
  // Invalid canvas colors are silently ignored. Two sentinels distinguish that
  // case from a valid color that happens to equal either sentinel.
  context.fillStyle = '#000000'
  context.fillStyle = color
  const first = context.fillStyle
  context.fillStyle = '#ffffff'
  context.fillStyle = color
  if (first !== context.fillStyle) throw new Error('Choose a valid canvas background color, such as #111827.')
}

function validateCrop(rect: Rect, bounds: Size): void {
  const epsilon = 0.00001
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || rect.x < -epsilon || rect.y < -epsilon
    || rect.x + rect.width > bounds.width + epsilon
    || rect.y + rect.height > bounds.height + epsilon) {
    throw new Error('The image placement produced an invalid crop. Check the image position and monitor dimensions.')
  }
}

function validatePlan(plan: WallpaperPlan, imageSize: Size): void {
  validateOutputSize(plan)
  if (plan.region) {
    validateCrop(plan.region.source, imageSize)
    validateCrop(plan.region.destination, plan)
  }
}

function checkBackend(mode: ProcessingMode): void {
  if (mode === 'worker') {
    if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function'
      || typeof OffscreenCanvas.prototype.convertToBlob !== 'function') {
      throw new ImageBackendUnavailableError()
    }
  } else if (typeof document === 'undefined') {
    throw new Error('Image processing requires a browser with canvas support.')
  }
}

/** One job owns its decoder and canvases. No full-resolution pixels survive a job. */
export async function processImageJob(
  job: ImageJob,
  mode: ProcessingMode,
  onProgress?: ImageProgress,
): Promise<ImageJobResult> {
  validateFileSize(job.file.size)
  validateSourceSize(job.header)
  if (job.kind === 'export') {
    validateSourceSize(job.imageSize)
    job.plans.forEach((plan) => validatePlan(plan, job.imageSize))
  }
  checkBackend(mode)
  const probe = createSurface({ width: 1, height: 1 }, mode, true)
  try {
    if (job.kind === 'export') setBackground(probe.context, job.backgroundColor)
  } finally {
    probe.dispose()
  }

  // Never use the untrusted File.type for a decode URL (in particular, not SVG).
  // Blob.slice changes the media type without retaining an extra decoded copy.
  const decoded = await decodeImage(job.file.slice(0, job.file.size, job.header.mimeType), mode)
  try {
    validateDecodedSize(decoded, job.header)
    if (job.kind === 'preview') {
      const size = getPreviewSize(decoded)
      const surface = createSurface(size, mode)
      try {
        surface.context.imageSmoothingEnabled = true
        surface.context.imageSmoothingQuality = 'high'
        surface.context.drawImage(decoded.source, 0, 0, size.width, size.height)
        return { kind: 'preview', width: decoded.width, height: decoded.height, blob: await surface.encode() }
      } finally {
        surface.dispose()
      }
    }

    if (decoded.width !== job.imageSize.width || decoded.height !== job.imageSize.height) {
      throw new Error('The original image dimensions changed. Load the image again before exporting.')
    }
    const wallpapers: ExportedWallpaper[] = []
    for (const plan of job.plans) {
      const surface = createSurface(plan, mode)
      try {
        const context = surface.context
        setBackground(context, job.backgroundColor)
        context.fillRect(0, 0, plan.width, plan.height)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        if (plan.region) {
          const { source, destination } = plan.region
          context.drawImage(decoded.source,
            source.x, source.y, source.width, source.height,
            destination.x, destination.y, destination.width, destination.height)
        }
        wallpapers.push({
          monitorId: plan.monitorId,
          filename: plan.filename,
          width: plan.width,
          height: plan.height,
          blob: await surface.encode(),
        })
      } finally {
        surface.dispose()
      }
      onProgress?.(wallpapers.length, job.plans.length)
      // Give the UI a paint/input opportunity between main-thread outputs.
      if (mode === 'main' && wallpapers.length < job.plans.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
    return { kind: 'export', wallpapers }
  } finally {
    decoded.dispose()
  }
}
