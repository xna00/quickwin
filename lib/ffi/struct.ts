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

// 运行时 Field = CType + name/offset/size；struct/union 分支内嵌整棵子布局（member: Field[]），
// 且子成员的 offset 已平移到「相对父 buffer 起点」的绝对偏移（见 computeStructLayout / deepMap）。
// 匿名成员已被 splice 提升，不出现在这里。
export type Field = (CBasic | CString | CArray | (Omit<(CStruct | CUnion), 'member'> & { member: Field[] })) & {
    name: string
    offset: number
    size: number
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
// 布局
// ============================================================

/** 向上对齐（a 必须是 2 的幂）。 */
function alignUp(v: number, a: number): number {
    return (v + a - 1) & ~(a - 1)
}

export function computeArray(t: CArray): { align: number, size: number } {
    if (!Number.isInteger(t.length) || t.length < 1)
        throw new Error(`ffi-struct: array length must be an integer >= 1, got ${t.length}`)
    if (t.ctype.tag === 'basic') {
        const s = SizeAlign[t.ctype.kind]
        return { align: s, size: s * t.length }
    } else if (t.ctype.tag === 'string') {
        const s = SizeAlign[t.ctype.unit]
        return { align: s, size: s * t.length * t.ctype.length }
    } else if (t.ctype.tag === 'struct' || t.ctype.tag === 'union') {
        const ret = computeStructLayout(t.ctype)
        return { align: ret.maxEffectiveAlign, size: ret.size * t.length }
    } else {
        const ret = computeArray(t.ctype)
        return { align: ret.align, size: ret.size * t.length }
    }
}

// 把整棵子布局（含更深层 member）的 offset 全部平移 offset。
const deepMap = (offsets: Fields, offset: number): Fields => {
    const ret: Fields = []
    for (const n of offsets) {
        if (n.tag === 'struct' || n.tag === 'union') {
            ret.push({ ...n, offset: n.offset + offset, member: deepMap(n.member, offset) })
        } else {
            ret.push({ ...n, offset: n.offset + offset })
        }
    }
    return ret
}

export function computeStructLayout(t: CStruct | CUnion): {
    size: number,
    maxEffectiveAlign: number,
    fields: Fields,
} {
    const isStruct = t.tag === 'struct'
    let maxEffectiveAlign = 1
    let maxMemberSize = 0
    let fields: Fields = []
    const pack = t.pack ?? 8

    let cursor = 0

    for (const m of t.member) {
        let size: number
        let align: number
        let offset: number
        if (m.type.tag === 'basic') {
            size = SizeAlign[m.type.kind]
            align = size
            if (pack > 0) align = Math.min(pack, align)
            if (m.alignas) align = Math.max(align, m.alignas)
            offset = alignUp(cursor, align)
            fields.push({ ...m.type, name: m.name!, offset, size })
        } else if (m.type.tag === 'string') {
            const unit_size = SizeAlign[m.type.unit]
            align = unit_size
            if (pack > 0) align = Math.min(pack, align)
            if (m.alignas) align = Math.max(align, m.alignas)
            size = unit_size * m.type.length
            offset = alignUp(cursor, align)
            fields.push({ ...m.type, name: m.name!, offset, size })
        } else if (m.type.tag === 'struct') {
            const ret = computeStructLayout(m.type)
            size = ret.size
            align = ret.maxEffectiveAlign
            if (pack > 0) align = Math.min(pack, align)
            if (m.alignas) align = Math.max(align, m.alignas)
            offset = alignUp(cursor, align)
            if (m.name !== undefined) {
                fields.push({ ...m.type, name: m.name, offset, size, member: deepMap(ret.fields, offset) })
            } else {
                fields.push(...deepMap(ret.fields, offset))
            }
        } else if (m.type.tag === 'union') {
            const ret = computeStructLayout(m.type)
            size = ret.size
            align = ret.maxEffectiveAlign
            if (pack > 0) align = Math.min(pack, align)
            if (m.alignas) align = Math.max(align, m.alignas)
            offset = alignUp(cursor, align)
            if (m.name !== undefined) {
                fields.push({ ...m.type, name: m.name, offset, size, member: deepMap(ret.fields, offset) })
            } else {
                fields.push(...deepMap(ret.fields, offset))
            }
        } else {
            const ret = computeArray(m.type)
            size = ret.size
            align = ret.align
            if (pack > 0) align = Math.min(pack, align)
            if (m.alignas) align = Math.max(align, m.alignas)
            offset = alignUp(cursor, align)
            fields.push({ ...m.type, name: m.name!, offset, size })
        }

        if (isStruct) {
            cursor = offset + size
        }
        maxEffectiveAlign = Math.max(maxEffectiveAlign, align)
        maxMemberSize = Math.max(maxMemberSize, size)
    }

    return {
        size: isStruct ? alignUp(cursor, maxEffectiveAlign) : alignUp(maxMemberSize, maxEffectiveAlign),
        maxEffectiveAlign,
        fields,
    }
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

function readString(dv: DataView, off: number, count: number, kind: FieldKind, enc: Encoding): string {
    const step = enc === 'utf16' ? 2 : 1
    const mask = enc === 'utf16' ? 0xFFFF : 0xFF
    let s = ''
    for (let i = 0; i < count; i++) {
        const u = readScalar(dv, off + i * step, kind) & mask
        if (u === 0) break
        s += String.fromCharCode(u)
    }
    return s
}

function writeString(dv: DataView, off: number, count: number, kind: FieldKind, enc: Encoding, v: unknown): void {
    const step = enc === 'utf16' ? 2 : 1
    for (let i = 0; i < count; i++) writeScalar(dv, off + i * step, kind, 0)
    const s = String(v ?? '')
    const n = Math.min(s.length, count - 1)
    for (let i = 0; i < n; i++) writeScalar(dv, off + i * step, kind, s.charCodeAt(i))
}

function readField(dv: DataView, base: number, f: Field): unknown {
    const off = base + f.offset
    switch (f.tag) {
        case 'basic':
            return readScalar(dv, off, f.kind)
        case 'string':
            return readString(dv, off, f.length, f.unit, f.encoding)
        case 'array': {
            if (f.ctype.tag === 'struct' || f.ctype.tag === 'union') {
                const child = computeStructLayout(f.ctype)
                const out: unknown[] = []
                for (let i = 0; i < f.length; i++)
                    out.push(doDecode(child.fields, dv.buffer as ArrayBuffer, off + i * child.size))
                return out
            }
            if (f.ctype.tag !== 'basic')
                throw new Error(`ffi-struct: unsupported array element <${f.ctype.tag}>`)
            const out: number[] = []
            const step = SizeAlign[f.ctype.kind]
            for (let i = 0; i < f.length; i++) out.push(readScalar(dv, off + i * step, f.ctype.kind))
            return out
        }
        case 'struct':
        case 'union':
            // f.member 的 offset 已包含 f.offset（相对父 buffer 起点），故传 base 而非 off。
            return doDecode(f.member, dv.buffer as ArrayBuffer, base)
    }
}

function writeField(dv: DataView, base: number, f: Field, v: unknown): void {
    const off = base + f.offset
    switch (f.tag) {
        case 'basic':
            writeScalar(dv, off, f.kind, Number(v))
            break
        case 'string':
            writeString(dv, off, f.length, f.unit, f.encoding, v)
            break
        case 'array': {
            if (f.ctype.tag === 'struct' || f.ctype.tag === 'union') {
                const child = computeStructLayout(f.ctype)
                const list = (v ?? []) as Record<string, unknown>[]
                for (let i = 0; i < f.length; i++)
                    doEncode(child.fields, child.size, list[i] ?? {}, dv.buffer as ArrayBuffer, off + i * child.size)
            } else if (f.ctype.tag === 'basic') {
                const step = SizeAlign[f.ctype.kind]
                const list = (v ?? []) as number[]
                for (let i = 0; i < f.length; i++) writeScalar(dv, off + i * step, f.ctype.kind, list[i] ?? 0)
            } else {
                throw new Error(`ffi-struct: unsupported array element <${f.ctype.tag}>`)
            }
            break
        }
        case 'struct':
        case 'union':
            // 同 readField：f.member offset 已含 f.offset，传 base。
            doEncode(f.member, f.size, v as Record<string, unknown>, dv.buffer as ArrayBuffer, base)
            break
    }
}

function doDecode(fields: Fields, buf: ArrayBuffer, offset: number): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const dv = new DataView(buf)
    for (const f of fields) out[f.name] = readField(dv, offset, f)
    return out
}

function doEncode(fields: Fields, size: number, v: Record<string, unknown>, buf?: ArrayBuffer, offset = 0): ArrayBuffer {
    buf = buf ?? new ArrayBuffer(size)
    const dv = new DataView(buf)
    for (const f of fields) writeField(dv, offset, f, v[f.name])
    return buf
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
        decode: (buf: ArrayBuffer, offset = 0) => doDecode(fields, buf, offset),
        encode: (v: any, buf?: ArrayBuffer, offset = 0) => doEncode(fields, size, v, buf, offset),
        offsetOf: (name: string) => {
            for (const f of fields) if (f.name === name) return f.offset
            throw new Error(`ffi-struct: no field "${name}"`)
        },
        alloc: () => {
            const buffer = new ArrayBuffer(size)
            return {
                buffer,
                ptr: ffi.bufferPtr(buffer),
                decode: (offset = 0) => doDecode(fields, buffer, offset),
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
