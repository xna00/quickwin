import '../text-codec.js'
import * as ffi from 'ffi'
import {
    PTR_SIZE, type StructPtr, type FieldKind,
    type CType, type CBasic, type CString, type CArray,
    type CStruct, type CUnion, type Member, type Encoding,
} from './ctype.js'

// ============================================================
// 结构体定义（唯一 API：CType IR）：
//   struct({ tag:'struct', member:[...] })          — 匿名聚合
//   struct('RECT', { tag:'struct', member:[...] })  — 命名聚合（alloc().ptr 带 StructPtr<'RECT'> 品牌）
// layout 采用 MSVC 对齐语义：
//   i8/u8→1  i16/u16→2  i32/u32/f32→4  i64/u64/f64→8  ptr→arch 宽(4/8)
//   struct 对齐 = 最大字段对齐，总尺寸末尾补齐；pack 压上限、alignas 抬下限
// ============================================================

// ============================================================
// 类型推导 — CType IR
// ============================================================

type ValOf<C extends CType> = C extends CBasic ? number
    : C extends CString ? string
    : C extends CArray ? Tuple<ValOf<C['ctype']>, C['length']>
    : C extends CStruct | CUnion ? ShapeOfC<C['member']>
    : never

type Tuple<T, N extends number, R extends T[] = []> =
    number extends N ? T[]
    : R['length'] extends N ? R
    : R['length'] extends 64 ? T[]
    : Tuple<T, N, [...R, T]>

type ShapeOfC<M extends readonly Member[]> = M extends readonly [
    infer H,
    ...infer T extends readonly Member[]
] ? (H extends Member ? FieldShape<H> & ShapeOfC<T> : {}) : {}

type FieldShape<M extends Member> =
    M extends { name?: undefined; type: infer T extends CStruct | CUnion }
    ? ShapeOfC<T['member']>
    : M extends { name: infer N; type: infer T extends CType }
    ? (N extends string ? { [K in N]: ValOf<T> } : {})
    : {}

// ============================================================
// 运行时类型
// ============================================================

// kind → size/align
const SizeAlign: Record<FieldKind, number> = {
    u8: 1, i8: 1,
    u16: 2, i16: 2,
    u32: 4, i32: 4,
    u64: 8, i64: 8,
    f32: 4, f64: 8,
    ptr: PTR_SIZE,
}

// 运行时 Field：IR 的 lowered 视图（独立于 CType，不保留 Member/alignas）。
// computeStructLayout 在 lowering 时把子布局内嵌进 FieldType（struct/union→fields，
// array→elementType+elementSize），运行期 read/write 零查表；offset 相对本层起点。
type FieldType =
    { tag: 'basic', kind: FieldKind }
    | { tag: 'string', encoding: Encoding }
    | { tag: 'struct' | 'union', fields: Field[] }
    | { tag: 'array', elementType: FieldType, elementSize: number }
export type Field = {
    name: string
    offset: number
    size: number
    type: FieldType
}
export type Fields = Field[]

// StructDef — struct() 返回
export type StructDef<T extends CStruct, N extends string = never> = {
    readonly __struct: T
    readonly size: number
    readonly structAlign: number
    decode(buf: ArrayBuffer, offset?: number): ShapeOfC<T['member']>
    encode(v: ShapeOfC<T['member']>, buf?: ArrayBuffer, offset?: number): ArrayBuffer
    offsetOf(name: string): number
    alloc(): StructAlloc<ShapeOfC<T['member']>, N>
}

export type StructAlloc<S, N extends string = never> = {
    readonly buffer: ArrayBuffer
    readonly ptr: [N] extends [never] ? number : StructPtr<N>
    decode(offset?: number): S
}

// ============================================================
// Layout IR —— computeStructLayout/lowerType 把 CType AST IR lower 到此。
// 自包含：子布局在 lowering 时内嵌、offset 相对本层起点，运行期 read/write 不回查 AST IR。
// ============================================================

/** 向上对齐（a 必须是 2 的幂）。 */
function alignUp(v: number, a: number): number {
    return (v + a - 1) & ~(a - 1)
}

/** 单个 CType 的布局 size/align（不含 pack/alignas 修正，由 computeStructLayout 施加）。 */
function typeSizeAlign(t: CType): { size: number, align: number } {
    switch (t.tag) {
        case 'basic': {
            const s = SizeAlign[t.kind]
            return { size: s, align: s }
        }
        case 'string': {
            const s = SizeAlign[t.unit]
            return { size: s * t.length, align: s }
        }
        case 'struct':
        case 'union': {
            const l = computeStructLayout(t)
            return { size: l.size, align: l.maxEffectiveAlign }
        }
        case 'array':
            return computeArray(t)
    }
}

export function computeArray(t: CArray): { align: number, size: number } {
    if (!Number.isInteger(t.length) || t.length < 1)
        throw new Error(`ffi-struct: array length must be an integer >= 1, got ${t.length}`)
    const el = typeSizeAlign(t.ctype)
    return { align: el.align, size: el.size * t.length }
}

type Layout = {
    size: number,
    maxEffectiveAlign: number,
    fields: Fields,
}

// 按聚合 IR 对象身份缓存布局（IR 为模块级常量；同一子类型可被多个父复用）。
const layoutCache = new WeakMap<CStruct | CUnion, Layout>()

// CType → FieldType：lowering 时把子布局内嵌（聚合→fields，array→elementType+elementSize），
// 运行期读写不再回查 IR；string 只留 encoding，字节跨度已由 unit+length 固化进 Field.size。
function lowerType(t: CType): FieldType {
    switch (t.tag) {
        case 'basic': return { tag: 'basic', kind: t.kind }
        case 'string': return { tag: 'string', encoding: t.encoding }
        case 'struct': return { tag: 'struct', fields: computeStructLayout(t).fields }
        case 'union': return { tag: 'union', fields: computeStructLayout(t).fields }
        case 'array': return { tag: 'array', elementType: lowerType(t.ctype), elementSize: typeSizeAlign(t.ctype).size }
    }
}

export function computeStructLayout(t: CStruct | CUnion): Layout {
    const hit = layoutCache.get(t)
    if (hit) return hit

    const isStruct = t.tag === 'struct'
    let maxEffectiveAlign = 1
    let maxMemberSize = 0
    const fields: Fields = []
    const pack = t.pack ?? 8

    let cursor = 0

    for (const m of t.member) {
        const { size, align: natural } = typeSizeAlign(m.type)
        let align = natural
        if (pack > 0) align = Math.min(pack, align)
        if (m.alignas) align = Math.max(align, m.alignas)
        const offset = alignUp(cursor, align)

        if (m.name !== undefined) {
            fields.push({ name: m.name, offset, size, type: lowerType(m.type) })
        } else {
            // 匿名聚合：子字段 splice 提升，offset 从子起点平移到本成员起点。
            for (const cf of computeStructLayout(m.type).fields)
                fields.push({ ...cf, offset: cf.offset + offset })
        }

        if (isStruct) cursor = offset + size
        maxEffectiveAlign = Math.max(maxEffectiveAlign, align)
        maxMemberSize = Math.max(maxMemberSize, size)
    }

    const ret: Layout = {
        size: isStruct ? alignUp(cursor, maxEffectiveAlign) : alignUp(maxMemberSize, maxEffectiveAlign),
        maxEffectiveAlign,
        fields,
    }
    layoutCache.set(t, ret)
    return ret
}

// ============================================================
// 读取 / 写入
// ============================================================

function readScalar(dv: DataView, off: number, k: FieldKind): number {
    switch (k) {
        case 'u8': return dv.getUint8(off)
        case 'i8': return dv.getInt8(off)
        case 'u16': return dv.getUint16(off, true)
        case 'i16': return dv.getInt16(off, true)
        case 'u32': return dv.getUint32(off, true)
        case 'i32': return dv.getInt32(off, true)
        case 'u64': return Number(dv.getBigUint64(off, true))
        case 'i64': return Number(dv.getBigInt64(off, true))
        case 'f32': return dv.getFloat32(off, true)
        case 'f64': return dv.getFloat64(off, true)
        case 'ptr': return readPtr(dv, off)
    }
}

function readPtr(dv: DataView, off: number): number {
    if (PTR_SIZE === 8) return Number(dv.getBigUint64(off, true))
    return dv.getUint32(off, true)
}

function writeScalar(dv: DataView, off: number, k: FieldKind, val: number): void {
    switch (k) {
        case 'u8': dv.setUint8(off, val); break
        case 'i8': dv.setInt8(off, val); break
        case 'u16': dv.setUint16(off, val, true); break
        case 'i16': dv.setInt16(off, val, true); break
        case 'u32': dv.setUint32(off, val >>> 0, true); break
        case 'i32': dv.setInt32(off, val | 0, true); break
        case 'u64': dv.setBigUint64(off, BigInt(Math.trunc(val)), true); break
        case 'i64': dv.setBigInt64(off, BigInt(Math.trunc(val)), true); break
        case 'f32': dv.setFloat32(off, val, true); break
        case 'f64': dv.setFloat64(off, val, true); break
        case 'ptr': writePtr(dv, off, val); break
    }
}

function writePtr(dv: DataView, off: number, val: number): void {
    if (PTR_SIZE === 8) dv.setBigUint64(off, BigInt(Math.trunc(val)), true)
    else dv.setUint32(off, val >>> 0, true)
}

// 字符串读写统一走 TextEncoder/TextDecoder（polyfill 见 lib/text-codec.js）。
// 定长字段：写入把编码结果截断到 size，读取扫到 NUL 终止符为止。
const stringEncoders: Record<Encoding, TextEncoder> = {
    'utf-8': new TextEncoder('utf-8'),
    'utf-16le': new TextEncoder('utf-16le'),
}

const stringDecoders: Record<Encoding, TextDecoder> = {
    'utf-8': new TextDecoder('utf-8', { ignoreBOM: true }),
    'utf-16le': new TextDecoder('utf-16le', { ignoreBOM: true }),
}

function readString(dv: DataView, off: number, size: number, enc: Encoding): string {
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset + off, size)
    const unit = enc === 'utf-16le' ? 2 : 1
    let end = size
    for (let i = 0; i + unit <= size; i += unit) {
        if (bytes[i] === 0 && (unit === 1 || bytes[i + 1] === 0)) { end = i; break }
    }
    return stringDecoders[enc].decode(bytes.subarray(0, end))
}

function writeString(dv: DataView, off: number, size: number, enc: Encoding, v: unknown): void {
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset + off, size)
    bytes.fill(0)
    const src = stringEncoders[enc].encode(String(v ?? ''))
    bytes.set(src.subarray(0, Math.min(src.length, size)))
}

type ArrayFieldType = Extract<FieldType, { tag: 'array' }>

function readArray(dv: DataView, off: number, size: number, t: ArrayFieldType): unknown[] {
    const count = t.elementSize > 0 ? size / t.elementSize : 0
    const out: unknown[] = []
    for (let i = 0; i < count; i++)
        out.push(readElement(dv, off + i * t.elementSize, t.elementType, t.elementSize))
    return out
}

function writeArray(dv: DataView, off: number, size: number, t: ArrayFieldType, v: unknown): void {
    const count = t.elementSize > 0 ? size / t.elementSize : 0
    const list = (v ?? []) as unknown[]
    for (let i = 0; i < count; i++)
        writeElement(dv, off + i * t.elementSize, t.elementType, t.elementSize, list[i])
}

function readElement(dv: DataView, off: number, t: FieldType, size: number): unknown {
    switch (t.tag) {
        case 'basic': return readScalar(dv, off, t.kind)
        case 'string': return readString(dv, off, size, t.encoding)
        case 'struct':
        case 'union': return doDecode(dv, off, t.fields)
        case 'array': return readArray(dv, off, size, t)
    }
}

function writeElement(dv: DataView, off: number, t: FieldType, size: number, val: unknown): void {
    switch (t.tag) {
        case 'basic': writeScalar(dv, off, t.kind, Number(val ?? 0)); break
        case 'string': writeString(dv, off, size, t.encoding, val); break
        case 'struct':
        case 'union': doEncode(dv, off, t.fields, (val ?? {}) as Record<string, unknown>); break
        case 'array': writeArray(dv, off, size, t, val); break
    }
}

function doDecode(dv: DataView, base: number, fields: Fields): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const f of fields)
        out[f.name] = readElement(dv, base + f.offset, f.type, f.size)
    return out
}

function doEncode(dv: DataView, base: number, fields: Fields, v: Record<string, unknown>): void {
    for (const f of fields)
        writeElement(dv, base + f.offset, f.type, f.size, v[f.name])
}

// ============================================================
// 内部构造器
// ============================================================

function createStruct(t: CStruct): any {
    const { fields, size, maxEffectiveAlign } = computeStructLayout(t)
    return {
        __struct: t,
        size,
        structAlign: maxEffectiveAlign,
        decode: (buf: ArrayBuffer, offset = 0) => doDecode(new DataView(buf), offset, fields),
        encode: (v: any, buf?: ArrayBuffer, offset = 0) => {
            const out = buf ?? new ArrayBuffer(size)
            doEncode(new DataView(out), offset, fields, v)
            return out
        },
        offsetOf: (name: string) => {
            for (const f of fields) if (f.name === name) return f.offset
            throw new Error(`ffi-struct: no field "${name}"`)
        },
        alloc: () => {
            const buffer = new ArrayBuffer(size)
            return {
                buffer,
                ptr: ffi.bufferPtr(buffer),
                decode: (offset = 0) => doDecode(new DataView(buffer), offset, fields),
            }
        },
    }
}

// ============================================================
// 公共 API
// ============================================================

/** CType IR 结构体。给 name 则 alloc().ptr 带 StructPtr<name> 品牌。 */
export function struct<const T extends CStruct>(t: T): StructDef<T, never>
export function struct<const N extends string, const T extends CStruct>(name: N, t: T): StructDef<T, N>
export function struct(a: string | CStruct, b?: CStruct): StructDef<any, any> {
    const t = (typeof a === 'string' ? b : a) as CStruct
    return createStruct(t)
}

/** 从 native 拥有的 `<STRUCT>ptr` 解码（ptr === null → null）。 */
export function structFromPtr<S>(
    def: { size: number; decode(buf: ArrayBuffer, offset?: number): S },
    ptr: number | null,
): S | null {
    if (ptr === null) return null
    const buf = new ArrayBuffer(def.size)
    const u8 = new Uint8Array(buf)
    for (let i = 0; i < u8.length; i++) u8[i] = ffi.readByte(ptr + i)
    return def.decode(buf)
}
