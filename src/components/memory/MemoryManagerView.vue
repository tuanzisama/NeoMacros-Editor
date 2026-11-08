<script setup lang="ts">
/** 内存主视图（活动栏「内存」入口）：与 DevTools 内存页签共用 store 与图表。 */
import MemoryPanel from '@/components/memory/MemoryPanel.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { backToExplorer } from '@/stores/workspace'
</script>

<template>
  <div class="memory-manager-view">
    <div class="view-header">
      <AppIcon name="memory" :size="16" />
      <span>内存</span>
      <button class="btn btn-ghost back-btn" @click="backToExplorer">返回编辑器</button>
    </div>
    <MemoryPanel />
  </div>
</template>

<style scoped>
.memory-manager-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
}

.view-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--divider);
  flex: none;
}

.back-btn {
  margin-left: auto;
  font-size: 12px;
}
</style>
