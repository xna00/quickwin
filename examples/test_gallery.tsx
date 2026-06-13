import '../lib/polyfill.js'
import * as gui from 'gui'
import * as os from 'os'


import { useState } from 'react'
import { render } from '../lib/react-qw/index.js'
import { Button } from '../lib/react-qw/components/Button.js'
import { Tab } from '../lib/react-qw/components/Tab.js'

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
  const [tabIndex, setTabIndex] = useState(0)

  return (
    <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:10, width:560, height:420, x:20, y:20}}>
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
      <Tab
        tabs={[
          { title: 'Buttons', content: <Button>Inside Tab 1</Button> },
          { title: 'Info', content: <w type="STATIC" ws={VISIBLE}>Tab 2 content</w> },
        ]}
        style={{flexGrow:1}}
        selectedIndex={tabIndex}
        onChange={(i) => setTabIndex(i)}
      />
    </w>
  )
}

const hwnd = gui.CreateWindow(
  'Gallery', 'Component Gallery',
  gui.WindowStyle.OVERLAPPEDWINDOW,
  100, 100, 640, 520, null, null
)

function dumpRects(): void {
  function dumpChild(parent: gui.HWND, indent: string): void {
    var ch = gui.GetWindow(parent, 5)
    var n = 0
    while (ch) {
      n++
      var wr = gui.GetWindowRect(ch)
      var cr = gui.GetClientRect(ch)
      var txt = String(gui.GetWindowText(ch) || '').slice(0, 16)
      console.log(indent + '[' + n + '] hwnd=' + String(ch) + ' txt="' + txt + '" wr=' + JSON.stringify(wr) + ' cr=' + JSON.stringify(cr))
      dumpChild(ch, indent + '  ')
      ch = gui.GetWindow(ch, 2)
    }
    if (n === 0) console.log(indent + '(no children)')
  }
  console.log('--- dump rects ---')
  if (hwnd) dumpChild(hwnd, '')
  os.setTimeout(dumpRects, 3000)
}

if (hwnd) {
  gui.ShowWindow(hwnd)
  render(<App />, hwnd)
  os.setTimeout(dumpRects, 3000)
}
