import * as ffi from 'ffi'
import * as win from 'win'
import './text-codec.js'

// 声明式 FFI 绑定：把字符串签名（'ptr wstr i32 ptr i32 -> i32'）解析成
// 一个可调用函数（bind）或一个 dll 的签名表（bindLib）。
// kind：void u8 i8 u16 i16 u32 i32 u64 i64 ptr wstr
//   ptr   收 ArrayBuffer | number | null，槽宽=指针宽（ia32 4B / x64 8B）
//   wstr  收 string，自动 utf-16le+'\0' 编码后走 ptr 槽（仅参数，不能作返回）

type Kind = 'void' | 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64' | 'ptr' | 'wstr'

type ArgKind = Exclude<Kind, 'void'>
type RetKind = Exclude<Kind, 'void' | 'wstr'>

type ArgTypeOf = {
    u8: number; i8: number; u16: number; i16: number
    u32: number; i32: number
    u64: number; i64: number
    ptr: ArrayBuffer | number | null
    wstr: string
}
type RetTypeOf = {
    u8: number; i8: number; u16: number; i16: number
    u32: number; i32: number
    u64: number; i64: number
    ptr: number | null
}

type ArgsOf<T extends string> =
    T extends '' ? []
        : T extends `${infer H} ${infer R}` ? [ArgTypeOf[H & keyof ArgTypeOf], ...ArgsOf<R>]
        : [ArgTypeOf[T & keyof ArgTypeOf]]

type _Args<S extends string> = S extends `${infer A} -> ${string}` ? ArgsOf<A> : never
type _Ret<S extends string> = S extends `${string} -> ${infer R}` ? RetTypeOf[R & keyof RetTypeOf] : never

const KIND_TO_FFI: Record<Kind, ffi.FfiType> = {
    void: ffi.FFI_TYPE_VOID,
    u8: ffi.FFI_TYPE_UINT8,
    i8: ffi.FFI_TYPE_SINT8,
    u16: ffi.FFI_TYPE_UINT16,
    i16: ffi.FFI_TYPE_SINT16,
    u32: ffi.FFI_TYPE_UINT32,
    i32: ffi.FFI_TYPE_SINT32,
    u64: ffi.FFI_TYPE_UINT64,
    i64: ffi.FFI_TYPE_SINT64,
    ptr: ffi.FFI_TYPE_POINTER,
    wstr: ffi.FFI_TYPE_POINTER,
}

const _dllCache: Map<string, win.HMODULE> = new Map()

function loadDll(dll: string): win.HMODULE {
    const cached = _dllCache.get(dll)
    if (cached !== undefined) return cached
    const loaded = win.LoadLibrary(dll)
    if (!loaded) throw new Error(`ffi-bind: LoadLibrary("${dll}") failed`)
    _dllCache.set(dll, loaded)
    return loaded
}

function parseSig(sig: string): { args: ArgKind[]; ret: RetKind } {
    const parts = sig.split(' -> ')
    const ret = parts[1]
    if (ret === undefined || parts.length > 2) {
        throw new Error(`ffi-bind: invalid signature "${sig}" (expected "arg1 arg2 -> ret")`)
    }
    const args = (parts[0] ?? '') === '' ? [] : (parts[0] as string).split(' ') as ArgKind[]
    return { args, ret: ret as RetKind }
}

function makeFn(proc: number, sig: string): (...a: unknown[]) => unknown {
    const { args, ret } = parseSig(sig)
    const argTypes = args.map((k) => KIND_TO_FFI[k])
    const retType = KIND_TO_FFI[ret]
    return (...a: unknown[]) => {
        const vals = args.map((k, i) =>
            k === 'wstr' ? new TextEncoder('utf-16le').encode(String(a[i]) + '\0').buffer : a[i])
        return ffi.ffiCall(proc, argTypes as any, vals as any, retType)
    }
}

export function bind<const S extends string>(dll: string, name: string, sig: S): (...args: _Args<S>) => _Ret<S> {
    const proc = win.GetProcAddress(loadDll(dll), name)
    if (!proc) throw new Error(`ffi-bind: proc "${name}" not found in ${dll}`)
    return makeFn(proc, sig) as unknown as (...args: _Args<S>) => _Ret<S>
}

export function bindLib<const M extends Record<string, string>>(dll: string, map: M):
    { [K in keyof M]: (...args: _Args<M[K]>) => _Ret<M[K]> } {
    const out: Record<string, (...a: unknown[]) => unknown> = {}
    const h = loadDll(dll)
    for (const [name, sig] of Object.entries(map)) {
        const proc = win.GetProcAddress(h, name)
        if (!proc) throw new Error(`ffi-bind: proc "${name}" not found in ${dll}`)
        out[name] = makeFn(proc, sig)
    }
    return out as { [K in keyof M]: (...args: _Args<M[K]>) => _Ret<M[K]> }
}