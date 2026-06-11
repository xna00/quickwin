import { forwardRef, useRef, useEffect, useState } from 'react'
import * as gui from 'gui'
import type { WStyle } from '../jsx.d.ts'

export interface ListBoxProps {
  items: string[]
  selectedIndex?: number
  defaultSelectedIndex?: number
  onChange?: (index: number) => void
  style?: WStyle
  disabled?: boolean
  sort?: boolean
}

export const ListBox = forwardRef<gui.HWND, ListBoxProps>(
  ({ items, selectedIndex: controlledIndex, defaultSelectedIndex = -1,
     onChange, style, disabled, sort }, ref) => {
    const [internalIndex, setInternalIndex] = useState(defaultSelectedIndex)
    const isControlled = controlledIndex !== undefined
    const sel = isControlled ? controlledIndex : internalIndex
    const wrapperRef = useRef<gui.HWND>(null)
    const lbHwnd = useRef<gui.HWND>(null)
    const dpiFont = gui.CreateSystemDpiFont()

    // LISTBOX 在 SetParent 后会把 WM_COMMAND 发给原父窗口而非当前父窗口，
    // 所以不能走 reconciler 的 createInstance(rootContainer) → SetParent 链路。
    // 改为直接 CreateWindow 挂到 wrapper（STATIC）下，绕过 reconciler，
    // 保证 WM_COMMAND 直达 wrapper 的 onEvent。
    useEffect(() => {
      const parent = wrapperRef.current
      if (!parent) return
      let ws = gui.WindowStyle.VISIBLE | gui.WindowStyle.BORDER | gui.WindowStyle.VSCROLL | gui.WindowStyle.CHILD
      ws |= gui.ListBoxStyle.HASSTRINGS | gui.ListBoxStyle.NOTIFY | gui.ListBoxStyle.NOINTEGRALHEIGHT
      if (sort) ws |= gui.ListBoxStyle.SORT
      const rect = gui.GetClientRect(parent)
      const lb = gui.CreateWindow('LISTBOX', '', ws, 0, 0, rect ? rect.right : 100, rect ? rect.bottom : 100, parent, null)
      if (!lb) return
      if (dpiFont) gui.SendMessage(lb, gui.WmMsg.SETFONT, dpiFont, 1)
      lbHwnd.current = lb
      return () => { gui.DestroyWindow(lb); lbHwnd.current = null }
    }, [])

    useEffect(() => {
      const h = lbHwnd.current
      if (!h) return
      gui.SendMessage(h, gui.LbMsg.RESETCONTENT, 0, 0)
      for (const item of items)
        gui.SendMessage(h, gui.LbMsg.ADDSTRING, 0, item)
      if (sel >= 0 && sel < items.length)
        gui.SendMessage(h, gui.LbMsg.SETCURSEL, sel, 0)
    }, [items])

    useEffect(() => {
      const h = lbHwnd.current
      if (h) gui.SendMessage(h, gui.LbMsg.SETCURSEL, sel, 0)
    }, [sel])

    return (
      <w
        type="STATIC"
        ws={gui.WindowStyle.VISIBLE | gui.WindowStyle.CLIPCHILDREN}
        style={{ ...style, flexDirection: 'column', alignItems: 'stretch' }}
        ref={(h: gui.HWND) => {
          wrapperRef.current = h
          if (typeof ref === 'function') ref(h)
          else if (ref) ref.current = h
        }}
        onEvent={(e) => {
          if (e.msg === gui.WmMsg.SIZE) {
            const h = lbHwnd.current
            if (h) {
              const lp = e.lParam
              const w = lp & 0xFFFF
              const hh = (lp >> 16) & 0xFFFF
              gui.SetWindowPos(h, 0, 0, 0, w, hh, 0)
            }
          }
          if (e.msg !== gui.WmMsg.COMMAND) return
          const code = (e.wParam >> 16) & 0xFFFF
          if (code === gui.LbnCode.SELCHANGE) {
            const h = lbHwnd.current
            if (!h) return
            const newSel = gui.SendMessage(h, gui.LbMsg.GETCURSEL, 0, 0)
            if (newSel !== sel && newSel >= 0) {
              if (!isControlled) setInternalIndex(newSel)
              onChange?.(newSel)
            }
          }
        }}
      />
    )
  }
)
