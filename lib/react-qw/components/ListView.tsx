import { forwardRef, useRef, useEffect, useState } from 'react'
import * as gui from 'gui'
import * as ffi from 'ffi'
import type { WStyle } from '../jsx.d.ts'

function textToUtf16(s: string): ArrayBuffer {
  const buf = new ArrayBuffer((s.length + 1) * 2)
  const dv = new DataView(buf)
  for (let i = 0; i < s.length; i++)
    dv.setUint16(i * 2, s.charCodeAt(i), true)
  return buf
}

function readI32(ptr: number, offset: number): number {
  return ffi.readByte(ptr + offset) | (ffi.readByte(ptr + offset + 1) << 8) |
    (ffi.readByte(ptr + offset + 2) << 16) | (ffi.readByte(ptr + offset + 3) << 24)
}

function bufPtr(buf: ArrayBuffer): number {
  return ffi.bufferPtr(buf) as number
}

const LVIF_TEXT = 0x0001
const LVIF_STATE = 0x0008
const LVIS_FOCUSED = 0x0001
const LVIS_SELECTED = 0x0002
const LVCF_TEXT = 0x0004
const LVCF_WIDTH = 0x0002
const LVCF_FMT = 0x0001
const LVNI_SELECTED = 0x0002

export interface ListViewProps {
  columns?: string[]
  items: string[][]
  selectedIndex?: number
  defaultSelectedIndex?: number
  onChange?: (index: number) => void
  style?: WStyle
}

export const ListView = forwardRef<gui.HWND, ListViewProps>(
  ({ columns = ['Name'], items, selectedIndex: controlledIndex, defaultSelectedIndex = -1,
     onChange, style }, ref) => {
    const [internalIndex, setInternalIndex] = useState(defaultSelectedIndex)
    const isControlled = controlledIndex !== undefined
    const sel = isControlled ? controlledIndex : internalIndex
    const lvRef = useRef<gui.HWND>(null)

    const lvWs = gui.WindowStyle.VISIBLE | gui.WindowStyle.BORDER | gui.WindowStyle.VSCROLL
      | gui.ListViewStyle.REPORT | gui.ListViewStyle.SINGLESEL | gui.ListViewStyle.SHOWSELALWAYS

    useEffect(() => {
      const h = lvRef.current
      if (!h) return

      gui.SendMessage(h, gui.LvMsg.SETEXTENDEDLISTVIEWSTYLE, 0,
        gui.LvExStyle.FULLROWSELECT | gui.LvExStyle.GRIDLINES | gui.LvExStyle.DOUBLEBUFFER)

      const n = columns.length
      for (let j = 0; j < n; j++) {
        const titleBuf = textToUtf16(columns[j])
        const lvc = new ArrayBuffer(52)
        const dv = new DataView(lvc)
        dv.setUint32(0, LVCF_TEXT | LVCF_WIDTH | LVCF_FMT, true)
        dv.setInt32(8, 100, true)
        dv.setBigUint64(16, BigInt(bufPtr(titleBuf)), true)
        dv.setInt32(28, j, true)
        gui.SendMessage(h, gui.LvMsg.INSERTCOLUMNW, j, bufPtr(lvc))
      }
    }, [])

    useEffect(() => {
      const h = lvRef.current
      if (!h) return

      gui.SendMessage(h, gui.LvMsg.DELETEALLITEMS, 0, 0)
      const nCols = columns.length

      for (let i = 0; i < items.length; i++) {
        const col0 = textToUtf16(items[i][0] ?? '')
        const lvi = new ArrayBuffer(84)
        const dv = new DataView(lvi)
        dv.setUint32(0, LVIF_TEXT, true)
        dv.setInt32(4, i, true)
        dv.setBigUint64(24, BigInt(bufPtr(col0)), true)
        gui.SendMessage(h, gui.LvMsg.INSERTITEMW, 0, bufPtr(lvi))

        for (let j = 1; j < nCols && j < items[i].length; j++) {
          const colJ = textToUtf16(items[i][j] ?? '')
          const sub = new ArrayBuffer(84)
          const sdv = new DataView(sub)
          sdv.setUint32(0, LVIF_TEXT, true)
          sdv.setInt32(4, i, true)
          sdv.setInt32(8, j, true)
          sdv.setBigUint64(24, BigInt(bufPtr(colJ)), true)
          gui.SendMessage(h, gui.LvMsg.SETITEMW, 0, bufPtr(sub))
        }
      }

      if (sel >= 0 && sel < items.length) {
        const lvi = new ArrayBuffer(84)
        const dv = new DataView(lvi)
        dv.setUint32(0, LVIF_STATE, true)
        dv.setUint32(12, LVIS_SELECTED | LVIS_FOCUSED, true)
        dv.setUint32(16, LVIS_SELECTED | LVIS_FOCUSED, true)
        gui.SendMessage(h, gui.LvMsg.SETITEMSTATE, sel, bufPtr(lvi))
      }
    }, [items])

    useEffect(() => {
      const h = lvRef.current
      if (!h) return

      const lvi = new ArrayBuffer(84)
      const dv = new DataView(lvi)
      dv.setUint32(0, LVIF_STATE, true)
      dv.setUint32(12, LVIS_SELECTED | LVIS_FOCUSED, true)
      dv.setUint32(16, LVIS_SELECTED | LVIS_FOCUSED, true)
      gui.SendMessage(h, gui.LvMsg.SETITEMSTATE, sel, bufPtr(lvi))
    }, [sel])

    return (
      <w type="STATIC"
        ws={gui.WindowStyle.VISIBLE | gui.WindowStyle.CLIPCHILDREN}
        style={{ ...style, flexDirection: 'column', alignItems: 'stretch' }}
        onEvent={(e) => {
          if (e.msg === gui.WmMsg.NOTIFY) {
            const code = readI32(e.lParam, 16)
            if (code === gui.LvNotifyCode.ITEMCHANGED) {
              const h = lvRef.current
              if (!h) return
              const newSel = gui.SendMessage(h, gui.LvMsg.GETNEXTITEM, -1, LVNI_SELECTED)
              if (newSel !== sel) {
                if (!isControlled) setInternalIndex(newSel)
                onChange?.(newSel)
              }
            }
          }
        }}
      >
        <w type="SysListView32" ws={lvWs}
          style={{flexGrow:1}}
          ref={(h: gui.HWND) => {
            lvRef.current = h
            if (typeof ref === 'function') ref(h)
            else if (ref) (ref as { current: gui.HWND }).current = h
          }}
          onEvent={(e) => {
            if (e.msg === gui.WmMsg.SIZE) {
              const w = e.lParam & 0xFFFF
              const n = columns.length
              const availW = w - 22
              const colW = Math.max(80, Math.floor(availW / n))
              for (let j = 0; j < n; j++) {
                const cw = j < n - 1 ? colW : availW - colW * (n - 1)
                gui.SendMessage(e.hwnd, gui.LvMsg.SETCOLUMNWIDTH, j, Math.max(80, cw))
              }
            }
          }}
        />
      </w>
    )
  }
)
