<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import AppIcon from './components/AppIcon.vue'
import MonitorLayout from './components/MonitorLayout.vue'
import MonitorSettings from './components/MonitorSettings.vue'
import WallpaperComposer from './components/WallpaperComposer.vue'
import { fitImage, getExportRegion, getImageRect, getLayoutBounds, getMonitorRect, getMonitorSize, getOutputSize, scaleImageAtPoint } from './lib/geometry'
import { disposeImage, exportWallpapers, loadImage } from './lib/image'
import { createSample } from './lib/sample'
import { defaultSettings, isValidMonitor, loadSettings, MAX_MONITORS, MONITOR_COLORS, SETTINGS_KEY } from './lib/settings'
import type { ExportedWallpaper, ImageAsset, ImageTransform, Monitor, Point } from './lib/types'

const saved = loadSettings()
const monitors = ref<Monitor[]>(saved.monitors)
const backgroundColor = ref(saved.backgroundColor)
const snapping = ref(saved.snapping)
const selectedId = ref(monitors.value[0]!.id)
const asset = shallowRef<ImageAsset | null>(null)
const transform = ref<ImageTransform>({ x: 0, y: 0, scale: 1 })
const fileInput = ref<HTMLInputElement>()
const exportDialog = ref<HTMLDialogElement>()
const importing = ref(false)
const exporting = ref(false)
const progress = ref({ completed: 0, total: 0 })
const error = ref('')
const storageAvailable = ref(true)
const dragDepth = ref(0)
const downloads = shallowRef<(ExportedWallpaper & { url: string })[]>([])
let alive = true
let saveTimer: ReturnType<typeof setTimeout> | undefined

const busy = computed(() => importing.value || exporting.value)
const selected = computed(() => monitors.value.find((monitor) => monitor.id === selectedId.value) ?? monitors.value[0]!)
const selectedIndex = computed(() => monitors.value.findIndex((monitor) => monitor.id === selected.value.id))
const bounds = computed(() => getLayoutBounds(monitors.value))
const coverScale = computed(() => asset.value ? fitImage(asset.value, bounds.value, 'cover').scale : 1)
const scalePercent = computed(() => Math.round(transform.value.scale / coverScale.value * 1000) / 10)
const outputs = computed(() => monitors.value.map((monitor, index) => ({ ...getOutputSize(monitor), id: monitor.id, name: monitor.name, color: MONITOR_COLORS[index] })))
const imageWarnings = computed(() => {
  if (!asset.value) return { uncovered: 0, upscaled: false }
  let uncovered = 0
  let upscaled = false
  for (const monitor of monitors.value) {
    const region = getExportRegion(monitor, asset.value, transform.value)
    const output = getOutputSize(monitor)
    if (!region || region.destination.width * region.destination.height < output.width * output.height * 0.9999) uncovered++
    if (region && (region.source.width < region.destination.width - 1 || region.source.height < region.destination.height - 1)) upscaled = true
  }
  return { uncovered, upscaled }
})
const hasOverlap = computed(() => monitors.value.some((a, index) => monitors.value.slice(index + 1).some((b) => {
  const r = getMonitorRect(a)
  const s = getMonitorRect(b)
  return Math.min(r.x + r.width, s.x + s.width) - Math.max(r.x, s.x) > 0.1
    && Math.min(r.y + r.height, s.y + s.height) - Math.max(r.y, s.y) > 0.1
})))

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, monitors: monitors.value, backgroundColor: backgroundColor.value, snapping: snapping.value }))
    storageAvailable.value = true
  } catch {
    storageAvailable.value = false
  }
}
watch([monitors, backgroundColor, snapping], () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(persistSettings, 150)
}, { deep: true })
window.addEventListener('pagehide', persistSettings)
persistSettings()

function updateMonitor(id: string, patch: Partial<Monitor>) {
  const index = monitors.value.findIndex((monitor) => monitor.id === id)
  if (index === -1) return
  const next = { ...monitors.value[index]!, ...patch }
  if (!isValidMonitor(next)) {
    error.value = 'These monitor settings exceed the supported limits. Use at most 16,384 pixels per side and 40 megapixels per screen; positions must stay within ±10,000 mm.'
    return
  }
  monitors.value[index] = next
}

function moveMonitor(id: string, position: Point) {
  updateMonitor(id, { x: Math.max(-10000, Math.min(10000, position.x)), y: Math.max(-10000, Math.min(10000, position.y)) })
}

function addMonitor() {
  if (monitors.value.length >= MAX_MONITORS) return
  const monitor: Monitor = { id: crypto.randomUUID(), name: `Screen ${monitors.value.length + 1}`, widthPx: 2560, heightPx: 1440, diagonalInches: 27, rotation: 0, x: bounds.value.x + bounds.value.width + 18, y: bounds.value.y }
  monitor.y += (bounds.value.height - getMonitorSize(monitor).height) / 2
  if (commitLayout([...monitors.value, monitor])) selectedId.value = monitor.id
}

function removeMonitor(id: string) {
  if (monitors.value.length === 1) return
  monitors.value = monitors.value.filter((monitor) => monitor.id !== id)
  if (selectedId.value === id) selectedId.value = monitors.value[0]!.id
}

function resetLayout() {
  monitors.value = defaultSettings().monitors
  selectedId.value = monitors.value[0]!.id
  fit('cover')
}

function commitLayout(next: Monitor[]): boolean {
  if (!next.every(isValidMonitor)) {
    error.value = 'That arrangement would place a screen beyond ±10,000 mm. Move your screens closer to the origin before adding or aligning them.'
    return false
  }
  monitors.value = next
  return true
}

function alignMonitors(alignment: 'top' | 'center' | 'bottom') {
  const layout = bounds.value
  commitLayout(monitors.value.map((monitor) => {
    const height = getMonitorSize(monitor).height
    const y = alignment === 'top' ? layout.y : alignment === 'bottom' ? layout.y + layout.height - height : layout.y + (layout.height - height) / 2
    return { ...monitor, y }
  }))
}

function fit(mode: 'cover' | 'contain') {
  if (asset.value) transform.value = fitImage(asset.value, bounds.value, mode)
}

function changeScale(event: Event) {
  const input = event.target as HTMLInputElement
  if (!asset.value || !input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
    input.value = String(scalePercent.value)
    return
  }
  const scale = coverScale.value * Math.min(800, Math.max(5, input.valueAsNumber)) / 100
  transform.value = scaleImageAtPoint(transform.value, { x: bounds.value.x + bounds.value.width / 2, y: bounds.value.y + bounds.value.height / 2 }, scale)
}

function alignImage(alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
  if (!asset.value) return
  const image = getImageRect(asset.value, transform.value)
  const layout = bounds.value
  const next = { ...transform.value }
  if (alignment === 'left') next.x = layout.x
  if (alignment === 'center') next.x = layout.x + (layout.width - image.width) / 2
  if (alignment === 'right') next.x = layout.x + layout.width - image.width
  if (alignment === 'top') next.y = layout.y
  if (alignment === 'middle') next.y = layout.y + (layout.height - image.height) / 2
  if (alignment === 'bottom') next.y = layout.y + layout.height - image.height
  transform.value = next
}

async function openImage(source: File | 'sample') {
  if (busy.value) return
  importing.value = true
  error.value = ''
  try {
    const file = source === 'sample' ? await createSample() : source
    const next = await loadImage(file)
    if (!alive) { disposeImage(next); return }
    const previous = asset.value
    asset.value = next
    fit('cover')
    if (previous) disposeImage(previous)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this image. Try another JPEG or PNG.'
  } finally {
    importing.value = false
  }
}

function fileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void openImage(file)
}

function dragEnter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragDepth.value++
}

function dragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = busy.value ? 'none' : 'copy'
}

function dropFile(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragDepth.value = 0
  const files = event.dataTransfer.files
  if (files.length > 1) { error.value = 'Choose one wallpaper image at a time.'; return }
  if (files[0]) void openImage(files[0])
}

function clearDownloads() {
  for (const download of downloads.value) URL.revokeObjectURL(download.url)
  downloads.value = []
}

async function exportImages() {
  if (!asset.value || busy.value) return
  exporting.value = true
  error.value = ''
  clearDownloads()
  progress.value = { completed: 0, total: monitors.value.length }
  try {
    const results = await exportWallpapers(asset.value, monitors.value, transform.value, backgroundColor.value, (completed, total) => { progress.value = { completed, total } })
    if (!alive) return
    downloads.value = results.map((result) => ({ ...result, url: URL.createObjectURL(result.blob) }))
    await nextTick()
    exportDialog.value?.showModal()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not export wallpapers. Try a smaller source image.'
  } finally {
    exporting.value = false
  }
}

onBeforeUnmount(() => {
  alive = false
  clearTimeout(saveTimer)
  persistSettings()
  window.removeEventListener('pagehide', persistSettings)
  if (asset.value) disposeImage(asset.value)
  clearDownloads()
})
</script>

<template>
  <div class="mx-auto min-h-screen max-w-[1560px] px-4 sm:px-7 xl:px-10" @dragenter="dragEnter" @dragleave="dragDepth = Math.max(0, dragDepth - 1)" @dragover="dragOver" @drop="dropFile">
    <header class="navbar min-h-20 border-b border-base-content/10 px-0">
      <div class="navbar-start">
        <a class="flex items-center gap-3 rounded-field" href="./" aria-label="Paperslicer home">
          <span class="grid size-10 place-items-center rounded-field border border-secondary/30 bg-secondary/10 text-secondary"><AppIcon name="slice" :size="25" /></span>
          <span class="text-xl font-semibold tracking-tight">paperslicer<span class="ml-2 font-mono text-secondary">/</span></span>
          <span class="badge badge-outline badge-xs hidden font-mono uppercase tracking-wider text-base-content/60 sm:inline-flex">alpha</span>
        </a>
      </div>
      <div class="navbar-end gap-2">
        <span class="status status-success status-xs" aria-hidden="true"></span>
        <span class="font-mono text-[10px] uppercase tracking-widest text-base-content/65">No uploads<span class="hidden sm:inline">. No account.</span></span>
      </div>
    </header>

    <section class="flex flex-col justify-between gap-6 py-8 md:flex-row md:items-center">
      <div>
        <p class="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-secondary">Mixed-DPI / Wallpaper studio</p>
        <h1 class="text-3xl font-semibold tracking-tighter sm:text-4xl">One scene. <span class="text-secondary">Every screen.</span></h1>
        <p class="mt-3 text-xs leading-relaxed text-base-content/65 sm:text-sm">Match the millimeters. Make the pixels follow.</p>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-4 md:flex-col md:items-end lg:flex-row lg:items-center">
        <label class="label cursor-pointer gap-2 text-xs text-base-content/75">
          <input v-model="snapping" class="toggle toggle-sm" type="checkbox" :disabled="busy" />Snap to guides
        </label>
        <button class="btn btn-primary min-h-11" :disabled="!asset || busy" @click="exportImages">
          <AppIcon name="download" />Export wallpapers
          <span class="badge badge-sm border-primary-content/20 bg-primary-content/15 font-mono text-primary-content">{{ monitors.length }}</span>
        </button>
      </div>
    </section>

    <input ref="fileInput" class="hidden" data-testid="image-input" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-label="Choose wallpaper image" @change="fileChosen" />
    <div v-if="error" class="alert alert-error alert-soft mb-5 flex items-center justify-between text-sm" role="alert">
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-sm btn-square shrink-0" aria-label="Dismiss error" @click="error = ''"><AppIcon name="close" :size="16" /></button>
    </div>

    <main class="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)] xl:gap-6" :inert="busy">
      <section class="card card-border min-w-0 overflow-hidden border-base-content/10 bg-base-100">
        <header class="flex min-h-20 items-center justify-between gap-3 border-b border-base-content/10 p-5">
          <div class="flex items-center gap-3">
            <span class="font-mono text-2xl font-light text-secondary/70">01</span>
            <div><h2 class="card-title text-base">Your desk</h2><p class="mt-1 text-[11px] text-base-content/60">Arrange screens by physical size</p></div>
          </div>
          <button class="btn btn-ghost btn-sm btn-square" title="Reset to the example two-monitor layout" aria-label="Reset monitor layout" @click="resetLayout"><AppIcon name="reset" :size="16" /></button>
        </header>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1">
          <div class="min-w-0">
            <MonitorLayout :monitors="monitors" :selected-id="selectedId" :snapping="snapping" @select="selectedId = $event" @move="moveMonitor" />
            <div class="flex items-center justify-between gap-2 border-t border-base-content/10 px-4 py-3">
              <span class="font-mono text-xs tabular-nums">{{ (bounds.width / 10).toFixed(1) }} × {{ (bounds.height / 10).toFixed(1) }} <span class="text-base-content/55">cm</span></span>
              <div class="join" aria-label="Monitor alignment">
                <button class="btn btn-sm btn-square join-item" title="Align monitor tops" aria-label="Align monitor tops" @click="alignMonitors('top')"><AppIcon name="top" :size="15" /></button>
                <button class="btn btn-sm btn-square join-item" title="Align monitor centers" aria-label="Align monitor centers" @click="alignMonitors('center')"><AppIcon name="middle" :size="15" /></button>
                <button class="btn btn-sm btn-square join-item" title="Align monitor bottoms" aria-label="Align monitor bottoms" @click="alignMonitors('bottom')"><AppIcon name="bottom" :size="15" /></button>
              </div>
            </div>
            <p v-if="hasOverlap" class="px-5 pb-3 text-xs leading-relaxed text-warning" role="status">Screens overlap. Drag them apart unless this is intentional.</p>
            <div class="space-y-2 px-3 pb-4" aria-label="Monitors">
              <div v-for="(monitor, index) in monitors" :key="monitor.id" data-testid="monitor-row" class="flex items-center rounded-field border" :class="selectedId === monitor.id ? 'border-secondary/40 bg-secondary/10' : 'border-transparent'">
                <button class="btn btn-ghost h-auto min-w-0 flex-1 justify-start gap-3 border-0 px-3 py-3 text-left" :aria-label="`Configure screen ${index + 1}: ${monitor.name}`" :aria-pressed="selectedId === monitor.id" @click="selectedId = monitor.id">
                  <span class="badge badge-outline h-7 w-9 shrink-0 rounded-sm font-mono" :style="{ color: MONITOR_COLORS[index] }">{{ index + 1 }}</span>
                  <span class="min-w-0"><strong class="block truncate text-xs font-medium">{{ monitor.name }}</strong><span class="mt-1 block text-[10px] font-normal text-base-content/60">{{ getOutputSize(monitor).width }} × {{ getOutputSize(monitor).height }} · {{ monitor.diagonalInches }}″<span v-if="monitor.physicalWidthMm"> · measured</span></span></span>
                </button>
                <button class="btn btn-ghost btn-sm btn-square mr-1 shrink-0 text-base-content/55" :disabled="monitors.length === 1" :aria-label="`Remove screen ${index + 1}`" @click="removeMonitor(monitor.id)"><AppIcon name="close" :size="14" /></button>
              </div>
              <button class="btn btn-dash btn-sm w-full font-normal" :disabled="monitors.length >= MAX_MONITORS" @click="addMonitor"><AppIcon name="plus" :size="15" />{{ monitors.length >= MAX_MONITORS ? '8-screen limit reached' : 'Add a screen' }}</button>
            </div>
          </div>
          <MonitorSettings :key="selected.id" class="border-t border-base-content/10 sm:border-t-0 sm:border-l lg:border-t lg:border-l-0" :monitor="selected" :index="selectedIndex" @update="updateMonitor" />
        </div>
      </section>

      <section class="card card-border min-w-0 overflow-hidden border-base-content/10 bg-base-100">
        <header class="flex min-h-20 items-center justify-between gap-2 border-b border-base-content/10 px-4 py-5 sm:px-5">
          <div class="flex items-center gap-3">
            <span class="font-mono text-2xl font-light text-secondary/70">02</span>
            <div><h2 class="card-title text-base">Your wallpaper</h2><p class="mt-1 text-[11px] text-base-content/60">Frame the view across your screens</p></div>
          </div>
          <button class="btn btn-sm px-2 text-[11px] sm:px-3 sm:text-xs" @click="fileInput?.click()"><AppIcon name="upload" :size="15" />{{ asset ? 'Replace image' : 'Open image' }}</button>
        </header>
        <WallpaperComposer :monitors="monitors" :selected-id="selectedId" :asset="asset" :transform="transform" :background-color="backgroundColor" :snapping="snapping" @transform="transform = $event" @choose="fileInput?.click()" @sample="openImage('sample')" />
        <div class="flex min-h-12 items-center gap-2 border-y border-base-content/10 bg-base-200/60 px-4 py-3 text-[11px] sm:px-5">
          <AppIcon name="image" :size="16" class="shrink-0 text-secondary" />
          <template v-if="asset">
            <span class="min-w-0 truncate" data-testid="image-name">{{ asset.name }}</span>
            <span class="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-base-content/65" data-testid="image-dimensions">{{ asset.width.toLocaleString() }} × {{ asset.height.toLocaleString() }}<span class="ml-3 hidden xl:inline">{{ (asset.file.size / 1024 / 1024).toFixed(1) }} MB</span></span>
          </template>
          <template v-else><span class="text-base-content/65">JPEG & PNG · up to 150 MiB / 120 MP</span><span class="badge badge-outline badge-xs ml-auto hidden font-mono sm:inline-flex">LOCAL FILE</span></template>
        </div>
        <fieldset class="fieldset gap-5 p-4 disabled:opacity-45 sm:p-5" :disabled="!asset">
          <legend class="sr-only">Wallpaper adjustments</legend>
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="join">
              <button class="btn btn-sm join-item" title="Fill the whole layout, cropping excess image" @click="fit('cover')">Cover layout</button>
              <button class="btn btn-sm join-item" title="Show the whole image; uncovered screens use the background color" @click="fit('contain')">Fit whole image</button>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-base-content/60">Align</span>
              <div class="join">
                <button v-for="direction in (['left', 'center', 'right', 'top', 'middle', 'bottom'] as const)" :key="direction" class="btn btn-sm btn-square join-item" :aria-label="`Align image ${direction}`" :title="`Align image ${direction}`" @click="alignImage(direction)"><AppIcon :name="direction" :size="16" /></button>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3 sm:gap-4">
            <label class="shrink-0 text-xs text-base-content/75" for="image-scale">Image scale</label>
            <input id="image-scale" class="range range-xs min-w-0 flex-1" type="range" :value="asset ? scalePercent : 100" min="5" max="800" step="0.1" @input="changeScale" />
            <label class="input input-sm w-24 shrink-0 gap-1 font-mono text-xs">
              <input class="min-w-0 tabular-nums" aria-label="Image scale percent" type="number" :value="asset ? scalePercent : 100" min="5" max="800" step="0.1" required @change="changeScale" /><span class="text-base-content/50">%</span>
            </label>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <label class="label cursor-pointer gap-2 text-xs text-base-content/75"><input v-model="backgroundColor" class="input input-xs h-7 w-8 cursor-pointer p-1" type="color" aria-label="Uncovered area background color" /><span>Background</span><span class="font-mono text-[10px] text-base-content/50">{{ backgroundColor }}</span></label>
            <span class="font-mono text-[10px] text-base-content/50">100% = cover layout</span>
          </div>
        </fieldset>
        <div class="space-y-1 px-5 pb-5 text-[11px] leading-relaxed" aria-live="polite">
          <p v-if="imageWarnings.uncovered" class="text-warning" data-testid="quality-note">Background is visible on {{ imageWarnings.uncovered }} {{ imageWarnings.uncovered === 1 ? 'screen' : 'screens' }}. Use “Cover layout” to fill every screen.</p>
          <p v-if="imageWarnings.upscaled" class="text-warning" data-testid="quality-note">Some slices are upscaled. A larger source image will look sharper.</p>
          <p v-if="!imageWarnings.uncovered && !imageWarnings.upscaled" class="text-base-content/55">Drag to move · Scroll to scale · <kbd class="kbd kbd-xs">Shift</kbd> to bypass snapping</p>
        </div>
        <div class="border-t border-base-content/10 p-5">
          <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-mono text-[10px] uppercase tracking-widest text-secondary">03 / Your output</h3><span class="text-[10px] text-base-content/60">Individual PNGs · native resolution</span></div>
          <div class="mt-4 grid grid-cols-1 gap-3 min-[440px]:grid-cols-2">
            <div v-for="(output, index) in outputs" :key="output.id" data-testid="output-chip" class="flex min-w-0 items-center gap-3 rounded-field border border-base-content/10 bg-base-200 px-4 py-3">
              <AppIcon name="monitor" :size="21" class="shrink-0" :style="{ color: output.color }" />
              <div class="min-w-0"><strong class="block truncate text-xs font-medium"><span class="mr-2 font-mono text-base-content/50">{{ String(index + 1).padStart(2, '0') }}</span>{{ output.name }}</strong><span class="mt-1 block font-mono text-[11px] text-base-content/65">{{ output.width }} × {{ output.height }}</span></div>
            </div>
          </div>
        </div>
        <div class="flex items-start gap-3 border-t border-secondary/15 bg-secondary/5 px-5 py-4 text-xs leading-relaxed">
          <AppIcon name="arrows" :size="20" class="mt-0.5 shrink-0 text-secondary" />
          <p class="text-base-content/65"><strong class="font-medium text-secondary">Physical space, not a pixel collage.</strong> Each screen gets its own crop at its own density. Objects stay the same size across your desk.</p>
        </div>
      </section>
    </main>

    <footer class="flex flex-col justify-between gap-3 py-6 text-[10px] leading-relaxed text-base-content/55 md:flex-row md:items-center">
      <span class="flex items-center gap-2"><span class="status status-xs" :class="storageAvailable ? 'status-success' : 'status-warning'" aria-hidden="true"></span>{{ storageAvailable ? 'Monitor setup saved on this device' : 'Storage unavailable — settings will not survive a reload' }}</span>
      <span>Images stay in memory, not in storage. <span class="mx-2 text-secondary/50">/</span> Made for mismatched monitors.</span>
    </footer>

    <div v-if="dragDepth > 0 && !busy" class="pointer-events-none fixed inset-3 z-30 grid place-items-center rounded-box border-2 border-dashed border-secondary bg-base-300/95 text-center backdrop-blur-sm">
      <div><AppIcon name="upload" :size="36" class="mx-auto mb-6 text-secondary" /><h2 class="text-3xl font-semibold tracking-tight">Drop your next view.</h2><p class="mt-3 text-sm text-base-content/65">One JPEG or PNG. Entirely local.</p></div>
    </div>
    <div v-if="busy" class="fixed inset-0 z-40 grid place-items-center bg-base-300/90 p-5 backdrop-blur-sm" role="status" aria-live="polite">
      <div class="card card-border w-full max-w-md border-secondary/20 bg-base-100 text-center shadow-xl">
        <div class="card-body items-center gap-4 py-10">
          <span class="loading loading-infinity loading-lg text-secondary" aria-hidden="true"></span>
          <h2 class="card-title text-xl">{{ importing ? 'Preparing your preview' : 'Slicing your wallpaper' }}</h2>
          <p class="text-sm leading-relaxed text-base-content/65">{{ importing ? 'Decoding locally. Large images can take a moment.' : `Rendering from the original · ${progress.completed} of ${progress.total} screens complete` }}</p>
          <progress v-if="exporting" class="progress mt-2 w-full" :value="progress.completed" :max="progress.total" aria-label="Wallpaper export progress"></progress>
          <p class="mt-2 font-mono text-[10px] uppercase tracking-wider text-secondary">Your pixels never leave this browser.</p>
        </div>
      </div>
    </div>

    <dialog id="wallpaper-exports" ref="exportDialog" class="modal" aria-labelledby="export-title" @close="clearDownloads">
      <div class="modal-box max-w-xl border border-secondary/20 bg-base-100 p-6 sm:p-8">
        <div class="mb-6 flex items-start justify-between">
          <span class="grid size-12 place-items-center rounded-box border border-secondary/30 bg-secondary/10 text-secondary"><AppIcon name="check" :size="25" /></span>
          <form method="dialog"><button class="btn btn-ghost btn-sm btn-square" aria-label="Close exports"><AppIcon name="close" /></button></form>
        </div>
        <p class="font-mono text-[10px] uppercase tracking-widest text-secondary">Export / Complete</p>
        <h2 id="export-title" class="mt-2 text-2xl font-semibold tracking-tight">Your wallpapers are ready.</h2>
        <p class="mt-3 text-sm leading-relaxed text-base-content/65">Download each PNG, then assign it to the matching display in your operating system’s wallpaper settings. Use each image on its own screen, not a spanned wallpaper.</p>
        <div class="my-6 space-y-3">
          <a v-for="(download, index) in downloads" :key="download.monitorId" :href="download.url" :download="download.filename" class="btn h-auto w-full justify-start gap-3 px-4 py-4 text-left" :data-testid="`download-${index}`">
            <AppIcon name="monitor" :size="24" class="shrink-0 text-secondary" />
            <span class="min-w-0 flex-1"><strong class="block text-xs font-medium break-all whitespace-normal">{{ download.filename }}</strong><span class="mt-1 block font-mono text-[10px] font-normal text-base-content/65">{{ download.width }} × {{ download.height }} · {{ (download.blob.size / 1024 / 1024).toFixed(1) }} MB</span></span>
            <AppIcon name="download" class="shrink-0 text-secondary" />
          </a>
        </div>
        <form method="dialog" class="modal-action"><button class="btn btn-block">Back to composing</button></form>
      </div>
      <form method="dialog" class="modal-backdrop"><button aria-label="Close export dialog">close</button></form>
    </dialog>
  </div>
</template>
