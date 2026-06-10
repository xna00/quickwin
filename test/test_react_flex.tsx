import '../lib/polyfill.js'
import * as gui from 'gui'
import { useState } from 'react'
import { createRoot } from '../lib/react-qw/index.js'
import { Tester } from './test_helper.js'

const WS_CHILD = 0x40000000
const WS_VISIBLE = 0x10000000

gui.RegisterClass('FlexTest', (hwnd, msg, wParam, lParam) => {
  if (!hwnd) return gui.DefWindowProc(hwnd, msg, wParam, lParam)
  if (msg === gui.WmMsg.DESTROY) {
    gui.PostQuitMessage(0)
    return 0
  }
  return gui.DefWindowProc(hwnd, msg, wParam, lParam)
})

function childrenOf(hwnd: any): any[] {
  const kids: any[] = []
  let child = gui.GetWindow(hwnd, gui.GetWindowCmd.CHILD)
  while (child) {
    kids.push(child)
    child = gui.GetWindow(child, gui.GetWindowCmd.NEXT)
  }
  return kids.reverse()
}

function getRelativeRect(childHwnd: any, parentHwnd: any) {
  const pr = gui.GetWindowRect(parentHwnd)
  const cr = gui.GetWindowRect(childHwnd)
  if (!pr || !cr) return { x: 0, y: 0, width: 0, height: 0 }
  return {
    x: cr.left - pr.left,
    y: cr.top - pr.top,
    width: cr.right - cr.left,
    height: cr.bottom - cr.top,
  }
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function expectedPositions(
  dir: 'row' | 'column',
  parentW: number, parentH: number,
  children: Array<{ w: number; h: number }>,
  justify: string = 'flex-start',
  align: string = 'stretch',
  gap: number = 0
) {
  if (dir === 'row') {
    const totalW = children.reduce((s, c) => s + c.w, 0) + Math.max(0, children.length - 1) * gap
    let offset = 0
    if (justify === 'flex-end') offset = parentW - totalW
    else if (justify === 'center') offset = Math.max(0, (parentW - totalW) / 2)
    let cursor = offset
    return children.map(c => {
      let ch = align === 'stretch' ? parentH : c.h
      let y = 0
      if (align === 'flex-end') y = parentH - ch
      else if (align === 'center') y = Math.max(0, (parentH - ch) / 2)
      const r = { x: cursor, y, width: c.w, height: ch }
      cursor += c.w + gap
      return r
    })
  }
  const totalH = children.reduce((s, c) => s + c.h, 0) + Math.max(0, children.length - 1) * gap
  let offset = 0
  if (justify === 'flex-end') offset = parentH - totalH
  else if (justify === 'center') offset = Math.max(0, (parentH - totalH) / 2)
  let cursor = offset
  return children.map(c => {
    let cw = align === 'stretch' ? parentW : c.w
    let x = 0
    if (align === 'flex-end') x = parentW - cw
    else if (align === 'center') x = Math.max(0, (parentW - cw) / 2)
    const r = { x, y: cursor, width: cw, height: c.h }
    cursor += c.h + gap
    return r
  })
}

async function testRowCol(
  tester: Tester,
  root: any, rootHwnd: any,
  name: string,
  dir: 'row' | 'column',
  parentW: number, parentH: number,
  childSizes: Array<{ w: number; h: number }>,
  justify: string = 'flex-start',
  align: string = 'stretch',
  gap: number = 0
) {
  tester.section(name)
  const exp = expectedPositions(dir, parentW, parentH, childSizes, justify, align, gap)

  root.render(
    <w type="BUTTON" style={{flexDirection: dir, justifyContent: justify as any, alignItems: align as any, gap, width: parentW, height: parentH, x: 0, y: 0}}>
      {childSizes.map((c, i) =>
        <w key={String(i)} type="BUTTON" style={{width: c.w, height: c.h}} />
      )}
    </w>
  )
  await flush()

  const outerKids = childrenOf(rootHwnd)
  if (outerKids.length !== 1) { tester.check('container exists', 1, outerKids.length); return }
  const flexHwnd = outerKids[0]
  const kids = childrenOf(flexHwnd)
  tester.check('child count', childSizes.length, kids.length)

  for (let i = 0; i < Math.min(exp.length, kids.length); i++) {
    const a = getRelativeRect(kids[i], flexHwnd)
    const e = exp[i]
    tester.check(`child${i} x`, Math.round(e.x), Math.round(a.x))
    tester.check(`child${i} y`, Math.round(e.y), Math.round(a.y))
    tester.check(`child${i} w`, Math.round(e.width), Math.round(a.width))
    tester.check(`child${i} h`, Math.round(e.height), Math.round(a.height))
  }
}

async function main() {
  const tester = new Tester()

  const hwnd = gui.CreateWindow('FlexTest', '', 0, 0, 0, 800, 600, null, null)
  if (!hwnd) { tester.check('create root window', true, false); tester.summary(); return }

  const root = createRoot(hwnd)

  const c3 = [{ w: 50, h: 30 }, { w: 50, h: 30 }, { w: 50, h: 30 }]
  const c2 = [{ w: 50, h: 30 }, { w: 80, h: 40 }]

  // Row
  await testRowCol(tester, root, hwnd, 'Row default', 'row', 400, 200, c3)
  await testRowCol(tester, root, hwnd, 'Row justify center', 'row', 400, 200, c3, 'center')
  await testRowCol(tester, root, hwnd, 'Row justify end', 'row', 400, 200, c3, 'flex-end')
  await testRowCol(tester, root, hwnd, 'Row gap 10', 'row', 400, 200, c3, 'flex-start', 'stretch', 10)
  await testRowCol(tester, root, hwnd, 'Row align center', 'row', 400, 200, c3, 'flex-start', 'center')
  await testRowCol(tester, root, hwnd, 'Row align end', 'row', 400, 200, c3, 'flex-start', 'flex-end')
  await testRowCol(tester, root, hwnd, 'Row center+center+gap', 'row', 400, 200, c3, 'center', 'center', 10)
  await testRowCol(tester, root, hwnd, 'Row mixed sizes', 'row', 400, 200, c2)

  // Column
  await testRowCol(tester, root, hwnd, 'Col default', 'column', 200, 400, c3)
  await testRowCol(tester, root, hwnd, 'Col justify center', 'column', 200, 400, c3, 'center')
  await testRowCol(tester, root, hwnd, 'Col justify end', 'column', 200, 400, c3, 'flex-end')
  await testRowCol(tester, root, hwnd, 'Col gap 10', 'column', 200, 400, c3, 'flex-start', 'stretch', 10)
  await testRowCol(tester, root, hwnd, 'Col align center', 'column', 200, 400, c3, 'flex-start', 'center')
  await testRowCol(tester, root, hwnd, 'Col align end', 'column', 200, 400, c3, 'flex-start', 'flex-end')
  await testRowCol(tester, root, hwnd, 'Col center+center+gap', 'column', 200, 400, c3, 'center', 'center', 10)
  await testRowCol(tester, root, hwnd, 'Col mixed sizes', 'column', 200, 400, c2)

  // ── Empty ──
  tester.section('Empty container no crash')
  root.render(
    <w type="BUTTON" style={{flexDirection:'row', width:400, height:200, x:0, y:0}} />
  )
  await flush()
  const outerKids = childrenOf(hwnd)
  if (outerKids.length !== 1) { tester.check('outer exists', 1, outerKids.length) }
  else { tester.check('no children', 0, childrenOf(outerKids[0]).length) }

  // ── Single child ──
  await testRowCol(tester, root, hwnd, 'Row single center', 'row', 400, 200, [{w:50, h:30}], 'center')
  await testRowCol(tester, root, hwnd, 'Row single end', 'row', 400, 200, [{w:50, h:30}], 'flex-end')
  await testRowCol(tester, root, hwnd, 'Col single center', 'column', 200, 400, [{w:50, h:30}], 'center')
  await testRowCol(tester, root, hwnd, 'Col single end', 'column', 200, 400, [{w:50, h:30}], 'flex-end')

  // ── No flex props ──
  tester.section('No flex props - positions unchanged')
  root.render(
    <w type="BUTTON" style={{width:400, height:200, x:0, y:0}}>
      <w type="BUTTON" style={{width:50, height:30}} />
      <w type="BUTTON" style={{width:80, height:40}} />
    </w>
  )
  await flush()
  const outer2 = childrenOf(hwnd)
  if (outer2.length !== 1) { tester.check('outer exists', 1, outer2.length) }
  else {
    const kids = childrenOf(outer2[0])
    tester.check('child count', 2, kids.length)
    if (kids.length >= 2) {
      const r0 = getRelativeRect(kids[0], outer2[0])
      const r1 = getRelativeRect(kids[1], outer2[0])
      // no flex layout applied, children keep creation positions (0,0,50,30) and (0,0,80,40)
      tester.check('child0 x', 0, Math.round(r0.x))
      tester.check('child0 y', 0, Math.round(r0.y))
      tester.check('child0 w', 50, Math.round(r0.width))
      tester.check('child0 h', 30, Math.round(r0.height))
      tester.check('child1 x', 0, Math.round(r1.x))
      tester.check('child1 y', 0, Math.round(r1.y))
      tester.check('child1 w', 80, Math.round(r1.width))
      tester.check('child1 h', 40, Math.round(r1.height))
    }
  }

  // ── Default sizes (no style.width/height on children) ──
  tester.section('Default sizes - 100x30')
  root.render(
    <w type="BUTTON" style={{flexDirection:'row', alignItems:'flex-start', gap:10, width:400, height:200, x:0, y:0}}>
      <w type="BUTTON" />
      <w type="BUTTON" />
    </w>
  )
  await flush()
  const outer3 = childrenOf(hwnd)
  if (outer3.length !== 1) { tester.check('outer exists', 1, outer3.length) }
  else {
    const kids = childrenOf(outer3[0])
    tester.check('child count', 2, kids.length)
    if (kids.length >= 2) {
      const r0 = getRelativeRect(kids[0], outer3[0])
      const r1 = getRelativeRect(kids[1], outer3[0])
      tester.check('child0 x', 0, Math.round(r0.x))
      tester.check('child0 y', 0, Math.round(r0.y))
      tester.check('child0 w', 100, Math.round(r0.width))
      tester.check('child0 h', 30, Math.round(r0.height))
      tester.check('child1 x', 110, Math.round(r1.x))
      tester.check('child1 y', 0, Math.round(r1.y))
      tester.check('child1 w', 100, Math.round(r1.width))
      tester.check('child1 h', 30, Math.round(r1.height))
    }
  }

  // ── Dynamic add/remove via setState ──
  tester.section('Dynamic add/remove via setState')
  function FlexApp({ initialItems }: { initialItems: any[] }) {
    const [items, setItems] = useState(initialItems)
    globalThis.__setItems = setItems
    return (
      <w type="BUTTON" style={{flexDirection:'row', justifyContent:'center', gap:10, width:400, height:200, x:0, y:0}}>
        {items.map((c, i) =>
          <w key={String(i)} type="BUTTON" style={{width:c.w, height:c.h}} />
        )}
      </w>
    )
  }

  root.render(<FlexApp initialItems={[{w:50,h:30},{w:50,h:30}]} />)
  await flush()

  function checkDynamic(outer: any[], expected: number[]) {
    if (outer.length !== 1) { tester.check('outer exists', 1, outer.length); return }
    const kids = childrenOf(outer[0])
    tester.check('child count', expected.length, kids.length)
    for (let i = 0; i < Math.min(expected.length, kids.length); i++) {
      const r = getRelativeRect(kids[i], outer[0])
      tester.check(`child${i} x`, expected[i], Math.round(r.x))
    }
  }

  let outer4 = childrenOf(hwnd)
  checkDynamic(outer4, [145, 205])

  // add third
  globalThis.__setItems([{w:50,h:30},{w:50,h:30},{w:50,h:30}])
  await flush()
  outer4 = childrenOf(hwnd)
  checkDynamic(outer4, [115, 175, 235])

  // remove back to one
  globalThis.__setItems([{w:50,h:30}])
  await flush()
  outer4 = childrenOf(hwnd)
  checkDynamic(outer4, [175])

  tester.summary()
  gui.PostQuitMessage(0)
}

main()
