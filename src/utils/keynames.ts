/**
 * 浏览器 KeyboardEvent.code ↔ 原版键名（Minecraft InputConstants 口径，
 * 如 `key.keyboard.x`）双向映射 + 组合键展示。
 * 名称对齐 26.3 InputConstants$Type 常量表；面板按键录入（config.keypress.key_code）用。
 */

const CODE_TO_VANILLA: Record<string, string> = {
  Space: 'space',
  Enter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  Escape: 'escape',
  Minus: 'minus',
  Equal: 'equal',
  BracketLeft: 'left.bracket',
  BracketRight: 'right.bracket',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'apostrophe',
  Backquote: 'grave.accent',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  CapsLock: 'caps.lock',
  ScrollLock: 'scroll.lock',
  NumLock: 'num.lock',
  PrintScreen: 'print.screen',
  Pause: 'pause',
  ContextMenu: 'menu',
  Insert: 'insert',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'page.up',
  PageDown: 'page.down',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  AltLeft: 'left.alt',
  AltRight: 'right.alt',
  ControlLeft: 'left.control',
  ControlRight: 'right.control',
  ShiftLeft: 'left.shift',
  ShiftRight: 'right.shift',
  MetaLeft: 'left.win',
  MetaRight: 'right.win',
  NumpadEnter: 'keypad.enter',
  NumpadAdd: 'keypad.add',
  NumpadSubtract: 'keypad.subtract',
  NumpadMultiply: 'keypad.multiply',
  NumpadDivide: 'keypad.divide',
  NumpadDecimal: 'keypad.decimal',
  NumpadEqual: 'keypad.equal',
  NumpadComma: 'keypad.comma',
  Separator: 'separator',
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

/** KeyboardEvent.code → 原版键名；未识别返回 null */
export function vanillaOf(code: string): string | null {
  if (CODE_TO_VANILLA[code]) return `key.keyboard.${CODE_TO_VANILLA[code]}`
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return `key.keyboard.${m[1].toLowerCase()}`
  m = /^Digit([0-9])$/.exec(code)
  if (m) return `key.keyboard.${m[1]}`
  m = /^F([1-9]|1\d|2[0-4])$/.exec(code)
  if (m) return `key.keyboard.f${m[1]}`
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return `key.keyboard.keypad.${m[1]}`
  return null
}

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code)
}

/** 按 code 提取按住的 ctrl/shift/alt（清单 modifiers 段，小写） */
export function modifiersOf(e: {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): string[] {
  const out: string[] = []
  if (e.ctrlKey) out.push('ctrl')
  if (e.shiftKey) out.push('shift')
  if (e.altKey) out.push('alt')
  return out
}

/** 原版键名 → 展示名（key.keyboard.page.up → PageUp；left.alt → LAlt；修饰键段同口径） */
export function prettyKey(vanilla: string): string {
  const name = vanilla.startsWith('key.keyboard.') ? vanilla.slice('key.keyboard.'.length) : vanilla
  const side = /^(left|right)\.(.+)$/.exec(name)
  if (side) {
    const label = capSegments(side[2])
    return (side[1] === 'left' ? 'L' : 'R') + label
  }
  return capSegments(name)
}

function capSegments(name: string): string {
  return name
    .split('.')
    .map((seg) => (seg.length <= 1 ? seg.toUpperCase() : seg[0].toUpperCase() + seg.slice(1).toLowerCase()))
    .join('')
}

/** 组合展示：Ctrl+Shift+Alt+X（修饰键固定 Ctrl/Shift/Alt 序） */
export function comboLabel(modifiers: string[], key: string | null): string {
  const order = ['ctrl', 'shift', 'alt']
  const mods = order
    .filter((m) => modifiers.includes(m))
    .map((m) => capSegments(m))
  if (key) mods.push(prettyKey(key))
  return mods.join('+')
}
