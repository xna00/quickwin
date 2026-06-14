import { forwardRef, useState, useEffect, useRef } from 'react'
import * as gui from 'gui'
import type { WStyle } from '../jsx.d.ts'

export interface ScrollViewProps {
  children?: React.ReactNode
  style?: WStyle
}

export const ScrollView = forwardRef<gui.HWND, ScrollViewProps>(
  ({ children, style }, ref) => {
    const svRef = useRef<gui.HWND>(null)
    const contentRef = useRef<gui.HWND>(null)
    const scrollYRef = useRef(0);

    // Win32 比例滚动条约定：
    //   min   = 0
    //   max   = contentH - 1（内容最后像素行号）
    //   page  = viewportH（可见行数）
    //   nPos  = 0 … max - page + 1（即 0 … contentH - viewportH）
    function updateScroll(sv: gui.HWND, content: gui.HWND) {
      const svRect = gui.GetClientRect(sv)
      if (!svRect) return
      const svW = svRect.right - svRect.left
      const svH = svRect.bottom - svRect.top

      // 测量所有子控件底部，算出内容自然高度
      let maxBottom = 0
      let child = gui.GetWindow(content, gui.GetWindowCmd.CHILD)
      while (child) {
        const childRect = gui.GetWindowRect(child)
        const contentRect = gui.GetWindowRect(content)
        if (!childRect || !contentRect) { child = gui.GetWindow(child, gui.GetWindowCmd.NEXT); continue }
        const relBottom = childRect.bottom - contentRect.top
        if (relBottom > maxBottom) maxBottom = relBottom
        child = gui.GetWindow(child, gui.GetWindowCmd.NEXT)
      }
      const naturalH = Math.max(maxBottom, 30)
      const scrollY = Math.min(scrollYRef.current, naturalH - svH)
      scrollYRef.current = Math.max(0, scrollY)

      gui.SetWindowPos(content, 0, 0, -scrollYRef.current, svW, naturalH,
        gui.SetWindowPosFlag.SWP_NOZORDER)

      if (naturalH > svH) {
        gui.SetScrollInfo(sv, gui.ScrollBar.VERT,
          { min: 0, max: naturalH - 1, page: svH, pos: scrollYRef.current }, true)
        gui.ShowScrollBar(sv, gui.ScrollBar.VERT, true)
      } else {
        scrollYRef.current = 0
        gui.ShowScrollBar(sv, gui.ScrollBar.VERT, false)
      }
    }

    useEffect(() => {
      const sv = svRef.current
      const content = contentRef.current
      if (!sv || !content) return
      updateScroll(sv, content)
    })

    function moveContent(sv: gui.HWND, content: gui.HWND, newPos: number) {
      scrollYRef.current = newPos
      gui.SetWindowPos(content, 0, 0, -newPos, 0, 0,
        gui.SetWindowPosFlag.SWP_NOSIZE | gui.SetWindowPosFlag.SWP_NOZORDER)
    }

    function handleWmScroll(e: { msg: number; wParam: number }) {
      const sv = svRef.current
      const content = contentRef.current
      if (!sv || !content) return
      const info = gui.GetScrollInfo(sv, gui.ScrollBar.VERT)
      const maxPos = info.max - info.page + 1
      const code = e.wParam & 0xFFFF

      let newPos = scrollYRef.current
      if (code === gui.ScrollCmd.THUMBTRACK) {
        newPos = Math.max(0, Math.min(maxPos, (e.wParam >> 16) & 0xFFFF))
      } else if (code === gui.ScrollCmd.LINEUP) newPos -= 20
      else if (code === gui.ScrollCmd.LINEDOWN) newPos += 20
      else if (code === gui.ScrollCmd.PAGEUP) newPos -= info.page
      else if (code === gui.ScrollCmd.PAGEDOWN) newPos += info.page
      else return
      newPos = Math.max(0, Math.min(maxPos, newPos))
      if (newPos !== scrollYRef.current) {
        moveContent(sv, content, newPos)
        gui.SetScrollInfo(sv, gui.ScrollBar.VERT, { pos: newPos }, true)
      }
    }

    function handleMouseWheel(e: { msg: number; wParam: number }) {
      const sv = svRef.current
      const content = contentRef.current
      if (!sv || !content) return
      const info = gui.GetScrollInfo(sv, gui.ScrollBar.VERT)
      const maxPos = info.max - info.page + 1
      const raw = (e.wParam >>> 16) & 0xFFFF
      const wheel = raw >= 0x8000 ? raw - 0x10000 : raw
      const dy = -Math.round(wheel * 40 / 120)
      let newPos = scrollYRef.current + dy
      newPos = Math.max(0, Math.min(maxPos, newPos))
      if (newPos !== scrollYRef.current) {
        moveContent(sv, content, newPos)
        gui.SetScrollInfo(sv, gui.ScrollBar.VERT, { pos: newPos }, true)
      }
    }

    return (
      <w type="STATIC"
        ws={gui.WindowStyle.VISIBLE | gui.WindowStyle.CLIPCHILDREN | gui.WindowStyle.VSCROLL}
        style={style}
        ref={(h: gui.HWND) => {
          svRef.current = h
          if (typeof ref === 'function') ref(h)
          else if (ref) (ref as React.MutableRefObject<gui.HWND | null>).current = h
        }}
        onEvent={(e) => {
          // 让 DefWindowProc 处理非客户区消息（确保滚动条能交互）
          if (e.msg === gui.WmMsg.NCHITTEST ||
              e.msg === gui.WmMsg.NCLBUTTONDOWN) {
            return gui.DefWindowProc(e.hwnd, e.msg, e.wParam, e.lParam)
          }
          // WM_VSCROLL 完全由 JS handler 接管。
          // 跳过 oldProc (DefWindowProc)，避免它的内部状态与我们的 SetScrollInfo 冲突。
          if (e.msg === gui.WmMsg.VSCROLL) { handleWmScroll(e); return 0 }
          if (e.msg === gui.WmMsg.MOUSEWHEEL) { handleMouseWheel(e); return 0 }
        }}
      >
        <w type="STATIC"
          ws={gui.WindowStyle.VISIBLE | gui.WindowStyle.CLIPCHILDREN}
          style={{flexDirection:'column', alignItems:'stretch'}}
          ref={(h: gui.HWND) => { contentRef.current = h }}
        >
          {children}
        </w>
      </w>
    )
  }
)
