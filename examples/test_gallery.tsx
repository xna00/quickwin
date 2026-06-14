import '../lib/polyfill.js'
import * as gui from 'gui'
import { useState } from 'react'
import { render } from '../lib/react-qw/index.js'
import { Button } from '../lib/react-qw/components/Button.js'
import { Tab } from '../lib/react-qw/components/Tab.js'
import { ListView } from '../lib/react-qw/components/ListView.js'
import type { Column } from '../lib/react-qw/components/ListView.js'
import { ListBox } from '../lib/react-qw/components/ListBox.js'

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

interface Fruit {
  name: string
  color: string
  origin: string
}

function App() {
  const [count, setCount] = useState(0)
  const [disabled, setDisabled] = useState(true)
  const [tabIndex, setTabIndex] = useState(1)  // ListView tab for testing
  const [listSel, setListSel] = useState(0)
  const [listData, setListData] = useState<Fruit[]>([
    { name: 'Apple', color: 'Red', origin: 'China' },
    { name: 'Banana', color: 'Yellow', origin: 'Philippines' },
    { name: 'Cherry', color: 'Dark Red', origin: 'USA' },
    { name: 'Date', color: 'Brown', origin: 'Middle East' },
    { name: 'Elderberry', color: 'Purple', origin: 'Europe' },
    { name: 'Fig', color: 'Purple', origin: 'Turkey' },
    { name: 'Grape', color: 'Green', origin: 'Italy' },
  ])
  const [newItemCount, setNewItemCount] = useState(0)
  const [lbItems, setLbItems] = useState(['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape'])
  const [lbSel, setLbSel] = useState(0)
  const [lbNewCount, setLbNewCount] = useState(0)
  const [listCols, setListCols] = useState<Column<Fruit>[]>([
    { name: 'Name', dataIndex: 'name' },
    { name: 'Color', dataIndex: 'color' },
    { name: 'Origin', dataIndex: 'origin' },
  ])
  const [colNewCount, setColNewCount] = useState(3)

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
              <ListView<Fruit> columns={listCols} data={listData} selectedIndex={listSel} onChange={(i) => setListSel(i)} style={{flexGrow:1}} />
              <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:4, alignItems:'stretch', height:30}}>
                <w type="STATIC" ws={VISIBLE} style={{flexGrow:1}} text={listSel >= 0 ? `Selected: ${listData[listSel].name}` : '(none selected)'} />
                <Button onClick={() => { setListData(d => [...d, { name: 'Item ' + String(newItemCount + 1), color: '', origin: '' }]); setNewItemCount(c => c + 1) }} style={{width:90}}>
                  Add Item
                </Button>
                <Button onClick={() => {
                  const n = colNewCount + 1
                  setListCols(cols => [...cols, { name: 'Col ' + n, dataIndex: 'name' as keyof Fruit }])
                  setColNewCount(n)
                }} style={{width:90}}>
                  Add Column
                </Button>
              </w>
            </w>
          ) },
          { title: 'ListBox', content: (
            <w type="STATIC" ws={VISIBLE} style={{flexGrow:1, flexDirection:'column', gap:4}}>
              <ListBox items={lbItems} selectedIndex={lbSel} onChange={(i) => setLbSel(i)} style={{flexGrow:1}} />
              <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:4, alignItems:'stretch', height:30}}>
                <w type="STATIC" ws={VISIBLE} style={{flexGrow:1}} text={lbSel >= 0 ? `Selected: ${lbItems[lbSel]}` : '(none selected)'} />
                <Button onClick={() => { setLbItems(items => [...items, 'Item ' + String(lbNewCount + 1)]); setLbNewCount(c => c + 1) }} style={{width:120}}>
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
