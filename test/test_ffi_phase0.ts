import * as ffi from 'ffi'
import * as win from 'win'
import * as os from 'os'
import { Tester } from './test_helper.js'

export const suite = {
    name: 'ffi-phase0',
    run: (t: Tester) => {
        t.section('phase0 probe (arch=' + os.arch + ')')

        {
            let threw = false
            try {
                ffi.ffiCall(0, ['nope' as any], [0], 'void' as any)
            } catch {
                threw = true
            }
            t.checkTrue('unknown string kind throws', threw)
        }

        const k32 = ffi.dlopen('kernel32.dll', {
            MulDiv: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
            GetTickCount: { args: [], returns: 'u32' },
        })
        t.checkTrue('dlopen returns object', !!k32 && !!k32.MulDiv)
        t.check('MulDiv(1,1,3)=0', 0, k32.MulDiv(1, 1, 3))
        t.check('MulDiv(1,1,2)=1 (round-half-up)', 1, k32.MulDiv(1, 1, 2))
        t.check('MulDiv(-1,1,1)=-1 (sign-extend)', -1, k32.MulDiv(-1, 1, 1))
        t.check('MulDiv(10,3,2)=15', 15, k32.MulDiv(10, 3, 2))
        const tick = k32.GetTickCount()
        t.checkTrue('GetTickCount u32', typeof tick === 'number' && tick >= 0)

        const u32 = ffi.dlopen('user32.dll', {
            GetDesktopWindow: { args: [], returns: 'hnd' },
            GetDC: { args: ['hnd'], returns: 'hnd' },
            ReleaseDC: { args: ['hnd', 'hnd'], returns: 'i32' },
        })
        const desk = u32.GetDesktopWindow()
        t.checkTrue('GetDesktopWindow hnd !== 0', typeof desk === 'number' && desk !== 0)
        const hdc = u32.GetDC(desk)
        t.checkTrue('GetDC hnd !== 0', typeof hdc === 'number' && hdc !== 0)
        t.check('ReleaseDC i32', 1, u32.ReleaseDC(desk, hdc))

        const getDesktop = win.GetProcAddress(win.LoadLibrary('user32.dll')!, 'GetDesktopWindow')
        t.checkTrue('GetProcAddress GetDesktopWindow', !!getDesktop)
        if (getDesktop) {
            const h = ffi.ffiCall(getDesktop, [], [], 'hnd')
            t.checkTrue('ffiCall hnd ret !== 0', typeof h === 'number' && h !== 0)
        }

        {
            let threw = false
            try {
                const r = k32.MulDiv(BigInt(6) as any, BigInt(2) as any, BigInt(3) as any)
                t.check('bigint args coerce (MulDiv 6*2/3=4)', 4, r)
            } catch (e) {
                threw = true
                t.checkTrue('bigint args no throw', false)
                t.check('bigint args error', '', String(e))
            }
            if (!threw) t.checkTrue('bigint args did not throw', true)
        }

        {
            let threw = false
            try {
                (k32.MulDiv as any)(1, 2)
                threw = false
            } catch {
                threw = true
            }
            t.checkTrue('bound arity mismatch throws', threw)
        }

        const enumPrinters = win.GetProcAddress(win.LoadLibrary('winspool.drv')!, 'EnumPrintersW')
        if (enumPrinters) {
            let threw = false
            try {
                ffi.ffiCall(enumPrinters, ['ptr'] as any, [123] as any, 'void')
            } catch {
                threw = true
            }
            t.checkTrue('non-ArrayBuffer pointer still throws', threw)
        }
    },
}
