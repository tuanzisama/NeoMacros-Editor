<script setup lang="ts">
/**
 * 更新横幅：mod 检查到渠道内有新版本时经 SSE 推送，叠在应用顶部
 * （ReconnectBanner 同位）。提供「查看更新」（打开发布说明）、「忽略此
 * 版本」（跨会话）与「关闭」（仅本会话）三个出口。
 */
import { computed } from 'vue'
import { connection } from '@/stores/connection'
import { updates, dismissUpdate, ignoreUpdate } from '@/stores/updates'
import AppIcon from '@/components/ui/AppIcon.vue'

/** 已连接会话内才展示；连接页保持干净 */
const visible = computed(() => connection.sessionEstablished && updates.latest !== null)

const text = computed(() => {
  const event = updates.latest
  if (!event) return ''
  const channelLabel = event.channel === 'release' ? '正式版' : `${event.channel} 渠道`
  const from = updates.current ? `，当前 ${updates.current}` : ''
  return `NeoMacros 有新版本 ${event.latest}（${channelLabel}）${from}`
})

/** 打开发布说明（旧版 mod 未带 notes 时降级为仓库页） */
function openNotes(): void {
  const url = updates.latest?.notes || 'https://github.com/tuanzisama/NeoMacros/releases'
  window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <div v-if="visible" class="update-banner" role="status">
    <AppIcon name="warn" :size="15" />
    <span class="text">{{ text }}</span>
    <button class="banner-btn" @click="openNotes">查看更新</button>
    <button class="banner-btn ghost" title="跨会话不再提示此版本" @click="ignoreUpdate">
      忽略此版本
    </button>
    <button class="banner-btn ghost" @click="dismissUpdate">关闭</button>
  </div>
</template>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  font-size: 12px;
  border-bottom: 1px solid var(--divider);
  flex: none;
  user-select: none;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-chrome));
  color: var(--text-1);
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
