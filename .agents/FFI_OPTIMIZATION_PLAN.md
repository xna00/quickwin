# FFI 系统性优化方案

> 对应 TODO：`.agents/TODO.md` 低优先级「系统性优化 FFI」  
> 范围：**Windows-only**（x86 XP / x64，未来可能 **ARM64 Windows**）；不含 Linux/macOS  
> 状态：Phase 0 + Phase 1 Spike + **Phase 2（删 libffi、qwcall 唯一后端、删 FFI_TYPE_*）已完成** + **ia32 i64 trampoline（`qw_call_ia32` 静态混槽压栈，`qw_call_eligible` throw 已删）** + **ARM64 Windows 就绪未测（AAPCS64 与 `intptr_t`+`QW_CASES` 天然匹配，`make cc-arm64`，无工具链未实测）**

---

## 0. 结论先行

1. **仓库已处于「int/ptr 固定子集」**——libffi 的任意签名能力（float / struct-by-value / varargs / closure）**当前未被用到**。
2. **体积不是决策因子**（libffi.a ≈ 35–38KB）；决策因子 = **API 样板、x86 stdcall 正确性、依赖构建链、ARM64 可维护性**。
3. **推荐主线：方案 A**——解析继续用 `LoadLibrary`/`GetModuleHandle` + `GetProcAddress`；**调用端**用纯 C 固定签名 wrapper（函数指针类型转型），删 libffi。
4. **不要走运行时 trampoline**（ACG / I-cache / 失败面多）。
   > 注：ia32 的 i64 支持用的是 `qw_call_ia32` **静态**迷你 trampoline（编译期 asm，压栈字节镜像 + 16B 对齐，不生成可执行页），与本条反对的「运行时生成代码」不同——已实现并经 XP 实测。
5. **已拍板：** `i64`/`u64` = **策略 C**（`number | bigint` 双模，对齐 `std`）；绑定 API = **`ffi.dlopen`**；旧 `FFI_TYPE_*` Phase 0 deprecated、Phase 2 删。
6. **分阶段：** Phase 0（与删 libffi 解耦）→ Phase 1 Spike → Phase 2 删 libffi → Phase 3+ 按需扩展。

---

## 1. 概念澄清：GetProcAddress 能否「做 FFI」

`SetProcessDPIAware`（`main.c`）与通用 FFI 都分两步：

```c
// 步骤 1：解析地址（两边一样，可继续用现成 win 模块）
HMODULE h = GetModuleHandleA("user32.dll");          // 已加载：GetModuleHandle
// 或 LoadLibraryW(L"user32.dll");                   // 未加载 / 任意 DLL：LoadLibrary
FARPROC p = GetProcAddress(h, "SetProcessDPIAware");

// 步骤 2：按 ABI 调用（FFI 的真正难点）
typedef void (WINAPI *fn_t)(void);
((fn_t)p)();   // 编译器生成 stdcall call；JS 自己 call 不了
```

| 问题 | 答案 |
|------|------|
| 能否用 `GetModuleHandle`+`GetProcAddress`？ | **能，这就是取函数地址的标准做法** |
| 能否**只**靠它们完成 FFI？ | **不能**——还缺「按 ABI 调用」 |
| 现状 FFI 缺哪块？ | 解析已有（`win.LoadLibrary`/`GetProcAddress`）；调用靠 **libffi `ffiCall`** |
| 方案 A 改什么？ | **只换调用端**：libffi → C 函数指针类型转型；解析层不动 |

**`GetModuleHandle` vs `LoadLibrary`：**

| API | 语义 | FFI 何时用 |
|-----|------|------------|
| `LoadLibrary` | 加载 DLL（+引用计数） | 首次打开任意 DLL |
| `GetModuleHandle` | **只查已加载**，不加载 | 进程必已加载的（如启动就链了 user32）；**不能**拉起未加载 DLL |
| `GetProcAddress` | 导出表取地址 | 通用；两边都要 |

**一句话：** `GetProcAddress` 负责「函数在哪」；FFI 还要解决「怎么调」。方案 A = 解析沿用 `GetProcAddress` + 调用改成 typed wrapper。

---

## 2. 现状快照

| 项 | 事实 |
|----|------|
| 实现 | `quickjs-ffi.c`（~173 行），每次调用重建 argTypes + `ffi_prep_cif`，**无缓存** |
| ABI | 恒为 `FFI_DEFAULT_ABI`；无 stdcall/cdecl 选项 |
| 类型 | 仅 `void / u8–s8 / u16–s16 / u32–s32 / u64–s64 / pointer`；float/struct 槽位 NULL |
| 句柄宽度 | TS 手写 `os.arch === 'ia32' ? UINT32 : UINT64`；多处仍误用 UINT64 |
| 构建 | `deps/libffi` submodule + autoreconf + configure；native 用系统 `-lffi` |
| CI | 缓存 `libffi.a` + `libffi-build/include`，hash 含 `deps/libffi/**` |
| 体积 | ia32 ≈ 38KB / x64 ≈ 35KB；closures ≈ 11KB（未用） |
| XP | `qwin-x86.exe` + `-D_WIN32_WINNT=0x0501` |

### 2.1 调用面

#### `ffi.ffiCall`（8 文件，31 处，~17 个 Win32 函数）

| 文件 | 次数 | 函数 |
|------|------|------|
| `examples/pdf_preview2.ts` | 7 | GetOpenFileNameW, GetDC, ReleaseDC, SetDIBitsToDevice, PatBlt |
| `lib/react-qw/components/ListView.tsx` | 6 | GetObjectW, CreateFontIndirectW, SelectObject, ScreenToClient, LoadCursorW, SetCursor |
| `lib/text-measure.ts` | 5 | DrawTextW, GetDC, ReleaseDC, SelectObject |
| `lib/react-qw/components/PathPicker.tsx` | 4 | GetOpenFileNameW, SHBrowseForFolderW, SHGetPathFromIDListW, CoTaskMemFree |
| `examples/PdfCanvas.tsx` | 3 | GetDC, ReleaseDC, SetDIBitsToDevice |
| `test/test_ffi.ts` | 3 | EnumPrintersW ×2 + 异常路径 |
| `examples/setres.ts` | 2 | EnumDisplaySettingsA, ChangeDisplaySettingsA |
| `examples/pdf_viewer.tsx` | 1 | GetOpenFileNameW |

最大 arity：`SetDIBitsToDevice` **9 参** → wrapper 覆盖 **0..10**。

#### 不依赖 libffi 的 API（可原样保留）

| API | 规模 |
|-----|------|
| `ffi.bufferPtr` | 10 文件 / 18 处 |
| `ffi.readByte` | 6 文件 / ~30 处 |
| `ffi.writeByte` | 1 文件 / 4 处 |

#### LoadLibrary + GetProcAddress 样板（8 文件，待收敛）

`text-measure.ts`、`setres.ts`、`pdf_preview2.ts`、`pdf_viewer.tsx`、`PdfCanvas.tsx`、`PathPicker.tsx`、`ListView.tsx`、`test_ffi.ts`

---

## 3. 问题清单（按严重度）

### 高

**H1. 硬编码 `FFI_TYPE_UINT64` 作句柄 — 4 文件 ~28 处（ia32 错位）**

已修对照：`lib/text-measure.ts`（`FFI_HND = os.arch === 'ia32' ? UINT32 : UINT64`）  
未修：`pdf_preview2.ts`(~10)、`PdfCanvas.tsx`(~5)、`ListView.tsx`(~11)、`PathPicker.tsx`(~2)

**H2. `arg_type`/`ret_type` 零校验** → OOB / NULL 解引用；VLA 无上限。

**H3. ia32 负数返回未符号扩展** → `-1` 变 `4294967295`；`setres.ts` DISP_CHANGE 表在 XP 失效。

### 中

| ID | 问题 |
|----|------|
| M1 | react-qw/pdf 大量 **x64-only 结构体布局**（Tab/Tooltip/PathPicker/ListView/TreeView）无 ia32 分支 |
| M2 | `ffi_prep_cif` status、`JS_ToInt64` 返回值不检查 |
| M3 | `POINTER` 只收 `ArrayBuffer\|null`，**句柄数字进不去** → 逼出 H1 |
| M4 | `loadProc` 样板重复 8 文件 |

### 低

| ID | 问题 |
|----|------|
| L1 | ia32 `FFI_DEFAULT_ABI`=MS CDECL，WinAPI=stdcall（现状靠 libffi 栈恢复碰巧安全；应用 **winapi 默认**） |
| L2 | `JS_GetPropertyUint32` 取的是下标，非值截断（虚惊）；真问题并入 M2 |
| L3 | POINTER NULL→`JS_NULL` 等边角 OK |
| L4 | 裸指针读写无校验 — 信任脚本模型，可接受 |

---

## 4. 方案选型

```
A. 固定签名 C wrapper（宏，纯 C）     ← 主线
B. dyncall（小汇编 CallVM）            ← 要 struct/callback 且不要 libffi 构建链时的备选
C. 运行时 trampoline（写可执行页）     ← 否
D. 保留 libffi + 薄封装                ← Spike 失败时的回退
```

| 维度 | D 留 libffi | B dyncall | **A 自研 wrapper** | C trampoline |
|------|-------------|-----------|---------------------|--------------|
| 体积 | ~35KB | ~10–60KB | **~3–8KB** | 小+exec 页 |
| XP x86 | ✅ 须修 stdcall | ✅ 测过 XP | ✅ 编译器 `ret N` | 多失败面 |
| ARM64 | ✅ | ✅ | ✅ **int/ptr 更简单** | ⚠️ I-cache/ACG |
| stdcall/cdecl | 需显式传 | ✅ | ✅ 类型内建 | 生成时 |
| 任意签名 | ✅ | ⚠️ | ❌ YAGNI | ⚠️ |
| 维护 | 中（构建链） | 中低 | **中低**（~200–400 行） | 高 |

**选 A 的理由：** 调用面 100% int/ptr；`GetProcAddress`+转型即可调；Windows 三架构宏可覆盖；无动态代码、无 submodule。

### struct-by-value（为何不在子集内）

- **按指针** `GetClientRect(hwnd, &rect)`：传地址 → 普通 `ptr`，已覆盖。  
- **按值** `f(POINT{10,20})`：整个结构体进寄存器/栈 → ABI 复杂；**仓库 0 处**，YAGNI。

---

## 5. 完整技术方案（方案 A）

### 5.1 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│ JS / TS                                                      │
│  ffi.dlopen('gdi32', { SelectObject: { args:['hnd','hnd'],  │
│                       returns:'hnd' }})                     │
│  或兼容层：ffi.ffiCall(fp, [hnd,hnd], [a,b], hnd)           │
│  解析：win.LoadLibrary / GetModuleHandle + GetProcAddress   │
├──────────────────────────────────────────────────────────────┤
│ quickjs-ffi.c                                                │
│  1) 解析 fp（number）+ 解析签名 → kind 表（可缓存）         │
│  2) 收集 args[] : uint64[]（ptr → ArrayBuffer 地址）         │
│  3) qw_call(fp, argc, abi, ret_kind, args)                   │
│     → switch(abi, argc, ret) → 静态 typed wrapper            │
├──────────────────────────────────────────────────────────────┤
│ 编译器生成的 __stdcall / __cdecl / x64/ARM64 调用            │
│  typedef 返回 (WINAPI|cdecl *fnN)(slot...);                  │
│  ((fnN)fp)(a0..aN-1);   // 无 libffi、无手写 asm             │
└──────────────────────────────────────────────────────────────┘
```

**与 libffi 对比：**

| | 现状 | 方案 A |
|--|------|--------|
| 解析 | `GetProcAddress` | **相同** |
| 调用 | `ffi_prep_cif` + 汇编 kernel | **C 函数指针转型 + 编译器 ABI** |
| 签名 | 每次调用 JS 传 `argTypes[]` | **声明一次**，缓存 kind |
| ABI | 锁死 `FFI_DEFAULT_ABI` | **默认 winapi**（x86=stdcall） |
| 句柄 | 调用方手写 UINT32/64 | **`hnd` 运行时定宽** |

### 5.2 类型系统（运行时 kind）

#### 语义类型（JS 字符串 / 内部 `QwType`）

| kind | 含义 | ia32 | x64 | ARM64 |
|------|------|------|-----|-------|
| `void` | 无返回 | — | — | — |
| `i8/i16/i32/i64` | 有符号整数 | 1/2/4/8 | 同 | 同 |
| `u8/u16/u32/u64` | 无符号整数 | 同 | 同 | 同 |
| **`hnd`** | 句柄/指针宽整数 | **4** | **8** | **8** |
| `ptr` | 裸指针；`ArrayBuffer` 自动取址；`number` 直传 | 4 | 8 | 8 |

`hnd` 在 C 里实现为：读 `args[i]` 的**指针宽**槽（`intptr_t`），与 `os.arch` 无关——**消灭 H1/M3**。

#### ABI

| 名 | ia32 | x64 / ARM64 |
|----|------|-------------|
| `winapi`（**默认**） | `__stdcall`（WinAPI） | 忽略（单 ABI） |
| `cdecl` | `__cdecl` | 忽略 |

修 L1；x86 varargs 才是 cdecl，当前子集不用。

#### 返回值规范（修 H3）

```c
// 内部统一拿到 uint64 raw（wrapper 返回 intptr_t 放进 raw）
switch (ret_kind) {
  case RET_VOID: return JS_UNDEFINED;
  case RET_I32:  return JS_NewInt32(ctx, (int32_t)(uint32_t)raw);   // 符号扩展
  case RET_U32:  return JS_NewUint32(ctx, (uint32_t)raw);
  case RET_HND:
  case RET_PTR:  return raw ? JS_NewInt64(ctx, (int64_t)raw)
                 : (ret_kind == RET_PTR ? JS_NULL : JS_NewInt64(ctx, 0));
  case RET_I64:  /* 策略 C：见 5.2.1 */ …
  case RET_U64:  /* 同上 */ …
}
```

> **设计选择：** `ptr` 空 → `JS_NULL`（保持现状）；`hnd` 0 → `0`（与现 UINT64 路径一致，避免 HWND 0 语义变化）。

#### 5.2.1 TS ↔ 运行时映射（已拍板）

| kind | TS 入参 | TS 返回 | C 转换 |
|------|---------|---------|--------|
| `void` | — | `undefined` | 不读返回 |
| `i8`–`i32` | `number` | `number` | `JS_NewInt32`（全宽符号扩展） |
| `u8`–`u32` | `number` | `number` | `JS_NewUint32` |
| **`i64` / `u64`** | **`number \| bigint`** | **`number \| bigint`（策略 C 双模）** | 见下 |
| **`hnd`** | `number` | `number`（0 **不**映射 null） | 指针宽 + `JS_NewInt64`；用户态 `< 2^48` 安全 |
| `ptr` | `ArrayBuffer \| null \| number` | `number \| null` | AB→地址；null→0；0 返回→`JS_NULL` |

**`i64`/`u64` 策略 C（对齐 `std.seek` / `std.tello` 双模）：**

```c
// 入参
if (JS_IsBigInt(ctx, v)) { JS_ToBigInt64(...); /* BigInt 路径精确 */ }
else                     { JS_ToInt64(...);    /* number，|x|≤2^53 精确 */ }

// 返回：仅当入参或签名要求 bigint 时用 JS_NewBigInt64
// 默认与现 API 一致：JS_NewInt64 → number
// 文档标明：bit63=1 时为负；>2^53 丢精度；要全宽传 1n / 收 BigInt
```

| 策略 | 结论 |
|------|------|
| A 恒 `number` | 最简，但 bit63 语义错 |
| B 恒 `bigint` | 语义全对，破坏现有 `number` API |
| **C 双模** | **选定**：小值零摩擦；逃生舱 `1n`；与 QuickJS `std` 一致 |

> 本仓库 31 处 `ffiCall` 几乎全是 `i32`/`hnd`/`ptr`，**真 64 位 ≈ 0**——`i64`/`u64` 作逃生舱，主路径不依赖其精度。

**不做（YAGNI）：** `hnd`/`ptr` 不返回 `bigint`；无 `f32`/`f64`（Phase 3）；无 struct-by-value；不引入独立 `Hnd` branded type（避免与 `gui.HWND` 打架，`hnd` 在 TS 即 `number`）。

#### 5.2.2 旧 `FFI_TYPE_*`（branded number）

- **Phase 0：保留 + `@deprecated`**，数值映射到 `QwType`（`FFI_TYPE_UINT64` → `'u64'`）。
- `ffi.ffiCall` 过渡期参数类型：`FfiKind | FfiType`（字符串**或**旧常量）。
- **Phase 2：** 调用点迁完后删除 branded 常量（或永留为数值别名）。

### 5.3 TS 类型推导（`quickwin.d.ts` 草图）

```ts
declare module "ffi" {
  type FfiKind =
    | "void"
    | "i8" | "i16" | "i32" | "i64"
    | "u8" | "u16" | "u32" | "u64"
    | "hnd" | "ptr";

  type TypeArg<K extends FfiKind> =
    K extends "void" ? never :
    K extends "ptr"  ? (ArrayBuffer | null | number) :
    K extends "i64" | "u64" ? (number | bigint) :
    number;

  type Ret<K extends FfiKind> =
    K extends "void" ? undefined :
    K extends "ptr"  ? (number | null) :
    K extends "i64" | "u64" ? (number | bigint) :
    number;

  type ArgsOf<A extends readonly FfiKind[]> = { [I in keyof A]: TypeArg<A[I]> };
  type BoundFn<A extends readonly FfiKind[], R extends FfiKind> =
    (...args: ArgsOf<A>) => Ret<R>;

  interface SymSig { args: readonly FfiKind[]; returns: FfiKind }
  type BoundLib<S extends Record<string, SymSig>> = {
    [K in keyof S]: BoundFn<S[K]["args"], S[K]["returns"]>;
  };

  /** LoadLibrary + 多符号 GetProcAddress + 生成可调用对象 */
  function dlopen<S extends Record<string, SymSig>>(lib: string, sigs: S): BoundLib<S>;

  /** 兼容：kind 字符串或旧 FFI_TYPE_* */
  function ffiCall<…>(…): …;

  function bufferPtr(buf: ArrayBuffer): number;
  function readByte(ptr: number): number;
  function writeByte(ptr: number, value: number): void;
}
```

推导效果：

```ts
const user32 = ffi.dlopen("user32.dll", {
  GetDC:     { args: ["hnd"], returns: "hnd" },
  DrawTextW: { args: ["hnd", "ptr", "i32", "ptr", "u32"], returns: "i32" },
});
const hdc: number = user32.GetDC(hwnd);
user32.DrawTextW(hdc, buf, -1, rect, flags); // 参数个数/类型错 → 编译错
```

**`dlopen` 挂在 `ffi`（已拍板）：** `win` 只保留解析原语（`LoadLibrary`/`GetProcAddress`/`GetModuleHandle`）；调用语义归 `ffi`。

### 5.4 目标 JS API

#### 推荐：签名声明一次（Deno/Bun 风格）

```ts
import * as ffi from "ffi"

const user32 = ffi.dlopen("user32.dll", {
  GetDC:     { args: ["hnd"], returns: "hnd" },
  ReleaseDC: { args: ["hnd", "hnd"], returns: "i32" },
  DrawTextW: { args: ["hnd", "ptr", "i32", "ptr", "u32"], returns: "i32" },
})
const gdi32 = ffi.dlopen("gdi32", {
  SelectObject: { args: ["hnd", "hnd"], returns: "hnd" },
})

const hdc = user32.GetDC(hwnd)
gdi32.SelectObject(hdc, hFont)
user32.DrawTextW(hdc, textBuf, -1, rect, DT_CALCRECT)
```

#### 签名串糖（可选）

```ts
const drawTextW = ffi.fn(user32, "DrawTextW", "hnd,ptr,i32,ptr,u32→i32")
```

#### 兼容层：保留 `ffiCall` 形态（迁移期）

```ts
// Phase 0：内部仍可走 libffi，或已走新 backend
ffi.ffiCall(fp, ["hnd", "ptr"], [hwnd, buf], "i32")
// 或旧：ffiCall(fp, [FFI_TYPE_POINTER…], …) — deprecated 别名
```

### 5.5 `hnd` 如何消灭 H1

| 调用方写法 | 结果 |
|------------|------|
| 现状 `UINT64` | ia32 错位 → text-measure 类 bug |
| 现状 `os.arch ? UINT32 : UINT64` | 正确但样板、易漏 |
| **新 `hnd`** | C 指针宽槽 + 目标 ABI，**全架构正确**；TS 恒 `number` |

迁移时把 4 个未修文件的 `UINT64` 句柄全部改成 `hnd`。

### 5.6 解析层（可选 Phase 0 糖）

```ts
// 收敛 8 处 loadProc —— ffi.dlopen 内部即 LoadLibrary + GetProcAddress
```

`SetProcessDPIAware` 类「C 内一次性」调用**不必**上 JS FFI；继续用 `main.c` 的 `GetProcAddress`。

### 5.7 C 调用端伪代码（`quickjs-ffi.c`）

```c
#define QW_MAX_ARGS 10
#define QW_MAX_TYPES 16   /* 含 void…pointer，修 H2 边界 */

typedef enum {
  QW_T_VOID, QW_T_U8, QW_T_S8, QW_T_U16, QW_T_S16,
  QW_T_U32, QW_T_S32, QW_T_U64, QW_T_S64, QW_T_PTR, QW_T_HND,
  QW_T_BAD = -1
} QwType;

typedef enum { QW_ABI_WINAPI = 0, QW_ABI_CDECL = 1 } QwAbi;

/* 每个 wrapper：args 指针宽槽；返回装入 *out */
typedef intptr_t (*QwFn0)(void);
typedef intptr_t (*QwFn1)(intptr_t);
typedef intptr_t (*QwFn2)(intptr_t, intptr_t);
/* … QwFn10 … */

#define QW_CAST_ABI(abi, ...) \
  ((abi) == QW_ABI_CDECL ? (__typeof__((QwFn0)0)__VA_ARGS__) : (__typeof__((QwFn0)0)__VA_ARGS__))
/* 实际实现：按 abi 分两套 typedef 宏展开，见下 */

/* ia32 stdcall / cdecl / x64 统一用宏生成 qw_call_N */
static intptr_t qw_call(intptr_t fp, int argc, QwAbi abi, const intptr_t *a)
{
  switch (argc) {
  case 0: return ((QwFn0)fp)();
  case 1: return ((QwFn1)fp)(a[0]);
  case 2: return ((QwFn2)fp)(a[0], a[1]);
  /* … case 10 … */
  default: return 0; /* JS 层已限制 */
  }
}
```

**说明：**

- `intptr_t` 槽 = 指针宽；小端下低 4 字节即 ia32 的 int32/指针（与现 libffi 参数约定一致）。
- **ia32 ABI：** 用两套 typedef：
  - `typedef intptr_t (WINAPI *QwFn2S)(intptr_t, intptr_t);`
  - `typedef intptr_t (__cdecl *QwFn2C)(intptr_t, intptr_t);`
  - `qw_call` 按 `abi` 分支转型调用 → **编译器生成 `ret N` / 调用方清栈**，无需手写 asm。
- **x64/ARM64：** `WINAPI`/`__cdecl` 均被忽略，一套即可。
- **参数收集：** 与现 `ffiCall` 相同——`ptr` 若为 ArrayBuffer 则 `JS_GetArrayBuffer` 取址，否则 number；整型 `JS_ToInt64` 写入 `intptr_t` 槽（检查返回值，修 M2）。
- **`hnd` vs `u64`：** 收集阶段 `hnd`/`u64`/`ptr` 都进指针宽槽；ia32 上目标函数只读低 4 字节（cdecl/stdcall 栈槽对齐）——**与 ABI 自动一致，调用方不再选 UINT32/64**。

---

## 6. ARM64 Windows

| 维度 | x64 | ARM64 |
|------|-----|-------|
| 整型 | RCX,RDX,R8,R9 | **x0–x7** |
| 第 5+ | 栈 + 32B shadow | 栈（AAPCS64） |
| stdcall/cdecl | 忽略 | 忽略 |

- **int/ptr wrapper：ARM64 比 x64 更简单**（无 stdcall 分叉、无 shadow 细节）→ 方案 A 加 `#ifdef __aarch64__` 一套宏即可。  
- float/HFA/struct-by-value 才复杂 → Phase 3 再说。  
- **不引入动态代码**，规避 ACG / I-cache / Arm64EC。

---

## 7. 子集边界（明确不做什么）

| 形态 | 占比 | 方案 A |
|------|------|--------|
| int/BOOL/DWORD/HANDLE/LPCWSTR* | ~95%+ | ✅ |
| 指针指向结构体 | 普遍 | ✅ |
| float/double | 少 | ❌ → Phase 3 或回退 D/B |
| struct 按值 | 极少 | ❌ |
| varargs | 少 | ❌（可单独专用 wrapper） |
| callback | 中 | ❌（现状也不支持） |

超出子集：**JS 边界明确 throw**，不静默错调。

---

## 8. 分阶段执行计划

### Phase 0 — 与删 libffi 解耦（优先，可单独 PR）

**目标：** API 先变干净、修高危，后端暂仍 libffi。

| # | 改动 | 文件 |
|---|------|------|
| 0.1 | 定义 kind：`hnd/ptr/i32/…` + TS `TypeArg`/`Ret`/`BoundFn`（`quickwin.d.ts`） | `quickwin.d.ts` |
| 0.2 | 签名绑定 API：**`ffi.dlopen`**（已拍板）+ 解析缓存；`i64`/`u64` 策略 C | `quickjs-ffi.c` 或纯 TS `lib/ffi-bind.ts` |
| 0.3 | ABI 默认 winapi（C：`FFI_STDCALL` on i386，或仍 DEFAULT 但文档注明；真正换 backend 在 Phase 2） | `quickjs-ffi.c` |
| 0.4 | C 加固：type 边界、argc≤10、`JS_ToInt64` 检查、i32 符号扩展 | `quickjs-ffi.c` |
| 0.5 | 4 文件 UINT64 句柄 → `hnd`（或临时 `FFI_HND` 共享 helper） | ListView / pdf_preview2 / PdfCanvas / PathPicker |
| 0.6 | 可选：`loadProc` → `bind` 收敛 | 8 文件样板 |
| 0.7 | 回归 | `test_ffi.ts` + XP/Win7 QEMU `ffi` suite |

**验收：** XP gallery Statics 仍正常；`test_ffi` 通过；无新 UINT64 句柄。

### Phase 1 — Spike（不进主干）

| 验证 | 通过标准 |
|------|----------|
| 宏 wrapper：stdcall/cdecl × arity 0..10 × {void,i32,i64,ptr/hnd} | XP ia32 调 `EnumPrintersW`/`SelectObject`/`MessageBoxW`：不崩、栈平衡、**-1 返回正确** |
| 同套 x64 | 通过 |
| 盘点 31 处 `ffiCall` | float/struct/vararg = **0** |

- 失败 → **停 Phase 0**，长期 D（保 libffi，只修 ABI+缓存）。  
- 通过 → Phase 2。

### Phase 2 — 换后端、删 libffi ✅ 已完成

| # | 改动 | 文件 |
|---|------|------|
| 2.1 | 实现 `qw_call` + 宏 wrapper；`js_ffi_call` 改走新路径；自备 `FFI_TYPE_*` 数值（去 `#include <ffi.h>`）；删 `setBackend`/`getBackend` | `quickjs-ffi.c`、`quickjs-ffi.h`、`quickwin.d.ts` |
| 2.2 | 删 `$(LIBFFI)`、include、构建规则、CROSS_BUILD_LIBS | `Makefile` |
| 2.3 | 删 cache path ×2；hashFiles 去 `deps/libffi/**`；key `-v3`→`-v4` | `ci-qemu.yml` |
| 2.4 | 删 submodule | `.gitmodules`、`deps/libffi` |
| 2.5 | TS 全量迁字符串 kind；删 `FFI_TYPE_*` branded 常量与 spike 测试 | 8 文件 31 处 + `test_ffi_spike.ts` |
| 2.6 | float 等 throw（`qw_type_valid` 拒绝） | C/TS 边界 |
| 2.7 | 文档 | README、development-workflow、本文件、TODO、QEMU_NET_SUITE_TEST |

**验收：** `make cc64 cc32` 无 libffi；XP+Win7 全量 `http_test.sh`（`failed≤1`）；examples 手跑。

### Phase 3+ — 按需（YAGNI）

| 需求 | 动作 |
|------|------|
| float/double | x64/ARM64 加变体（ARM64 记 v0–v7） |
| callback | 固定签名 thunk / dyncallback / 最小 closures |
| varargs | 专用 wrapper |
| struct 按值 / 任意签名 | **回退 libffi 或全量 dyncall**，上层 API 不变 |

### ARM64（Phase 2 后）

- `qw_call` 加 `__aarch64__` 分支（x0–x7 + 栈）。  
- CI：交叉编译 + smoke。  
- 无动态代码。

---

## 9. 文件级改动清单（汇总）

### 必改（Phase 0）

| 文件 | 改什么 |
|------|--------|
| `quickwin.d.ts` | `ffi`：`FfiKind` 字符串、`hnd`、`dlopen`/`BoundFn` 推导、`i64\|bigint`；`FFI_TYPE_*` 标 deprecated |
| `quickjs-ffi.c` | 校验、符号扩展、可选 bind；Phase 2：换 `qw_call` |
| `lib/react-qw/components/ListView.tsx` | UINT64 → hnd（+ 结构体 ia32 另项 M1） |
| `examples/pdf_preview2.ts` | 同上 |
| `examples/PdfCanvas.tsx` | 同上 |
| `lib/react-qw/components/PathPicker.tsx` | 同上 |
| `lib/text-measure.ts` | 可改为 `hnd` 统一（可选，已修） |
| `test/test_ffi.ts` | 新 API + 负数返回断言 |

### Phase 2 额外

| 文件 | 改什么 |
|------|--------|
| `Makefile` | 去 libffi |
| `.github/workflows/ci-qemu.yml` | cache / hash |
| `.gitmodules` | 删 libffi |
| README / AGENTS / docs | 描述更新 |
| 其余 `ffiCall` 调用点 | 迁签名 API（若未做透明 backend） |

### 不动

- `bufferPtr` / `readByte` / `writeByte`
- `main.c` 的 `SetProcessDPIAware`（C 启动路径）
- `gui.GetScaleFactor` / `CreateSystemDpiFont`（C 内嵌）

---

## 10. 测试与验收

| 阶段 | 测试 |
|------|------|
| Phase 0 | `test_ffi` + XP `http_test.sh xp` + Win7；**gallery 截图** Statics auto-width |
| Phase 1 | Spike 脚本 XP+x64，断言返回值与栈 |
| Phase 2 | 全量 `http_test.sh` XP/Win7；examples：gallery、pdf_preview2、setres、PathPicker |
| 负数 | 新增：ia32 上 `ffiCall` 返回 -1 的断言（修 H3 回归） |
| 句柄 | 新增：`hnd` 在 ia32/x64 上 `GetDC`/`SelectObject` 往返 |

---

## 11. 风险与对策

| 风险 | 对策 |
|------|------|
| 漏 arity（>10） | Spike 前 grep 全 `ffiCall`；最大 9（SetDIBitsToDevice）；超限 throw |
| ia32 stdcall 清栈 | `WINAPI` typedef 让**编译器**生成；XP 实测 |
| 负数 | `RET_I32` 统一符号扩展 + 测试 |
| 透明换 backend 行为差 | Phase 2 并行 `QUICKWIN_FFI_LIBFFI` 开关一个版本周期 |
| 未来 float/struct | 文档写明回退 D/B，**上层 API 不动** |
| M1 结构体 ia32 | **独立任务**（与 FFI 后端解耦），不阻塞 Phase 0/2 |

---

## 12. 建议决策

| 问题 | 建议 |
|------|------|
| 是否删 libffi？ | Phase 0 先做；**Spike 过再删**（Phase 2） |
| 是否 dyncall？ | 仅 struct/callback 且不要 libffi 构建链时 |
| 是否 trampoline？ | **否** |
| ARM64？ | 方案 A 有利；Phase 2 后加 `__aarch64__` |
| API 放哪？ | **`ffi.dlopen`（已拍板）**；`win` 只留解析原语 |
| `i64`/`u64`？ | **策略 C 双模 `number \| bigint`**（对齐 `std.seek`） |
| 旧 `FFI_TYPE_*`？ | Phase 0 `@deprecated` 保留；Phase 2 调用点迁完后删 |
| 现在最小 PR？ | **Phase 0**：`hnd` + 签名 API + C 加载校验/符号扩展 + 清 4 文件 UINT64 |

---

## 13. 主要参考

- 仓库：`quickjs-ffi.c`、`quickwin.d.ts`、`test/test_ffi.ts`、`lib/text-measure.ts`、`main.c`（SetProcessDPIAware）、`Makefile`、`ci-qemu.yml`、`deps/libffi/src/x86/ffitarget.h`、`.agents/TODO.md`
- MS Learn：x64 / ARM64 calling convention、ARM64EC、ACG
- Node `ffi-fast-api-internals.md`；dyncall.org（XP 矩阵）；libffi `msvc_build/aarch64`
- Bun `bun:ffi`、Deno `Deno.dlopen`、shajunxing·quickjs-ffi、ratboy666·qjs-ffi、node-ffi#34、Mozilla bug 1358552
