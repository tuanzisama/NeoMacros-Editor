<script setup lang="ts">
/**
 * 应用外壳：标题栏 / 活动栏 / 侧栏（资源管理器）/ 主区 / DevTools 面板 / 状态栏 + 全局模态。
 * 启动编排（契约 §2）：query 深链（host+pair）→ meta 首探 → 自动配对 → 在线拉快照/日志/事件流。
 */

import { computed, watch, onMounted } from 'vue'
import TitleBar from '@/components/shell/TitleBar.vue'
import ActivityBar from '@/components/shell/ActivityBar.vue'
import StatusBar from '@/components/shell/StatusBar.vue'
import ReconnectBanner from '@/components/shell/ReconnectBanner.vue'
import ConnectView from '@/components/connect/ConnectView.vue'
import MacroSideBar from '@/components/explorer/MacroSideBar.vue'
import EditorArea from '@/components/editor/EditorArea.vue'
import NewMacroWizard from '@/components/editor/NewMacroWizard.vue'
import DeleteConfirm from '@/components/editor/DeleteConfirm.vue'
import DevToolsPanel from '@/components/devtools/DevToolsPanel.vue'
import TaskManagerView from '@/components/tasks/TaskManagerView.vue'
import SettingsView from '@/components/settings/SettingsView.vue'
import AboutView from '@/components/settings/AboutView.vue'
import {
  connection,
  connect,
  consumeDeepLink,
  lastHost,
  pair,
  startReconnectLoop,
  type DeepLink,
} from '@/stores/connection'
import { workspace, notify, isCategory } from '@/stores/workspace'
import { settings } from '@/stores/settings'
import { refresh, bindSse as bindMacroSse } from '@/stores/macros'
import { bindSse as bindEditorSse } from '@/stores/editor'
import { startLogs, stopLogs, bindSse as bindLogSse } from '@/stores/logs'
import {
  startConsole,
  stopConsole,
  bindConsoleSse,
} from '@/stores/console'
import { startNetwork, stopNetwork, bindNetworkSse } from '@/stores/network'
import { startTasks, stopTasks, bindTasksSse } from '@/stores/tasks'
import { sse } from '@/api/sse'

// SSE 事件绑定（幂等注册）
bindMacroSse()
bindEditorSse()
bindLogSse()
bindConsoleSse()
bindNetworkSse()
bindTasksSse()

const sidebarVisible = computed(
  () =>
    (connection.status === 'online' || connection.sessionEstablished) &&
    isCategory(workspace.activity) &&
    workspace.sidebarOpen,
)
const mainSpecial = computed(() => workspace.mainSpecial)
/**
 * 连接页只在前置未就绪时出现（从未连接/主动断开/解除配对）。曾在线后的
 * 断线、重连、凭据失效都保持原界面，由顶部重连横幅接管提示，避免编辑
 * 中的内容被连接页整屏覆盖。
 */
const showConnectView = computed(
  () => connection.status !== 'online' && !connection.sessionEstablished,
)

/* ---- 侧栏拖拽调宽（220–520，双击复位，持久化于 settings） ---- */

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 520
const SIDEBAR_DEFAULT = 280

watch(
  () => settings.sidebarWidth,
  (w) => {
    document.documentElement.style.setProperty('--sidebar-w', `${w}px`)
  },
  { immediate: true },
)

function startResize(e: PointerEvent): void {
  const startX = e.clientX
  const startW = settings.sidebarWidth
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  document.body.classList.add('resizing')
  const onMove = (ev: PointerEvent): void => {
    settings.sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(startW + ev.clientX - startX)))
  }
  const onUp = (): void => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    document.body.classList.remove('resizing')
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}

function resetSidebarWidth(): void {
  settings.sidebarWidth = SIDEBAR_DEFAULT
}

async function onOnline(): Promise<void> {
  await refresh()
  startLogs()
  startConsole()
  startNetwork()
  startTasks()
}

/** 深链引导：host 连接 + token 自动配对（§2 深链无 file 参数，直达文件由编辑器内路由实现） */
async function handleDeepLink(link: DeepLink | null): Promise<void> {
  if (link?.pairToken) connection.pendingPairToken = link.pairToken

  const host = link?.host || lastHost()
  if (host) {
    // 状态到达 online 由下方 watch 统一触发 onOnline（避免双跑）
    await connect(host)
    // 连不上（游戏未开/重启中）：进入自愈重连，服务恢复即自动上线（§6 修订）
    if (connection.status === 'unreachable') {
      startReconnectLoop()
    }
  }

  // 深链带 token：连接后自动配对（token 单次、落盘长 TTL，配对即生效；
  // 失败原因显示在连接卡）
  if (connection.status === 'unpaired' && connection.pendingPairToken && !connection.pairing) {
    void pair(connection.pendingPairToken).catch((e) => {
      connection.error = e instanceof Error ? e.message : String(e)
    })
  }
}

onMounted(async () => {
  // 契约 §6（修订）：server:shutdown → 自愈重连，游戏重启后零操作恢复在线
  sse.onShutdown(() => {
    notify('游戏已停止，重启后自动重连', 'warning')
    sse.stop()
    stopLogs()
    stopConsole()
    stopNetwork()
    stopTasks()
    startReconnectLoop()
  })
  // 硬断线（游戏崩溃/强杀，无 shutdown 广播）：事件流连续失败判死 → 连接级自愈
  sse.onDead(() => {
    sse.stop()
    if (connection.status === 'online') {
      notify('与游戏的连接中断，自动重连中', 'warning')
      stopLogs()
      stopConsole()
      stopNetwork()
      stopTasks()
      startReconnectLoop()
    }
  })

  // query 深链总是伴随整页导航，boot 时消费一次即可
  await handleDeepLink(consumeDeepLink())
})

watch(
  () => connection.status,
  async (status, prev) => {
    if (status === 'online' && prev !== 'online') await onOnline()
    if (status !== 'online') {
      stopLogs()
      stopConsole()
      stopNetwork()
      stopTasks()
    }
  },
)
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <ReconnectBanner />
    <div class="app-body">
      <ActivityBar />
      <MacroSideBar v-if="sidebarVisible" />
      <div
        v-if="sidebarVisible"
        class="sidebar-resizer"
        title="拖拽调宽，双击复位"
        @pointerdown="startResize"
        @dblclick="resetSidebarWidth"
      />
      <main class="main-area">
        <div class="main-stack">
          <div class="main-content">
            <ConnectView v-if="showConnectView" />
            <TaskManagerView v-else-if="mainSpecial === 'tasks'" />
            <SettingsView v-else-if="mainSpecial === 'settings'" />
            <AboutView v-else-if="mainSpecial === 'about'" />
            <EditorArea v-else />
          </div>
          <DevToolsPanel v-if="workspace.bottomPanelOpen" />
        </div>
      </main>
    </div>
    <StatusBar />

    <NewMacroWizard v-if="workspace.showNewMacro" />
    <DeleteConfirm v-if="workspace.deleteTarget" />
  </div>
</template>

<style scoped>
.sidebar-resizer {
  width: 5px;
  flex: none;
  cursor: col-resize;
  background: transparent;
  transition: background var(--dur) var(--ease);
  z-index: 5;
}

.sidebar-resizer:hover,
.sidebar-resizer:active {
  background: var(--accent);
  opacity: 0.55;
}

.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.app-body {
  /* flex:1 而非 grid 1fr：重连横幅 v-if 移除时 flex 列布局不留空行，
     grid 自动放置会把后续元素顶进错误的行（主体塌陷/状态栏被撑大） */
  flex: 1;
  display: flex;
  min-height: 0;
}

.main-area {
  flex: 1;
  min-width: 0;
  display: flex;
}

.main-stack {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.main-content {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.main-content > * {
  flex: 1;
  min-height: 0;
}
</style>

<style>
/* 拖拽调宽中的全局姿态（非 scoped：作用于 body） */
body.resizing {
  cursor: col-resize !important;
  user-select: none !important;
}

body.resizing * {
  pointer-events: none;
}

body.resizing .sidebar-resizer {
  pointer-events: auto;
}
</style>
