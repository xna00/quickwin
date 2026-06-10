import type { HWND } from 'gui'

interface WStyle {
  x?: number; y?: number
  width?: number; height?: number
  flexDirection?: 'row' | 'column'
  justifyContent?: 'flex-start' | 'flex-end' | 'center'
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch'
  gap?: number
}

interface WEvent {
  hwnd: HWND; msg: number; wParam: number; lParam: number
}
interface WIntrinsicProps {
  key?: string | number; type?: string; text?: string; ws?: number
  disabled?: boolean; visible?: boolean; style?: WStyle
  onEvent?: (e: WEvent) => void
  children?: React.ReactNode
  ref?: React.Ref<HWND>
}
declare module 'react' {
  namespace JSX { interface IntrinsicElements { w: WIntrinsicProps } }
}
export type { WEvent, WIntrinsicProps, WStyle }
