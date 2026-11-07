<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  connection,
  connect as apiConnect,
  pair,
  pairWithoutToken,
  lastHost,
} from '@/stores/connection'

const hostInput = ref(connection.host || lastHost() || '127.0.0.1:9454')
const connecting = ref(false)
const tokenInput = ref(connection.pendingPairToken)
/** 免 token 申请已提交、正等游戏内点击确认卡片 */
const waitingConfirm = ref(false)

// 深链连接成功后同步真实地址（boot 时组件先于连接挂载，初值可能取自 lastHost）
watch(
  () => connection.host,
  (h) => {
    if (h) hostInput.value = h
  },
)

// 深链带入的 token 回填到输入框
watch(
  () => connection.pendingPairToken,
  (t) => {
    if (t && !tokenInput.value.trim()) tokenInput.value = t
  },
)

const busy = computed(() => connecting.value || connection.pairing)
const tokenFilled = computed(() => tokenInput.value.trim().length > 0)
const canSubmit = computed(() => hostInput.value.trim().length > 0 && !busy.value)
const buttonLabel = computed(() => {
  if (waitingConfirm.value) return '等待游戏内确认…'
  if (connection.pairing) return '配对中…'
  if (connecting.value) return '连接中…'
  return tokenFilled.value ? '连接并配对' : '连接'
})

/**
 * 连接；已配对的设备直接回在线（无需 token）。待配对时按 token 有无分流（契约 §4/§4.1）：
 * 有 token 走深链配对，无 token 走免 token 申请（仅本机回环，游戏内出确认卡片）。
 */
async function doConnect(): Promise<void> {
  if (!canSubmit.value) return
  connecting.value = true
  connection.error = ''
  try {
    await apiConnect(hostInput.value.trim())
    if (connection.status === 'unpaired') {
      const token = tokenInput.value.trim()
      if (token) {
        await pair(token)
        tokenInput.value = ''
      } else {
        waitingConfirm.value = true
        try {
          await pairWithoutToken()
        } finally {
          waitingConfirm.value = false
        }
      }
    }
  } catch (e) {
    connection.error = e instanceof Error ? e.message : String(e)
  } finally {
    connecting.value = false
  }
}
</script>

<template>
  <div class="connect-view">
    <div class="hero">
      <div class="mark">▣</div>
      <h1>NeoMacros 面板</h1>
      <p class="sub">管理按键 / 事件 / 服务宏，用内置 Monaco 编辑器编写脚本。</p>
    </div>

    <section class="card">
      <input
        v-model="hostInput"
        class="field-input"
        placeholder="服务地址，如 127.0.0.1:30636"
        spellcheck="false"
        @keydown.enter="doConnect"
      />
      <input
        v-model="tokenInput"
        class="field-input"
        placeholder="配对 token（可留空，本机浏览器免 token 配对）"
        spellcheck="false"
        @keydown.enter="doConnect"
      />
      <button class="btn btn-primary connect-btn" :disabled="!canSubmit" @click="doConnect">
        {{ buttonLabel }}
      </button>
      <p v-if="connection.status === 'reconnecting'" class="note-text">
        游戏离线，自动重连中…（服务恢复后自动上线）
      </p>
      <p v-if="connection.error" class="error-text">{{ connection.error }}</p>
    </section>
  </div>
</template>

<style scoped>
.connect-view {
  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10vh 24px 48px;
  gap: 24px;
}

.hero {
  text-align: center;
}

.mark {
  font-size: 34px;
  color: var(--accent);
  line-height: 1;
}

h1 {
  font-size: 22px;
  margin: 10px 0 4px;
  font-weight: 600;
}

.sub {
  color: var(--text-2);
  margin: 0;
}

.card {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 18px;
}

.field-input {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12px;
}

.connect-btn {
  justify-content: center;
}

.error-text {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
}

.note-text {
  color: var(--text-2);
  font-size: 12px;
  margin: 0;
}
</style>
