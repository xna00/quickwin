/** @jsxImportSource .. */
import * as gui from 'gui'
import * as ffi from 'ffi'
import * as win from 'win'
import * as os from 'os'
import { moveWindow } from '../props.js'

const _user32 = win.LoadLibrary('user32.dll')

const FFI_U64 = ffi.FFI_TYPE_UINT64
const FFI_U32 = ffi.FFI_TYPE_UINT32
const FFI_S32 = ffi.FFI_TYPE_SINT32
const FFI_PTR = ffi.FFI_TYPE_POINTER

const GetWindow_proc = _user32 ? win.GetProcAddress(_user32, 'GetWindow') : 0
const GetWindowRect_proc = _user32 ? win.GetProcAddress(_user32, 'GetWindowRect') : 0
const SetScrollInfo_proc = _user32 ? win.GetProcAddress(_user32, 'SetScrollInfo') : 0
const GetClientRect_proc = _user32 ? win.GetProcAddress(_user32, 'GetClientRect') : 0

const GW_CHILD = 5
const GW_HWNDNEXT = 2

const SIF_RANGE = 0x0001
const SIF_PAGE = 0x0002
const SIF_POS = 0x0004
const SIF_RANGEPAGE = SIF_RANGE | SIF_PAGE

const SB_HORZ = 0
const SB_VERT = 1

const SB_LINEUP = 0
const SB_LINEDOWN = 1
const SB_PAGEUP = 2
const SB_PAGEDOWN = 3
const SB_THUMBTRACK = 5

const SCROLL_LINE = 40

interface ScrollState {
    x: number
    y: number
    contentW: number
    contentH: number
}

const _scrollState = new Map<number, ScrollState>()

export interface ScrollViewProps {
    style?: Record<string, any>
    scrollY?: boolean
    scrollX?: boolean
    children?: any
}

function getClientSize(hwnd: number): { w: number; h: number } {
    if (!GetClientRect_proc) return { w: 0, h: 0 }
    const rectBuf = new ArrayBuffer(16)
    const ok = ffi.ffiCall(GetClientRect_proc, [FFI_U64, FFI_PTR], [hwnd, rectBuf], FFI_U32) as number
    if (!ok) return { w: 0, h: 0 }
    const dv = new DataView(rectBuf)
    return { w: dv.getInt32(8, true), h: dv.getInt32(12, true) }
}

function getChildrenHwnds(hwnd: number): number[] {
    if (!GetWindow_proc) return []
    const result: number[] = []
    const child = ffi.ffiCall(GetWindow_proc, [FFI_U64, FFI_U32], [hwnd, GW_CHILD], FFI_U64) as number
    if (!child) return result
    result.push(child)
    let next = ffi.ffiCall(GetWindow_proc, [FFI_U64, FFI_U32], [child, GW_HWNDNEXT], FFI_U64) as number
    while (next) {
        result.push(next)
        next = ffi.ffiCall(GetWindow_proc, [FFI_U64, FFI_U32], [next, GW_HWNDNEXT], FFI_U64) as number
    }
    return result
}

function getContentExtent(hwnd: number): { w: number; h: number } {
    if (!GetWindowRect_proc) return { w: 0, h: 0 }
    const children = getChildrenHwnds(hwnd)
    if (children.length === 0) return { w: 0, h: 0 }

    const parentRect = new ArrayBuffer(16)
    ffi.ffiCall(GetWindowRect_proc, [FFI_U64, FFI_PTR], [hwnd, parentRect], FFI_U32)
    const pv = new DataView(parentRect)
    const pLeft = pv.getInt32(0, true)
    const pTop = pv.getInt32(4, true)

    let maxRight = 0
    let maxBottom = 0

    for (const child of children) {
        const rect = new ArrayBuffer(16)
        ffi.ffiCall(GetWindowRect_proc, [FFI_U64, FFI_PTR], [child, rect], FFI_U32)
        const dv = new DataView(rect)
        const curLeft = dv.getInt32(0, true) - pLeft
        const curTop = dv.getInt32(4, true) - pTop
        const w = dv.getInt32(8, true) - dv.getInt32(0, true)
        const h = dv.getInt32(12, true) - dv.getInt32(4, true)
        maxRight = Math.max(maxRight, curLeft + w)
        maxBottom = Math.max(maxBottom, curTop + h)
    }

    return { w: maxRight, h: maxBottom }
}

function setScrollRange(hwnd: number, bar: number, maxVal: number, page: number, pos: number): void {
    if (!SetScrollInfo_proc) return
    const si = new ArrayBuffer(28)
    const dv = new DataView(si)
    dv.setUint32(0, 28, true)
    dv.setUint32(4, SIF_RANGEPAGE, true)
    dv.setInt32(8, 0, true)
    dv.setInt32(12, maxVal, true)
    dv.setUint32(16, page, true)
    ffi.ffiCall(SetScrollInfo_proc, [FFI_U64, FFI_S32, FFI_PTR, FFI_U32], [hwnd, bar, si, 1], FFI_U32)

    dv.setUint32(4, SIF_POS, true)
    dv.setInt32(20, pos, true)
    ffi.ffiCall(SetScrollInfo_proc, [FFI_U64, FFI_S32, FFI_PTR, FFI_U32], [hwnd, bar, si, 1], FFI_U32)
}

function updateScrollRange(hwnd: number): void {
    const state = _scrollState.get(hwnd)
    if (!state) return
    const client = getClientSize(hwnd)
    const extent = getContentExtent(hwnd)
    state.contentW = extent.w
    state.contentH = extent.h

    state.x = Math.min(state.x, Math.max(0, state.contentW - client.w))
    state.y = Math.min(state.y, Math.max(0, state.contentH - client.h))

    setScrollRange(hwnd, SB_VERT, state.contentH, client.h, state.y)
    setScrollRange(hwnd, SB_HORZ, state.contentW, client.w, state.x)
}

function applyScrollDelta(hwnd: number, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return
    if (!GetWindowRect_proc) return
    const children = getChildrenHwnds(hwnd)
    if (children.length === 0) return

    const parentRect = new ArrayBuffer(16)
    ffi.ffiCall(GetWindowRect_proc, [FFI_U64, FFI_PTR], [hwnd, parentRect], FFI_U32)
    const pv = new DataView(parentRect)
    const pLeft = pv.getInt32(0, true)
    const pTop = pv.getInt32(4, true)

    for (const child of children) {
        const rect = new ArrayBuffer(16)
        ffi.ffiCall(GetWindowRect_proc, [FFI_U64, FFI_PTR], [child, rect], FFI_U32)
        const dv = new DataView(rect)
        const w = dv.getInt32(8, true) - dv.getInt32(0, true)
        const h = dv.getInt32(12, true) - dv.getInt32(4, true)
        const curX = dv.getInt32(0, true) - pLeft
        const curY = dv.getInt32(4, true) - pTop
        moveWindow(child, curX + dx, curY + dy, w, h)
    }
}

function applyScrollOffset(hwnd: number, scrollX: number, scrollY: number): void {
    if (scrollX === 0 && scrollY === 0) return
    if (!GetWindowRect_proc) return
    const children = getChildrenHwnds(hwnd)
    if (children.length === 0) return

    const parentRect = new ArrayBuffer(16)
    ffi.ffiCall(GetWindowRect_proc, [FFI_U64, FFI_PTR], [hwnd, parentRect], FFI_U32)
    const pv = new DataView(parentRect)
    const pLeft = pv.getInt32(0, true)
    const pTop = pv.getInt32(4, true)

    for (const child of children) {
        const rect = new ArrayBuffer(16)
        ffi.ffiCall(GetWindowRect_proc, [FFI_U64, FFI_PTR], [child, rect], FFI_U32)
        const dv = new DataView(rect)
        const w = dv.getInt32(8, true) - dv.getInt32(0, true)
        const h = dv.getInt32(12, true) - dv.getInt32(4, true)
        const virtX = dv.getInt32(0, true) - pLeft
        const virtY = dv.getInt32(4, true) - pTop
        moveWindow(child, virtX - scrollX, virtY - scrollY, w, h)
    }
}

function handleScroll(hwnd: number, dx: number, dy: number): void {
    const state = _scrollState.get(hwnd)
    if (!state) return
    const client = getClientSize(hwnd)
    const oldX = state.x
    const oldY = state.y

    const maxX = Math.max(0, state.contentW - client.w)
    const maxY = Math.max(0, state.contentH - client.h)
    state.x = Math.max(0, Math.min(state.x + dx, maxX))
    state.y = Math.max(0, Math.min(state.y + dy, maxY))

    applyScrollDelta(hwnd, -(state.x - oldX), -(state.y - oldY))
    setScrollRange(hwnd, SB_VERT, state.contentH, client.h, state.y)
    setScrollRange(hwnd, SB_HORZ, state.contentW, client.w, state.x)
}

function syncAfterLayout(hwnd: number): void {
    updateScrollRange(hwnd)
    const state = _scrollState.get(hwnd)
    if (state) applyScrollOffset(hwnd, state.x, state.y)
}

export function ScrollView(props: ScrollViewProps) {
    const scrollY = props.scrollY !== false
    const scrollX = props.scrollX === true
    let ws = gui.WindowStyle.CLIPCHILDREN
    if (scrollY) ws |= gui.WindowStyle.VSCROLL
    if (scrollX) ws |= gui.WindowStyle.HSCROLL

    const ref = (hwnd: gui.HWND) => {
        if (!hwnd) return
        if (!_scrollState.has(hwnd as number)) {
            _scrollState.set(hwnd as number, { x: 0, y: 0, contentW: 0, contentH: 0 })
        }
        os.setTimeout(() => syncAfterLayout(hwnd as number), 0)
    }

    return (
        <w type="STATIC"
            ref={ref}
            ws={ws}
            style={props.style}
            onEvent={(e) => {
                const hwnd = e.hwnd as number
                const state = _scrollState.get(hwnd)

                if (e.msg === gui.WmMsg.VSCROLL && state) {
                    const code = e.wParam & 0xFFFF
                    let dy = 0
                    if (code === SB_LINEUP) dy = -SCROLL_LINE
                    else if (code === SB_LINEDOWN) dy = SCROLL_LINE
                    else if (code === SB_PAGEUP) {
                        const ch = getClientSize(hwnd).h
                        dy = -(ch - SCROLL_LINE)
                    }
                    else if (code === SB_PAGEDOWN) {
                        const ch = getClientSize(hwnd).h
                        dy = ch - SCROLL_LINE
                    }
                    else if (code === SB_THUMBTRACK) {
                        const thumb = (e.wParam >> 16) & 0xFFFF
                        dy = thumb - state.y
                    }
                    handleScroll(hwnd, 0, dy)
                }
                else if (e.msg === gui.WmMsg.HSCROLL && state) {
                    const code = e.wParam & 0xFFFF
                    let dx = 0
                    if (code === SB_LINEUP) dx = -SCROLL_LINE
                    else if (code === SB_LINEDOWN) dx = SCROLL_LINE
                    else if (code === SB_PAGEUP) {
                        const cw = getClientSize(hwnd).w
                        dx = -(cw - SCROLL_LINE)
                    }
                    else if (code === SB_PAGEDOWN) {
                        const cw = getClientSize(hwnd).w
                        dx = cw - SCROLL_LINE
                    }
                    else if (code === SB_THUMBTRACK) {
                        const thumb = (e.wParam >> 16) & 0xFFFF
                        dx = thumb - state.x
                    }
                    handleScroll(hwnd, dx, 0)
                }
                else if (e.msg === gui.WmMsg.MOUSEWHEEL && state) {
                    const raw = (e.wParam >>> 16) & 0xFFFF
                    const wheel = raw >= 0x8000 ? raw - 0x10000 : raw
                    const dy = -Math.round(wheel * SCROLL_LINE / 120)
                    handleScroll(hwnd, 0, dy)
                }
                else if (e.msg === gui.WmMsg.NCHITTEST) {
                    return gui.DefWindowProc(hwnd as gui.HWND, e.msg, e.wParam, e.lParam)
                }
                else if (e.msg === gui.WmMsg.SIZE) {
                    os.setTimeout(() => syncAfterLayout(hwnd), 0)
                }
            }}>
            {props.children}
        </w>
    )
}
