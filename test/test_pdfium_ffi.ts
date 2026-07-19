/**
 * PDFium FFI 渲染示例 & 基准测试
 *
 * 本文件演示了如何通过 ffi.ffiCall 调用 pdfium.dll 原生的 C API 来渲染 PDF。
 * 不依赖任何 WASM 胶水层，直接通过 FFI 调用 native 代码。
 *
 * ── 前置条件 ──────────────────────────────────────────────────────
 *
 * 1. 下载 pdfium.dll（Windows x64）
 *    https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F7947
 *    下载 pdfium-win-x64.tgz，解压后将 pdfium.dll 放在 win.exe 同目录
 *
 * 2. 编译运行
 *    make js
 *    cd _build && win.exe test/test_pdfium_ffi.js [pdf文件名]
 *
 * ── FFI 类型系统（关键） ──────────────────────────────────────────
 *
 * 调用 C 函数时，每个参数需要指定类型，返回值也需要指定类型：
 *
 *   ffi.ffiCall(函数地址, [参数类型列表], [参数值列表], 返回值类型)
 *
 *   FFI_TYPE_POINTER  → 参数传 ArrayBuffer（自动取地址），返回值 number|null
 *   FFI_TYPE_UINT64   → 参数传 number（原样传递），    返回值 number
 *   FFI_TYPE_SINT32   → 参数传 number，                返回值 number
 *   FFI_TYPE_UINT32   → 参数传 number，                返回值 number
 *   FFI_TYPE_VOID     → 无参数/无返回值，              返回值 undefined
 *
 *   ⚠ 重要：指针句柄（如 FPDF_DOCUMENT、FPDF_PAGE、FPDF_BITMAP）
 *     是 ffiCall 返回的 number，传给下一个函数时用 FFI_TYPE_UINT64，
 *     不要用 FFI_TYPE_POINTER（那只用于传 ArrayBuffer 缓冲区）。
 *
 *   ⚠ 输出参数：如果 C 函数需要写入缓冲区（如 FPDF_GetPageSizeByIndex
 *     写 double 到指针），先创建 ArrayBuffer，用 FFI_TYPE_POINTER 传入。
 *
 * ── 支持的平台 ────────────────────────────────────────────────────
 *
 *   Windows 7/8/10/11 x64  ✅（bblanchon 版本禁用了 PartitionAlloc）
 *   Windows XP/Vista       ❌（Chromium 本身不支持）
 *   其他操作系统           ❌（需要对应平台的 pdfium 库）
 *
 * ── 性能参考（300 DPI） ───────────────────────────────────────────
 *
 *   example.pdf（1页纯文字）     ~10 ms
 *   irs1040.pdf（15页复杂表单）  ~400 ms （26.6 ms/页）
 *   imgtext.pdf（10页图文混排）  ~579 ms （图片密集页可达 120 ms/页）
 *   600 DPI 打印质量             ~34 ms/页
 */

import * as std from 'std'
import * as win from 'win'
import * as ffi from 'ffi'

// TextEncoder polyfill（QuickJS 不自带，由 lib/polyfill.js 提供）
import '../lib/polyfill.js'

// ── FFI 类型常量 ──────────────────────────────────────────────────
// 所有类型常量都是 branded number，TS 可以用 const 推断出精确字面量类型
const FFI_PTR = ffi.FFI_TYPE_POINTER   // void*：传 ArrayBuffer，返回 number|null
const FFI_U64 = ffi.FFI_TYPE_UINT64    // uint64_t：传 number（句柄值）
const FFI_S32 = ffi.FFI_TYPE_SINT32    // int32_t：传 number
const FFI_U32 = ffi.FFI_TYPE_UINT32    // uint32_t：传 number
const FFI_VOID = ffi.FFI_TYPE_VOID     // void：无返回值

// ── 辅助函数 ──────────────────────────────────────────────────────

// loadProc: 加载 DLL 导出函数，返回函数地址（number）
// 传入 null 检查+提前退出，确保 TypesScript 收窄到 number 类型
function loadProc(lib: win.HMODULE, name: string): number {
    const ptr = win.GetProcAddress(lib, name)
    if (!ptr) { std.printf('Error: cannot load %s\n', name); std.exit(1) }
    return ptr
}

// ── 加载 pdfium.dll ───────────────────────────────────────────────
// win.LoadLibrary 返回 HMODULE（number | null），用完不需 FreeLibrary
// 因为 DLL 整个进程生命周期内都保持加载

const hPdfium = win.LoadLibrary('pdfium.dll')
if (!hPdfium) { std.printf('Error: cannot load pdfium.dll\n'); std.exit(1) }

// ── 获取函数地址 ──────────────────────────────────────────────────
// 每个函数地址只需获取一次，所有调用都复用同一个 number 值

const FPDF_InitLibrary = loadProc(hPdfium, 'FPDF_InitLibrary')
const FPDF_DestroyLibrary = loadProc(hPdfium, 'FPDF_DestroyLibrary')
const FPDF_LoadDocument = loadProc(hPdfium, 'FPDF_LoadDocument')
const FPDF_CloseDocument = loadProc(hPdfium, 'FPDF_CloseDocument')
const FPDF_GetPageCount = loadProc(hPdfium, 'FPDF_GetPageCount')
const FPDF_LoadPage = loadProc(hPdfium, 'FPDF_LoadPage')
const FPDF_ClosePage = loadProc(hPdfium, 'FPDF_ClosePage')
const FPDF_GetPageSizeByIndex = loadProc(hPdfium, 'FPDF_GetPageSizeByIndex')
const FPDFBitmap_Create = loadProc(hPdfium, 'FPDFBitmap_Create')
const FPDFBitmap_Destroy = loadProc(hPdfium, 'FPDFBitmap_Destroy')
const FPDFBitmap_FillRect = loadProc(hPdfium, 'FPDFBitmap_FillRect')
const FPDFBitmap_GetBuffer = loadProc(hPdfium, 'FPDFBitmap_GetBuffer')
const FPDFBitmap_GetStride = loadProc(hPdfium, 'FPDFBitmap_GetStride')
const FPDF_RenderPageBitmap = loadProc(hPdfium, 'FPDF_RenderPageBitmap')
const FPDF_GetLastError = loadProc(hPdfium, 'FPDF_GetLastError')

// ── 命令行参数 ────────────────────────────────────────────────────
// scriptArgs[0] 是脚本自身路径，scriptArgs[1] 开始是用户参数

const fname = scriptArgs[1] ?? 'example.pdf'
std.printf('pdf: %s\n', fname)

// ═══════════════════════════════════════════════════════════════════
// PDFium 渲染流程
// ═══════════════════════════════════════════════════════════════════
//
// 1. FPDF_InitLibrary          — 初始化 PDFium 引擎
// 2. FPDF_LoadDocument         — 打开 PDF 文件，返回文档句柄
// 3. FPDF_GetPageCount         — 获取页数
// 4. for each page:
// 5.   FPDF_LoadPage           — 加载页面，返回页面句柄
// 6.   FPDF_GetPageSizeByIndex — 获取页面尺寸（通过输出参数）
// 7.   FPDFBitmap_Create       — 创建渲染目标位图
// 8.   FPDFBitmap_FillRect     — 清空位图（白色背景）
// 9.   FPDF_RenderPageBitmap   — 渲染页面到位图
// 10.  FPDFBitmap_GetBuffer    — 获取位图像素数据指针
// 11.  FPDFBitmap_GetStride    — 获取每行字节数
// 12.  RtlMoveMemory           — 从 GPU 内存拷贝像素数据到 JS
// 13.  FPDFBitmap_Destroy      — 释放位图
// 14.  FPDF_ClosePage          — 释放页面
// 15. FPDF_CloseDocument        — 关闭文档
// 16. FPDF_DestroyLibrary       — 反初始化 PDFium 引擎
// ═══════════════════════════════════════════════════════════════════

// ── 初始化 ────────────────────────────────────────────────────────
// FPDF_InitLibrary(void) → void
// 无参数，无返回值
ffi.ffiCall(FPDF_InitLibrary, [], [], FFI_VOID)

// ── 打开文档 ──────────────────────────────────────────────────────
// FPDF_LoadDocument(const char* path, const char* password) → FPDF_DOCUMENT
// 参数1：文件路径（UTF-8 编码，以 \0 结尾），用 ArrayBuffer 传入
// 参数2：密码（null 表示无密码）
// 返回值：FPDF_DOCUMENT 句柄（number），失败返回 null
//
// 模式：FFI_TYPE_POINTER 传 ArrayBuffer（自动取地址传指针）
const pdfPath = new TextEncoder().encode(fname + '\0').buffer
const doc = ffi.ffiCall(FPDF_LoadDocument, [FFI_PTR, FFI_PTR], [pdfPath, null], FFI_PTR)
if (doc === null) {
    const err = ffi.ffiCall(FPDF_GetLastError, [], [], FFI_U32)
    std.printf('FPDF_GetLastError = %d\n', err)
    ffi.ffiCall(FPDF_DestroyLibrary, [], [], FFI_VOID)
    std.exit(1)
}

// ── 获取页数 ──────────────────────────────────────────────────────
// FPDF_GetPageCount(FPDF_DOCUMENT) → int
// 模式：文档句柄是 number（前一步 ffiCall 返回的），用 FFI_TYPE_UINT64 传入
// 返回值：int → number
const pageCount = ffi.ffiCall(FPDF_GetPageCount, [FFI_U64], [doc], FFI_S32)
std.printf('pages: %d\n', pageCount)

const DPI = 300
const POINTS_PER_INCH = 72

let totalRenderMs = 0

// ── 逐页渲染 ──────────────────────────────────────────────────────
for (let pi = 0; pi < pageCount; pi++) {

    // ── 加载页面 ──────────────────────────────────────────────────
    // FPDF_LoadPage(FPDF_DOCUMENT, int page_index) → FPDF_PAGE
    const page = ffi.ffiCall(FPDF_LoadPage, [FFI_U64, FFI_S32], [doc, pi], FFI_PTR)
    if (page === null) {
        std.printf('page %d: failed to load\n', pi)
        continue
    }

    // ── 获取页面尺寸 ──────────────────────────────────────────────
    // FPDF_GetPageSizeByIndex(FPDF_DOCUMENT, int index, double* width, double* height) → int
    // 模式：输出参数通过 ArrayBuffer 传入，C 函数写入数据后从 ArrayBuffer 读取
    // 注意：width 和 height 必须用不同的 ArrayBuffer，不能共用
    const wBuf = new ArrayBuffer(8)
    const hBuf = new ArrayBuffer(8)
    ffi.ffiCall(FPDF_GetPageSizeByIndex, [FFI_U64, FFI_S32, FFI_PTR, FFI_PTR],
        [doc, pi, wBuf, hBuf], FFI_S32)
    const pw = new DataView(wBuf).getFloat64(0, true)  // 页面宽度（点）
    const ph = new DataView(hBuf).getFloat64(0, true)  // 页面高度（点）

    // 将点（1/72 英寸）转换为指定 DPI 的像素
    const bmpW = (pw / POINTS_PER_INCH * DPI) | 0
    const bmpH = (ph / POINTS_PER_INCH * DPI) | 0

    // ── 创建位图 ──────────────────────────────────────────────────
    // FPDFBitmap_Create(int width, int height, int alpha) → FPDF_BITMAP
    // alpha=1 表示 32 位 BGRA 格式
    const bmp = ffi.ffiCall(FPDFBitmap_Create, [FFI_S32, FFI_S32, FFI_S32], [bmpW, bmpH, 1], FFI_PTR)
    if (bmp === null) {
        ffi.ffiCall(FPDF_ClosePage, [FFI_U64], [page], FFI_VOID)
        continue
    }

    // ── 渲染基准 ──────────────────────────────────────────────────
    // 循环渲染 N 次取平均，消除单次抖动
    const N = 20
    const t0 = Date.now()
    for (let i = 0; i < N; i++) {
        // 清空为白色
        // FPDFBitmap_FillRect(FPDF_BITMAP, int left, int top, int width, int height, FPDF_DWORD color)
        ffi.ffiCall(FPDFBitmap_FillRect, [FFI_U64, FFI_S32, FFI_S32, FFI_S32, FFI_S32, FFI_U32],
            [bmp, 0, 0, bmpW, bmpH, 0xFFFFFFFF], FFI_VOID)

        // 渲染页面
        // FPDF_RenderPageBitmap(FPDF_BITMAP, FPDF_PAGE, int start_x, int start_y,
        //                        int size_x, int size_y, int rotate, int flags)
        ffi.ffiCall(FPDF_RenderPageBitmap, [FFI_U64, FFI_U64, FFI_S32, FFI_S32, FFI_S32, FFI_S32, FFI_S32, FFI_U32],
            [bmp, page, 0, 0, bmpW, bmpH, 0, 0], FFI_VOID)
    }
    const elapsed = Date.now() - t0
    const msPerPage = elapsed / N
    totalRenderMs += msPerPage
    std.printf('  page %d: %dx%d px, %.1f ms/render\n', pi, bmpW, bmpH, msPerPage)

    // ── 保存第一页为 BMP（用于视觉验证） ──────────────────────────
    if (pi === 0) {
        // FPDFBitmap_GetStride(FPDF_BITMAP) → int
        const stride = ffi.ffiCall(FPDFBitmap_GetStride, [FFI_U64], [bmp], FFI_S32)

        // FPDFBitmap_GetBuffer(FPDF_BITMAP) → void*
        // 返回位图像素数据指针（number|null）
        const ptr = ffi.ffiCall(FPDFBitmap_GetBuffer, [FFI_U64], [bmp], FFI_PTR)
        if (ptr !== null) {
            // 用 RtlMoveMemory 从原生内存拷贝到 JS ArrayBuffer
            // 因为 PDFium 的位图像素存在 DLL 内部管理的堆内存中，需要拷贝出来
            const hKernel32 = win.LoadLibrary('kernel32.dll')
            const RtlMoveMemory = loadProc(hKernel32!, 'RtlMoveMemory')
            const pixelSize = bmpH * stride
            const pixelBuf = new ArrayBuffer(pixelSize)
            ffi.ffiCall(RtlMoveMemory, [FFI_PTR, FFI_U64, FFI_U32],
                [pixelBuf, ptr, pixelSize], FFI_VOID)

            // 组装 BMP 文件头并写入磁盘
            // BGRA 32-bit BMP 格式：14 字节文件头 + 40 字节信息头 + 像素数据
            const headerSize = 14 + 40
            const fileSize = headerSize + pixelSize
            const bmpFile = new ArrayBuffer(fileSize)
            const bdv = new DataView(bmpFile)
            let off = 0
            bdv.setUint16(off, 0x4D42, true); off += 2   // 'BM' 签名
            bdv.setUint32(off, fileSize, true); off += 4 // 文件大小
            bdv.setUint32(off, 0, true); off += 4         // 保留
            bdv.setUint32(off, headerSize, true); off += 4 // 像素数据偏移
            bdv.setUint32(off, 40, true); off += 4        // 信息头大小
            bdv.setInt32(off, bmpW, true); off += 4       // 宽度
            bdv.setInt32(off, -bmpH, true); off += 4       // 高度（负值=从上到下）
            bdv.setUint16(off, 1, true); off += 2          // 颜色平面数
            bdv.setUint16(off, 32, true); off += 2         // 位深度
            bdv.setUint32(off, 0, true); off += 4           // 压缩方式
            bdv.setUint32(off, pixelSize, true); off += 4   // 像素数据大小
            bdv.setInt32(off, 2835, true); off += 4         // 水平分辨率 (DPI)
            bdv.setInt32(off, 2835, true); off += 4         // 垂直分辨率 (DPI)
            bdv.setUint32(off, 0, true); off += 4            // 调色板颜色数
            bdv.setUint32(off, 0, true); off += 4            // 重要颜色数
            new Uint8Array(bmpFile, headerSize).set(new Uint8Array(pixelBuf, 0, pixelSize))
            const f = std.open('output_pdfium.bmp', 'wb')
            if (f) {
                f.write(bmpFile, 0, fileSize)
                f.close()
                std.printf('  saved: output_pdfium.bmp (%d bytes, %dx%d)\n', fileSize, bmpW, bmpH)
            }
        }
    }

    // ── 清理本页资源 ──────────────────────────────────────────────
    ffi.ffiCall(FPDFBitmap_Destroy, [FFI_U64], [bmp], FFI_VOID)
    ffi.ffiCall(FPDF_ClosePage, [FFI_U64], [page], FFI_VOID)
}

// ── 全局清理 ──────────────────────────────────────────────────────
ffi.ffiCall(FPDF_CloseDocument, [FFI_U64], [doc], FFI_VOID)
ffi.ffiCall(FPDF_DestroyLibrary, [], [], FFI_VOID)
std.printf('total render: %.1f ms (%d pages)\n', totalRenderMs, pageCount)