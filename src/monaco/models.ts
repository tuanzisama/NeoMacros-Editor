/**
 * Monaco 模型缓存：路径 → ITextModel（URI = file:///macros/<path>，
 * 与 extraLib 的 file:/// 命名空间一致，宏脚本间可见但互不干扰）。
 */

import { getMonaco } from './setup'
import type * as monaco from 'monaco-editor'
import type { FileLanguage } from '@/stores/editor'

const models = new Map<string, monaco.editor.ITextModel>()

/** 视图状态（光标/滚动）按路径缓存；定义标签不持久化——每次跳转都由 opener 重新定位到声明处 */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

export function saveViewState(path: string, state: monaco.editor.ICodeEditorViewState | null): void {
  if (path.startsWith('file:///neomacros')) return
  viewStates.set(path, state)
}

export function takeViewState(path: string): monaco.editor.ICodeEditorViewState | null | undefined {
  if (path.startsWith('file:///neomacros')) return undefined
  const state = viewStates.get(path)
  viewStates.delete(path)
  return state
}

export async function getOrCreateModel(
  path: string,
  initial: string,
  language: FileLanguage,
): Promise<monaco.editor.ITextModel> {
  const monaco = await getMonaco()
  const existing = models.get(path)
  if (existing && !existing.isDisposed()) return existing
  const uri = monaco.Uri.parse(`file:///macros/${path}`)
  const found = monaco.editor.getModel(uri)
  const model = found ?? monaco.editor.createModel(initial, language, uri)
  models.set(path, model)
  return model
}

export function getModel(path: string): monaco.editor.ITextModel | undefined {
  const model = models.get(path)
  if (model && !model.isDisposed()) return model
  return undefined
}

export function disposeModel(path: string): void {
  const model = models.get(path)
  if (model && !model.isDisposed()) {
    model.dispose()
    models.delete(path)
  }
}

/** 外部内容重载（磁盘变更/冲突取回）：整段替换并重置撤销栈 */
export function resetModelValue(path: string, value: string): void {
  const model = getModel(path)
  if (model && model.getValue() !== value) model.setValue(value)
}

/** LocatedError → Monaco 标红（行列可能为 null，兜底第 1 行） */
export async function applyLocatedError(
  path: string,
  error: { line?: number | null; column?: number | null; message: string } | null | undefined,
): Promise<void> {
  const model = getModel(path)
  if (!model) return
  const monaco = await getMonaco()
  const owner = 'neomacros'
  if (!error) {
    monaco.editor.setModelMarkers(model, owner, [])
    return
  }
  const line = Math.max(1, error.line ?? 1)
  const column = Math.max(1, error.column ?? 1)
  monaco.editor.setModelMarkers(model, owner, [
    {
      severity: monaco.MarkerSeverity.Error,
      message: error.message,
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: column + 1,
      source: 'NeoMacros',
    },
  ])
}
