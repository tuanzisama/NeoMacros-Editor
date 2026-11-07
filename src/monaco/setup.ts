/**
 * Monaco 单例装配：NLS 语言装载 → editor.main 贡献求值 → monaco 绑定。
 *
 * 求值顺序关键点：ESM 顶层 await 只阻塞祖先链、不阻塞兄弟模块（规范行为，
 * Chromium 实测如此），而 monaco 的界面文案在各模块求值期就被捕获，因此
 * editor.main 必须作为 NLS 文案装载的「后代」在此动态引入——任何静态
 * import monaco 都会在文案就位前求值而回退英文。消费方运行时一律经
 * getMonaco() 取值，类型引用用 type-only 导入。
 */

import neomacrosDts from './neomacros.d.ts?raw'
import supplementDts from './neomacros-supplement.d.ts?raw'
import { settings } from '@/stores/settings'
import { resolveMonacoLocale, type MonacoLocale } from './locale'
import type * as monaco from 'monaco-editor'

export type Monaco = typeof import('monaco-editor')

/** 语言文案表（副作用模块：装载 globalThis._VSCODE_NLS_MESSAGES/_LANGUAGE）；en 为内联默认，无需装载 */
const LOADERS: Record<Exclude<MonacoLocale, 'en'>, () => Promise<unknown>> = {
  'zh-cn': () => import('monaco-editor/nls/lang/zh-cn.js'),
  'zh-tw': () => import('monaco-editor/nls/lang/zh-tw.js'),
  ja: () => import('monaco-editor/nls/lang/ja.js'),
  ko: () => import('monaco-editor/nls/lang/ko.js'),
  de: () => import('monaco-editor/nls/lang/de.js'),
  es: () => import('monaco-editor/nls/lang/es.js'),
  fr: () => import('monaco-editor/nls/lang/fr.js'),
  it: () => import('monaco-editor/nls/lang/it.js'),
  pl: () => import('monaco-editor/nls/lang/pl.js'),
  'pt-br': () => import('monaco-editor/nls/lang/pt-br.js'),
  ru: () => import('monaco-editor/nls/lang/ru.js'),
  tr: () => import('monaco-editor/nls/lang/tr.js'),
  cs: () => import('monaco-editor/nls/lang/cs.js'),
}

// worker 接入（label 路由）；worker 上下文无界面文案，不受 NLS 时序影响
;(self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(new URL('./workers/ts.worker.ts', import.meta.url), { type: 'module' })
    }
    if (label === 'json') {
      return new Worker(new URL('./workers/json.worker.ts', import.meta.url), { type: 'module' })
    }
    return new Worker(new URL('./workers/editor.worker.ts', import.meta.url), { type: 'module' })
  },
}

let ready: Promise<Monaco> | null = null

/** 唯一运行时入口：首次调用完成 NLS 装载与 monaco 全量求值，此后复用同一实例 */
export function getMonaco(): Promise<Monaco> {
  ready ??= (async () => {
    const locale = resolveMonacoLocale(settings.language)
    if (locale !== 'en') await LOADERS[locale]()
    const monaco = await import('monaco-editor')
    // 0.57 主入口只含 editor.api 核心；显式引入全部编辑器功能贡献
    // （gotoSymbol 的 Ctrl+Click/F12 转到定义、查找、快速跳转等均在此）
    await import('monaco-editor/editor/editor.main.js')
    return monaco
  })()
  return ready
}

let bootstrapped = false

/** JS 诊断配置（checkJs 开关只切语义验证，语法错误恒开） */
export function applyDiagnostics(monaco: Monaco): void {
  const js = monaco.typescript.javascriptDefaults
  js.setDiagnosticsOptions({
    noSemanticValidation: !settings.checkJs,
    noSyntaxValidation: false,
    // 未解析模块导入等噪音不在宏脚本关注面内
    diagnosticCodesToIgnore: [2304, 2307, 7006, 7005, 7010, 7016],
  })
}

/** d.ts 只读模型（跳转落点）。存在即复用，内容随会话静态 */
export function ensureLibModel(monaco: Monaco, uri: string, content: string): void {
  const u = monaco.Uri.parse(uri)
  if (!monaco.editor.getModel(u)) {
    monaco.editor.createModel(content, 'javascript', u)
  }
}

export function setupMonaco(monaco: Monaco): void {
  if (bootstrapped) return
  bootstrapped = true

  const js = monaco.typescript.javascriptDefaults
  js.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    checkJs: true, // 由 noSemanticValidation 控制语义层；编译选项恒允许 JS
    target: monaco.typescript.ScriptTarget.ES2020,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    lib: ['es2022'],
    strict: false,
    noEmit: true,
    skipLibCheck: true,
  })
  // d.ts 以只读模型形式挂载（而非 addExtraLib）：模型同样会同步进 TS worker
  // 参与补全/诊断，同时让 Ctrl+Click / F12「转到定义」有真实落点（可跳进 d.ts 浏览）。
  // 注意不要再对同一路径 addExtraLib，否则同名文件双重注册。
  ensureLibModel(monaco, 'file:///neomacros.d.ts', neomacrosDts)
  ensureLibModel(monaco, 'file:///neomacros-supplement.d.ts', supplementDts)
  applyDiagnostics(monaco)

  // 转到定义的落点（契约外必做项）：standalone 的 openCodeEditor 默认无跨模型 handler
  // （当前模型 ≠ 目标模型即返回 null，跳转静默失败），这里接管 lib 模型打开：
  // 切到目标模型并定位声明处；MonacoPane 的 onDidChangeModel 会据此登记只读定义标签
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selection): boolean {
      const uri = resource.toString()
      if (!uri.startsWith('file:///neomacros')) return false
      const model = monaco.editor.getModel(resource)
      if (!model) return false
      source.setModel(model)
      if (selection) {
        const pos =
          'endLineNumber' in selection
            ? { lineNumber: selection.startLineNumber, column: selection.startColumn }
            : { lineNumber: selection.lineNumber, column: selection.column }
        if ('endLineNumber' in selection) source.setSelection(selection)
        source.revealPositionInCenter(pos, monaco.editor.ScrollType.Immediate)
      } else {
        source.revealLine(1, monaco.editor.ScrollType.Immediate)
      }
      return true
    },
  })

  monaco.editor.defineTheme('neomacros-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8B98A8', fontStyle: 'italic' },
      { token: 'keyword', foreground: '2F7DE9' },
      { token: 'keyword.json', foreground: '2F7DE9' },
      { token: 'string', foreground: '1A9E5C' },
      { token: 'string.key.json', foreground: '5A6A7D' },
      { token: 'string.value.json', foreground: '1A9E5C' },
      { token: 'number', foreground: 'B97F14' },
      { token: 'type', foreground: '1F6FD0' },
      { token: 'type.identifier', foreground: '1F6FD0' },
      { token: 'identifier', foreground: '1C2733' },
      { token: 'delimiter', foreground: '5A6A7D' },
      { token: 'tag', foreground: '2F7DE9' },
      { token: 'attribute.name', foreground: 'B97F14' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1c2733',
      'editor.lineHighlightBackground': '#f0f4fa',
      'editorLineNumber.foreground': '#b3bdcb',
      'editorLineNumber.activeForeground': '#5a6a7d',
      'editorCursor.foreground': '#2f7de9',
      'editor.selectionBackground': '#2f7de933',
      'editor.inactiveSelectionBackground': '#2f7de922',
      'editorIndentGuide.background1': '#e6ebf3',
      'editorIndentGuide.activeBackground1': '#c9d4e4',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#d7deea',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.selectedBackground': '#2f7de922',
      'editorHoverWidget.background': '#ffffff',
      'editorGutter.background': '#ffffff',
      'editorError.foreground': '#d64545',
      'editorWarning.foreground': '#b97f14',
      'scrollbarSlider.background': '#0d162618',
      'scrollbarSlider.hoverBackground': '#0d162630',
      'scrollbarSlider.activeBackground': '#0d162648',
      'minimap.background': '#f7f9fc',
    },
  })

  monaco.editor.defineTheme('neomacros-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '66707F', fontStyle: 'italic' },
      { token: 'keyword', foreground: '4F9DFF' },
      { token: 'keyword.json', foreground: '4F9DFF' },
      { token: 'string', foreground: '57D98A' },
      { token: 'string.key.json', foreground: '9AA7B8' },
      { token: 'string.value.json', foreground: '57D98A' },
      { token: 'number', foreground: 'FFBE4B' },
      { token: 'type', foreground: '6CADFF' },
      { token: 'type.identifier', foreground: '6CADFF' },
      { token: 'identifier', foreground: 'ECF1F8' },
      { token: 'delimiter', foreground: '9AA7B8' },
      { token: 'tag', foreground: '4F9DFF' },
      { token: 'attribute.name', foreground: 'FFBE4B' },
    ],
    colors: {
      'editor.background': '#0d1016',
      'editor.foreground': '#ECF1F8',
      'editor.lineHighlightBackground': '#161b24',
      'editorLineNumber.foreground': '#3a4353',
      'editorLineNumber.activeForeground': '#9AA7B8',
      'editorCursor.foreground': '#4F9DFF',
      'editor.selectionBackground': '#2E4F9D55',
      'editor.inactiveSelectionBackground': '#2E4F9D22',
      'editorIndentGuide.background1': '#1a2029',
      'editorIndentGuide.activeBackground1': '#2a3442',
      'editorWidget.background': '#161b24',
      'editorWidget.border': '#2a3442',
      'editorSuggestWidget.background': '#161b24',
      'editorSuggestWidget.selectedBackground': '#2E4F9D44',
      'editorHoverWidget.background': '#161b24',
      'editorGutter.background': '#0d1016',
      'editorError.foreground': '#FF5C5C',
      'editorWarning.foreground': '#FFBE4B',
      'scrollbarSlider.background': '#FFFFFF20',
      'scrollbarSlider.hoverBackground': '#FFFFFF32',
      'scrollbarSlider.activeBackground': '#FFFFFF48',
      'minimap.background': '#0b0e13',
    },
  })
}

/** 由解析后的主题名得到 Monaco 主题 id（defineTheme 已在 setupMonaco 中注册） */
export function monacoThemeName(resolved: 'dark' | 'light'): string {
  return resolved === 'light' ? 'neomacros-light' : 'neomacros-dark'
}
