import * as gui from 'gui'
import { Tester } from './test_helper.js'
import { bind, bindLib } from '../lib/ffi-bind.js'

export const suite = {
    name: 'ffi-bind',
    run: (t: Tester) => {
        t.section('bind single proc')
        const getDC = bind('user32.dll', 'GetDC', 'ptr -> ptr')
        const dc = getDC(0)
        t.checkTrue('bind GetDC(NULL) returns screen DC', !!dc)

        t.section('bindLib batch with wstr auto-encode')
        const user32 = bindLib('user32.dll', {
            DrawTextW: 'ptr wstr i32 ptr i32 -> i32',
            ReleaseDC: 'ptr ptr -> i32',
        })
        const rect = new ArrayBuffer(16)
        const dv = new DataView(rect)
        dv.setInt32(8, 500, true)
        const lines = user32.DrawTextW(dc, 'hello ffi-bind', -1, rect, gui.DrawTextFlag.CALCRECT)
        t.checkTrue('DrawTextW returns line count > 0', lines > 0)
        t.checkTrue('measured width > 0', dv.getInt32(8, true) > 0)
        t.checkTrue('measured height > 0', dv.getInt32(12, true) > 0)
        if (dc) user32.ReleaseDC(0, dc)
    },
}