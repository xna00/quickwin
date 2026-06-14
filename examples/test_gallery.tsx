import '../lib/polyfill.js'
import * as gui from 'gui'
import { useState } from 'react'
import { render } from '../lib/react-qw/index.js'
import { Button } from '../lib/react-qw/components/Button.js'
import { Input } from '../lib/react-qw/components/Input.js'
import { CheckBox } from '../lib/react-qw/components/CheckBox.js'
import { ProgressBar } from '../lib/react-qw/components/ProgressBar.js'
import { ComboBox } from '../lib/react-qw/components/ComboBox.js'
import { Tab } from '../lib/react-qw/components/Tab.js'
import { ListView } from '../lib/react-qw/components/ListView.js'
import type { Column } from '../lib/react-qw/components/ListView.js'
import { ListBox } from '../lib/react-qw/components/ListBox.js'
import { ScrollView } from '../lib/react-qw/components/ScrollView.js'
import { RadioButton } from '../lib/react-qw/components/RadioButton.js'
import { Slider } from '../lib/react-qw/components/Slider.js'
import { TreeView, type TreeNode } from '../lib/react-qw/components/TreeView.js'

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

const treeData: TreeNode[] = [
  {
    key: 'fruits', label: 'Fruits',
    children: [
      { key: 'apple', label: 'Apple' },
      { key: 'banana', label: 'Banana' },
      { key: 'cherry', label: 'Cherry' },
    ],
  },
  {
    key: 'veggies', label: 'Vegetables',
    children: [
      { key: 'carrot', label: 'Carrot' },
      { key: 'broccoli', label: 'Broccoli' },
    ],
  },
  {
    key: 'meats', label: 'Meats',
    children: [
      { key: 'chicken', label: 'Chicken' },
      { key: 'beef', label: 'Beef' },
      { key: 'pork', label: 'Pork' },
    ],
  },
]

function App() {
  const [count, setCount] = useState(0)
  const [disabled, setDisabled] = useState(true)
  const [inputText, setInputText] = useState('')
  const [checkA, setCheckA] = useState(true)
  const [checkB, setCheckB] = useState(false)
  const [progress, setProgress] = useState(30)
  const [listSel, setListSel] = useState(0)
  const [lbSel, setLbSel] = useState(0)
  const [cbSel, setCbSel] = useState(-1)
  const [radio, setRadio] = useState('a')
  const [sliderVal, setSliderVal] = useState(50)
  const [treeSel, setTreeSel] = useState<TreeNode | null>(null)
  const [listData, setListData] = useState<Fruit[]>([
    { name: 'Apple', color: 'Red', origin: 'China' },
    { name: 'Banana', color: 'Yellow', origin: 'Philippines' },
    { name: 'Cherry', color: 'Dark Red', origin: 'USA' },
    { name: 'Date', color: 'Brown', origin: 'Middle East' },
    { name: 'Elderberry', color: 'Purple', origin: 'Europe' },
    { name: 'Fig', color: 'Purple', origin: 'Turkey' },
    { name: 'Grape', color: 'Green', origin: 'Italy' },
  ])
  const [listCols, setListCols] = useState<Column<Fruit>[]>([
    { name: 'Name', dataIndex: 'name' },
    { name: 'Color', dataIndex: 'color' },
    { name: 'Origin', dataIndex: 'origin' },
  ])
  const [newItemCount, setNewItemCount] = useState(7)
  const [colNewCount, setColNewCount] = useState(3)
  const lbItems = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape']
  const cbItems = ['Red', 'Green', 'Blue', 'Yellow', 'Purple', 'Orange']

  return (
    <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:8, width:780, height:940, x:20, y:20}}>
      {/* ===== 三列上半区 ===== */}
      <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:10, flexGrow:2}}>

        {/* --- 左列: Buttons + CheckBoxes --- */}
        <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:6, flexGrow:1}}>
          <w type="STATIC" ws={VISIBLE} text="Buttons" style={{height:20}} />
          <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:6, alignItems:'stretch', height:30}}>
            <Button onClick={() => setCount(c => c + 1)} style={{flexGrow:1}}>
              {`Clicked ${count} times`}
            </Button>
            <Button onClick={() => setCount(0)} style={{width:70}}>
              Reset
            </Button>
          </w>
          <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:6, alignItems:'stretch', height:30}}>
            <Button onClick={() => setDisabled(d => !d)} style={{flexGrow:1}}>
              {`Toggle disabled (${String(disabled)})`}
            </Button>
            <Button disabled={disabled} style={{width:80}}>
              Disabled
            </Button>
          </w>
          <w type="STATIC" ws={VISIBLE} text="CheckBoxes" style={{height:20}} />
          <CheckBox checked={checkA} onChange={setCheckA} label={`Option A (${String(checkA)})`} style={{height:26}} />
          <CheckBox checked={checkB} onChange={setCheckB} label={`Option B (${String(checkB)})`} style={{height:26}} />
          <CheckBox label="Disabled checkbox" disabled style={{height:26}} />
          <w type="STATIC" ws={VISIBLE} text={`RadioButtons (${radio})`} style={{height:20}} />
          <RadioButton checked={radio === 'a'} onChange={() => setRadio('a')} label="Option A" style={{height:24}} />
          <RadioButton checked={radio === 'b'} onChange={() => setRadio('b')} label="Option B" style={{height:24}} />
          <RadioButton checked={radio === 'c'} onChange={() => setRadio('c')} label="Option C" style={{height:24}} />
        </w>

        {/* --- 中列: Input + ProgressBar --- */}
        <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:6, flexGrow:1}}>
          <w type="STATIC" ws={VISIBLE} text="Input" style={{height:20}} />
          <Input value={inputText} onChange={setInputText} placeholder="Type here..." style={{height:28}} />
          <w type="STATIC" ws={VISIBLE} text={`You typed: ${inputText || '(empty)'}`} style={{height:20}} />
          <Input placeholder="Password" password style={{height:28}} />
          <Input placeholder="Number only" number style={{height:28}} />
          <Input value="Read only" readonly style={{height:28}} />
          <w type="STATIC" ws={VISIBLE} text="ProgressBar" style={{height:20}} />
          <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:6, alignItems:'stretch', height:24}}>
            <ProgressBar value={progress} max={100} smooth style={{flexGrow:1}} />
            <w type="STATIC" ws={VISIBLE} text={`${progress}%`} style={{width:40}} />
          </w>
          <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:6, alignItems:'stretch', height:30}}>
            <Button onClick={() => setProgress(p => Math.min(100, p + 10))} style={{flexGrow:1}}>
              +10
            </Button>
            <Button onClick={() => setProgress(p => Math.max(0, p - 10))} style={{flexGrow:1}}>
              -10
            </Button>
            <Button onClick={() => setProgress(0)} style={{width:50}}>
              0
            </Button>
          </w>
          <w type="STATIC" ws={VISIBLE} text={`Slider (${sliderVal})`} style={{height:20}} />
          <Slider value={sliderVal} onChange={setSliderVal} min={0} max={100} style={{height:30}} />
        </w>

        {/* --- 右列: ListBox + ComboBox --- */}
        <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:6, flexGrow:1}}>
          <w type="STATIC" ws={VISIBLE} text={`ListBox (sel=${lbSel >= 0 ? lbItems[lbSel] : 'none'})`} style={{height:20}} />
          <ListBox items={lbItems} selectedIndex={lbSel} onChange={(i) => setLbSel(i)} style={{flexGrow:1}} />
          <w type="STATIC" ws={VISIBLE} text="ComboBox" style={{height:20}} />
          <ComboBox items={cbItems} selectedIndex={cbSel} onChange={(i) => setCbSel(i)} style={{height:26}} />
          <w type="STATIC" ws={VISIBLE}
            text={cbSel >= 0 ? `Selected: ${cbItems[cbSel]}` : '(none selected)'}
            style={{height:20}} />
        </w>
      </w>

      {/* ===== Tab Demo ===== */}
      <w type="STATIC" ws={VISIBLE} text="Tab" style={{height:20}} />
      <Tab
        tabs={[
          { title: 'Tab A', content: <w type="STATIC" ws={VISIBLE} text="Content A" style={{height:24}} /> },
          { title: 'Tab B', content: <w type="STATIC" ws={VISIBLE} text="Content B" style={{height:24}} /> },
        ]}
        style={{height:60}}
      />

      {/* ===== 下半区: ListView + ScrollView + TreeView ===== */}
      <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:6, alignItems:'stretch', flexGrow:3}}>
        <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:4, flexGrow:1}}>
          <w type="STATIC" ws={VISIBLE} text={`ListView (sel=${listSel >= 0 ? listData[listSel].name : 'none'})`} style={{height:20}} />
          <w type="STATIC" ws={VISIBLE} style={{flexDirection:'row', gap:6, alignItems:'stretch', flexGrow:1}}>
            <ListView<Fruit>
              columns={listCols}
              data={listData}
              selectedIndex={listSel}
              onChange={(i) => setListSel(i)}
              style={{flexGrow:1}}
            />
            <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:6, width:100}}>
              <Button onClick={() => { setListData(d => [...d, { name: 'NewItem ' + String(newItemCount + 1), color: '', origin: '' }]); setNewItemCount(c => c + 1) }} style={{height:28}}>
                Add
              </Button>
              <Button onClick={() => {
                const n = colNewCount + 1
                setListCols(cols => [...cols, { name: 'Col' + n, dataIndex: 'name' as keyof Fruit }])
                setColNewCount(n)
              }} style={{height:28}}>
                +Column
              </Button>
            </w>
          </w>
        </w>
        <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:4, flexGrow:1}}>
          <w type="STATIC" ws={VISIBLE} text="ScrollView (scrollable)" style={{height:20}} />
          <ScrollView style={{flexGrow:1}}>
            {Array.from({ length: 20 }, (_, i) => (
              <w type="STATIC" ws={VISIBLE}
                key={i}
                text={`Item ${i + 1} - ${i === 0 ? 'here is a line so wide that the horizontal scrollbar appears for demonstration' : ''}`}
                style={{width: i === 0 ? 500 : 200, height:28}}
              />
            ))}
          </ScrollView>
        </w>
        <w type="STATIC" ws={VISIBLE | CLIPCHILDREN} style={{flexDirection:'column', gap:4, flexGrow:1}}>
          <w type="STATIC" ws={VISIBLE} text={`TreeView (sel=${treeSel?.label ?? 'none'})`} style={{height:20}} />
          <TreeView data={treeData} onSelect={setTreeSel} style={{flexGrow:1}} />
        </w>
      </w>
    </w>
  )
}

const hwnd = gui.CreateWindow(
  'Gallery', 'Component Gallery',
  gui.WindowStyle.OVERLAPPEDWINDOW,
  100, 100, 840, 1060, null, null
)

if (hwnd) {
  gui.ShowWindow(hwnd)
  render(<App />, hwnd)
}
