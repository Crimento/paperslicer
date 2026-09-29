import type { Size } from './types'

export const IMAGE_LIMITS = {
  fileBytes: 150 * 1024 * 1024,
  headerBytes: 1024 * 1024,
  sourcePixels: 120_000_000,
  sourceSide: 32_768,
  previewSide: 2_048,
  outputPixels: 40_000_000,
  outputSide: 16_384,
} as const

export interface ImageHeader extends Size {
  mimeType: 'image/jpeg' | 'image/png'
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function assertDimensions(size: Size, label: string): void {
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)
    || size.width <= 0 || size.height <= 0) {
    throw new Error(`${label} width and height must be positive whole numbers.`)
  }
}

export function validateFileSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error('The image file is empty or has an invalid size.')
  }
  if (bytes > IMAGE_LIMITS.fileBytes) {
    throw new Error('The image exceeds the 150 MiB file-size limit. Re-save a smaller JPEG or PNG.')
  }
}

export function validateSourceSize(size: Size): void {
  assertDimensions(size, 'Image')
  if (Math.max(size.width, size.height) > IMAGE_LIMITS.sourceSide) {
    throw new Error('The image exceeds the 32,768-pixel side limit. Re-save a smaller image; a small preview can still require full-resolution decoding.')
  }
  if (size.width * size.height > IMAGE_LIMITS.sourcePixels) {
    throw new Error('The image exceeds the 120-megapixel source limit. Re-save a smaller image; a small preview can still require full-resolution decoding.')
  }
}

export function validateOutputSize(size: Size): void {
  assertDimensions(size, 'Wallpaper')
  if (Math.max(size.width, size.height) > IMAGE_LIMITS.outputSide) {
    throw new Error('A wallpaper exceeds the 16,384-pixel output side limit. Reduce the monitor resolution.')
  }
  if (size.width * size.height > IMAGE_LIMITS.outputPixels) {
    throw new Error('A wallpaper exceeds the 40-megapixel output limit. Reduce the monitor resolution (8K UHD is supported).')
  }
}

export function getPreviewSize(size: Size): Size {
  validateSourceSize(size)
  const scale = Math.min(1, IMAGE_LIMITS.previewSide / Math.max(size.width, size.height))
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/** Headers are un-oriented. The decoder, not an extra EXIF rotation, owns orientation. */
export function validateDecodedSize(decoded: Size, header: ImageHeader): void {
  validateSourceSize(decoded)
  const unchanged = decoded.width === header.width && decoded.height === header.height
  const rotated = decoded.width === header.height && decoded.height === header.width
  if (!unchanged && !rotated) {
    throw new Error('The decoded image dimensions do not match its header. Re-save the image as a standard JPEG or PNG.')
  }
}

function headerError(truncated: boolean): Error {
  return new Error(truncated
    ? 'The JPEG header exceeds the 1 MiB inspection limit. Re-save the image with less metadata before loading it.'
    : 'The image header is incomplete or corrupt. Choose a valid JPEG or PNG.')
}

function parsePng(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 33) throw headerError(false)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    throw new Error('The PNG must begin with a valid IHDR dimension header.')
  }

  const bitDepth = bytes[24]!
  const colorType = bytes[25]!
  const validDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
  }
  if (!validDepths[colorType]?.includes(bitDepth)
    || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28]! > 1) {
    throw new Error('The PNG IHDR header contains invalid encoding settings.')
  }

  let crc = 0xffffffff
  for (let i = 12; i < 29; i++) {
    crc ^= bytes[i]!
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(29)) {
    throw new Error('The PNG dimension header has a corrupt checksum.')
  }

  return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
}

function parseJpeg(bytes: Uint8Array, truncated: boolean): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  let size: Size | undefined

  // Walk segment lengths, never search arbitrary metadata for apparent SOF bytes.
  // Stop at the first scan: compressed pixel data is the browser decoder's job.
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw headerError(false)
    while (bytes[offset] === 0xff) offset++
    if (offset >= bytes.length) throw headerError(truncated)
    const marker = bytes[offset++]!
    if (marker === 0x01) continue // Standalone TEM marker.
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9
      || (marker >= 0xd0 && marker <= 0xd7)) throw headerError(false)
    if (offset + 2 > bytes.length) throw headerError(truncated)

    const length = view.getUint16(offset)
    if (length < 2) throw headerError(false)
    const end = offset + length
    if (end > bytes.length) throw headerError(truncated)

    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (length < 8 || size) throw headerError(false)
      const components = bytes[offset + 7]!
      if (components === 0 || length !== 8 + 3 * components) throw headerError(false)
      size = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
      validateSourceSize(size)
    }
    if (marker === 0xda) {
      if (!size || length < 6 || bytes[offset + 2] === 0
        || length !== 6 + 2 * bytes[offset + 2]!) throw headerError(false)
      return { mimeType: 'image/jpeg', ...size }
    }
    offset = end
  }
  throw headerError(truncated)
}

/** Parses at most 1 MiB; intentionally rejects unusually large JPEG metadata headers. */
export function parseImageHeader(input: Uint8Array, truncated = false): ImageHeader {
  const bytes = input.subarray(0, IMAGE_LIMITS.headerBytes)
  const capped = truncated || input.length > bytes.length
  let header: ImageHeader
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    header = parsePng(bytes)
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    header = parseJpeg(bytes, capped)
  } else {
    throw new Error('Only JPEG and PNG images are supported. The file contents, not its name or MIME type, must identify a JPEG or PNG; SVG is not supported.')
  }
  validateSourceSize(header)
  return header
}

export async function readImageHeader(file: Blob): Promise<ImageHeader> {
  validateFileSize(file.size)
  let buffer: ArrayBuffer
  try {
    buffer = await file.slice(0, IMAGE_LIMITS.headerBytes).arrayBuffer()
  } catch {
    throw new Error('The image file could not be read. Please select it again.')
  }
  return parseImageHeader(new Uint8Array(buffer), file.size > buffer.byteLength)
}
