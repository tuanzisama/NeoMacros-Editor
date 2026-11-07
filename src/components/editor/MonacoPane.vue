<script setup lang="ts">
/**
 * Monaco 编辑器宿主：模型按路径缓存复用、视图状态按路径保持、
 * Ctrl+S 保存、LocatedError 标红、设置联动（字号/换行/minimap/checkJs）。
 */

import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { setupMonaco, applyDiagnostics, monacoThemeName, getMonaco } from '@/monaco/setup'
import type * as monaco from 'monaco-editor'
import {
  getOrCreateModel,
  resetModelValue,
  applyLocatedError,
  saveViewState,
  takeViewState,
} from '@/monaco/models'
import { activeTab, setBuffer, save, cursor, openDefinitionTab, revealTarget } from '@/stores/editor'
import { settings } from '@/stores/settings'
import { resolvedTheme } from '@/theme'

const container = ref<HTMLDivElement | null>(null)
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null
let applying = false
let currentPath: string | null = null

onMounted(async () => {
  const monaco = await getMonaco()
  setupMonaco(monaco)
  editorInstance = monaco.editor.create(container.value!, {
    theme: monacoThemeName(resolvedTheme.value),
    fontSize: settings.fontSize,
    tabSize: settings.tabSize,
    wordWrap: settings.wordWrap ? 'on' : 'off',
    minimap: { enabled: settings.minimap },
    automaticLayout: true,
    scrollBeyondLastLine: true,
    renderLineHighlight: 'all',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    padding: { top: 8 },
    guides: { indentation: true },
    bracketPairColorization: { enabled: true },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    // Ctrl+Click / F12 转到定义：直接打开只读定义标签（不走 peek 浮窗）
    definitionLinkOpensInPeek: false,
  })

  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    const tab = activeTab.value
    if (tab) void save(tab.path)
  })

  editorInstance.onDidChangeModelContent(() => {
    if (applying) return
    const tab = activeTab.value
    if (tab && editorInstance) setBuffer(tab.path, editorInstance.getModel()!.getValue())
  })

  // Ctrl+Click / F12「转到定义」落地：目标模型不在宏文件命名空间时登记只读标签
  editorInstance.onDidChangeModel(() => {
    const model = editorInstance?.getModel()
    if (!model) return
    const path = model.uri.toString()
    if (path.startsWith('file:///macros/')) return
    if (currentPath === path) return
    openDefinitionTab(path, model.uri.path.split('/').pop() ?? path)
  })

  editorInstance.onDidChangeCursorPosition((e) => {
    cursor.line = e.position.lineNumber
    cursor.column = e.position.column
  })

  void nextTick(syncModel)
})

onBeforeUnmount(() => {
  editorInstance?.dispose()
  editorInstance = null
})

async function syncModel(): Promise<void> {
  if (!editorInstance) return
  const tab = activeTab.value
  if (!tab || tab.loading || tab.loadError) return
  const monaco = await getMonaco()

  if (currentPath && currentPath !== tab.path) {
    // 仅当编辑器当前模型确实对应 currentPath 时保存视图状态
    // （Ctrl+Click 跳转已先切换模型，避免把 d.ts 的视图状态记到原文件名下）
    const cur = editorInstance.getModel()
    if (cur && cur.uri.toString() === currentPath) {
      saveViewState(currentPath, editorInstance.saveViewState())
    }
  }

  let model: monaco.editor.ITextModel
  if (tab.definition) {
    // d.ts 定义模型在 setup 阶段已创建，按 URI 直接取
    const uri = monaco.Uri.parse(tab.path)
    model = monaco.editor.getModel(uri) ?? (await getOrCreateModel(tab.path, tab.buffer, tab.language))
  } else {
    model = await getOrCreateModel(tab.path, tab.buffer, tab.language)
    if (model.getValue() !== tab.buffer) {
      applying = true
      resetModelValue(tab.path, tab.buffer)
      applying = false
    }
  }
  if (editorInstance.getModel() !== model) editorInstance.setModel(model)
  editorInstance.updateOptions({ readOnly: !!tab.definition })
  const state = takeViewState(tab.path)
  if (state) editorInstance.restoreViewState(state)
  if (!tab.definition) void applyLocatedError(tab.path, tab.locatedError)
  currentPath = tab.path
}

watch(activeTab, (tab) => {
  if (tab) void nextTick(syncModel)
})

// 程序化整段替换（磁盘重载 / 冲突取回）
watch(
  () => activeTab.value?.rev,
  () => void nextTick(syncModel),
)

// 加载完成 → 建模型
watch(
  () => activeTab.value?.loading,
  () => void nextTick(syncModel),
)

// LocatedError 变化（保存热重载回传等）
watch(
  () => activeTab.value?.locatedError,
  (err) => {
    const tab = activeTab.value
    if (tab) void applyLocatedError(tab.path, err)
  },
)

// 控制台定位跳转：等模型切换完成（syncModel 落定）后再滚动+选中目标行
watch(revealTarget, async (target) => {
  if (!target || !editorInstance) return
  if (activeTab.value?.path !== target.path) return
  await nextTick(syncModel)
  if (!editorInstance || activeTab.value?.path !== target.path) return
  const model = editorInstance.getModel()
  if (!model) return
  const line = Math.min(Math.max(1, target.line), model.getLineCount())
  const column = Math.min(Math.max(1, target.column), model.getLineMaxColumn(line))
  editorInstance.revealPositionInCenter({ lineNumber: line, column })
  editorInstance.setSelection({
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: model.getLineMaxColumn(line),
  })
})

// 设置联动
watch(resolvedTheme, (t) => {
  void getMonaco().then((monaco) => monaco.editor.setTheme(monacoThemeName(t)))
})

watch(
  () => [settings.fontSize, settings.tabSize, settings.wordWrap, settings.minimap],
  () => {
    editorInstance?.updateOptions({
      fontSize: settings.fontSize,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      minimap: { enabled: settings.minimap },
    })
  },
)

watch(
  () => settings.checkJs,
  () => void getMonaco().then((monaco) => applyDiagnostics(monaco)),
)
</script>

<template>
  <div ref="container" class="monaco-pane" />
</template>

<style scoped>
.monaco-pane {
  position: absolute;
  inset: 0;
}
</style>
