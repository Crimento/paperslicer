<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId } from 'vue'
import { getImageRect, getLayoutBounds, getMonitorRect, scaleImageAtPoint, snapRect, fitImage } from '../lib/geometry'
import { MONITOR_COLORS } from '../lib/settings'
import { paddedBounds, pointerInSvg, snapThreshold, viewBox } from '../lib/viewport'
import type { Guide, ImageAsset, ImageTransform, Monitor, Point } from '../lib/types'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  monitors: Monitor[]; asset: ImageAsset | null; transform: ImageTransform
  backgroundColor: string; snapping: boolean; selectedId: string
}>()
const emit = defineEmits<{ transform: [value: ImageTransform]; choose: []; sample: [] }>()
const svg = ref<SVGSVGElement>()
const viewZoom = ref(1)
const clipId = useId()
const guides = ref<Guide[]>([])
const drag = shallowRef<{ pointerId: number; start: Point; origin: ImageTransform } | null>(null)
const bounds = computed(() => getLayoutBounds(props.monitors))
const viewport = computed(() => paddedBounds(bounds.value, 0.18, viewZoom.value))
const imageRect = computed(() => props.asset ? getImageRect(props.asset, props.transform) : null)
const screens = computed(() => props.monitors.map((monitor, index) => ({
  ...getMonitorRect(monitor), id: monitor.id, index, color: MONITOR_COLORS[index],
})))
const labelSize = computed(() => viewport.value.width / 65)

async function startDrag(event: PointerEvent) {
  if (!props.asset || !svg.value || event.button !== 0 || drag.value) return
  event.preventDefault()
  svg.value.focus()
  svg.value.setPointerCapture(event.pointerId)
  // A scale input may have just committed on blur. Don't overwrite it with stale props.
  await nextTick()
  if (!svg.value?.hasPointerCapture(event.pointerId)) return
  drag.value = { pointerId: event.pointerId, start: pointerInSvg(svg.value, event), origin: { ...props.transform } }
}

function moveDrag(event: PointerEvent) {
  const active = drag.value
  if (!active || !svg.value || !props.asset || event.pointerId !== active.pointerId) return
  const point = pointerInSvg(svg.value, event)
  const next = { ...active.origin, x: active.origin.x + point.x - active.start.x, y: active.origin.y + point.y - active.start.y }
  const result = props.snapping && !event.shiftKey
    ? snapRect(getImageRect(props.asset, next), [bounds.value], snapThreshold(svg.value))
    : { ...next, guides: [] }
  guides.value = result.guides
  emit('transform', { ...next, x: result.x, y: result.y })
}

function endDrag(event: PointerEvent) {
  if (!drag.value || event.pointerId !== drag.value.pointerId) return
  drag.value = null
  guides.value = []
  if (svg.value?.hasPointerCapture(event.pointerId)) svg.value.releasePointerCapture(event.pointerId)
}

function wheel(event: WheelEvent) {
  if (!props.asset || !svg.value) return
  event.preventDefault()
  if (drag.value) return
  const cover = fitImage(props.asset, bounds.value, 'cover').scale
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1)
  const scale = Math.min(cover * 8, Math.max(cover * 0.05, props.transform.scale * Math.exp(-delta * 0.0015)))
  emit('transform', scaleImageAtPoint(props.transform, pointerInSvg(svg.value, event), scale))
}

function nudge(event: KeyboardEvent) {
  if (!props.asset) return
  const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault()
  const step = event.shiftKey ? 10 : 1
  emit('transform', { ...props.transform, x: props.transform.x + direction.x * step, y: props.transform.y + direction.y * step })
}
</script>

<template>
  <div class="drafting-grid relative h-[380px] min-h-[360px] sm:h-[440px] lg:h-auto lg:flex-1">
    <svg ref="svg" class="absolute inset-0 block size-full touch-none overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-secondary" :class="asset ? (drag ? 'cursor-grabbing' : 'cursor-grab') : ''" data-testid="wallpaper-composer" :viewBox="viewBox(viewport)" tabindex="0" role="group" aria-label="Wallpaper position. Drag or use arrow keys to move. Scroll to scale the image." @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @wheel="wheel" @keydown="nudge">
      <defs><clipPath :id="clipId"><rect v-for="screen in screens" :key="screen.id" :x="screen.x" :y="screen.y" :width="screen.width" :height="screen.height" /></clipPath></defs>
      <image v-if="asset && imageRect" :href="asset.previewUrl" v-bind="imageRect" preserveAspectRatio="none" opacity="0.28" class="pointer-events-none select-none" />
      <g :clip-path="`url(#${clipId})`" class="pointer-events-none select-none">
        <rect v-bind="bounds" :fill="backgroundColor" />
        <image v-if="asset && imageRect" :href="asset.previewUrl" v-bind="imageRect" preserveAspectRatio="none" />
      </g>
      <g v-for="screen in screens" :key="screen.id" class="pointer-events-none select-none">
        <rect :x="screen.x" :y="screen.y" :width="screen.width" :height="screen.height" fill="none" :stroke="screen.color" :stroke-width="screen.id === selectedId ? 2 : 1" vector-effect="non-scaling-stroke" />
        <rect :x="screen.x + labelSize / 2" :y="screen.y + labelSize / 2" :width="labelSize * 1.5" :height="labelSize * 1.5" :rx="labelSize / 4" fill="var(--color-base-300)" fill-opacity="0.9" />
        <text :x="screen.x + labelSize * 1.25" :y="screen.y + labelSize * 1.6" :font-size="labelSize" :fill="screen.color" text-anchor="middle" font-weight="600">{{ screen.index + 1 }}</text>
      </g>
      <line v-for="guide in guides" :key="guide.axis" :x1="guide.axis === 'x' ? guide.position : viewport.x" :x2="guide.axis === 'x' ? guide.position : viewport.x + viewport.width" :y1="guide.axis === 'y' ? guide.position : viewport.y" :y2="guide.axis === 'y' ? guide.position : viewport.y + viewport.height" class="snap-guide" vector-effect="non-scaling-stroke" />
    </svg>
    <div v-if="!asset" class="absolute inset-0 flex flex-col items-center justify-center bg-base-300/80 p-5 text-center">
      <div class="relative mb-6 grid size-16 -rotate-6 place-items-center rounded-field border border-secondary/50 bg-base-100 text-secondary shadow-lg"><AppIcon name="image" :size="30" /><span class="absolute -right-2 -bottom-2 size-5 rounded-sm border border-secondary/40 bg-base-200" aria-hidden="true"></span></div>
      <p class="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-secondary/70">Your canvas is waiting</p>
      <h3 class="text-2xl font-medium tracking-tight">A view worth spanning.</h3>
      <p class="mt-3 text-xs leading-6 text-base-content/60">Drop a JPEG or PNG onto this workspace.<br />Your image never leaves this browser.</p>
      <button class="btn mt-5" @click="emit('choose')"><AppIcon name="plus" />Choose an image</button>
      <button class="btn btn-ghost btn-sm mt-2 font-normal" @click="emit('sample')"><AppIcon name="spark" :size="14" />Or try a sample</button>
    </div>
    <div class="join absolute right-4 bottom-4 shadow-sm" aria-label="Editor view zoom">
      <button class="btn btn-xs btn-square join-item" aria-label="Zoom editor view out" :disabled="viewZoom <= 0.25" @click="viewZoom = Math.max(0.25, viewZoom / 1.25)"><AppIcon name="minus" :size="14" /></button>
      <button class="btn btn-xs join-item font-mono text-[10px] font-normal" title="Reset editor view (does not change the wallpaper)" @click="viewZoom = 1">View {{ Math.round(viewZoom * 100) }}%</button>
      <button class="btn btn-xs btn-square join-item" aria-label="Zoom editor view in" :disabled="viewZoom >= 3" @click="viewZoom = Math.min(3, viewZoom * 1.25)"><AppIcon name="plus" :size="14" /></button>
    </div>
    <span v-if="asset" class="badge badge-outline badge-xs pointer-events-none absolute top-4 left-4 border-base-content/15 bg-base-300/85 font-mono text-[9px] uppercase tracking-wider text-base-content/65">Preview / original used for export</span>
  </div>
</template>
