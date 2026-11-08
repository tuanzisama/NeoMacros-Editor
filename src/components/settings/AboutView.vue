<script setup lang="ts">
import { connection } from '@/stores/connection'
import { backToExplorer } from '@/stores/workspace'
import AppIcon from '@/components/ui/AppIcon.vue'
</script>

<template>
  <div class="about-view">
    <div class="card">
      <div class="mark">▣</div>
      <h1>NeoMacros 面板</h1>
      <p class="sub">按键 / 事件 / 服务三类宏的网页版管理与 Monaco 脚本编辑器。</p>
      <div v-if="connection.meta" class="meta">
        <span>mod v{{ connection.meta.modVersion
          }}<em v-if="connection.meta.channel" class="channel">{{ connection.meta.channel }}</em></span>
        <span>Minecraft {{ connection.meta.gameVersion }}</span>
        <span>Panel API v1</span>
      </div>
      <p class="hint">
        配对设备的私钥只存在本浏览器（IndexedDB，不可导出），每请求 Ed25519/ECDSA 签名；
        面板本身无后端，一切数据来自游戏内 NeoMacros 服务。
      </p>
      <button class="btn btn-ghost back" @click="backToExplorer">
        <AppIcon name="close" :size="13" />
        关闭
      </button>
    </div>
  </div>
</template>

<style scoped>
.about-view {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.card {
  text-align: center;
  max-width: 460px;
  padding: 32px;
}

.mark {
  font-size: 40px;
  color: var(--accent);
}

h1 {
  font-size: 20px;
  margin: 12px 0 4px;
  font-weight: 600;
}

.sub {
  color: var(--text-2);
  margin: 0 0 16px;
}

.channel {
  font-style: normal;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}

.meta {
  display: flex;
  justify-content: center;
  gap: 16px;
  font-size: 12px;
  color: var(--text-3);
  font-family: var(--font-mono);
  margin-bottom: 16px;
}

.hint {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.8;
  margin: 0 0 20px;
}

.back {
  margin: 0 auto;
  display: inline-flex;
}
</style>
