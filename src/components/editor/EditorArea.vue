<script setup lang="ts">
/** 主编辑区：多标签 + Monaco + 欢迎页 + 脏关闭确认 + 磁盘变更横幅 + 409 冲突流。 */

import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  editor,
  activeTab,
  openFile,
  closeTab,
  save,
  reloadFromDisk,
  ignoreExternalChange,
  type EditorTab,
} from '@/stores/editor'
import { focusEditor } from '@/stores/workspace'
import { connection } from '@/stores/connection'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppModal from '@/components/ui/AppModal.vue'
import MonacoPane from './MonacoPane.vue'
import ConflictDialog from './ConflictDialog.vue'

const closeCandidate = ref<EditorTab | null>(null)

function switchTo(path: string): void {
  editor.activePath = path
  const tab = editor.tabs.find((t) => t.path === path)
  focusEditor(tab?.macroId)
}

function requestClose(tab: EditorTab): void {
  if (tab.dirty) {
    closeCandidate.value = tab
  } else {
    closeTab(tab.path)
  }
}

async function closeAndSave(): Promise<void> {
  const tab = closeCandidate.value
  if (!tab) return
  const ok = await save(tab.path)
  if (ok) {
    closeTab(tab.path)
    closeCandidate.value = null
  } else {
    closeCandidate.value = null // 保存失败（如冲突），留在编辑器处理
  }
}

function closeWithoutSave(): void {
  const tab = closeCandidate.value
  if (!tab) return
  tab.buffer = tab.content // 丢弃缓冲
  tab.dirty = false
  closeTab(tab.path)
  closeCandidate.value = null
}

async function retryOpen(tab: EditorTab): Promise<void> {
  await openFile(tab.path, tab.macroId)
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    const tab = activeTab.value
    if (tab) {
      e.preventDefault()
      void save(tab.path)
    }
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <section class="editor-area">
    <!-- 标签栏 -->
    <div v-if="editor.tabs.length > 0" class="tabs-bar">
      <button
        v-for="tab in editor.tabs"
        :key="tab.path"
        class="tab"
        :class="{ active: tab.path === editor.activePath }"
        :title="tab.definition ? `${tab.path}（类型定义，只读）` : tab.path"
        @click="switchTo(tab.path)"
        @auxclick.middle="requestClose(tab)"
      >
        <AppIcon :name="tab.language === 'javascript' ? 'files' : 'settings'" :size="13" />
        <span class="tab-title" :class="{ def: tab.definition }">{{ tab.title }}</span>
        <span class="close" role="button" title="关闭" @click.stop="requestClose(tab)">
          <span v-if="tab.dirty" class="dirty-dot" />
          <AppIcon v-else name="close" :size="12" class="close-icon" />
        </span>
      </button>
    </div>

    <!-- 磁盘外部修改横幅 -->
    <div v-if="activeTab?.externalChange" class="banner">
      <AppIcon name="warn" :size="14" />
      <span>文件已在磁盘上被修改（游戏内或外部编辑器）。</span>
      <button class="btn" @click="reloadFromDisk(activeTab!.path)">重新加载</button>
      <button class="btn btn-ghost" @click="ignoreExternalChange(activeTab!.path)">忽略</button>
    </div>

    <!-- 编辑器主体 -->
    <div class="editor-body">
      <MonacoPane v-show="activeTab && !activeTab.loading && !activeTab.loadError" />

      <!-- 加载中 -->
      <div v-if="activeTab?.loading" class="state-overlay">
        <span class="spin" /> 正在读取文件…
      </div>

      <!-- 读取失败 -->
      <div v-else-if="activeTab?.loadError" class="state-overlay error">
        <AppIcon name="warn" :size="20" />
        <p>{{ activeTab.loadError }}</p>
        <button class="btn" @click="retryOpen(activeTab!)">重试</button>
      </div>

      <!-- 欢迎页 -->
      <div v-else-if="!activeTab" class="welcome">
        <div class="mark">▣</div>
        <h2>NeoMacros 编辑器</h2>
        <template v-if="connection.status === 'online'">
          <p>从左侧选择一个宏开始编辑，或新建一个宏。</p>
          <p class="tips">
            <span><b>Ctrl+S</b> 保存并热重载</span>
            <span><b>neo.</b> 唤出 API 补全</span>
          </p>
        </template>
        <template v-else>
          <p>先连接到游戏内的 NeoMacros 服务。</p>
        </template>
      </div>
    </div>

    <!-- 脏关闭确认 -->
    <AppModal
      v-if="closeCandidate"
      :title="`关闭「${closeCandidate.title}」`"
      :width="420"
      @close="closeCandidate = null"
    >
      <p>有未保存的更改，关闭前要保存吗？</p>
      <template #footer>
        <button class="btn btn-ghost" @click="closeCandidate = null">取消</button>
        <button class="btn" @click="closeWithoutSave">不保存</button>
        <button class="btn btn-primary" @click="closeAndSave">保存并关闭</button>
      </template>
    </AppModal>

    <!-- 409 冲突 -->
    <ConflictDialog v-if="activeTab?.conflict" :tab="activeTab" />
  </section>
</template>

<style scoped>
.editor-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--bg-editor);
}

.tabs-bar {
  height: var(--tabsbar-h);
  display: flex;
  align-items: stretch;
  background: var(--bg-chrome);
  border-bottom: 1px solid var(--divider);
  overflow-x: auto;
  flex: none;
}

.tabs-bar::-webkit-scrollbar {
  height: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px 0 14px;
  font-size: 12px;
  color: var(--text-2);
  border-right: 1px solid var(--divider);
  white-space: nowrap;
  position: relative;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.tab:hover {
  color: var(--text-1);
  background: var(--hover);
}

.tab.active {
  color: var(--text-1);
  background: var(--bg-editor);
}

.tab.active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
}

.tab-title {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-title.def {
  font-style: italic;
  color: var(--text-2);
}

.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
}

.close:hover {
  background: var(--control-hover);
}

.dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(255, 190, 75, 0.1);
  border-bottom: 1px solid rgba(255, 190, 75, 0.25);
  color: var(--warning);
  font-size: 12px;
  flex: none;
}

.banner .btn {
  padding: 2px 10px;
  font-size: 12px;
}

.banner span:first-of-type {
  flex: 1;
}

.editor-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.state-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-2);
  background: var(--bg-editor);
}

.state-overlay.error {
  color: var(--danger);
}

.state-overlay p {
  margin: 0;
  max-width: 480px;
  text-align: center;
  line-height: 1.7;
}

.spin {
  width: 18px;
  height: 18px;
  border: 2px solid var(--control);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation-duration: 3s;
  }
}

.welcome {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-2);
  text-align: center;
}

.welcome .mark {
  font-size: 42px;
  color: var(--accent);
  opacity: 0.85;
}

.welcome h2 {
  margin: 4px 0;
  font-size: 18px;
  color: var(--text-1);
  font-weight: 600;
}

.welcome p {
  margin: 0;
  font-size: 13px;
}

.tips {
  display: flex;
  gap: 22px;
  margin-top: 10px !important;
  font-size: 12px;
  color: var(--text-3);
}

.tips b {
  color: var(--text-2);
  font-weight: 600;
  font-family: var(--font-mono);
}
</style>
