export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Rect extends Size, Point {}

export interface Monitor {
  id: string
  name: string
  widthPx: number
  heightPx: number
  diagonalInches: number
  rotation: 0 | 90
  x: number
  y: number
  /** Optional measured active-area dimensions, before rotation. */
  physicalWidthMm?: number
  physicalHeightMm?: number
}

/** Position in millimeters; scale in millimeters per source-image pixel. */
export interface ImageTransform extends Point {
  scale: number
}

export interface Guide {
  axis: 'x' | 'y'
  position: number
}

export interface ExportRegion {
  source: Rect
  destination: Rect
}

export interface ImageAsset extends Size {
  file: File
  name: string
  previewUrl: string
}

export interface ExportedWallpaper extends Size {
  monitorId: string
  filename: string
  blob: Blob
}
