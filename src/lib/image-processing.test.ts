import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processImageJob } from './image-processing'
import { ImageBackendUnavailableError } from './image-protocol'
import type { ImageJob } from './image-protocol'

class FakeContext {
  private color = '#000000'
  get fillStyle() { return this.color }
  set fillStyle(value: string) {
    if (/^#[0-9a-f]{6}$/i.test(value)) this.color = value.toLowerCase()
  }
  imageSmoothingEnabled = false
  imageSmoothingQuality = 'low'
  drawImage = vi.fn()
  fillRect = vi.fn()
}

const surfaces: FakeCanvas[] = []
const encodedSizes: { width: number; height: number }[] = []
let encodeFailure = false
let encodeCount = 0
let maxConcurrentEncodes = 0

class FakeCanvas {
  context = new FakeContext()
  constructor(public width: number, public height: number) { surfaces.push(this) }
  getContext = vi.fn(() => this.context)
  async convertToBlob(options: ImageEncodeOptions) {
    expect(options.type).toBe('image/png')
    encodeCount++
    maxConcurrentEncodes = Math.max(maxConcurrentEncodes, encodeCount)
    encodedSizes.push({ width: this.width, height: this.height })
    await Promise.resolve()
    encodeCount--
    if (encodeFailure) throw new Error('Out of memory')
    return new Blob(['png'], { type: 'image/png' })
  }
}

const file = new File(['original data'], 'original.jpg', { type: 'image/svg+xml' })
const header = { width: 4000, height: 2000, mimeType: 'image/jpeg' as const }
const bitmap = { width: 4000, height: 2000, close: vi.fn() }
const decode = vi.fn()

function exportJob(): Extract<ImageJob, { kind: 'export' }> {
  return {
    kind: 'export', file, header, imageSize: { width: 4000, height: 2000 }, backgroundColor: '#112233',
    plans: [
      {
        monitorId: 'partial', filename: 'partial.png', width: 3840, height: 2160,
        region: {
          source: { x: 1000, y: 500, width: 2000, height: 1000 },
          destination: { x: 300, y: 100, width: 3000, height: 1500 },
        },
      },
      { monitorId: 'empty', filename: 'empty.png', width: 2160, height: 3840, region: null },
    ],
  }
}

beforeEach(() => {
  surfaces.length = 0
  encodedSizes.length = 0
  encodeFailure = false
  encodeCount = 0
  maxConcurrentEncodes = 0
  bitmap.width = 4000
  bitmap.height = 2000
  bitmap.close.mockReset()
  decode.mockReset().mockResolvedValue(bitmap)
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('createImageBitmap', decode)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('image rendering and resource ownership', () => {
  it('reports oriented original dimensions while drawing only a bounded preview', async () => {
    bitmap.width = 2000
    bitmap.height = 4000
    const result = await processImageJob({ kind: 'preview', file, header }, 'worker')
    expect(result).toMatchObject({ kind: 'preview', width: 2000, height: 4000 })
    expect(encodedSizes).toEqual([{ width: 1024, height: 2048 }])
    expect(surfaces[1]!.context.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0, 1024, 2048)
    expect(decode).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), { imageOrientation: 'from-image' })
    expect((decode.mock.calls[0]![0] as Blob).type).toBe('image/jpeg')
    expect((decode.mock.calls[0]![0] as Blob).size).toBe(file.size)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(surfaces.every((surface) => surface.width === 0 && surface.height === 0)).toBe(true)
  })

  it('fills backgrounds, draws clipped source/destination rectangles, and encodes sequentially', async () => {
    const onProgress = vi.fn(() => {
      expect(bitmap.close).not.toHaveBeenCalled()
      expect(surfaces.every((surface) => surface.width === 0)).toBe(true)
    })
    const job = exportJob()
    const result = await processImageJob(job, 'worker', onProgress)
    expect(result.kind).toBe('export')
    if (result.kind !== 'export') throw new Error('Expected export')
    expect(result.wallpapers.map(({ monitorId, filename, width, height, blob }) => ({ monitorId, filename, width, height, type: blob.type })))
      .toEqual([
        { monitorId: 'partial', filename: 'partial.png', width: 3840, height: 2160, type: 'image/png' },
        { monitorId: 'empty', filename: 'empty.png', width: 2160, height: 3840, type: 'image/png' },
      ])
    const partial = surfaces[1]!.context
    expect(partial.fillStyle).toBe('#112233')
    expect(partial.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 3840, 2160)
    expect(partial.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 1000, 500, 2000, 1000, 300, 100, 3000, 1500)
    expect(partial.fillRect.mock.invocationCallOrder[0]).toBeLessThan(partial.drawImage.mock.invocationCallOrder[0]!)
    expect(surfaces[2]!.context.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 2160, 3840)
    expect(surfaces[2]!.context.drawImage).not.toHaveBeenCalled()
    expect(encodedSizes).toEqual([{ width: 3840, height: 2160 }, { width: 2160, height: 3840 }])
    expect(maxConcurrentEncodes).toBe(1)
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]])
    expect(decode).toHaveBeenCalledOnce()
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('closes the bitmap and canvases on encoding failure', async () => {
    encodeFailure = true
    await expect(processImageJob(exportJob(), 'worker')).rejects.toThrow(/allocate or encode/)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(surfaces.every((surface) => surface.width === 0 && surface.height === 0)).toBe(true)
    expect(encodedSizes).toHaveLength(1)
  })

  it('closes the preview bitmap if PNG encoding throws synchronously', async () => {
    vi.spyOn(FakeCanvas.prototype, 'convertToBlob').mockImplementation(() => { throw new Error('encode failed') })
    await expect(processImageJob({ kind: 'preview', file, header }, 'worker')).rejects.toThrow(/allocate or encode/)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(surfaces.every((surface) => surface.width === 0)).toBe(true)
  })

  it('closes the bitmap on invalid decoded dimensions, including zero', async () => {
    bitmap.width = 0
    await expect(processImageJob({ kind: 'preview', file, header }, 'worker')).rejects.toThrow(/positive whole numbers/)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(encodedSizes).toHaveLength(0)
  })

  it('rejects mismatched original dimensions rather than using preview-sized crops', async () => {
    const job = exportJob()
    job.imageSize = { width: 2000, height: 4000 }
    job.plans = []
    await expect(processImageJob(job, 'worker')).rejects.toThrow(/Load the image again/)
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('releases resources if a progress observer throws', async () => {
    await expect(processImageJob(exportJob(), 'worker', () => { throw new Error('Observer failed') }))
      .rejects.toThrow('Observer failed')
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(encodedSizes).toHaveLength(1)
  })

  it('rejects invalid output sizes, crops, and colors before decoding', async () => {
    const job = exportJob()
    job.plans[0]!.width = 16385
    await expect(processImageJob(job, 'worker')).rejects.toThrow(/16,384/)
    job.plans[0]!.width = 3840
    job.plans[0]!.region!.source.x = -10
    await expect(processImageJob(job, 'worker')).rejects.toThrow(/invalid crop/)
    job.plans[0]!.region = null
    job.backgroundColor = 'url(untrusted.svg)'
    await expect(processImageJob(job, 'worker')).rejects.toThrow(/background color/)
    expect(decode).not.toHaveBeenCalled()
    expect(surfaces.every((surface) => surface.width === 0)).toBe(true)
  })

  it('distinguishes missing worker capabilities from decoder errors', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    await expect(processImageJob({ kind: 'preview', file, header }, 'worker')).rejects.toBeInstanceOf(ImageBackendUnavailableError)
    expect(decode).not.toHaveBeenCalled()
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    decode.mockRejectedValue(new Error('Corrupt JPEG'))
    await expect(processImageJob({ kind: 'preview', file, header }, 'worker')).rejects.toThrow(/damaged.*memory/)
  })

  it('falls back to an HTML image and canvas without createImageBitmap or OffscreenCanvas', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('OffscreenCanvas', undefined)
    const image = {
      naturalWidth: 2000, naturalHeight: 4000, onload: null as (() => void) | null,
      onerror: null as (() => void) | null, decoding: '',
      set src(_value: string) { queueMicrotask(() => this.onload?.()) },
      removeAttribute: vi.fn(),
    }
    const canvases: { width: number; height: number; context: FakeContext }[] = []
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'img') return image
        const context = new FakeContext()
        const canvas = {
          width: 0, height: 0, context, getContext: () => context,
          toBlob: (callback: BlobCallback, type: string) => callback(new Blob(['png'], { type })),
        }
        canvases.push(canvas)
        return canvas
      },
    })
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:temporary-original')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const result = await processImageJob({ kind: 'preview', file, header }, 'main')
    expect(result).toMatchObject({ width: 2000, height: 4000 })
    expect(createUrl.mock.calls[0]![0]).toMatchObject({ type: 'image/jpeg' })
    expect(canvases[1]!.context.drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0, 1024, 2048)
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
    expect(image.removeAttribute).toHaveBeenCalledWith('src')
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:temporary-original')
  })

  it('revokes a fallback decode URL on a corrupt image', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const image = {
      onload: null as (() => void) | null, onerror: null as (() => void) | null,
      set src(_value: string) { queueMicrotask(() => this.onerror?.()) },
      removeAttribute: vi.fn(),
    }
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'img' ? image : {
      width: 0, height: 0, getContext: () => new FakeContext(),
    } })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bad-original')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await expect(processImageJob({ kind: 'preview', file, header }, 'main')).rejects.toThrow(/could not be decoded/)
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:bad-original')
    expect(image.removeAttribute).toHaveBeenCalledWith('src')
    expect(image.onload).toBeNull()
    expect(image.onerror).toBeNull()
  })
})
