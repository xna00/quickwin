import * as gui from 'gui'
import type { Instance } from './reconciler.js'

const EM_GETSEL = 0x00B0
const EM_SETSEL = 0x00B1

export function applyProps(
  instance: Instance,
  newProps: Record<string, any>,
  _oldProps: Record<string, any>,
) {
  instance.props = newProps

  if ('text' in newProps) {
    // SetWindowText on EDIT resets cursor to position 0; save and restore it
    let cursor = -1
    if (instance.type === 'EDIT') {
      const sel = gui.SendMessage(instance.hwnd, EM_GETSEL, 0, 0)
      cursor = sel >>> 16 // caret position is in HIWORD
    }
    gui.SetWindowText(instance.hwnd, newProps.text ?? '')
    if (instance.type === 'EDIT' && cursor >= 0) {
      gui.SendMessage(instance.hwnd, EM_SETSEL, cursor, cursor)
    }
  }
  if ('disabled' in newProps) {
    gui.EnableWindow(instance.hwnd, !newProps.disabled)
  }
  if ('hidden' in newProps) {
    gui.ShowWindow(instance.hwnd, newProps.hidden ? 0 : 5)
  }
  if ('visible' in newProps) {
    gui.ShowWindow(instance.hwnd, newProps.visible)
  }
  const s = newProps.style
  if (s && ('x' in s || 'y' in s || 'width' in s || 'height' in s)) {
    const cur = instance.lastRect ?? { x: 0, y: 0, w: 100, h: 30 }
    const newX = 'x' in s ? s.x : cur.x
    const newY = 'y' in s ? s.y : cur.y
    const newW = 'width' in s ? s.width : cur.w
    const newH = 'height' in s ? s.height : cur.h
    if (newX !== cur.x || newY !== cur.y || newW !== cur.w || newH !== cur.h) {
      gui.SetWindowPos(instance.hwnd, 0, newX, newY, newW, newH, gui.SetWindowPosFlag.SWP_NOZORDER)
      instance.lastRect = { x: newX, y: newY, w: newW, h: newH }
    }
  }
}
