import '../lib/polyfill.js'
import * as gui from 'gui'
import { render } from '../lib/react-qw/index.js'

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

function App() {
  return (
    <>
      {/* 垂直排列 + center + gap */}
      <w
        type="STATIC"
        ws={WS_CHILD | WS_VISIBLE}
        style={{x:10, y:10, width:200, height:200, flexDirection:'column', gap:8, alignItems:'center', justifyContent:'center'}}
      >
        <w type="BUTTON" text="Top" ws={WS_CHILD | WS_VISIBLE} style={{width:80, height:28}} />
        <w type="BUTTON" text="Middle" ws={WS_CHILD | WS_VISIBLE} style={{width:80, height:28}} />
        <w type="BUTTON" text="Bottom" ws={WS_CHILD | WS_VISIBLE} style={{width:80, height:28}} />
      </w>

      {/* 水平排列 + gap */}
      <w
        type="STATIC"
        ws={WS_CHILD | WS_VISIBLE}
        style={{x:220, y:10, width:260, height:100, flexDirection:'row', gap:10, alignItems:'center', justifyContent:'center'}}
      >
        <w type="BUTTON" text="L" ws={WS_CHILD | WS_VISIBLE} style={{width:60, height:28}} />
        <w type="BUTTON" text="C" ws={WS_CHILD | WS_VISIBLE} style={{width:60, height:28}} />
        <w type="BUTTON" text="R" ws={WS_CHILD | WS_VISIBLE} style={{width:60, height:28}} />
      </w>

      {/* stretch 测试 */}
      <w
        type="STATIC"
        ws={WS_CHILD | WS_VISIBLE}
        style={{x:220, y:120, width:260, height:100, flexDirection:'column', gap:4, alignItems:'stretch'}}
      >
        <w type="BUTTON" text="Full Width A" ws={WS_CHILD | WS_VISIBLE} style={{height:24}} />
        <w type="BUTTON" text="Full Width B" ws={WS_CHILD | WS_VISIBLE} style={{height:24}} />
      </w>
    </>
  )
}

const hwnd = gui.CreateWindow(
  'FlexTest', 'Flex Layout Test',
  gui.WindowStyle.OVERLAPPEDWINDOW,
  100, 100, 520, 300, null, null
)

if (hwnd) {
  gui.ShowWindow(hwnd)
  setTimeout(() => {
    function rectStr(hwnd: any): string {
    const wr = gui.GetWindowRect(hwnd)
    if (!wr) return 'no rect'
    return `screen=(${wr.left},${wr.top},${wr.right - wr.left}x${wr.bottom - wr.top})`
  }

  function childRectStr(child: any, parent: any): string {
    const wr = gui.GetWindowRect(child)
    const pw = gui.GetWindowRect(parent)
    if (!wr || !pw) return 'no rect'
    const x = wr.left - pw.left, y = wr.top - pw.top
    return `pos=(${x},${y}) size=(${wr.right - wr.left}x${wr.bottom - wr.top})`
  }

  console.log('\n=== Window Tree ===')
  let child = gui.GetWindow(hwnd, gui.GetWindowCmd.CHILD)
  while (child) {
    const text = gui.GetWindowText(child) || '(no text)'
    console.log(`  hwnd=${child} text="${text}" ${rectStr(child)}`)
    let grand = gui.GetWindow(child, gui.GetWindowCmd.CHILD)
    while (grand) {
      const gt = gui.GetWindowText(grand) || '(no text)'
      console.log(`    hwnd=${grand} text="${gt}" ${childRectStr(grand, child)}`)
      grand = gui.GetWindow(grand, gui.GetWindowCmd.NEXT)
    }
    child = gui.GetWindow(child, gui.GetWindowCmd.NEXT)
  }
  console.log('===================\n')
    gui.PostQuitMessage(0)
  }, 500)

  render(<App />, hwnd)
}
