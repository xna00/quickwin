import { struct } from './ffi/struct.js'

// 跨组件/示例共享的 Windows 结构体（CType IR，ffi-struct 按本机架构 MSVC 对齐布局）。
// OPENFILENAMEW（GetOpenFileNameW）。Win2000+ 定义含尾部 pvReserved/dwReserved/FlagsEx（即 XP 系统上的真实 sizeof=152/88）：
export const OPENFILENAMEW = struct({
  tag: 'struct',
  member: [
    { name: 'lStructSize', type: { tag: 'basic', kind: 'u32' } },
    { name: 'hwndOwner', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'hInstance', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lpstrFilter', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lpstrCustomFilter', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'nMaxCustFilter', type: { tag: 'basic', kind: 'u32' } },
    { name: 'nFilterIndex', type: { tag: 'basic', kind: 'u32' } },
    { name: 'lpstrFile', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'nMaxFile', type: { tag: 'basic', kind: 'u32' } },
    { name: 'lpstrFileTitle', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'nMaxFileTitle', type: { tag: 'basic', kind: 'u32' } },
    { name: 'lpstrInitialDir', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lpstrTitle', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'Flags', type: { tag: 'basic', kind: 'u32' } },
    { name: 'nFileOffset', type: { tag: 'basic', kind: 'u16' } },
    { name: 'nFileExtension', type: { tag: 'basic', kind: 'u16' } },
    { name: 'lpstrDefExt', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lCustData', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lpfnHook', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lpTemplateName', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'pvReserved', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'dwReserved', type: { tag: 'basic', kind: 'u32' } },
    { name: 'FlagsEx', type: { tag: 'basic', kind: 'u32' } },
  ],
})

// BROWSEINFOW（SHBrowseForFolderW）：
export const BROWSEINFOW = struct({
  tag: 'struct',
  member: [
    { name: 'hwndOwner', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'pidlRoot', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'pszDisplayName', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lpszTitle', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'ulFlags', type: { tag: 'basic', kind: 'u32' } },
    { name: 'lpfn', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'lParam', type: { tag: 'basic', kind: 'ptr' } },
    { name: 'iImage', type: { tag: 'basic', kind: 'i32' } },
  ],
})
