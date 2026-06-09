export interface FlexStyle {
  flexDirection?: 'row' | 'column'
  justifyContent?: 'flex-start' | 'flex-end' | 'center'
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch'
  gap?: number
}

interface ChildInfo {
  style: Record<string, any>
}

export interface LayoutResult {
  x: number; y: number; width: number; height: number
}

const DEFAULT_W = 100
const DEFAULT_H = 30

export function calculateFlexLayout(
  flex: FlexStyle,
  parentW: number,
  parentH: number,
  children: ChildInfo[]
): LayoutResult[] {
  const dir = flex.flexDirection || 'column'
  const gap = flex.gap ?? 0
  const justify = flex.justifyContent || 'flex-start'
  const align = flex.alignItems || 'stretch'

  const sizes = children.map(c => ({
    w: c.style.width ?? DEFAULT_W,
    h: c.style.height ?? DEFAULT_H,
  }))

  if (dir === 'row') {
    const totalW = sizes.reduce((s, c) => s + c.w, 0) + Math.max(0, children.length - 1) * gap
    let offset = 0
    if (justify === 'flex-end') offset = parentW - totalW
    else if (justify === 'center') offset = Math.max(0, (parentW - totalW) / 2)

    let cursor = offset
    return sizes.map(sz => {
      let childW = sz.w
      let childH = sz.h
      let x = cursor
      let y = 0
      if (align === 'stretch') { childH = parentH; y = 0 }
      else if (align === 'flex-end') y = parentH - childH
      else if (align === 'center') y = Math.max(0, (parentH - childH) / 2)
      cursor += childW + gap
      return { x, y, width: childW, height: childH }
    })
  }

  // column (default)
  const totalH = sizes.reduce((s, c) => s + c.h, 0) + Math.max(0, children.length - 1) * gap
  let offset = 0
  if (justify === 'flex-end') offset = parentH - totalH
  else if (justify === 'center') offset = Math.max(0, (parentH - totalH) / 2)

  let cursor = offset
  return sizes.map(sz => {
    let childW = sz.w
    let childH = sz.h
    let x = 0
    let y = cursor
    if (align === 'stretch') { childW = parentW; x = 0 }
    else if (align === 'flex-end') x = parentW - childW
    else if (align === 'center') x = Math.max(0, (parentW - childW) / 2)
    cursor += childH + gap
    return { x, y, width: childW, height: childH }
  })
}
