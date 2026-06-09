import * as gui from 'gui'

const EM_SETSEL = 0x00B1

export function applyProps(
  instance: { hwnd: gui.HWND; type: string; props: Record<string, any> },
  newProps: Record<string, any>,
  _oldProps: Record<string, any>,
) {
  instance.props = newProps

  if ('text' in newProps) {
    gui.SetWindowText(instance.hwnd, newProps.text ?? '')
    // SetWindowText on EDIT resets cursor to position 0; restore to end
    if (instance.type === 'EDIT') {
      const len = gui.GetWindowText(instance.hwnd).length
      gui.SendMessage(instance.hwnd, EM_SETSEL, len, len)
    }
  }
  if ('disabled' in newProps) {
    gui.EnableWindow(instance.hwnd, !newProps.disabled)
  }
  if ('visible' in newProps) {
    gui.ShowWindow(instance.hwnd, newProps.visible)
  }
  if ('x' in newProps || 'y' in newProps || 'width' in newProps || 'height' in newProps) {
    gui.SetWindowPos(
      instance.hwnd, 0,
      newProps.x ?? _oldProps.x ?? 0,
      newProps.y ?? _oldProps.y ?? 0,
      newProps.width ?? _oldProps.width ?? 100,
      newProps.height ?? _oldProps.height ?? 30,
      0
    )
  }
}
