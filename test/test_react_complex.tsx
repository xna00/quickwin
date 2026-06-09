import '../lib/polyfill.js'
import * as gui from 'gui'
import * as os from 'os'
import React, { useState } from 'react'
import { render } from '../lib/react-qw/index.js'

// 打印窗口树
function printWindowTree(hwnd: gui.HWND, indent: number = 0) {
  if (!hwnd) return
  const prefix = '  '.repeat(indent)
  let text = '(no text)'
  try {
    text = gui.GetWindowText(hwnd) || '(no text)'
  } catch (e) {
    text = '(error)'
  }
  const isWindow = gui.IsWindow(hwnd)
  console.log(`${prefix}hwnd=${hwnd}, text="${text}", IsWindow=${isWindow}`)
  
  let child = gui.GetWindow(hwnd, gui.GetWindowCmd.CHILD)
  while (child) {
    printWindowTree(child, indent + 1)
    child = gui.GetWindow(child, gui.GetWindowCmd.NEXT)
  }
}

function mockSetInterval(func: () => void, delay: number) {
  function loop() {
    func()
    os.setTimeout(loop, delay)
  }
  os.setTimeout(loop, delay)
}

gui.RegisterClass('ComplexTest', (hwnd, msg, wParam, lParam) => {
  if (!hwnd) return gui.DefWindowProc(hwnd, msg, wParam, lParam)
  if (msg === gui.WmMsg.DESTROY) {
    gui.PostQuitMessage(0)
    return 0
  }
  return gui.DefWindowProc(hwnd, msg, wParam, lParam)
})

const SS_LEFT = 0x00000000
const SS_SUNKEN = 0x00000100
const WM_LBUTTONUP = 0x202

function Counter({ label, initial = 0, x = 10, y = 10 }: { label: string; initial?: number; x?: number; y?: number }) {
  const [count, setCount] = useState(initial)
  return (
    <w
      type="BUTTON"
      text={`${label}: ${count}`}
      ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
      x={x} y={y} width={180} height={30}
      onEvent={(e: any) => {
        if (e.msg === WM_LBUTTONUP) {
          setCount(count + 1)
        }
      }}
    />
  )
}

function NestedButtons() {
  const [clicks, setClicks] = useState(0)
  return (
    <w
      type="STATIC"
      text="Nested Panel"
      ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE | gui.WindowStyle.BORDER | gui.WindowStyle.CLIPCHILDREN}
      x={10} y={90} width={460} height={100}
    >
      <w
        type="BUTTON"
        text={`Nested A: ${clicks}`}
        ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
        x={15} y={20} width={160} height={25}
        onEvent={(e: any) => {
          if (e.msg === WM_LBUTTONUP) {
            setClicks((c: number) => c + 1)
          }
        }}
      />
      <w
        type="BUTTON"
        text={`Nested B: ${clicks * 2}`}
        ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
        x={190} y={20} width={160} height={25}
      />
      <w
        type="BUTTON"
        text="Reset"
        ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
        x={360} y={18} width={60} height={29}
        onEvent={(e: any) => {
          if (e.msg === WM_LBUTTONUP) {
            setClicks(0)
          }
        }}
      />
    </w>
  )
}

function App() {
  const [showExtra, setShowExtra] = useState(false)
  const [showNested, setShowNested] = useState(true)

  return (
    <>
      <Counter label="Counter A" initial={0} />
      <w
        type="BUTTON"
        text="Counter B: 100"
        ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
        x={200} y={10} width={180} height={30}
      />

      <w
        type="BUTTON"
        text="Toggle Extra"
        ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
        x={10} y={50} width={120} height={30}
        onEvent={(e: any) => {
          if (e.msg === WM_LBUTTONUP) {
            console.log('[App] Toggle button clicked, current showExtra:', showExtra)
            setShowExtra(!showExtra)
          }
        }}
      />
      <w
        type="BUTTON"
        text={showNested ? 'Hide Panel' : 'Show Panel'}
        ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
        x={140} y={50} width={120} height={30}
        onEvent={(e: any) => {
          if (e.msg === WM_LBUTTONUP) {
            console.log('[App] Toggle Nested button clicked, current showNested:', showNested)
            setShowNested(!showNested)
          }
        }}
      />

      {showNested && <NestedButtons />}

      {showExtra && (
        <Counter label="Extra" initial={100} x={280} y={50} />
      )}
    </>
  )
}

const hwnd = gui.CreateWindow(
  'ComplexTest', 'Complex React Test',
  gui.WindowStyle.OVERLAPPEDWINDOW,
  100, 100, 520, 260, null, null
)

if (hwnd) {
  gui.ShowWindow(hwnd)
  render(<App />, hwnd)
  
  mockSetInterval(() => {
    console.log('\n=== Window Tree ===')
    printWindowTree(hwnd)
    console.log('===================\n')
  }, 3000)
}
