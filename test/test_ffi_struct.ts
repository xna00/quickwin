import * as os from 'os'
import { Tester } from './test_helper.js'
import { struct } from '../lib/ffi-struct.js'
import { bind } from '../lib/ffi-bind.js'

const RECT = struct({ left: 'i32', top: 'i32', right: 'i32', bottom: 'i32' })

const TVITEM = struct({
    mask: 'u32',
    hItem: 'ptr',
    state: 'u32',
    stateMask: 'u32',
    pszText: 'ptr',
    cchTextMax: 'i32',
    iImage: 'i32',
    iSelectedImage: 'i32',
    cChildren: 'i32',
    lParam: 'ptr',
})
const TVINSERTSTRUCT = struct({ hParent: 'ptr', hInsertAfter: 'ptr', item: TVITEM })

export const suite = {
    name: 'ffi-struct',
    run: (t: Tester) => {
        const is64 = os.arch === 'x64'

        t.section('RECT layout & roundtrip')
        t.check('RECT.size == 16', 16, RECT.size)
        const rbuf = RECT.write({ left: 10, top: 20, right: 30, bottom: 40 })
        const r = RECT.read(rbuf)
        t.check('left', 10, r.left)
        t.check('top', 20, r.top)
        t.check('right', 30, r.right)
        t.check('bottom', 40, r.bottom)
        t.check('offsetOf left', 0, RECT.offsetOf('left'))
        t.check('offsetOf bottom', 12, RECT.offsetOf('bottom'))

        t.section('GetWindowRect fills RECT buffer')
        const getWindowRect = bind('user32.dll', 'GetWindowRect', 'ptr ptr -> int')
        const getDesktopWindow = bind('user32.dll', 'GetDesktopWindow', ' -> ptr')
        const hwnd = getDesktopWindow()
        const wrect = new ArrayBuffer(16)
        const ok = getWindowRect(hwnd, wrect)
        t.checkTrue('GetWindowRect succeeds', ok !== 0)
        const wr = RECT.read(wrect)
        t.checkTrue('screen RECT non-empty', wr.right > 0 && wr.bottom > 0)

        t.section('ptr layout matches arch')
        t.check(`TVITEM.size (${os.arch})`, is64 ? 56 : 40, TVITEM.size)
        t.check('TVITEM.offsetOf pszText', is64 ? 24 : 16, TVITEM.offsetOf('pszText'))
        t.check('TVINSERTSTRUCT.size', is64 ? 72 : 48, TVINSERTSTRUCT.size)
        t.check('TVINSERTSTRUCT.offsetOf item', is64 ? 16 : 8, TVINSERTSTRUCT.offsetOf('item'))

        t.section('nested struct roundtrip')
        const ins = TVINSERTSTRUCT.write({
            hParent: 0x11111111,
            hInsertAfter: 0x22222222,
            item: {
                mask: 1, hItem: 0x33333333, state: 0, stateMask: 0,
                pszText: 0x44444444, cchTextMax: 100,
                iImage: 0, iSelectedImage: 0, cChildren: 5, lParam: 0x55555555,
            },
        })
        const got = TVINSERTSTRUCT.read(ins)
        t.check('nested hParent', 0x11111111, got.hParent)
        t.check('nested hInsertAfter', 0x22222222, got.hInsertAfter)
        t.check('nested cChildren', 5, got.item.cChildren)
        t.check('nested ptr pszText', 0x44444444, got.item.pszText)

        t.section('C typedef aliases (int/DWORD/LPARAM/LONG_PTR/short)')
        const M = struct({ n: 'int', d: 'DWORD', w: 'LPARAM', s: 'short', q: 'LONG_PTR' })
        t.check(`aliased size (${os.arch})`, is64 ? 32 : 20, M.size)
        const mb = M.write({ n: -5, d: 0xFFFFFFFF, w: 0xAABBCCDD, s: -7, q: 0x11223344 })
        const m = M.read(mb)
        t.check('int -5', -5, m.n)
        t.check('DWORD', 0xFFFFFFFF, m.d)
        t.check('LPARAM', 0xAABBCCDD, m.w)
        t.check('short -7', -7, m.s)
        t.check('LONG_PTR', 0x11223344, m.q)

        t.section('wstr[8] roundtrip & truncation')
        const W = struct({ name: 'wstr[8]' })
        t.check('wstr[8].size == 16', 16, W.size)
        const wb = W.write({ name: 'hello' })
        t.check('read back "hello"', 'hello', W.read(wb).name)
        const lb = W.write({ name: 'a very long string over' })
        t.check('truncated to 7 chars', 'a very ', W.read(lb).name)

        t.section('numeric arrays roundtrip')
        const A = struct({ v: 'u16[4]', k: 'i32[2]' })
        t.check('size == 16', 16, A.size)
        const ab = A.write({ v: [1, 2, 3, 4], k: [-1, 300000] })
        const ad = A.read(ab)
        t.check('u16[0]', 1, ad.v[0])
        t.check('u16[3]', 4, ad.v[3])
        t.check('i32[0] -1', -1, ad.k[0])
        t.check('i32[1]', 300000, ad.k[1])

        t.section('f32/f64 layout (MSVC: f@0, double@8)')
        const FL = struct({ f: 'float', d: 'double' })
        t.check('size == 16 (f@0, double aligned @8)', 16, FL.size)
        const fb = FL.write({ f: 1.5, d: -2.25 })
        const fr = FL.read(fb)
        t.check('float', 1.5, fr.f)
        t.check('double', -2.25, fr.d)

        t.section('comctl dialog structs track 32/64-bit ABI')
        const TCITEMW = struct({
            mask: 'u32', dwState: 'u32', dwStateMask: 'u32',
            pszText: 'ptr', cchTextMax: 'i32', iImage: 'i32', lParam: 'ptr',
        })
        t.check('TCITEMW.size', is64 ? 40 : 28, TCITEMW.size)
        t.check('TCITEMW.offsetOf pszText', is64 ? 16 : 12, TCITEMW.offsetOf('pszText'))
        t.check('TCITEMW.offsetOf cchTextMax', is64 ? 24 : 16, TCITEMW.offsetOf('cchTextMax'))

        const TTTOOLINFOW = struct({
            cbSize: 'u32', uFlags: 'u32', hwnd: 'ptr', uId: 'ptr',
            rect: 'i32[4]', hinst: 'ptr', lpszText: 'ptr', lParam: 'ptr',
        })
        t.check('TTTOOLINFOW.size', is64 ? 64 : 44, TTTOOLINFOW.size)
        t.check('TTTOOLINFOW.offsetOf lpszText', is64 ? 48 : 36, TTTOOLINFOW.offsetOf('lpszText'))

        const OPENFILENAMEW = struct({
            lStructSize: 'u32', hwndOwner: 'ptr', hInstance: 'ptr', lpstrFilter: 'ptr',
            lpstrCustomFilter: 'ptr', nMaxCustFilter: 'u32', nFilterIndex: 'u32',
            lpstrFile: 'ptr', nMaxFile: 'u32', lpstrFileTitle: 'ptr', nMaxFileTitle: 'u32',
            lpstrInitialDir: 'ptr', lpstrTitle: 'ptr', Flags: 'u32',
            nFileOffset: 'u16', nFileExtension: 'u16',
            lpstrDefExt: 'ptr', lCustData: 'ptr', lpfnHook: 'ptr', lpTemplateName: 'ptr',
        })
        t.check('OPENFILENAMEW.size', is64 ? 136 : 76, OPENFILENAMEW.size)
        t.check('OPENFILENAMEW.offsetOf lpstrFile', is64 ? 48 : 28, OPENFILENAMEW.offsetOf('lpstrFile'))
        t.check('OPENFILENAMEW.offsetOf Flags', is64 ? 96 : 52, OPENFILENAMEW.offsetOf('Flags'))
        t.check('OPENFILENAMEW.offsetOf lpstrTitle', is64 ? 88 : 48, OPENFILENAMEW.offsetOf('lpstrTitle'))

        const BROWSEINFOW = struct({
            hwndOwner: 'ptr', pidlRoot: 'ptr', pszDisplayName: 'ptr', lpszTitle: 'ptr',
            ulFlags: 'u32', lpfn: 'ptr', lParam: 'ptr', iImage: 'i32',
        })
        t.check('BROWSEINFOW.size', is64 ? 64 : 32, BROWSEINFOW.size)
        t.check('BROWSEINFOW.offsetOf lpszTitle', is64 ? 24 : 12, BROWSEINFOW.offsetOf('lpszTitle'))
        t.check('BROWSEINFOW.offsetOf ulFlags', is64 ? 32 : 16, BROWSEINFOW.offsetOf('ulFlags'))
    },
}