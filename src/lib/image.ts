import { getExportRegion, getOutputSize } from './geometry'
import { createWallpaperFilenames } from './image-filenames'
import { readImageHeader, validateOutputSize, validateSourceSize } from './image-headers'
import { processImageJob } from './image-processing'
import { ImageBackendUnavailableError } from './image-protocol'
import type { ImageJob, ImageJobResult, ImageProgress, ImageWorkerMessage } from './image-protocol'
import type { ExportedWallpaper, ImageAsset, ImageTransform, Monitor } from './types'

async function runWorkerJob(job: ImageJob, onProgress?: ImageProgress): Promise<ImageJobResult> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    throw new ImageBackendUnavailableError()
  }

  let startupTimer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<ImageJobResult>((resolve, reject) => {
      let started = false
      startupTimer = setTimeout(() => reject(new ImageBackendUnavailableError()), 10_000)
      worker.onmessage = (event: MessageEvent<ImageWorkerMessage>) => {
        const message = event.data
        try {
          switch (message.kind) {
            case 'ready':
              if (started) return
              clearTimeout(startupTimer)
              started = true
              try {
                worker.postMessage(job)
              } catch {
                reject(new ImageBackendUnavailableError())
              }
              break
            case 'progress':
              onProgress?.(message.completed, message.total)
              break
            case 'result':
              resolve(message.result)
              break
            case 'error':
              reject(message.unavailable
                ? new ImageBackendUnavailableError(message.message)
                : new Error(message.message))
              break
          }
        } catch (error) {
          reject(error)
        }
      }
      worker.onerror = (event) => {
        event.preventDefault()
        reject(started
          ? new Error('Background image processing stopped unexpectedly. The browser may be out of memory; try a smaller image or monitor resolution.')
          : new ImageBackendUnavailableError())
      }
      worker.onmessageerror = () => reject(started
        ? new Error('The browser could not receive the processed image. Please try again.')
        : new ImageBackendUnavailableError())
    })
  } finally {
    clearTimeout(startupTimer)
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  }
}

async function runImageJob(job: ImageJob, onProgress?: ImageProgress): Promise<ImageJobResult> {
  if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
    try {
      return await runWorkerJob(job, onProgress)
    } catch (error) {
      // Only capability/startup failures are retried. Corruption or memory errors
      // must not trigger a second full-resolution decode on the main thread.
      if (!(error instanceof ImageBackendUnavailableError)) throw error
    }
  }
  return processImageJob(job, 'main', onProgress)
}

/**
 * Keeps the original File plus a PNG preview with a maximum side of 2048 pixels.
 * Width/height are the original, browser-oriented dimensions, not preview size.
 * Header limits reduce risk; even a small preview can require a full-size decode.
 */
export async function loadImage(file: File): Promise<ImageAsset> {
  const header = await readImageHeader(file)
  const result = await runImageJob({ kind: 'preview', file, header })
  if (result.kind !== 'preview') throw new Error('The browser returned an unexpected image preview.')

  const previewUrl = URL.createObjectURL(result.blob)
  try {
    return { file, name: file.name, width: result.width, height: result.height, previewUrl }
  } catch (error) {
    URL.revokeObjectURL(previewUrl)
    throw error
  }
}

/** Release a replaced, discarded, or unmounted preview. Export still uses asset.file. */
export function disposeImage(asset: ImageAsset): void {
  URL.revokeObjectURL(asset.previewUrl)
}

/**
 * Exports sequentially at each monitor's native output size, using the ORIGINAL
 * file, never the preview. Progress starts at (0, total), then advances per PNG.
 */
export async function exportWallpapers(
  asset: ImageAsset,
  monitors: Monitor[],
  transform: ImageTransform,
  backgroundColor: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<ExportedWallpaper[]> {
  validateSourceSize(asset)
  if (![transform.x, transform.y, transform.scale].every(Number.isFinite) || transform.scale <= 0) {
    throw new Error('Image position must be finite and image scale must be greater than zero.')
  }
  if (typeof backgroundColor !== 'string' || !backgroundColor.trim()) {
    throw new Error('Choose a valid wallpaper background color.')
  }

  // Snapshot geometry before awaiting file IO: subsequent dragging in the UI
  // must not change a running export or disagree with its filenames.
  const imageSize = { width: asset.width, height: asset.height }
  const outputs = monitors.map((monitor) => {
    validateOutputSize({ width: monitor.widthPx, height: monitor.heightPx })
    const size = getOutputSize(monitor)
    validateOutputSize(size)
    return { ...size, name: monitor.name, monitorId: monitor.id, region: getExportRegion(monitor, imageSize, transform) }
  })
  const filenames = createWallpaperFilenames(asset.name, outputs)
  const plans = outputs.map((output, index) => ({ ...output, filename: filenames[index]! }))
  onProgress?.(0, plans.length)
  if (plans.length === 0) return []

  const header = await readImageHeader(asset.file)
  const result = await runImageJob({ kind: 'export', file: asset.file, header, imageSize, plans, backgroundColor }, onProgress)
  if (result.kind !== 'export') throw new Error('The browser returned an unexpected wallpaper result.')
  return result.wallpapers
}
