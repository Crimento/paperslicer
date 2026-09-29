import { describe, expect, it, vi } from 'vitest'
import {
  getPreviewSize,
  IMAGE_LIMITS,
  parseImageHeader,
  readImageHeader,
  validateDecodedSize,
  validateFileSize,
  validateOutputSize,
  validateSourceSize,
} from './image-headers'

function png(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 6, 0, 0, 0], 24)
  let crc = 0xffffffff
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  view.setUint32(29, (crc ^ 0xffffffff) >>> 0)
  return bytes
}

function jpeg(width = 6000, height = 4000, marker = 0xc0, metadata: number[] = []): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, ...metadata,
    0xff, marker, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0,
    0xff, 0xd9,
  ])
}

describe('bounded JPEG/PNG inspection', () => {
  it('reads PNG dimensions and works with byte-array views', () => {
    const bytes = new Uint8Array(40)
    bytes.set(png(3840, 2160), 4)
    expect(parseImageHeader(bytes.subarray(4, 37))).toEqual({ mimeType: 'image/png', width: 3840, height: 2160 })
  })

  it.each([0xc0, 0xc1, 0xc2])('reads JPEG SOF marker %i', (marker) => {
    expect(parseImageHeader(jpeg(6000, 4000, marker))).toEqual({ mimeType: 'image/jpeg', width: 6000, height: 4000 })
  })

  it('skips metadata by length, even when it contains apparent frame markers', () => {
    const metadata = [0xff, 0xe1, 0, 8, 0xff, 0xc0, 0, 0, 0, 0]
    expect(parseImageHeader(jpeg(100, 200, 0xc2, metadata))).toMatchObject({ width: 100, height: 200 })
  })

  it('ignores EXIF orientation in headers; only the decoder determines oriented dimensions', () => {
    const exif = [69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0,
      1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]
    const header = parseImageHeader(jpeg(6000, 4000, 0xc0, [0xff, 0xe1, 0, exif.length + 2, ...exif]))
    expect(header).toMatchObject({ width: 6000, height: 4000 })
    expect(() => validateDecodedSize({ width: 4000, height: 6000 }, header)).not.toThrow()
    expect(() => validateDecodedSize({ width: 6000, height: 4000 }, header)).not.toThrow()
    expect(() => validateDecodedSize({ width: 2048, height: 1365 }, header)).toThrow(/do not match/)
  })

  it('checks bytes, not a filename or reported media type', async () => {
    const file = new File([png() as Uint8Array<ArrayBuffer>], 'not-an-image.svg', { type: 'image/svg+xml' })
    expect(await readImageHeader(file)).toMatchObject({ mimeType: 'image/png' })
    await expect(readImageHeader(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'fake.png', { type: 'image/png' })))
      .rejects.toThrow(/Only JPEG and PNG/)
  })

  it.each([
    new Uint8Array(),
    new Uint8Array([71, 73, 70, 56, 57, 97]),
    new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
  ])('rejects other signatures', (bytes) => {
    expect(() => parseImageHeader(bytes)).toThrow(/Only JPEG and PNG/)
  })

  it('rejects incomplete, malformed, and checksum-corrupt PNG headers', () => {
    expect(() => parseImageHeader(png().subarray(0, 24))).toThrow(/incomplete or corrupt/)
    const wrongChunk = png()
    wrongChunk[12] = 0
    expect(() => parseImageHeader(wrongChunk)).toThrow(/IHDR/)
    const wrongDepth = png()
    wrongDepth[24] = 3
    expect(() => parseImageHeader(wrongDepth)).toThrow(/encoding settings/)
    const corrupt = png()
    corrupt[32] = corrupt[32]! ^ 1
    expect(() => parseImageHeader(corrupt)).toThrow(/checksum/)
  })

  it('rejects malformed JPEG segments and missing frames/scans', () => {
    expect(() => parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 1]))).toThrow(/corrupt/)
    expect(() => parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 20]))).toThrow(/incomplete/)
    expect(() => parseImageHeader(jpeg().subarray(0, 15))).toThrow(/incomplete/)
    expect(() => parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0]))).toThrow(/corrupt/)
  })

  it('bounds parsing even when JPEG metadata keeps going', () => {
    const bytes = new Uint8Array(17 * 65537 + 2)
    bytes.set([0xff, 0xd8])
    for (let offset = 2; offset < bytes.length; offset += 65537) bytes.set([0xff, 0xe1, 0xff, 0xff], offset)
    expect(() => parseImageHeader(bytes)).toThrow(/1 MiB inspection limit/)
  })

  it('reads only a bounded prefix and rejects oversized files before reading', async () => {
    const slice = vi.fn(() => new Blob([png() as Uint8Array<ArrayBuffer>]))
    await readImageHeader({ size: 10_000_000, slice } as unknown as Blob)
    expect(slice).toHaveBeenCalledExactlyOnceWith(0, IMAGE_LIMITS.headerBytes)
    slice.mockClear()
    await expect(readImageHeader({ size: IMAGE_LIMITS.fileBytes + 1, slice } as unknown as Blob)).rejects.toThrow(/150 MiB/)
    expect(slice).not.toHaveBeenCalled()
  })

  it('turns file read errors into an actionable message', async () => {
    const slice = () => ({ arrayBuffer: () => Promise.reject(new Error('Permission denied')) })
    await expect(readImageHeader({ size: 100, slice } as unknown as Blob)).rejects.toThrow(/select it again/)
  })
})

describe('image and output limits', () => {
  it('rejects empty files and accepts the exact file-size boundary', () => {
    expect(() => validateFileSize(0)).toThrow(/empty/)
    expect(() => validateFileSize(IMAGE_LIMITS.fileBytes)).not.toThrow()
  })

  it('rejects zero, oversized-side, and oversized-area source headers', () => {
    expect(() => parseImageHeader(png(0, 1))).toThrow(/positive whole numbers/)
    expect(() => parseImageHeader(jpeg(1, 0))).toThrow(/positive whole numbers/)
    expect(() => parseImageHeader(png(32769, 1))).toThrow(/32,768/)
    expect(() => parseImageHeader(jpeg(12001, 10000))).toThrow(/120-megapixel/)
    expect(() => validateSourceSize({ width: 12000, height: 10000 })).not.toThrow()
    expect(() => validateSourceSize({ width: 32768, height: 1 })).not.toThrow()
  })

  it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid dimensions %s', (width) => {
    expect(() => validateOutputSize({ width, height: 100 })).toThrow(/positive whole numbers/)
  })

  it('allows 8K UHD in both orientations, while bounding output area and side', () => {
    expect(() => validateOutputSize({ width: 7680, height: 4320 })).not.toThrow()
    expect(() => validateOutputSize({ width: 4320, height: 7680 })).not.toThrow()
    expect(() => validateOutputSize({ width: 8000, height: 5000 })).not.toThrow()
    expect(() => validateOutputSize({ width: 8001, height: 5000 })).toThrow(/40-megapixel/)
    expect(() => validateOutputSize({ width: 16385, height: 1 })).toThrow(/16,384/)
  })

  it('keeps previews bounded, proportional, nonzero, and never upscales', () => {
    expect(getPreviewSize({ width: 6000, height: 4000 })).toEqual({ width: 2048, height: 1365 })
    expect(getPreviewSize({ width: 4000, height: 6000 })).toEqual({ width: 1365, height: 2048 })
    expect(getPreviewSize({ width: 1, height: 32768 })).toEqual({ width: 1, height: 2048 })
    expect(getPreviewSize({ width: 320, height: 200 })).toEqual({ width: 320, height: 200 })
  })
})
