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
  
  // 遍历子窗口
  let child = gui.GetWindow(hwnd, gui.GetWindowCmd.CHILD)
  while (child) {
    printWindowTree(child, indent + 1)
    child = gui.GetWindow(child, gui.GetWindowCmd.NEXT)
  }
}

// 用 setTimeout 模拟 setInterval
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

const WM_LBUTTONUP = 0x202

// 计数器组件
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

// 主应用
function App() {
  const [showExtra, setShowExtra] = useState(false)

  return (
    <>
      {/* 第一行：两个计数器 */}
      <Counter label="Counter A" initial={0} />
      <w
        type="BUTTON"
        text="Counter B: 100"
        ws={gui.WindowStyle.CHILD | gui.WindowStyle.VISIBLE}
        x={200} y={10} width={180} height={30}
      />

      {/* 第二行：切换按钮 - 文本不变 */}
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

      {/* 条件渲染 */}
      {showExtra && (
        <Counter label="Extra" initial={100} x={140} y={50} />
      )}
    </>
  )
}

const hwnd = gui.CreateWindow(
  'ComplexTest', 'Complex React Test',
  gui.WindowStyle.OVERLAPPEDWINDOW,
  100, 100, 500, 200, null, null
)

if (hwnd) {
  gui.ShowWindow(hwnd)
  render(<App />, hwnd)
  
  // 每 3 秒打印窗口树
  mockSetInterval(() => {
    console.log('\n=== Window Tree ===')
    printWindowTree(hwnd)
    console.log('===================\n')
  }, 3000)
}
