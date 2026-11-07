<script setup lang="ts">
/** 活动栏：顶部三个宏分类入口（横线分隔），下方为设置/关于；日志入口在状态栏。 */
import { computed } from 'vue'
import { workspace, selectActivity } from '@/stores/workspace'
import { macros, hasError } from '@/stores/macros'
import type { MacroCategory } from '@/types/api'
import AppIcon from '@/components/ui/AppIcon.vue'

const CATEGORY_ICONS: Record<MacroCategory, { icon: string; label: string }> = {
  keypress: { icon: 'key', label: '按键宏' },
  event: { icon: 'bolt', label: '事件宏' },
  services: { icon: 'server', label: '服务宏' },
}

const categories = computed(() =>
  (Object.keys(CATEGORY_ICONS) as MacroCategory[]).map((c) => ({
    id: c,
    ...CATEGORY_ICONS[c],
    errors: macros.macros.filter((m) => m.category === c && hasError(m)).length,
  })),
)

const others = [
  { id: 'tasks', icon: 'tasks', label: '任务管理器' },
  { id: 'settings', icon: 'settings', label: '设置' },
  { id: 'about', icon: 'info', label: '关于' },
] as const
</script>

<template>
  <nav class="activity-bar">
    <button
      v-for="c in categories"
      :key="c.id"
      class="activity-item"
      :class="{ active: workspace.activity === c.id }"
      :title="c.label"
      @click="selectActivity(c.id)"
    >
      <AppIcon :name="c.icon" :size="20" />
      <span v-if="c.errors > 0" class="badge err">{{
        c.errors > 9 ? '9+' : c.errors
      }}</span>
    </button>

    <div class="divider" role="separator" />

    <button
      v-for="item in others"
      :key="item.id"
      class="activity-item"
      :class="{ active: workspace.activity === item.id }"
      :title="item.label"
      @click="selectActivity(item.id)"
    >
      <AppIcon :name="item.icon" :size="20" />
    </button>
  </nav>
</template>

<style scoped>
.activity-bar {
  width: var(--activitybar-w);
  background: var(--bg-chrome);
  border-right: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 6px;
  gap: 2px;
}

.activity-item {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-3);
  position: relative;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.activity-item:hover {
  color: var(--text-1);
  background: var(--hover);
}

.activity-item.active {
  color: var(--accent);
  background: var(--active);
}

.divider {
  width: 24px;
  height: 1px;
  margin: 5px 0;
  background: var(--border);
}

.badge {
  position: absolute;
  right: 2px;
  bottom: 1px;
  font-size: 9px;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 6px;
  background: var(--control);
  color: var(--text-2);
}

.badge.err {
  background: var(--danger);
  color: var(--on-danger);
}
</style>
