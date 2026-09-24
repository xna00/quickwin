import * as ffi from 'ffi'
import * as win from 'win'
import * as gui from 'gui'

function loadProc(lib: win.HMODULE, name: string): number {
    const ptr = win.GetProcAddress(lib, name)
    if (!ptr) throw new Error(`Cannot load ${name}`)
    return ptr
}

const user32 = win.LoadLibrary('user32.dll')
const gdi32 = win.LoadLibrary('gdi32.dll')
if (!user32 || !gdi32) throw new Error('Failed to load system DLLs')
const DrawTextW = loadProc(user32, 'DrawTextW')
const GetDC = loadProc(user32, 'GetDC')
const ReleaseDC = loadProc(user32, 'ReleaseDC')
const SelectObject = loadProc(gdi32, 'SelectObject')

// 句柄（HDC/HWND/HFONT）：C 侧按指针宽传参，无需再按 os.arch 分支
const FFI_HND = 'hnd' as const
const FFI_S32 = 'i32' as const
const FFI_PTR = 'ptr' as const

export function measureText(hdc: number, text: string, maxWidth: number): { width: number; height: number } {
    const textBuf = new TextEncoder('utf-16le').encode(text + '\0').buffer
    const rect = new ArrayBuffer(16)
    const dv = new DataView(rect)
    dv.setInt32(8, maxWidth, true)
    ffi.ffiCall(DrawTextW, [FFI_HND, FFI_PTR, FFI_S32, FFI_PTR, FFI_S32], [hdc, textBuf, -1, rect, gui.DrawTextFlag.CALCRECT], FFI_S32)
    return { width: dv.getInt32(8, true), height: dv.getInt32(12, true) }
}

export function getButtonIdealSize(hwnd: gui.HWND): { width: number; height: number } {
    const size = new ArrayBuffer(8)
    gui.SendMessage(hwnd, gui.ButtonExtMsg.GETIDEALSIZE, 0, ffi.bufferPtr(size))
    const dv = new DataView(size)
    return { width: dv.getInt32(0, true), height: dv.getInt32(4, true) }
}

export function measureTextForHwnd(hwnd: gui.HWND, text: string): { width: number; height: number } {
    const hdc = ffi.ffiCall(GetDC, [FFI_HND], [hwnd], FFI_HND)
    if (!hdc) return { width: 0, height: 0 }
    const hFont = gui.SendMessage(hwnd, gui.WmMsg.GETFONT, 0, 0)
    const oldFont = hFont ? ffi.ffiCall(SelectObject, [FFI_HND, FFI_HND], [hdc, hFont], FFI_HND) : 0
    const result = measureText(hdc, text, 0)
    if (hFont) ffi.ffiCall(SelectObject, [FFI_HND, FFI_HND], [hdc, oldFont], FFI_HND)
    ffi.ffiCall(ReleaseDC, [FFI_HND, FFI_HND], [hwnd, hdc], FFI_S32)
    const wr = gui.GetWindowRect(hwnd)
    const cr = gui.GetClientRect(hwnd)
    if (wr && cr) {
        result.width += (wr.right - wr.left) - (cr.right - cr.left)
        result.height += (wr.bottom - wr.top) - (cr.bottom - cr.top)
    }
    return result
}
