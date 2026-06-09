import type { HWND } from 'gui'

interface WEvent {
  hwnd: HWND; msg: number; wParam: number; lParam: number
}
interface WIntrinsicProps {
  type?: string; text?: string; ws?: number; disabled?: boolean
  visible?: boolean; x?: number; y?: number; width?: number; height?: number
  onEvent?: (e: WEvent) => void; children?: any; ref?: any
}
declare module 'react' {
  namespace JSX { interface IntrinsicElements { w: WIntrinsicProps } }
}
export type { WEvent, WIntrinsicProps }
