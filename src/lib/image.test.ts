import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeImage, exportWallpapers, loadImage } from './image'
import { IMAGE_LIMITS } from './image-headers'
import { processImageJob } from './image-processing'
import type { ImageJob, ImageJobResult, ImageWorkerMessage } from './image-protocol'
import type { ImageAsset, Monitor } from './types'

vi.mock('./image-processing', () => ({ processImageJob: vi.fn() }))

// A real, tiny PNG; its extension and claimed MIME type deliberately disagree.
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='), (char) => char.charCodeAt(0))
const file = new File([png], 'original.jpeg', { type: 'text/plain' })
const preview: ImageJobResult = { kind: 'preview', width: 1, height: 1, blob: new Blob(['preview'], { type: 'image/png' }) }
const asset: ImageAsset = { file, name: file.name, width: 1, height: 1, previewUrl: 'blob:preview' }
const transform = { x: 0, y: 0, scale: 100 }

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 'one', name: 'Desk / display', widthPx: 1920, heightPx: 1080, diagonalInches: 24,
    rotation: 0, x: 0, y: 0, physicalWidthMm: 100, physicalHeightMm: 100,
    ...overrides,
  }
}

function installWorker(messages: ImageWorkerMessage[], startupError = false) {
  const instances: StubWorker[] = []
  class StubWorker {
    onmessage: ((event: MessageEvent<ImageWorkerMessage>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    onmessageerror: (() => void) | null = null
    terminate = vi.fn()
    postMessage = vi.fn((_job: ImageJob) => {
      queueMicrotask(() => {
        for (const message of messages) this.onmessage?.({ data: message } as MessageEvent<ImageWorkerMessage>)
      })
    })
    constructor(public url: URL, public options: WorkerOptions) {
      instances.push(this)
      queueMicrotask(() => {
        if (startupError) this.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent)
        else this.onmessage?.({ data: { kind: 'ready' } } as MessageEvent<ImageWorkerMessage>)
      })
    }
  }
  vi.stubGlobal('Worker', StubWorker)
  vi.stubGlobal('OffscreenCanvas', class {})
  return instances
}

beforeEach(() => {
  vi.mocked(processImageJob).mockReset().mockResolvedValue(preview)
  vi.stubGlobal('Worker', undefined)
  vi.stubGlobal('OffscreenCanvas', undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('loadImage and disposeImage', () => {
  it('keeps the original File, obtains a downsampled preview URL, and supports explicit disposal', async () => {
    const loaded = await loadImage(file)
    expect(loaded).toEqual(asset)
    expect(loaded.file).toBe(file)
    expect(processImageJob).toHaveBeenCalledWith({ kind: 'preview', file, header: { width: 1, height: 1, mimeType: 'image/png' } }, 'main', undefined)
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(preview.blob)
    disposeImage(loaded)
    disposeImage(loaded)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(loaded.previewUrl)
  })

  it('uses a dedicated module worker and always terminates it', async () => {
    const workers = installWorker([{ kind: 'result', result: preview }])
    expect(await loadImage(file)).toEqual(asset)
    expect(workers[0]!.url.pathname).toMatch(/\/image\.worker\.ts$/)
    expect(workers[0]!.options).toEqual({ type: 'module' })
    expect(workers[0]!.postMessage.mock.calls[0]![0]).toMatchObject({ kind: 'preview', file })
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(workers[0]!.onmessage).toBeNull()
    expect(processImageJob).not.toHaveBeenCalled()
  })

  it('falls back when worker construction is blocked (for example by CSP)', async () => {
    vi.stubGlobal('OffscreenCanvas', class {})
    vi.stubGlobal('Worker', class { constructor() { throw new Error('SecurityError') } })
    expect(await loadImage(file)).toEqual(asset)
    expect(processImageJob).toHaveBeenCalledOnce()
  })

  it('terminates failed startup workers before falling back', async () => {
    const workers = installWorker([], true)
    expect(await loadImage(file)).toEqual(asset)
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(processImageJob).toHaveBeenCalledOnce()
  })

  it('falls back for missing worker canvas capabilities', async () => {
    const workers = installWorker([{ kind: 'error', message: 'No OffscreenCanvas 2D support', unavailable: true }])
    expect(await loadImage(file)).toEqual(asset)
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(processImageJob).toHaveBeenCalledOnce()
  })

  it('does not repeat a failed decode on the main thread', async () => {
    const workers = installWorker([{ kind: 'error', message: 'Image is corrupt or out of memory', unavailable: false }])
    await expect(loadImage(file)).rejects.toThrow(/corrupt or out of memory/)
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(processImageJob).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('preflights signatures and file limits before either decoder backend runs', async () => {
    const workers = installWorker([{ kind: 'result', result: preview }])
    await expect(loadImage(new File(['<svg/>'], 'malicious.png', { type: 'image/png' }))).rejects.toThrow(/Only JPEG and PNG/)
    const oversized = new File(['x'], 'large.jpg')
    Object.defineProperty(oversized, 'size', { value: IMAGE_LIMITS.fileBytes + 1 })
    await expect(loadImage(oversized)).rejects.toThrow(/150 MiB/)
    expect(workers).toHaveLength(0)
    expect(processImageJob).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('does not leak a preview URL on processing failure', async () => {
    vi.mocked(processImageJob).mockRejectedValue(new Error('Encoding failed'))
    await expect(loadImage(file)).rejects.toThrow('Encoding failed')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('exportWallpapers', () => {
  it('snapshots native output geometry and unique filenames and passes the original File, not the preview', async () => {
    const monitors = [monitor(), monitor({ id: 'two', name: 'desk : DISPLAY', rotation: 90 })]
    const placements = { ...transform }
    vi.mocked(processImageJob).mockResolvedValue({ kind: 'export', wallpapers: [] })
    const onProgress = vi.fn()
    const exporting = exportWallpapers(asset, monitors, placements, '#112233', onProgress)
    monitors[0]!.widthPx = 800
    placements.x = 999
    await exporting
    const job = vi.mocked(processImageJob).mock.calls[0]![0]
    expect(job.kind).toBe('export')
    if (job.kind !== 'export') throw new Error('Expected export')
    expect(job.file).toBe(file)
    expect(job.imageSize).toEqual({ width: 1, height: 1 })
    expect(job.plans).toMatchObject([
      {
        monitorId: 'one', width: 1920, height: 1080, filename: 'original-Desk-display-1920x1080.png',
        region: { source: { x: 0, y: 0, width: 1, height: 1 }, destination: { x: 0, y: 0, width: 1920, height: 1080 } },
      },
      { monitorId: 'two', width: 1080, height: 1920, filename: 'original-desk-DISPLAY-1080x1920.png' },
    ])
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(0, 2)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('forwards sequential progress and results from a worker', async () => {
    const wallpaper = { monitorId: 'one', filename: 'test.png', width: 1920, height: 1080, blob: new Blob(['png'], { type: 'image/png' }) }
    const workers = installWorker([
      { kind: 'progress', completed: 1, total: 1 },
      { kind: 'result', result: { kind: 'export', wallpapers: [wallpaper] } },
    ])
    const onProgress = vi.fn()
    const result = await exportWallpapers(asset, [monitor()], transform, '#112233', onProgress)
    expect(result).toEqual([wallpaper])
    expect(onProgress.mock.calls).toEqual([[0, 1], [1, 1]])
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  })

  it('terminates the worker if a progress observer throws', async () => {
    const workers = installWorker([{ kind: 'progress', completed: 1, total: 1 }])
    const onProgress = (completed: number) => { if (completed > 0) throw new Error('Observer failed') }
    await expect(exportWallpapers(asset, [monitor()], transform, '#112233', onProgress)).rejects.toThrow('Observer failed')
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(processImageJob).not.toHaveBeenCalled()
  })

  it('returns an empty export without decoding when there are no monitors', async () => {
    const onProgress = vi.fn()
    expect(await exportWallpapers(asset, [], transform, '#112233', onProgress)).toEqual([])
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(0, 0)
    expect(processImageJob).not.toHaveBeenCalled()
  })

  it('rejects unsafe output sizes and invalid placement before decoding', async () => {
    await expect(exportWallpapers(asset, [monitor({ widthPx: 16385 })], transform, '#112233')).rejects.toThrow(/16,384/)
    await expect(exportWallpapers(asset, [monitor({ widthPx: 8000, heightPx: 6000 })], transform, '#112233')).rejects.toThrow(/40-megapixel/)
    await expect(exportWallpapers(asset, [monitor()], { ...transform, scale: 0 }, '#112233')).rejects.toThrow(/greater than zero/)
    await expect(exportWallpapers(asset, [monitor()], { ...transform, x: NaN }, '#112233')).rejects.toThrow(/finite/)
    await expect(exportWallpapers(asset, [monitor()], transform, '')).rejects.toThrow(/background color/)
    expect(processImageJob).not.toHaveBeenCalled()
  })
})
