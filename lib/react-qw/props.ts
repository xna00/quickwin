import * as gui from 'gui'

const EM_GETSEL = 0x00B0
const EM_SETSEL = 0x00B1

export function applyProps(
  instance: { hwnd: gui.HWND; type: string; props: Record<string, any> },
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
  const os = _oldProps.style || _oldProps
  if (s && ('x' in s || 'y' in s || 'width' in s || 'height' in s)) {
    gui.SetWindowPos(
      instance.hwnd, 0,
      s.x ?? os.x ?? 0,
      s.y ?? os.y ?? 0,
      s.width ?? os.width ?? 100,
      s.height ?? os.height ?? 30,
      0
    )
  }
}
