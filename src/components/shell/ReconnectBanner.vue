<script setup lang="ts">
/**
 * 重连横幅：曾连接后断线（游戏重启/网络抖动/凭据失效）期间叠在应用顶部，
 * 主区保持原界面不清屏。重连中/不可达为黄色态（自动退避重试持续进行），
 * 凭据失效为红色态（需人工介入，给「重新配对」引导）；右侧始终提供
 * 「返回连接页」的手动出口。
 */
import { computed } from 'vue'
import { connection } from '@/stores/connection'
import AppIcon from '@/components/ui/AppIcon.vue'

/** 本次会话在线过且当前不在在线态才显示 */
const visible = computed(
  () => connection.sessionEstablished && connection.status !== 'online',
)

const variant = computed<'reconnecting' | 'unreachable' | 'unpaired'>(() => {
  if (connection.status === 'unpaired') return 'unpaired'
  if (connection.status === 'unreachable') return 'unreachable'
  return 'reconnecting'
})

const message = computed(() => {
  switch (variant.value) {
    case 'reconnecting':
      return '与游戏的连接已断开，正在自动重连…'
    case 'unreachable':
      return connection.error
        ? `无法连接：${connection.error}（将继续自动重试）`
        : '无法连接到游戏（将继续自动重试）'
    case 'unpaired':
      return connection.error || '配对已失效，需要重新配对后才能继续'
  }
})

/** 回到连接页（手动出口；主动断开态会复位 sessionEstablished） */
function backToConnect(): void {
  connection.sessionEstablished = false
}
</script>

<template>
  <div
    v-if="visible"
    class="reconnect-banner"
    :class="variant"
    role="status"
  >
    <span v-if="variant !== 'unreachable'" class="spinner" aria-hidden="true" />
    <AppIcon v-else name="warn" :size="15" />
    <span class="text">{{ message }}</span>
    <button v-if="variant === 'unpaired'" class="banner-btn" @click="backToConnect">
      重新配对
    </button>
    <button class="banner-btn ghost" title="返回连接页" @click="backToConnect">
      返回连接页
    </button>
  </div>
</template>

<style scoped>
.reconnect-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  font-size: 12px;
  border-bottom: 1px solid var(--divider);
  flex: none;
  user-select: none;
}

.reconnect-banner.reconnecting {
  background: color-mix(in srgb, var(--warning, #e8b339) 14%, var(--bg-chrome));
  color: var(--text-1);
}

.reconnect-banner.unreachable {
  background: color-mix(in srgb, var(--warning, #e8b339) 22%, var(--bg-chrome));
  color: var(--text-1);
}

.reconnect-banner.unpaired {
  background: color-mix(in srgb, var(--danger) 16%, var(--bg-chrome));
  color: var(--text-1);
}

.spinner {
  width: 13px;
  height: 13px;
  flex: none;
  border: 2px solid color-mix(in srgb, var(--text-3) 40%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: banner-spin 0.9s linear infinite;
}

@keyframes banner-spin {
  to {
    transform: rotate(360deg);
  }
}

.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner-btn {
  flex: none;
  background: var(--control);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 11px;
  padding: 3px 10px;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}

.banner-btn:hover {
  background: var(--hover);
}

.banner-btn.ghost {
  background: transparent;
  color: var(--text-3);
  border-color: transparent;
}

.banner-btn.ghost:hover {
  color: var(--text-1);
  background: var(--hover);
}
</style>
