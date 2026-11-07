<script setup lang="ts">
import { computed } from 'vue'
import { workspace, toggleDevTools } from '@/stores/workspace'
import { counts } from '@/stores/macros'
import { editor, activeTab, cursor } from '@/stores/editor'
import { levelCounts } from '@/stores/logs'
import { sse } from '@/api/sse'
import { connection } from '@/stores/connection'
import AppIcon from '@/components/ui/AppIcon.vue'

const sseLabel = computed(() => {
  if (connection.status !== 'online') return '—'
  switch (sse.status.value) {
    case 'off':
      return '—'
    case 'connecting':
      return '事件流连接中'
    case 'open':
      return '事件流已连接'
    case 'reconnecting':
      return '事件流重连中'
  }
})

const saveLabel = computed(() => {
  const tab = activeTab.value
  if (!tab || tab.definition) return ''
  if (tab.saving) return '保存中…'
  if (tab.dirty) return '未保存'
  return '已保存'
})

const langLabel = computed(() => {
  if (activeTab.value?.definition) return 'TypeScript'
  switch (activeTab.value?.language) {
    case 'javascript':
      return 'JavaScript'
    case 'yaml':
      return 'YAML'
    case 'plaintext':
      return '纯文本'
    default:
      return ''
  }
})

const feedbackClass = computed(() => workspace.feedback?.kind ?? 'info')
</script>

<template>
  <footer class="status-bar">
    <div class="left">
      <button class="devtools-btn" :class="{ open: workspace.bottomPanelOpen }" @click="toggleDevTools">
        <AppIcon name="terminal" :size="13" />
        <span>DevTools</span>
        <span class="badges">
          <span class="cnt info" :class="{ zero: levelCounts.info === 0 }">{{ levelCounts.info }}</span>
          <span class="cnt warn" :class="{ zero: levelCounts.warn === 0 }">{{ levelCounts.warn }}</span>
          <span class="cnt err" :class="{ zero: levelCounts.error === 0 }">{{
            levelCounts.error
          }}</span>
        </span>
      </button>
      <span v-if="workspace.feedback" class="feedback" :class="feedbackClass">
        {{ workspace.feedback.text }}
      </span>
      <span v-else-if="connection.status === 'online'" class="stats">
        {{ counts.total }} 宏 · {{ counts.enabled }} 已启用 · {{ counts.running }} 运行中
      </span>
      <span v-else-if="connection.status === 'reconnecting'" class="stats reconnecting">
        游戏离线，自动重连中…
      </span>
      <span v-else class="stats">未连接到 NeoMacros 服务</span>
    </div>
    <div class="right">
      <template v-if="activeTab">
        <span>行 {{ cursor.line }}, 列 {{ cursor.column }}</span>
        <span :class="{ dirty: activeTab.dirty }">{{ saveLabel }}</span>
        <span>{{ langLabel }}</span>
        <span>UTF-8</span>
      </template>
      <span :class="{ live: sse.status.value === 'open' }">{{ sseLabel }}</span>
      <span v-if="editor.tabs.length > 0">{{ editor.tabs.length }} 个文件</span>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  height: var(--statusbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px  0 0;
  background: var(--bg-chrome);
  border-top: 1px solid var(--divider);
  font-size: 11px;
  color: var(--text-2);
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.left {
  align-self: stretch;
}

/* DevTools 入口：贴满状态栏高度，badge 按级别着色（0 计数置灰） */
.devtools-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  align-self: stretch;
  padding: 0 12px;
  border-radius: 0;
  color: var(--text-2);
  font-size: 11px;
  flex: none;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.devtools-btn:hover {
  background: var(--hover);
  color: var(--text-1);
}

.devtools-btn.open {
  background: var(--active);
  color: var(--text-1);
}

/* 徽章组：与文字拉开一档，组内更紧 */
.badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cnt {
  min-width: 17px;
  height: 14px;
  line-height: 14px;
  padding: 0 5px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}

.cnt.info {
  background: var(--accent);
  color: var(--on-accent);
}

.cnt.warn {
  background: var(--warning);
  color: var(--on-accent);
}

.cnt.err {
  background: var(--danger);
  color: var(--on-danger);
}

.cnt.zero {
  background: var(--control);
  color: var(--text-3);
}

.feedback {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feedback.success {
  color: var(--success);
}

.feedback.warning {
  color: var(--warning);
}

.feedback.error {
  color: var(--danger);
}

.stats {
  color: var(--text-2);
}

.stats.reconnecting {
  color: var(--warning);
}

.dirty {
  color: var(--warning);
}

.live {
  color: var(--success);
}
</style>
