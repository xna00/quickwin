import * as std from 'std'
import * as win from 'win'
import * as ffi from 'ffi'
import '../lib/polyfill.js'

// pdfium.dll: Windows x64, Chromium 7947 (PDFium 152.0.7947.0)
// https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F7947

const FFI_PTR = ffi.FFI_TYPE_POINTER
const FFI_U64 = ffi.FFI_TYPE_UINT64
const FFI_S32 = ffi.FFI_TYPE_SINT32
const FFI_U32 = ffi.FFI_TYPE_UINT32
const FFI_VOID = ffi.FFI_TYPE_VOID

function loadProc(lib: win.HMODULE, name: string): number {
    const ptr = win.GetProcAddress(lib, name)
    if (!ptr) { std.printf('Error: cannot load %s\n', name); std.exit(1) }
    return ptr
}

const hPdfium = win.LoadLibrary('pdfium.dll')
if (!hPdfium) { std.printf('Error: cannot load pdfium.dll\n'); std.exit(1) }

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
const FPDF_GetPageSizeByIndexFn = FPDF_GetPageSizeByIndex

const fname = scriptArgs[1] ?? 'example.pdf'
std.printf('pdf: %s\n', fname)

ffi.ffiCall(FPDF_InitLibrary, [], [], FFI_VOID)

const pdfPath = new TextEncoder().encode(fname + '\0').buffer
const doc = ffi.ffiCall(FPDF_LoadDocument, [FFI_PTR, FFI_PTR], [pdfPath, null], FFI_PTR)
if (doc === null) {
    const err = ffi.ffiCall(FPDF_GetLastError, [], [], FFI_U32)
    std.printf('FPDF_GetLastError = %d\n', err)
    ffi.ffiCall(FPDF_DestroyLibrary, [], [], FFI_VOID)
    std.exit(1)
}

const pageCount = ffi.ffiCall(FPDF_GetPageCount, [FFI_U64], [doc], FFI_S32)
std.printf('pages: %d\n', pageCount)

const DPI = 300
const POINTS_PER_INCH = 72

let totalRenderMs = 0

for (let pi = 0; pi < pageCount; pi++) {
    const page = ffi.ffiCall(FPDF_LoadPage, [FFI_U64, FFI_S32], [doc, pi], FFI_PTR)
    if (page === null) {
        std.printf('page %d: failed to load\n', pi)
        continue
    }

    const wBuf = new ArrayBuffer(8)
    const hBuf = new ArrayBuffer(8)
    ffi.ffiCall(FPDF_GetPageSizeByIndexFn, [FFI_U64, FFI_S32, FFI_PTR, FFI_PTR],
        [doc, pi, wBuf, hBuf], FFI_S32)
    const pw = new DataView(wBuf).getFloat64(0, true)
    const ph = new DataView(hBuf).getFloat64(0, true)

    const bmpW = (pw / POINTS_PER_INCH * DPI) | 0
    const bmpH = (ph / POINTS_PER_INCH * DPI) | 0

    const bmp = ffi.ffiCall(FPDFBitmap_Create, [FFI_S32, FFI_S32, FFI_S32], [bmpW, bmpH, 1], FFI_PTR)
    if (bmp === null) {
        ffi.ffiCall(FPDF_ClosePage, [FFI_U64], [page], FFI_VOID)
        continue
    }

    const N = 20
    const t0 = Date.now()
    for (let i = 0; i < N; i++) {
        ffi.ffiCall(FPDFBitmap_FillRect, [FFI_U64, FFI_S32, FFI_S32, FFI_S32, FFI_S32, FFI_U32],
            [bmp, 0, 0, bmpW, bmpH, 0xFFFFFFFF], FFI_VOID)
        ffi.ffiCall(FPDF_RenderPageBitmap, [FFI_U64, FFI_U64, FFI_S32, FFI_S32, FFI_S32, FFI_S32, FFI_S32, FFI_U32],
            [bmp, page, 0, 0, bmpW, bmpH, 0, 0], FFI_VOID)
    }
    const elapsed = Date.now() - t0
    const msPerPage = elapsed / N
    totalRenderMs += msPerPage
    std.printf('  page %d: %dx%d px, %.1f ms/render\n', pi, bmpW, bmpH, msPerPage)

    if (pi === 0) {
        const stride = ffi.ffiCall(FPDFBitmap_GetStride, [FFI_U64], [bmp], FFI_S32)
        const ptr = ffi.ffiCall(FPDFBitmap_GetBuffer, [FFI_U64], [bmp], FFI_PTR)
        if (ptr !== null) {
            const hKernel32 = win.LoadLibrary('kernel32.dll')
            const RtlMoveMemory = loadProc(hKernel32!, 'RtlMoveMemory')
            const pixelSize = bmpH * stride
            const pixelBuf = new ArrayBuffer(pixelSize)
            ffi.ffiCall(RtlMoveMemory, [FFI_PTR, FFI_U64, FFI_U32], [pixelBuf, ptr, pixelSize], FFI_VOID)

            const headerSize = 14 + 40
            const fileSize = headerSize + pixelSize
            const bmpFile = new ArrayBuffer(fileSize)
            const bdv = new DataView(bmpFile)
            let off = 0
            bdv.setUint16(off, 0x4D42, true); off += 2
            bdv.setUint32(off, fileSize, true); off += 4
            bdv.setUint32(off, 0, true); off += 4
            bdv.setUint32(off, headerSize, true); off += 4
            bdv.setUint32(off, 40, true); off += 4
            bdv.setInt32(off, bmpW, true); off += 4
            bdv.setInt32(off, -bmpH, true); off += 4
            bdv.setUint16(off, 1, true); off += 2
            bdv.setUint16(off, 32, true); off += 2
            bdv.setUint32(off, 0, true); off += 4
            bdv.setUint32(off, pixelSize, true); off += 4
            bdv.setInt32(off, 2835, true); off += 4
            bdv.setInt32(off, 2835, true); off += 4
            bdv.setUint32(off, 0, true); off += 4
            bdv.setUint32(off, 0, true); off += 4
            new Uint8Array(bmpFile, headerSize).set(new Uint8Array(pixelBuf, 0, pixelSize))
            const f = std.open('output_pdfium.bmp', 'wb')
            if (f) {
                f.write(bmpFile, 0, fileSize)
                f.close()
                std.printf('  saved: output_pdfium.bmp (%d bytes, %dx%d)\n', fileSize, bmpW, bmpH)
            }
        }
    }

    ffi.ffiCall(FPDFBitmap_Destroy, [FFI_U64], [bmp], FFI_VOID)
    ffi.ffiCall(FPDF_ClosePage, [FFI_U64], [page], FFI_VOID)
}

ffi.ffiCall(FPDF_CloseDocument, [FFI_U64], [doc], FFI_VOID)
ffi.ffiCall(FPDF_DestroyLibrary, [], [], FFI_VOID)
std.printf('total render: %.1f ms (%d pages)\n', totalRenderMs, pageCount)