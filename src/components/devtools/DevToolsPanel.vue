<script setup lang="ts">
/**
 * DevTools 外壳：顶边拖拽调高（持久化 settings.devtoolsHeight）+ 标签栏（registry 注册表）
 * + 全局工具（独立窗口 Document PiP / 关闭）。活动页由 workspace.devtoolsTab 决定。
 */
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { devtoolsTabs } from './registry'
import { workspace } from '@/stores/workspace'
import { settings } from '@/stores/settings'
import AppIcon from '@/components/ui/AppIcon.vue'

const DT_MIN = 120
const DT_MAX = 600
const DT_DEFAULT = 260

/* ---- 拖拽调高（向上拖增高，双击复位） ---- */

watch(
  () => settings.devtoolsHeight,
  (h) => {
    document.documentElement.style.setProperty('--devtools-h', `${h}px`)
  },
  { immediate: true },
)

function startResize(e: PointerEvent): void {
  const startY = e.clientY
  const startH = settings.devtoolsHeight
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  document.body.classList.add('resizing-row')
  const onMove = (ev: PointerEvent): void => {
    settings.devtoolsHeight = Math.min(DT_MAX, Math.max(DT_MIN, Math.round(startH - (ev.clientY - startY))))
  }
  const onUp = (): void => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    document.body.classList.remove('resizing-row')
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}

function resetHeight(): void {
  settings.devtoolsHeight = DT_DEFAULT
}

/* ---- 活动页 ---- */

const activeDef = computed(() => {
  const hit = devtoolsTabs.find((t) => t.id === workspace.devtoolsTab)
  return hit ?? devtoolsTabs[0]
})

/* ---- Document Picture-in-Picture：不支持时入口直接隐藏 ---- */

const pipSupported = 'documentPictureInPicture' in window
const pipActive = ref(false)
const panelEl = ref<HTMLElement | null>(null)

let pipWin: Window | null = null
let homeParent: HTMLElement | null = null
let themeObserver: MutationObserver | null = null

/** 复制主文档样式到画中画窗口（跨域样式表读不到规则时回退 <link>） */
function copyStyles(win: Window): void {
  for (const sheet of document.styleSheets) {
    try {
      const style = win.document.createElement('style')
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('')
      win.document.head.appendChild(style)
    } catch {
      if (!sheet.href) continue
      const link = win.document.createElement('link')
      link.rel = 'stylesheet'
      link.href = sheet.href
      win.document.head.appendChild(link)
    }
  }
}

/** 面板搬回主文档（画中画关闭时触发），并确保原页面 DevTools 打开 */
function leavePip(): void {
  themeObserver?.disconnect()
  themeObserver = null
  const el = panelEl.value
  if (el && homeParent) {
    homeParent.appendChild(el)
    el.classList.remove('in-pip')
  }
  homeParent = null
  pipWin = null
  pipActive.value = false
  workspace.bottomPanelOpen = true
}

async function togglePip(): Promise<void> {
  if (pipWin) {
    pipWin.close() // pagehide → leavePip 搬回
    return
  }
  const el = panelEl.value
  if (!el || !window.documentPictureInPicture) return
  let win: Window
  try {
    win = await window.documentPictureInPicture.requestWindow({ width: 640, height: 360 })
  } catch {
    return // 缺用户手势等场景，静默放弃
  }
  pipWin = win
  homeParent = el.parentElement
  copyStyles(win)
  // 主题令牌挂在 :root，画中画文档需单独同步
  win.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'dark'
  win.document.body.style.margin = '0'
  win.document.body.style.overflow = 'hidden'
  el.classList.add('in-pip')
  win.document.body.appendChild(el)
  // 打开期间跟随主文档切换明暗主题
  themeObserver = new MutationObserver(() => {
    win.document.documentElement.dataset.theme = document.documentElement.dataset.theme
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  win.addEventListener('pagehide', leavePip, { once: true })
  pipActive.value = true
}

onBeforeUnmount(() => {
  if (pipWin) {
    // 组件随面板卸载：跳过搬回，直接关窗
    pipWin.removeEventListener('pagehide', leavePip)
    pipWin.close()
  }
})
</script>

<template>
  <div ref="panelEl" class="devtools">
    <div class="dt-resizer" title="拖拽调高，双击复位" @pointerdown="startResize" @dblclick="resetHeight" />

    <div class="dt-tabstrip">
      <button
        v-for="tab in devtoolsTabs"
        :key="tab.id"
        class="dt-tab"
        :class="{ on: activeDef.id === tab.id }"
        @click="workspace.devtoolsTab = tab.id"
      >
        {{ tab.label }}
      </button>

      <div class="dt-tools">
        <button
          v-if="pipSupported"
          class="dt-tool"
          :class="{ on: pipActive }"
          :title="pipActive ? '退出独立窗口' : '独立窗口'"
          @click="togglePip"
        >
          <AppIcon name="pip" :size="13" />
        </button>
        <button v-if="!pipActive" class="dt-tool" title="关闭" @click="workspace.bottomPanelOpen = false">
          <AppIcon name="close" :size="13" />
        </button>
      </div>
    </div>

    <component :is="activeDef.component" />
  </div>
</template>

<style scoped>
.devtools {
  position: relative;
  height: var(--devtools-h);
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--divider);
  flex: none;
  min-height: 0;
}

/* 独立窗口内：占满整个窗口，隐藏拖拽条 */
.devtools.in-pip {
  height: 100%;
  border-top: none;
}

.devtools.in-pip .dt-resizer {
  display: none;
}

.dt-resizer {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  z-index: 5;
  transition: background var(--dur) var(--ease);
}

.dt-resizer:hover {
  background: var(--accent);
  opacity: 0.55;
}

.dt-tabstrip {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  border-bottom: 1px solid var(--divider);
  flex: none;
}

.dt-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 12px;
  font-size: 11px;
  color: var(--text-2);
  border-radius: 0;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.dt-tab:hover {
  color: var(--text-1);
  background: var(--hover);
}

.dt-tab.on {
  color: var(--text-1);
}

.dt-tab.on::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
}

.dt-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.dt-tool {
  display: inline-flex;
  align-items: center;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
}

.dt-tool:hover {
  background: var(--hover);
  color: var(--text-1);
}

.dt-tool.on {
  background: var(--active);
  color: var(--accent);
}
</style>

<style>
/* 垂直拖拽调高中的全局姿态（非 scoped：作用于 body） */
body.resizing-row {
  cursor: row-resize !important;
  user-select: none !important;
}

body.resizing-row * {
  pointer-events: none;
}

body.resizing-row .dt-resizer {
  pointer-events: auto;
}
</style>
