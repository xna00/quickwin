import * as ffi from 'ffi'
import * as win from 'win'
import * as os from 'os'
import { Tester } from './test_helper.js'

/** 在 libffi / qwcall 两个后端上跑同一组断言（Spike 验收） */
function runBattery(t: Tester, tag: string): void {
    const k32 = ffi.dlopen('kernel32.dll', {
        MulDiv: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
        GetTickCount: { args: [], returns: 'u32' },
    })
    t.check(tag + ' MulDiv(1,1,3)=0', 0, k32.MulDiv(1, 1, 3))
    t.check(tag + ' MulDiv(-1,1,1)=-1 sign-extend', -1, k32.MulDiv(-1, 1, 1))
    t.check(tag + ' MulDiv(10,3,2)=15', 15, k32.MulDiv(10, 3, 2))
    const tick = k32.GetTickCount()
    t.checkTrue(tag + ' GetTickCount u32', typeof tick === 'number' && tick >= 0)

    const u32 = ffi.dlopen('user32.dll', {
        GetDesktopWindow: { args: [], returns: 'hnd' },
        GetDC: { args: ['hnd'], returns: 'hnd' },
        ReleaseDC: { args: ['hnd', 'hnd'], returns: 'i32' },
    })
    const desk = u32.GetDesktopWindow()
    t.checkTrue(tag + ' GetDesktopWindow !== 0', typeof desk === 'number' && desk !== 0)
    const hdc = u32.GetDC(desk)
    t.checkTrue(tag + ' GetDC !== 0', typeof hdc === 'number' && hdc !== 0)
    t.check(tag + ' ReleaseDC=1', 1, u32.ReleaseDC(desk, hdc))

    // 高 arity：EnumPrintersW 7 参，验证栈平衡不崩
    const hsp = win.LoadLibrary('winspool.drv')
    if (hsp) {
        const ep = win.GetProcAddress(hsp, 'EnumPrintersW')
        if (ep) {
            const needed = new Uint32Array(new ArrayBuffer(4))
            const returned = new Uint32Array(new ArrayBuffer(4))
            const ret = ffi.ffiCall(
                ep,
                ['u32', 'ptr', 'u32', 'ptr', 'u32', 'ptr', 'ptr'],
                [0x06, null, 2, null, 0, needed.buffer, returned.buffer],
                'i32'
            )
            t.checkTrue(tag + ' EnumPrintersW arity7 no crash', typeof ret === 'number')
            t.checkTrue(tag + ' EnumPrintersW pcbNeeded set', needed[0]! >= 0)
        }
    }

    // 负返回（stdcall 栈平衡探针：错 ABI 会立即崩）
    const mulDivFp = win.GetProcAddress(win.LoadLibrary('kernel32.dll')!, 'MulDiv')
    if (mulDivFp) {
        const neg = ffi.ffiCall(mulDivFp, ['i32', 'i32', 'i32'], [-1, 1, 1], 'i32')
        t.check(tag + ' ffiCall MulDiv(-1,1,1)=-1', -1, neg)
    }

    // hnd 往返
    const getDcFp = win.GetProcAddress(win.LoadLibrary('user32.dll')!, 'GetDC')
    const relDcFp = win.GetProcAddress(win.LoadLibrary('user32.dll')!, 'ReleaseDC')
    if (getDcFp && relDcFp) {
        const d = ffi.ffiCall(getDcFp, ['hnd'], [desk], 'hnd')
        t.checkTrue(tag + ' ffiCall GetDC hnd', typeof d === 'number' && d !== 0)
        const r = ffi.ffiCall(relDcFp, ['hnd', 'hnd'], [desk, d], 'i32')
        t.check(tag + ' ffiCall ReleaseDC=1', 1, r)
    }
}

export const suite = {
    name: 'ffi-spike',
    run: (t: Tester) => {
        t.section('backend switch (arch=' + os.arch + ')')
        const prev = ffi.getBackend()
        t.checkTrue('getBackend returns string', prev === 'libffi' || prev === 'qwcall')

        const back = ffi.setBackend('qwcall')
        t.check('setBackend returns previous', prev, back)
        t.check('getBackend after set', 'qwcall', ffi.getBackend())

        t.section('qwcall backend battery')
        try {
            runBattery(t, '[qwcall]')
            t.checkTrue('qwcall battery no throw', true)
        } catch (e) {
            t.checkTrue('qwcall battery no throw', false)
            t.check('qwcall error', '', String(e))
        }

        // i64：x64 走 qwcall；ia32 上 qwcall 明确拒绝（回退需改后端）
        t.section('i64 policy')
        if (os.arch === 'ia32') {
            let threw = false
            let msg = ''
            try {
                const fp = win.GetProcAddress(win.LoadLibrary('kernel32.dll')!, 'MulDiv')
                if (fp) ffi.ffiCall(fp, ['i64', 'i64', 'i64'], [1n, 1n, 1n], 'i64')
            } catch (e) {
                threw = true
                msg = String(e)
            }
            t.checkTrue('ia32 qwcall rejects i64', threw)
            t.checkTrue('ia32 i64 error mentions qwcall', msg.indexOf('qwcall') >= 0)
        } else {
            const fp = win.GetProcAddress(win.LoadLibrary('kernel32.dll')!, 'MulDiv')
            if (fp) {
                const r = ffi.ffiCall(fp, ['i32', 'i32', 'i32'], [-1, 1, 1], 'i32')
                t.check('x64 MulDiv via string kinds=-1', -1, r)
            }
        }

        // 切回 libffi 对照
        ffi.setBackend('libffi')
        t.section('libffi control battery')
        try {
            runBattery(t, '[libffi]')
            t.checkTrue('libffi battery no throw', true)
        } catch (e) {
            t.checkTrue('libffi battery no throw', false)
            t.check('libffi error', '', String(e))
        }

        // 还原初始后端，避免污染其它 suite
        ffi.setBackend(prev as 'libffi' | 'qwcall')
        t.check('restored backend', prev, ffi.getBackend())
    },
}
