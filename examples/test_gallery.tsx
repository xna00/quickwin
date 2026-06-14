import '../lib/polyfill.js'
import * as gui from 'gui'
import { useState } from 'react'
import { render } from '../lib/react-qw/index.js'
import { Button } from '../lib/react-qw/components/Button.js'
import { Tab } from '../lib/react-qw/components/Tab.js'
import { ListView } from '../lib/react-qw/components/ListView.js'

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
  const [tabIndex, setTabIndex] = useState(1)  // ListView tab for testing
  const [listSel, setListSel] = useState(0)
  const [listItems, setListItems] = useState([
    ['Apple', 'Red', 'China'],
    ['Banana', 'Yellow', 'Philippines'],
    ['Cherry', 'Dark Red', 'USA'],
    ['Date', 'Brown', 'Middle East'],
    ['Elderberry', 'Purple', 'Europe'],
    ['Fig', 'Purple', 'Turkey'],
    ['Grape', 'Green', 'Italy'],
  ])
  const [newItemCount, setNewItemCount] = useState(0)

  return (
    <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:10, width:560, height:540, x:20, y:20}}>
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
          { title: 'ListView', content: (
            <w type="STATIC" ws={VISIBLE} style={{flexGrow:1, flexDirection:'column', gap:4}}>
              <ListView columns={['Name', 'Color', 'Origin']} items={listItems} selectedIndex={listSel} onChange={(i) => setListSel(i)} style={{flexGrow:1}} />
              <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:4, alignItems:'stretch', height:30}}>
                <w type="STATIC" ws={VISIBLE} style={{flexGrow:1}} text={listSel >= 0 ? `Selected: ${listItems[listSel][0]}` : '(none selected)'} />
                <Button onClick={() => { setListItems(items => [...items, ['Item ' + String(newItemCount + 1), '', '']]); setNewItemCount(c => c + 1) }} style={{width:120}}>
                  Add Item
                </Button>
              </w>
            </w>
          ) },
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
  100, 100, 640, 640, null, null
)

if (hwnd) {
  gui.ShowWindow(hwnd)
  render(<App />, hwnd)
}
