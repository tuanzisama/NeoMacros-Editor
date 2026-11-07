<script setup lang="ts">
/** 设置页：连接（地址/本机设备/服务端设备）+ 编辑器 + 关于。 */
import { ref, onMounted } from 'vue'
import { connection, connect as apiConnect, forgetDevice } from '@/stores/connection'
import { macros } from '@/stores/macros'
import { settings, resetSettings } from '@/stores/settings'
import { MONACO_LOCALES, LOCALE_LABELS } from '@/monaco/locale'
import { notify, backToExplorer } from '@/stores/workspace'
import { listDevices, revokeDevice } from '@/api/endpoints'
import type { DeviceRecord } from '@/types/api'
import AppIcon from '@/components/ui/AppIcon.vue'

const hostInput = ref(connection.host)
const connecting = ref(false)

const devices = ref<DeviceRecord[] | null>(null)
const devicesError = ref('')

async function doConnect(): Promise<void> {
  connecting.value = true
  try {
    await apiConnect(hostInput.value.trim())
    notify(connection.status === 'online' ? '已连接' : connection.error || '未连接', connection.status === 'online' ? 'success' : 'error')
  } finally {
    connecting.value = false
  }
}

async function loadDevices(): Promise<void> {
  devicesError.value = ''
  devices.value = null
  try {
    devices.value = await listDevices()
  } catch (e) {
    devicesError.value = e instanceof Error ? e.message : String(e)
  }
}

async function forget(): Promise<void> {
  await forgetDevice()
  notify('已解除本机配对（服务端记录仍在，可重新配对或吊销）', 'info')
}

async function revoke(id: string): Promise<void> {
  try {
    await revokeDevice(id)
    notify(`已吊销设备 ${id}`, 'success')
    await loadDevices()
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), 'error')
  }
}

onMounted(() => {
  if (connection.status === 'online') void loadDevices()
})

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h} 时 ${m % 60} 分`
  if (m > 0) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}
</script>

<template>
  <div class="settings-view">
    <header class="view-header">
      <h1>设置</h1>
      <button class="btn btn-ghost" @click="backToExplorer">
        <AppIcon name="close" :size="13" />
        关闭
      </button>
    </header>

    <div class="sections">
      <!-- 连接 -->
      <section class="card">
        <h2>连接</h2>
        <div class="row">
          <input v-model="hostInput" class="grow mono" placeholder="127.0.0.1:9454" spellcheck="false" @keydown.enter="doConnect" />
          <button class="btn btn-primary" :disabled="connecting || !hostInput.trim()" @click="doConnect">
            {{ connecting ? '连接中…' : '重新连接' }}
          </button>
        </div>
        <p class="hint">修改地址会重新走 meta 首探；本机设备凭据按地址隔离存于 IndexedDB。</p>

        <div class="sub">
          <h3>本机设备</h3>
          <template v-if="connection.device">
            <div class="device-row">
              <AppIcon name="link" :size="14" />
              <span class="grow">{{ connection.device.label }}</span>
              <span class="mono dim">{{ connection.device.clientId }} · {{ connection.device.algo }}</span>
              <button class="btn btn-ghost" @click="forget">解除配对</button>
            </div>
          </template>
          <p v-else class="hint">未配对。回到连接页完成配对。</p>
        </div>

        <div class="sub">
          <div class="sub-head">
            <h3>服务端受信设备</h3>
            <button v-if="connection.status === 'online'" class="btn btn-ghost" @click="loadDevices">
              <AppIcon name="refresh" :size="13" />
              刷新
            </button>
          </div>
          <p v-if="connection.status !== 'online'" class="hint">未连接。</p>
          <p v-else-if="devicesError" class="hint">
            无法读取（{{ devicesError }}）。设备管理端点属 mod 侧 W2 里程碑，落地后此处可用。
          </p>
          <template v-else-if="devices">
            <div v-for="d in devices" :key="d.id" class="device-row">
              <AppIcon name="key" :size="14" />
              <span class="grow">{{ d.label }}</span>
              <span class="mono dim">{{ d.id }} · {{ d.algo }}</span>
              <button class="btn btn-ghost" title="吊销" @click="revoke(d.id)">
                <AppIcon name="trash" :size="13" />
              </button>
            </div>
            <p v-if="devices && devices.length === 0" class="hint">没有受信设备。</p>
          </template>
        </div>

        <div v-if="connection.meta" class="sub">
          <h3>服务信息</h3>
          <div class="kv">
            <span>mod 版本</span><span class="mono">{{ connection.meta.modVersion }}</span>
            <span>游戏版本</span><span class="mono">{{ connection.meta.gameVersion }}</span>
            <span>API</span><span class="mono">v{{ connection.meta.api.join(' · v') }}</span>
            <template v-if="macros.server">
              <span>监听</span><span class="mono">{{ macros.server.listen }} :{{ macros.server.port }}</span>
              <span>运行时长</span><span class="mono">{{ fmtUptime(macros.server.uptimeMs) }}</span>
            </template>
          </div>
        </div>
      </section>

      <!-- 编辑器 -->
      <section class="card">
        <h2>编辑器</h2>
        <div class="opt-row">
          <label class="grow" for="set-theme">主题</label>
          <select id="set-theme" v-model="settings.theme" class="num">
            <option value="dark">深色</option>
            <option value="light">浅色</option>
            <option value="auto">跟随系统</option>
          </select>
        </div>
        <div class="opt-row">
          <label class="grow" for="set-lang">
            语言
            <span class="hint-inline">编辑器界面文案；刷新页面后生效</span>
          </label>
          <select id="set-lang" v-model="settings.language" class="num">
            <option value="auto">自动识别</option>
            <option v-for="l in MONACO_LOCALES" :key="l" :value="l">{{ LOCALE_LABELS[l] }}</option>
          </select>
        </div>
        <div class="opt-row">
          <label class="grow" for="set-font">字号</label>
          <input id="set-font" v-model.number="settings.fontSize" type="number" min="10" max="28" class="num" />
        </div>
        <div class="opt-row">
          <label class="grow" for="set-tab">缩进宽度</label>
          <select id="set-tab" v-model.number="settings.tabSize" class="num">
            <option :value="2">2</option>
            <option :value="4">4</option>
            <option :value="8">8</option>
          </select>
        </div>
        <div class="opt-row">
          <label class="grow" for="set-wrap">自动换行</label>
          <input id="set-wrap" v-model="settings.wordWrap" type="checkbox" class="checkbox" />
        </div>
        <div class="opt-row">
          <label class="grow" for="set-minimap">缩略图（minimap）</label>
          <input id="set-minimap" v-model="settings.minimap" type="checkbox" class="checkbox" />
        </div>
        <div class="opt-row">
          <label class="grow" for="set-checkjs">
            JS 语义诊断（checkJs）
            <span class="hint-inline">语法错误恒开；开启后按 neomacros.d.ts 做类型检查</span>
          </label>
          <input id="set-checkjs" v-model="settings.checkJs" type="checkbox" class="checkbox" />
        </div>
        <div class="opt-row">
          <span class="grow" />
          <button class="btn btn-ghost" @click="resetSettings">恢复默认</button>
        </div>
      </section>

      <!-- 关于 -->
      <section class="card">
        <h2>关于</h2>
        <p class="hint">
          NeoMacros 面板 —— 与游戏内 v2 面板同源的网页版宏管理与脚本编辑器。
          密钥仅存于本浏览器（IndexedDB，不可导出）；所有状态来自本机 mod 服务。
        </p>
        <div v-if="connection.status === 'online'" class="kv">
          <span>实时 API 契约</span>
          <a class="mono link" :href="`http://${connection.host}/api-docs/openapi.json`" target="_blank" rel="noopener">
            /api-docs/openapi.json
          </a>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow-y: auto;
  padding: 0 0 32px;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 22px 8px;
  position: sticky;
  top: 0;
  background: var(--bg-app);
  z-index: 2;
}

h1 {
  font-size: 18px;
  margin: 0;
  font-weight: 600;
}

.sections {
  max-width: 720px;
  padding: 0 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
}

h2 {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--text-1);
}

h3 {
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--text-2);
}

.sub {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--divider);
}

.sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.sub-head h3 {
  margin: 0;
}

.row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.grow {
  flex: 1;
  min-width: 0;
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.dim {
  color: var(--text-3);
}

.hint {
  font-size: 11px;
  color: var(--text-3);
  margin: 4px 0 0;
  line-height: 1.7;
}

.hint-inline {
  display: block;
  font-size: 10px;
  color: var(--text-3);
  font-weight: 400;
}

.device-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 12px;
}

.device-row svg {
  color: var(--text-3);
}

.kv {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 4px 14px;
  font-size: 12px;
}

.kv > span:first-child {
  color: var(--text-3);
}

.link {
  color: var(--accent);
  text-decoration: none;
  user-select: text;
}

.link:hover {
  text-decoration: underline;
}

.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
}

.num {
  width: 72px;
}

.checkbox {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  padding: 0;
}
</style>
