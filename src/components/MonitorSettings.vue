<script setup lang="ts">
import { computed } from 'vue'
import { getMonitorSize, getOutputSize } from '../lib/geometry'
import type { Monitor } from '../lib/types'

const props = defineProps<{ monitor: Monitor; index: number }>()
const emit = defineEmits<{ update: [id: string, patch: Partial<Monitor>] }>()
const physical = computed(() => getMonitorSize(props.monitor))
const output = computed(() => getOutputSize(props.monitor))
const measured = computed(() => props.monitor.physicalWidthMm !== undefined)
const ppi = computed(() => output.value.width / physical.value.width * 25.4)

function numberChange(event: Event, field: keyof Monitor) {
  const input = event.target as HTMLInputElement
  const value = input.valueAsNumber
  if (!input.checkValidity() || !Number.isFinite(value)) {
    input.reportValidity()
    input.value = String(props.monitor[field] ?? '')
    return
  }
  emit('update', props.monitor.id, { [field]: value })
  // The parent may reject a combined constraint, such as the total output pixel limit.
  input.value = String(props.monitor[field] ?? '')
}

function nameChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.value.trim()) emit('update', props.monitor.id, { name: input.value.trim() })
  else input.value = props.monitor.name
}

function toggleMeasured(event: Event) {
  if ((event.target as HTMLInputElement).checked) {
    const size = getMonitorSize({ ...props.monitor, rotation: 0 })
    emit('update', props.monitor.id, { physicalWidthMm: Math.round(size.width * 10) / 10, physicalHeightMm: Math.round(size.height * 10) / 10 })
  } else {
    emit('update', props.monitor.id, { physicalWidthMm: undefined, physicalHeightMm: undefined })
  }
}
</script>

<template>
  <section class="min-w-0 p-5" aria-label="Selected monitor settings">
    <div class="mb-4 flex items-center justify-between gap-2">
      <h3 class="text-xs font-medium">Screen {{ index + 1 }} details</h3>
      <span class="badge badge-ghost badge-sm font-mono text-[10px] text-secondary">{{ ppi.toFixed(1) }} PPI</span>
    </div>
    <fieldset class="fieldset gap-4 p-0">
      <legend class="sr-only">Monitor dimensions and placement</legend>
      <label class="grid gap-2 text-base-content/75">Name<input class="input input-sm w-full" :value="monitor.name" maxlength="60" required @change="nameChange" /></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="grid min-w-0 gap-2 text-base-content/75"><span class="flex justify-between gap-1">Native width <span class="font-mono text-[10px] text-base-content/45">px</span></span><input class="input input-sm w-full font-mono" aria-label="Native width (px)" type="number" :value="monitor.widthPx" min="1" max="16384" step="1" required @change="numberChange($event, 'widthPx')" /></label>
        <label class="grid min-w-0 gap-2 text-base-content/75"><span class="flex justify-between gap-1">Native height <span class="font-mono text-[10px] text-base-content/45">px</span></span><input class="input input-sm w-full font-mono" aria-label="Native height (px)" type="number" :value="monitor.heightPx" min="1" max="16384" step="1" required @change="numberChange($event, 'heightPx')" /></label>
        <label class="grid min-w-0 gap-2 text-base-content/75"><span class="flex justify-between gap-1">Diagonal <span class="font-mono text-[10px] text-base-content/45">in</span></span><input class="input input-sm w-full font-mono" aria-label="Diagonal (in)" type="number" :value="monitor.diagonalInches" :disabled="measured" min="1" max="150" step="0.1" required @change="numberChange($event, 'diagonalInches')" /></label>
        <label class="grid min-w-0 gap-2 text-base-content/75">Orientation<select class="select select-sm w-full" :value="monitor.rotation" @change="emit('update', monitor.id, { rotation: Number(($event.target as HTMLSelectElement).value) as 0 | 90 })"><option :value="0">Landscape</option><option :value="90">Portrait ↻</option></select></label>
      </div>
      <label class="label cursor-pointer gap-2 text-xs text-base-content/75"><input class="checkbox checkbox-sm" type="checkbox" :checked="measured" @change="toggleMeasured" />Use measured active area</label>
      <div v-if="measured" class="grid grid-cols-2 gap-3">
        <label class="grid min-w-0 gap-2 text-base-content/75"><span class="flex justify-between gap-1">Active width <span class="font-mono text-[10px] text-base-content/45">mm</span></span><input class="input input-sm w-full font-mono" aria-label="Active width (mm)" type="number" :value="monitor.physicalWidthMm" min="10" max="4000" step="0.1" required @change="numberChange($event, 'physicalWidthMm')" /></label>
        <label class="grid min-w-0 gap-2 text-base-content/75"><span class="flex justify-between gap-1">Active height <span class="font-mono text-[10px] text-base-content/45">mm</span></span><input class="input input-sm w-full font-mono" aria-label="Active height (mm)" type="number" :value="monitor.physicalHeightMm" min="10" max="4000" step="0.1" required @change="numberChange($event, 'physicalHeightMm')" /></label>
        <p class="col-span-2 text-[11px] leading-relaxed text-base-content/55">Measure the lit panel, without bezels, in its unrotated orientation.</p>
      </div>
      <div v-else class="flex items-center justify-between gap-2 rounded-field border border-base-content/10 bg-base-200 px-3 py-2.5 text-[11px]"><span class="text-base-content/55">Active area</span><strong class="font-mono font-normal">{{ (physical.width / 10).toFixed(1) }} × {{ (physical.height / 10).toFixed(1) }} cm</strong></div>
      <div class="grid grid-cols-2 gap-3">
        <label class="grid min-w-0 gap-2 text-base-content/75"><span class="flex justify-between gap-1">Position X <span class="font-mono text-[10px] text-base-content/45">mm</span></span><input class="input input-sm w-full font-mono" aria-label="Position X (mm)" type="number" :value="Number(monitor.x.toFixed(1))" min="-10000" max="10000" step="any" required @change="numberChange($event, 'x')" /></label>
        <label class="grid min-w-0 gap-2 text-base-content/75"><span class="flex justify-between gap-1">Position Y <span class="font-mono text-[10px] text-base-content/45">mm</span></span><input class="input input-sm w-full font-mono" aria-label="Position Y (mm)" type="number" :value="Number(monitor.y.toFixed(1))" min="-10000" max="10000" step="any" required @change="numberChange($event, 'y')" /></label>
      </div>
      <p class="text-[11px] leading-relaxed text-base-content/55">Positions are the top-left of each active area. Leave a gap for bezels; negative positions are fine.</p>
    </fieldset>
  </section>
</template>
