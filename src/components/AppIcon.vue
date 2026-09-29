<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
const paths: Record<string, string> = {
  slice: 'M5 3v18M19 3v18M3 7h18M3 17h18M10 11l4 2-4 2z',
  monitor: 'M4 4h16a1 1 0 0 1 1 1v11H3V5a1 1 0 0 1 1-1ZM8 21h8M12 16v5',
  image: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 16l6-6 5 5 3-3 4 4M16 7h.01',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  reset: 'M3 11a9 9 0 1 1 2 7M3 4v7h7',
  lock: 'M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4',
  arrows: 'M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4',
  left: 'M4 4v16M8 8h12v8H8V8Z',
  center: 'M12 3v18M5 8h14v8H5V8Z',
  right: 'M20 4v16M4 8h12v8H4V8Z',
  top: 'M4 4h16M8 8h8v12H8V8Z',
  middle: 'M3 12h18M8 5h8v14H8V5Z',
  bottom: 'M4 20h16M8 4h8v12H8V4Z',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] ?? paths.monitor" />
  </svg>
</template>
