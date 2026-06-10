import '../lib/polyfill.js'
import * as gui from 'gui'
import { useState } from 'react'
import { render } from '../lib/react-qw/index.js'
import { Button } from '../lib/react-qw/components/Button.js'

gui.RegisterClass('Gallery', (hwnd, msg, wParam, lParam) => {
  if (!hwnd) return gui.DefWindowProc(hwnd, msg, wParam, lParam)
  if (msg === gui.WmMsg.DESTROY) {
    gui.PostQuitMessage(0)
    return 0
  }
  return gui.DefWindowProc(hwnd, msg, wParam, lParam)
})

const VISIBLE = gui.WindowStyle.VISIBLE
const CLIPCHILDREN = gui.WindowStyle.CLIPCHILDREN

function App() {
  const [count, setCount] = useState(0)
  const [disabled, setDisabled] = useState(true)

  return (
    <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:10, width:560, height:200, x:20, y:20}}>
      <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:10, width:560, height:30, alignItems:'stretch'}}>
        <Button onClick={() => setCount(c => c + 1)} style={{flexGrow:1}}>
          {`Clicked ${count} times`}
        </Button>
        <Button onClick={() => setCount(0)} style={{width:80}}>
          Reset
        </Button>
      </w>
      <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:10, width:560, height:30, alignItems:'stretch'}}>
        <Button onClick={() => setDisabled(d => !d)} style={{flexGrow:1}}>
          {`Toggle disabled (${String(disabled)})`}
        </Button>
        <Button disabled={disabled} style={{width:120}}>
          Disabled
        </Button>
      </w>
    </w>
  )
}

const hwnd = gui.CreateWindow(
  'Gallery', 'Component Gallery',
  gui.WindowStyle.OVERLAPPEDWINDOW,
  100, 100, 640, 300, null, null
)

if (hwnd) {
  gui.ShowWindow(hwnd)
  render(<App />, hwnd)
}
