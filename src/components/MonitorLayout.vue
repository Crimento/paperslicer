<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import { getLayoutBounds, getMonitorRect, getOutputSize, snapRect } from '../lib/geometry'
import { MONITOR_COLORS } from '../lib/settings'
import { paddedBounds, pointerInSvg, snapThreshold, viewBox } from '../lib/viewport'
import type { Guide, Monitor, Point, Rect } from '../lib/types'

const props = defineProps<{ monitors: Monitor[]; selectedId: string; snapping: boolean }>()
const emit = defineEmits<{
  select: [id: string]
  move: [id: string, position: Point]
}>()
const svg = ref<SVGSVGElement>()
const drag = shallowRef<{ pointerId: number; id: string; start: Point; origin: Rect; viewport: Rect } | null>(null)
const guides = ref<Guide[]>([])
const bounds = computed(() => getLayoutBounds(props.monitors))
const viewport = computed(() => drag.value?.viewport ?? paddedBounds(bounds.value, 0.12))
const screens = computed(() => props.monitors.map((monitor, index) => ({
  monitor, rect: getMonitorRect(monitor), output: getOutputSize(monitor), color: MONITOR_COLORS[index], index,
})))
const labelSize = computed(() => viewport.value.width / 46)

async function startDrag(event: PointerEvent, monitor: Monitor) {
  if (event.button !== 0 || !svg.value || drag.value) return
  event.preventDefault()
  const target = event.currentTarget as SVGGElement
  target.focus()
  emit('select', monitor.id)
  svg.value.setPointerCapture(event.pointerId)
  // Focusing commits pending form edits; use their updated geometry as the drag origin.
  await nextTick()
  if (!svg.value?.hasPointerCapture(event.pointerId)) return
  const current = props.monitors.find((item) => item.id === monitor.id)
  if (!current) return
  drag.value = {
    pointerId: event.pointerId, id: monitor.id, start: pointerInSvg(svg.value, event),
    origin: getMonitorRect(current), viewport: { ...viewport.value },
  }
}

function moveDrag(event: PointerEvent) {
  const active = drag.value
  if (!active || !svg.value || event.pointerId !== active.pointerId) return
  const point = pointerInSvg(svg.value, event)
  const moving = { ...active.origin, x: active.origin.x + point.x - active.start.x, y: active.origin.y + point.y - active.start.y }
  const result = props.snapping && !event.shiftKey
    ? snapRect(moving, screens.value.filter((screen) => screen.monitor.id !== active.id).map((screen) => screen.rect), snapThreshold(svg.value))
    : { ...moving, guides: [] }
  guides.value = result.guides
  emit('move', active.id, { x: result.x, y: result.y })
}

function endDrag(event: PointerEvent) {
  if (!drag.value || event.pointerId !== drag.value.pointerId) return
  drag.value = null
  guides.value = []
  if (svg.value?.hasPointerCapture(event.pointerId)) svg.value.releasePointerCapture(event.pointerId)
}

function nudge(event: KeyboardEvent, monitor: Monitor) {
  const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault()
  const step = event.shiftKey ? 10 : 1
  emit('move', monitor.id, { x: monitor.x + direction.x * step, y: monitor.y + direction.y * step })
}
</script>

<template>
  <div class="drafting-grid relative h-[216px]">
    <svg ref="svg" class="block h-[184px] w-full touch-none p-3" data-testid="monitor-layout" :viewBox="viewBox(viewport)" aria-label="Physical monitor layout" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
      <g v-for="screen in screens" :key="screen.monitor.id" class="draggable-monitor cursor-grab active:cursor-grabbing" tabindex="0" role="button" :aria-label="`Monitor ${screen.index + 1}: ${screen.monitor.name}. Use arrow keys to move.`" :aria-pressed="screen.monitor.id === selectedId" :data-testid="`layout-${screen.monitor.id}`" @pointerdown="startDrag($event, screen.monitor)" @focus="emit('select', screen.monitor.id)" @keydown="nudge($event, screen.monitor)">
        <rect v-bind="screen.rect" :rx="labelSize / 3" :fill="screen.color" :fill-opacity="screen.monitor.id === selectedId ? 0.2 : 0.08" :stroke="screen.color" :stroke-width="screen.monitor.id === selectedId ? 2 : 1" vector-effect="non-scaling-stroke" />
        <text :x="screen.rect.x + screen.rect.width / 2" :y="screen.rect.y + screen.rect.height / 2 - labelSize * 0.15" :font-size="labelSize * 1.8" :fill="screen.color" text-anchor="middle" font-weight="600" class="pointer-events-none select-none">{{ screen.index + 1 }}</text>
        <text :x="screen.rect.x + screen.rect.width / 2" :y="screen.rect.y + screen.rect.height / 2 + labelSize * 1.35" :font-size="labelSize * 0.75" fill="var(--color-base-content)" text-anchor="middle" class="pointer-events-none select-none">{{ screen.output.width }} × {{ screen.output.height }}</text>
      </g>
      <line v-for="guide in guides" :key="guide.axis" :x1="guide.axis === 'x' ? guide.position : viewport.x" :x2="guide.axis === 'x' ? guide.position : viewport.x + viewport.width" :y1="guide.axis === 'y' ? guide.position : viewport.y" :y2="guide.axis === 'y' ? guide.position : viewport.y + viewport.height" class="snap-guide" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="pointer-events-none absolute right-4 bottom-3 left-4 flex items-center justify-between gap-2 text-[10px] text-base-content/55"><span>Drag screens to match your desk</span><span class="font-mono uppercase tracking-wide text-secondary/70">mm / scale</span></div>
  </div>
</template>
