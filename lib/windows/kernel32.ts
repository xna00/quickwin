// kernel32.dll 绑定（进程 / 管道 / 系统信息子集；品牌约定见 lib/windows/user32.ts 头注释）：
//   - HANDLE（管道 / 进程 / 线程等内核对象句柄）保持 <>ptr：与 gdi32 的 HGDIOBJ 同理，
//     异种对象互传由运行时句柄有效性判定，类型层不设品牌
//   - 结构位（STARTUPINFOW / PROCESS_INFORMATION / SYSTEM_INFO）一律 <>ptr 收 ffi.bufferPtr(buf)：
//     这几个结构的布局由「调用进程位数」决定（WOW64 下 os.arch 报系统原生架构，与进程位数不一致），
//     调用方按进程位数自管 buffer 与偏移，故不在 ./structs.ts 注册定义
//   - 空指针位（lpApplicationName / lpProcessAttributes 等）传 NULL（来自 ../ffi/ctype.js）；
//     传 JS null/undefined 会在参数槽 fail-loud
//   - 返回值 0 保真（C→JS 不做 0→null）；BOOL 型返回 i32，成功 → 非 0，失败 → 0（原因见 GetLastError）
import { bind, type CodecMap } from '../ffi/bind.js'

// dll 名部分应用（工厂转调保泛型 infer，见 lib/windows/user32.ts 头注释）
const b = <const S extends string, const LE extends CodecMap = {}>(name: string, sig: S, encoders?: LE) =>
    bind('kernel32.dll', name, sig, encoders)

// ============ 管道 / 进程 ============

/** 建匿名管道；hReadPipe / hWritePipe 为两个 HANDLE 出参槽（各占一个指针宽度），
 *  lpPipeAttributes 传 NULL；nSize 传 0 用默认缓冲；成功 → 非 0 */
export const CreatePipe = /*@__PURE__*/ b('CreatePipe', '<>ptr <>ptr <>ptr u32 -> i32')
/** 设句柄标志（dwMask / dwFlags 如 HANDLE_FLAG_INHERIT = 1）；成功 → 非 0 */
export const SetHandleInformation = /*@__PURE__*/ b('SetHandleInformation', '<>ptr u32 u32 -> i32')
/** 建进程（lpApplicationName / lpCommandLine 为 string 或 NULL；lpStartupInfo = STARTUPINFOW 缓冲、
 *  lpProcessInformation = PROCESS_INFORMATION 出参缓冲，均传 ffi.bufferPtr；
 *  bInheritHandles 非 0 继承句柄）；成功 → 非 0 */
export const CreateProcess = /*@__PURE__*/ b('CreateProcessW',
    '<WCHAR>ptr <WCHAR>ptr <>ptr <>ptr i32 u32 <>ptr <WCHAR>ptr <>ptr <>ptr -> i32')
/** 等内核对象就绪（dwMilliseconds = 0xffffffff 无限等）；返回 WAIT_* 码 */
export const WaitForSingleObject = /*@__PURE__*/ b('WaitForSingleObject', '<>ptr u32 -> u32')
/** 取进程退出码到 lpExitCode（DWORD 出参槽）；成功 → 非 0 */
export const GetExitCodeProcess = /*@__PURE__*/ b('GetExitCodeProcess', '<>ptr <>ptr -> i32')
/** 关闭内核对象句柄；成功 → 非 0 */
export const CloseHandle = /*@__PURE__*/ b('CloseHandle', '<>ptr -> i32')

// ============ 文件 I/O ============

/** 同步读文件 / 管道到 lpBuffer（lpNumberOfBytesRead 为 DWORD 出参槽，lpOverlapped 传 NULL / 0）；
 *  成功 → 非 0，管道写端全部关闭后读返回 0（EOF） */
export const ReadFile = /*@__PURE__*/ b('ReadFile', '<>ptr <>ptr u32 <>ptr <>ptr -> i32')

// ============ 系统 / 错误 ============

/** 取调用线程最近一次 Win32 错误码 */
export const GetLastError = /*@__PURE__*/ b('GetLastError', ' -> u32')
/** 取 System32 目录路径（宽字符）到 lpBuffer，uSize 为缓冲 WCHAR 数；返回写入的字符数（不含 NUL，0 失败） */
export const GetSystemDirectory = /*@__PURE__*/ b('GetSystemDirectoryW', '<>ptr u32 -> u32')
/** 取系统信息到 SYSTEM_INFO 缓冲；WOW64 下报告「进程视角」架构（32 位进程得 PROCESSOR_ARCHITECTURE_INTEL = 0） */
export const GetSystemInfo = /*@__PURE__*/ b('GetSystemInfo', '<>ptr -> void')
