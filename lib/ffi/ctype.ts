import * as os from 'os'

// ============================================================
// AST IR —— struct/bind 的类型描述树（CType = FieldKind|CString|CArray|CStruct|CUnion）。
// 标量直接写 kind 字符串（如 'i32'）；指针必须写 '<>ptr'（裸地址）或 '<NAME>ptr'（带名），
// 复合类型才是带 tag 的对象。
// 只描述「C 声明怎么写」（unit/length/encoding 等意图）；内存布局与读写视图由
// struct.ts 的 computeStructLayout/lower 单独 lower 成 layout IR。
//
// 叶子模块：刻意不依赖 win/std/text-codec，可被 struct 直接引用，
// 避免「只用 struct」的调用方被动加载整个 bind 运行时。
// 四段按依赖序：§1 kind 词汇表 → §2 指针布局与品牌 → §3 C 别名与 token 归一 → §4 CType IR。
// ============================================================

// ============================================================
// §1 kind 词汇表
//   用户面（可写进 CType）：CInteger | CFloat | CPointer<string> = FieldKind。
//     指针必须带角括号 —— '<>ptr' 裸地址，'<NAME>ptr' 带名（品牌见 §2 Ptr<T>）。
//   内部（lower 后运行时 IR 用）：Kind = CInteger|CFloat 的超集
//     （多 'void'、裸 'ptr'、u64n/i64n 三个内部专用档）。裸 'ptr' 用户面已禁用、内部保留。
//   本表是 bind 与 struct 共用的规范 kind 集合；C/Windows typedef 别名表见 §3。
// ============================================================
// export type CInteger = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64'
// export type CFloat = 'f32' | 'f64'
// type CPointer<T extends string = ''> = `<${T}>ptr`

// 用户面标量全集：可作 struct 成员 type / bind 签名 token。
// 注意用 CPointer<string>（非默认 ''）：默认参数会把它收缩成字面量 '<>ptr'，
// 导致 '<RECT>ptr' 等具体指针无法赋给 CType。

// 内部 kind 全集：KINDS 元组是唯一手写清单，Kind 与 KIND_SET 都从它派生
// （此前 BasicKind 类型与 KIND_SET 列表各自抄了一遍这 14 个字符串）。
//   = 用户面标量（CInteger|CFloat）+ 'void' + 裸 'ptr' + 两个内部专用档：
//   u64n/i64n —— 无符号 / 有符号 64 位窄读（不是 C 类型，故不在 CInteger 里；u64/i64 是原生值）。
// 裸 'ptr' 用户面已禁用，内部保留：它是唯一随架构变宽的标量档（见 §2 PTR_SIZE）。
// 注意不能从 CInteger 派生 —— u64n/i64n 不在其中。
const KINDS = [
    'void', 'u8', 'i8', 'u16', 'i16', 'u32', 'i32',
    'u64', 'i64', 'u64n', 'i64n', 'f32', 'f64', 'ptr',
] as const
export type Kind = (typeof KINDS)[number]

// 运行时 kind 集合，供 normKind 校验。
const KIND_SET: ReadonlySet<Kind> = new Set(KINDS)

// ============================================================
// §2 指针布局与品牌
// ============================================================
// 指针宽：与 bind 的调用约定 / quickjs-ffi-type.h 一致。
export const PTR_SIZE = os.arch === 'x64' ? 8 : 4

// 指针的编译期品牌（运行期擦除，值就是 number）：'<>ptr'（T=''）直接退化成 number，
// 带名 '<NAME>ptr' 提供名义约束 —— 不同 <NAME>ptr 不可互串，裸 number 不可传给 <NAME>ptr。
declare const ptrBrand: unique symbol
export type Ptr<T extends string> =
    T extends '' ? number : number & { readonly [ptrBrand]: T }

type NullablePtr<T extends string> = (T extends '' ? number : number & { readonly [ptrBrand]: T }) | null
export type StructPtr<N extends string> = Ptr<N>

// <NAME>ptr 指针布局的 NAME。
const PTR_LAYOUT_RE = /^<(\w+)>ptr$/

// ============================================================
// §3 C 别名与 token 归一
//   Windows x86/x64 均 LLP64：int/long 恒 32 位，long long 恒 64 位；
//   LONG_PTR/WPARAM/SIZE_T 等指针 typedef 一律归一到 '<>ptr'（裸地址）；
//   LPCWSTR 等宽字符串 typedef 归一到 '<WCHAR>ptr' 指针布局。
//   单源常量（as const satisfies）：类型层 Norm 由它派生，无需手同步；
//   satisfies 让 value 也在定义处被校验（仅 as const 会静默放过 'u32' 写成 'u3z'，
//   错误推迟到调用点变成诡异的 never 参数）。
// ============================================================

export type C_Number = 'u8' | 'i8' | 'u16' | 'i16'
    | 'u32' | 'i32' | 'u64' | 'i64' | 'f32' | 'f64'

type C_Basic_Type = 'void' | C_Number | 'u64n' | 'i64n'

type C_Type = C_Basic_Type | `<${string}>ptr`

const C_ALIAS = {
    void: 'void', u8: 'u8', i8: 'i8', u16: 'u16', i16: 'i16', u32: 'u32', i32: 'i32',
    u64: 'u64', i64: 'i64', f32: 'f32', f64: 'f64', i64n: 'i64n', u64n: 'u64n',
    int: 'i32', long: 'i32', short: 'i16', char: 'i8', float: 'f32', double: 'f64',
    DWORD: 'u32', UINT: 'u32', ULONG: 'u32', LONG: 'i32', BOOL: 'i32', HRESULT: 'i32',
    SHORT: 'i16', USHORT: 'u16', BYTE: 'u8', WCHAR: 'u16',
    LONG_PTR: '<>ptr', ULONG_PTR: '<>ptr', INT_PTR: '<>ptr', UINT_PTR: '<>ptr', DWORD_PTR: '<>ptr',
    SIZE_T: '<>ptr', WPARAM: '<>ptr', LPARAM: '<>ptr',
    HANDLE: '<>ptr', HWND: '<>ptr', HDC: '<>ptr', HMODULE: '<>ptr', HFONT: '<>ptr', HBRUSH: '<>ptr',
    HICON: '<>ptr', HBITMAP: '<>ptr', LPVOID: '<>ptr', LPCVOID: '<>ptr',
    LPCWSTR: '<WCHAR>ptr', PCWSTR: '<WCHAR>ptr', LPWSTR: '<WCHAR>ptr',
} as const satisfies Record<string, C_Type>

export type C_ALIAS_MAP = typeof C_ALIAS

export type C_TypeJsTypeMap = {
    u8: number; i8: number; u16: number; i16: number
    u32: number; i32: number; u64: number; i64: number
    u64n: bigint; i64n: bigint; f32: number; f64: number
}

export type C_TypeReturnJsTypeMap = C_TypeJsTypeMap & { void: void }

type Norm<K extends string> = K extends `<${string}>ptr` ? K : C_ALIAS_MAP[K & keyof C_ALIAS_MAP]

export type JsTypeOfC_Type<K extends string, M, L, D> =
    Norm<K> extends infer S ?
    S extends `<${infer N}>ptr` ? NullablePtr<N> | L[N & keyof L] :
    M[S & keyof M] extends never ? D
    : M[S & keyof M]
    : never

// 合法 token 全集 = typedef 别名 ∪ 规范 kind ∪ 指针 token。
// 裸 'ptr' 是合法内部 Kind，但不是合法用户 token —— 由 ArgToken/RetToken 显式拒绝。
// export type Keys = keyof typeof C_ALIAS | Kind | CPointer<string>

// token 的类型层归一（运行时对应 normToken）：别名查表；
// 已是规范 kind / 指针 token 者原样返回（这两类不需要映射）。

// token 归一：C/Windows typedef 别名 → 规范形式（'HANDLE' → '<>ptr' 等）；非别名原样返回。
export function normToken(t: string): string {
    return (C_ALIAS as Record<string, string>)[t] ?? t
}

// 别名归一 + kind 校验：非法 kind 抛错，合法者收窄为 Kind。
export function normKind(t: string): Kind {
    const k = normToken(t) as Kind
    if (!KIND_SET.has(k)) throw new Error(`ffi-bind: invalid kind "${t}"`)
    return k
}

// token（C 别名归一后）是否为 <NAME>ptr 指针布局；是则返回 NAME，否则 undefined。
// 注意 '<>ptr'（空名裸指针）不匹配 —— 调用方按裸指针另行处理。
export function ptrLayoutName(t: string): string | undefined {
    const m = PTR_LAYOUT_RE.exec(normToken(t))
    return m ? m[1]! : undefined
}

// ============================================================
// §4 CType IR —— 复合类型（带 tag 的对象）；标量/指针直接写 kind 字符串。
// ============================================================
// 字符串解释方式（与 printf 的 %d/%u 类比：encoding 只决定「把这段字节怎么看成 JS string」）。
// 直接复用 TextDecoder/TextEncoder 的标准标签，读写统一走 lib/text-codec.js：
//   utf-8    变长编解码
//   utf-16le 每 2 字节 1 码元（宽字符）
// 定长字段：写入超长即截断到 size，读取到 NUL 为止。
// unit+length 共同决定 layout；encoding 只在 decode/encode 时使用，可与任意 unit 组合。
export type Encoding = 'utf-8' | 'utf-16le'

export type CString = {
    tag: 'string',
    unit: 'u8' | 'u16',   // 存储单元类型（决定槽宽与对齐）
    length: number,   // 槽数
    encoding: Encoding
}
export type CArray = {
    tag: 'array',
    ctype: CType,
    length: number
}
// 成员分两支，用 name 判别：
//   命名成员：标量 kind / string / array（没有可提升的子布局，必须命名）
//   匿名聚合：struct / union（C11 匿名字段，其字段被 splice 提升进父结构）
// alignas 抬对齐下限（pack 压上限）；bitfield 暂不支持。
export type Member =
    | { name: string; type: CType; alignas?: number }
    | { name?: undefined; type: CStruct | CUnion; alignas?: number }

export type CStruct = { tag: 'struct'; member: readonly Member[], pack?: number }
export type CUnion = { tag: 'union'; member: readonly Member[], pack?: number }

export type FieldKind = Exclude<C_Type, 'void'>

export type CType = C_Number | `<${string}>ptr` | CString | CArray | CStruct | CUnion
