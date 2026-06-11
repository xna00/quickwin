import * as ffi from 'ffi'

const SIZES: Record<number, number> = {
  [ffi.FFI_TYPE_UINT8]: 1,
  [ffi.FFI_TYPE_SINT8]: 1,
  [ffi.FFI_TYPE_UINT16]: 2,
  [ffi.FFI_TYPE_SINT16]: 2,
  [ffi.FFI_TYPE_UINT32]: 4,
  [ffi.FFI_TYPE_SINT32]: 4,
  [ffi.FFI_TYPE_UINT64]: 8,
  [ffi.FFI_TYPE_SINT64]: 8,
  [ffi.FFI_TYPE_FLOAT]: 4,
  [ffi.FFI_TYPE_DOUBLE]: 8,
  [ffi.FFI_TYPE_POINTER]: 8,
}

const ALIGNS: Record<number, number> = {
  [ffi.FFI_TYPE_UINT8]: 1,
  [ffi.FFI_TYPE_SINT8]: 1,
  [ffi.FFI_TYPE_UINT16]: 2,
  [ffi.FFI_TYPE_SINT16]: 2,
  [ffi.FFI_TYPE_UINT32]: 4,
  [ffi.FFI_TYPE_SINT32]: 4,
  [ffi.FFI_TYPE_UINT64]: 8,
  [ffi.FFI_TYPE_SINT64]: 8,
  [ffi.FFI_TYPE_FLOAT]: 4,
  [ffi.FFI_TYPE_DOUBLE]: 8,
  [ffi.FFI_TYPE_POINTER]: 8,
}

const READERS: Record<number, (dv: DataView, offset: number) => number> = {
  [ffi.FFI_TYPE_UINT8]: (dv, o) => dv.getUint8(o),
  [ffi.FFI_TYPE_SINT8]: (dv, o) => dv.getInt8(o),
  [ffi.FFI_TYPE_UINT16]: (dv, o) => dv.getUint16(o, true),
  [ffi.FFI_TYPE_SINT16]: (dv, o) => dv.getInt16(o, true),
  [ffi.FFI_TYPE_UINT32]: (dv, o) => dv.getUint32(o, true),
  [ffi.FFI_TYPE_SINT32]: (dv, o) => dv.getInt32(o, true),
  [ffi.FFI_TYPE_UINT64]: (dv, o) => Number(dv.getBigUint64(o, true)),
  [ffi.FFI_TYPE_SINT64]: (dv, o) => Number(dv.getBigInt64(o, true)),
  [ffi.FFI_TYPE_FLOAT]: (dv, o) => dv.getFloat32(o, true),
  [ffi.FFI_TYPE_DOUBLE]: (dv, o) => dv.getFloat64(o, true),
  [ffi.FFI_TYPE_POINTER]: (dv, o) => Number(dv.getBigUint64(o, true)),
}

function align(offset: number, alignment: number): number {
  return (offset + alignment - 1) & ~(alignment - 1)
}

export function defineStruct(layout: any): any {
  const fields: { name: string; offset: number; reader: (dv: DataView, offset: number) => number }[] = []
  let offset = 0
  let maxAlign = 1

  for (const [name, type] of layout) {
    const size = SIZES[type]
    const a = ALIGNS[type]
    offset = align(offset, a)
    fields.push({ name, offset, reader: READERS[type] })
    offset += size
    if (a > maxAlign) maxAlign = a
  }

  const structSize = align(offset, maxAlign)

  const reader: any = (buf: ArrayBuffer) => {
    const dv = new DataView(buf)
    const obj: Record<string, any> = {}
    for (const f of fields) {
      obj[f.name] = f.reader(dv, f.offset)
    }
    return obj
  }

  reader.size = structSize
  return reader
}
