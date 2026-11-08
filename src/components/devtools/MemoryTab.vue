<script setup lang="ts">
/** DevTools 内存页签：复用共享内存面板（store 与图表同主视图一体）。 */
import MemoryPanel from '@/components/memory/MemoryPanel.vue'
</script>

<template>
  <div class="memory-tab">
    <MemoryPanel />
  </div>
</template>

<style scoped>
.memory-tab {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
