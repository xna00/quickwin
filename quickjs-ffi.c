#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include "quickjs.h"
#include "quickjs-ffi.h"

/* 内部类型 ID；不导出 JS */
enum {
    QW_T_VOID = 0,
    QW_T_UINT8,
    QW_T_SINT8,
    QW_T_UINT16,
    QW_T_SINT16,
    QW_T_UINT32,
    QW_T_SINT32,
    QW_T_UINT64,
    QW_T_SINT64,
    QW_T_POINTER,
    QW_T_HND,
};

#define QW_MAX_ARGS 16
#define QW_MAX_BOUNDS 256

#if defined(_M_IX86) || defined(__i386__)
#define QW_IS_IA32 1
#else
#define QW_IS_IA32 0
#endif

#if QW_IS_IA32
#define QW_SAPI __stdcall
#define QW_CAPI __cdecl
#else
#define QW_SAPI
#define QW_CAPI
#endif

static int qw_type_valid(int t)
{
    switch (t)
    {
    case QW_T_VOID:
    case QW_T_UINT8:
    case QW_T_SINT8:
    case QW_T_UINT16:
    case QW_T_SINT16:
    case QW_T_UINT32:
    case QW_T_SINT32:
    case QW_T_UINT64:
    case QW_T_SINT64:
    case QW_T_POINTER:
    case QW_T_HND:
        return 1;
    default:
        return 0;
    }
}

static int qw_kind_from_str(const char *s)
{
    if (!strcmp(s, "void")) return QW_T_VOID;
    if (!strcmp(s, "u8")) return QW_T_UINT8;
    if (!strcmp(s, "i8")) return QW_T_SINT8;
    if (!strcmp(s, "u16")) return QW_T_UINT16;
    if (!strcmp(s, "i16")) return QW_T_SINT16;
    if (!strcmp(s, "u32")) return QW_T_UINT32;
    if (!strcmp(s, "i32")) return QW_T_SINT32;
    if (!strcmp(s, "u64")) return QW_T_UINT64;
    if (!strcmp(s, "i64")) return QW_T_SINT64;
    if (!strcmp(s, "ptr")) return QW_T_POINTER;
    if (!strcmp(s, "hnd")) return QW_T_HND;
    return -1;
}

/* 解析类型：仅字符串 kind */
static int qw_parse_type(JSContext *ctx, JSValueConst v, int *out)
{
    if (!JS_IsString(v))
    {
        JS_ThrowTypeError(ctx, "FFI kind must be a string");
        return -1;
    }
    const char *s = JS_ToCString(ctx, v);
    if (!s)
        return -1;
    int t = qw_kind_from_str(s);
    JS_FreeCString(ctx, s);
    if (t < 0)
    {
        JS_ThrowRangeError(ctx, "unknown FFI kind");
        return -1;
    }
    *out = t;
    return 0;
}

static int qw_abi_from_js(JSContext *ctx, JSValueConst v, int *out)
{
    if (JS_IsUndefined(v) || JS_IsNull(v))
    {
        *out = 0; /* 默认 winapi */
        return 0;
    }
    if (JS_IsString(v))
    {
        const char *s = JS_ToCString(ctx, v);
        if (!s)
            return -1;
        if (!strcmp(s, "winapi") || !strcmp(s, "stdcall"))
            *out = 0;
        else if (!strcmp(s, "cdecl"))
            *out = 1;
        else
        {
            JS_FreeCString(ctx, s);
            JS_ThrowRangeError(ctx, "abi must be 'winapi' or 'cdecl'");
            return -1;
        }
        JS_FreeCString(ctx, s);
        return 0;
    }
    int64_t n;
    if (JS_ToInt64(ctx, &n, v) < 0)
        return -1;
    *out = n ? 1 : 0;
    return 0;
}

/* 收集参数到 int64 槽；成功返回 0，失败已抛异常返回 -1 */
static int qw_collect_args(JSContext *ctx, int argc_in, const int *arg_types,
                           JSValueConst *argv, int64_t *slots)
{
    for (int i = 0; i < argc_in; i++)
    {
        int at = arg_types[i];
        JSValue js_arg = argv[i];
        if (at == QW_T_POINTER)
        {
            if (JS_IsNull(js_arg) || JS_IsUndefined(js_arg))
            {
                slots[i] = 0;
            }
            else
            {
                size_t size;
                void *p = JS_GetArrayBuffer(ctx, &size, js_arg);
                if (!p && JS_HasException(ctx))
                    return -1;
                slots[i] = (int64_t)(intptr_t)p;
            }
        }
        else if (JS_IsBigInt(ctx, js_arg))
        {
            if (JS_ToBigInt64(ctx, &slots[i], js_arg) < 0)
                return -1;
        }
        else
        {
            if (JS_ToInt64(ctx, &slots[i], js_arg) < 0)
                return -1;
        }
    }
    return 0;
}

static JSValue qw_make_return(JSContext *ctx, int ret_type, uint64_t ret)
{
    if (ret_type == QW_T_VOID)
        return JS_UNDEFINED;
    if (ret_type == QW_T_POINTER && ret == 0)
        return JS_NULL;
    /* HND：0 保持 0（句柄语义），不映射 null */
    if (ret_type == QW_T_SINT8)
        return JS_NewInt32(ctx, (int8_t)(uint8_t)ret);
    if (ret_type == QW_T_SINT16)
        return JS_NewInt32(ctx, (int16_t)(uint16_t)ret);
    if (ret_type == QW_T_SINT32)
        return JS_NewInt32(ctx, (int32_t)(uint32_t)ret);
    if (ret_type == QW_T_UINT8)
        return JS_NewUint32(ctx, (uint8_t)ret);
    if (ret_type == QW_T_UINT16)
        return JS_NewUint32(ctx, (uint16_t)ret);
    if (ret_type == QW_T_UINT32)
        return JS_NewUint32(ctx, (uint32_t)ret);
    return JS_NewInt64(ctx, (int64_t)ret);
}

/* ── 纯 C 固定签名 wrapper（唯一调用后端） ── */

/* 公共 arity 表：RET=返回类型，K=语句包装（void 不能 return 调用结果） */
#define QW_CASES(ABI, RET, K) \
    case 0: K(((RET (ABI *)(void))fp)()); \
    case 1: K(((RET (ABI *)(intptr_t))fp)(a[0])); \
    case 2: K(((RET (ABI *)(intptr_t, intptr_t))fp)(a[0], a[1])); \
    case 3: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2])); \
    case 4: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3])); \
    case 5: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4])); \
    case 6: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5])); \
    case 7: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6])); \
    case 8: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7])); \
    case 9: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8])); \
    case 10: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9])); \
    case 11: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10])); \
    case 12: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11])); \
    case 13: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12])); \
    case 14: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13])); \
    case 15: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], a[14])); \
    case 16: K(((RET (ABI *)(intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t, intptr_t))fp)(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], a[14], a[15]));

#define QW_K_RET(e)  return e
#define QW_K_VOID(e) e; return 0

#define QW_CASES_VAL(ABI)  QW_CASES(ABI, intptr_t, QW_K_RET)
#define QW_CASES_VOID(ABI) QW_CASES(ABI, void,     QW_K_VOID)

static intptr_t qw_call_raw(void *fp, int n, int abi_cdecl, int is_void,
                            const intptr_t *a)
{
    if (n < 0 || n > QW_MAX_ARGS)
        return 0;
#if QW_IS_IA32
    if (abi_cdecl)
    {
        if (is_void)
            switch (n) { QW_CASES_VOID(QW_CAPI) }
        else
            switch (n) { QW_CASES_VAL(QW_CAPI) }
    }
    else
    {
        if (is_void)
            switch (n) { QW_CASES_VOID(QW_SAPI) }
        else
            switch (n) { QW_CASES_VAL(QW_SAPI) }
    }
#else
    (void)abi_cdecl;
    if (is_void)
        switch (n) { QW_CASES_VOID(QW_SAPI) }
    else
        switch (n) { QW_CASES_VAL(QW_SAPI) }
#endif
    return 0;
}

/* ia32：i64/u64 占 8 字节栈槽，intptr_t wrapper 无法正确传参 */
static int qw_call_eligible(int n, const int *arg_types, int ret_type)
{
#if QW_IS_IA32
    if (ret_type == QW_T_SINT64 || ret_type == QW_T_UINT64)
        return 0;
    for (int i = 0; i < n; i++)
    {
        if (arg_types[i] == QW_T_SINT64 || arg_types[i] == QW_T_UINT64)
            return 0;
    }
#else
    (void)n;
    (void)arg_types;
    (void)ret_type;
#endif
    return 1;
}

static JSValue qw_do_call(JSContext *ctx, void *func, int n_args,
                          const int *arg_types, int ret_type, int abi_cdecl,
                          JSValueConst *argv)
{
    if (n_args < 0 || n_args > QW_MAX_ARGS)
        return JS_ThrowRangeError(ctx, "ffi arg count out of range");
    if (!qw_type_valid(ret_type))
        return JS_ThrowRangeError(ctx, "invalid FFI return type");

    int64_t slots[QW_MAX_ARGS];
    memset(slots, 0, sizeof(slots));

    for (int i = 0; i < n_args; i++)
    {
        if (!qw_type_valid(arg_types[i]))
            return JS_ThrowRangeError(ctx, "invalid FFI argument type");
    }

    if (!qw_call_eligible(n_args, arg_types, ret_type))
        return JS_ThrowRangeError(ctx, "i64/u64 not supported on ia32");

    if (qw_collect_args(ctx, n_args, arg_types, argv, slots) < 0)
        return JS_EXCEPTION;

    intptr_t a[QW_MAX_ARGS];
    for (int i = 0; i < n_args; i++)
        a[i] = (intptr_t)slots[i];
    intptr_t raw = qw_call_raw(func, n_args, abi_cdecl,
                               ret_type == QW_T_VOID, a);
    uint64_t ret = (uint64_t)(uintptr_t)raw;

    if (JS_HasException(ctx))
        return JS_EXCEPTION;
    return qw_make_return(ctx, ret_type, ret);
}

/**
 * argv: func, argTypes[], args[], retType[, abi]
 * argTypes / retType 元素为 'hnd'/'ptr'/'i32'… 字符串 kind
 */
JSValue js_ffi_call(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 4)
        return JS_ThrowTypeError(ctx, "ffiCall(func, argTypes, args, retType[, abi])");

    int64_t _func;
    if (JS_ToInt64(ctx, &_func, argv[0]) < 0)
        return JS_EXCEPTION;
    void *func = (void *)(intptr_t)_func;

    int64_t length;
    JSValue len = JS_GetPropertyStr(ctx, argv[1], "length");
    if (JS_ToInt64(ctx, &length, len) < 0)
    {
        JS_FreeValue(ctx, len);
        return JS_EXCEPTION;
    }
    JS_FreeValue(ctx, len);
    if (length < 0 || length > QW_MAX_ARGS)
        return JS_ThrowRangeError(ctx, "ffi arg count out of range");

    int ret_type;
    if (qw_parse_type(ctx, argv[3], &ret_type) < 0)
        return JS_EXCEPTION;

    int abi_cdecl = 0;
    if (argc > 4 && qw_abi_from_js(ctx, argv[4], &abi_cdecl) < 0)
        return JS_EXCEPTION;

    int arg_types[QW_MAX_ARGS];
    for (int i = 0; i < (int)length; i++)
    {
        JSValue js_at = JS_GetPropertyUint32(ctx, argv[1], (uint32_t)i);
        int t;
        int rc = qw_parse_type(ctx, js_at, &t);
        JS_FreeValue(ctx, js_at);
        if (rc < 0)
            return JS_EXCEPTION;
        arg_types[i] = t;
    }

    JSValue args_arr = argv[2];
    JSValue alen_v = JS_GetPropertyStr(ctx, args_arr, "length");
    int64_t alen;
    if (JS_ToInt64(ctx, &alen, alen_v) < 0)
    {
        JS_FreeValue(ctx, alen_v);
        return JS_EXCEPTION;
    }
    JS_FreeValue(ctx, alen_v);
    if (alen != length)
        return JS_ThrowRangeError(ctx, "ffiCall args length mismatch");

    JSValue arg_vals[QW_MAX_ARGS];
    for (int i = 0; i < (int)length; i++)
        arg_vals[i] = JS_GetPropertyUint32(ctx, args_arr, (uint32_t)i);

    JSValue ret = qw_do_call(ctx, func, (int)length, arg_types, ret_type,
                             abi_cdecl, arg_vals);

    for (int i = 0; i < (int)length; i++)
        JS_FreeValue(ctx, arg_vals[i]);
    return ret;
}

/* ── dlopen：签名声明一次 ── */

typedef struct
{
    void *fp;
    int n_args;
    int arg_types[QW_MAX_ARGS];
    int ret_type;
    int abi_cdecl;
} QwBoundFn;

static QwBoundFn qw_bounds[QW_MAX_BOUNDS];
static int qw_bound_count = 0;

static JSValue js_ffi_bound_call(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv,
                                 int magic, JSValue *func_data)
{
    (void)this_val;
    (void)func_data;
    if (magic < 0 || magic >= qw_bound_count)
        return JS_ThrowRangeError(ctx, "invalid bound FFI function");
    QwBoundFn *fn = &qw_bounds[magic];
    if (argc != fn->n_args)
        return JS_ThrowRangeError(ctx, "bound FFI function arity mismatch");
    return qw_do_call(ctx, fn->fp, fn->n_args, fn->arg_types, fn->ret_type,
                      fn->abi_cdecl, argv);
}

static wchar_t *qw_utf8_to_wide(const char *utf8)
{
    int len = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
    wchar_t *w = (wchar_t *)malloc((size_t)len * sizeof(wchar_t));
    if (w)
        MultiByteToWideChar(CP_UTF8, 0, utf8, -1, w, len);
    return w;
}

static int qw_parse_sig(JSContext *ctx, JSValueConst sig, QwBoundFn *fn)
{
    JSValue args_v = JS_GetPropertyStr(ctx, sig, "args");
    if (JS_IsException(args_v))
        return -1;
    JSValue ret_v = JS_GetPropertyStr(ctx, sig, "returns");
    if (JS_IsException(ret_v))
    {
        JS_FreeValue(ctx, args_v);
        return -1;
    }

    int rc = -1;
    int64_t n = 0;
    JSValue len_v = JS_GetPropertyStr(ctx, args_v, "length");
    if (JS_IsException(len_v))
        goto done;
    if (JS_ToInt64(ctx, &n, len_v) < 0)
    {
        JS_FreeValue(ctx, len_v);
        goto done;
    }
    JS_FreeValue(ctx, len_v);

    if (n < 0 || n > QW_MAX_ARGS)
    {
        JS_ThrowRangeError(ctx, "dlopen sig args out of range");
        goto done;
    }
    fn->n_args = (int)n;
    for (int i = 0; i < fn->n_args; i++)
    {
        JSValue at = JS_GetPropertyUint32(ctx, args_v, (uint32_t)i);
        int t;
        if (qw_parse_type(ctx, at, &t) < 0)
        {
            JS_FreeValue(ctx, at);
            goto done;
        }
        JS_FreeValue(ctx, at);
        if (!qw_type_valid(t))
        {
            JS_ThrowRangeError(ctx, "invalid FFI argument type in dlopen sig");
            goto done;
        }
        fn->arg_types[i] = t;
    }
    if (qw_parse_type(ctx, ret_v, &fn->ret_type) < 0)
        goto done;
    if (!qw_type_valid(fn->ret_type))
    {
        JS_ThrowRangeError(ctx, "invalid FFI return type in dlopen sig");
        goto done;
    }
    rc = 0;
done:
    JS_FreeValue(ctx, args_v);
    JS_FreeValue(ctx, ret_v);
    return rc;
}

/**
 * dlopen(libName, { name: { args: [...], returns: '...' } [, abi?: 'winapi'|'cdecl'] })
 * 第三参可选 abi 字符串。返回 { name: boundFn, ... }
 */
JSValue js_ffi_dlopen(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 2)
        return JS_ThrowTypeError(ctx, "dlopen(libName, sigs[, abi])");

    const char *lib_name = JS_ToCString(ctx, argv[0]);
    if (!lib_name)
        return JS_EXCEPTION;
    wchar_t *wlib = qw_utf8_to_wide(lib_name);
    JS_FreeCString(ctx, lib_name);
    if (!wlib)
        return JS_ThrowOutOfMemory(ctx);
    HMODULE hmod = LoadLibraryW(wlib);
    free(wlib);
    if (!hmod)
        return JS_ThrowInternalError(ctx, "LoadLibrary failed");

    int abi_cdecl = 0;
    if (argc > 2 && qw_abi_from_js(ctx, argv[2], &abi_cdecl) < 0)
        return JS_EXCEPTION;

    JSValue sigs = argv[1];
    JSPropertyEnum *tab = NULL;
    uint32_t tab_len = 0;
    if (JS_GetOwnPropertyNames(ctx, &tab, &tab_len, sigs,
                               JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0)
        return JS_EXCEPTION;

    JSValue result = JS_NewObject(ctx);
    if (JS_IsException(result))
    {
        JS_FreePropertyEnum(ctx, tab, tab_len);
        return JS_EXCEPTION;
    }

    for (uint32_t i = 0; i < tab_len; i++)
    {
        const char *name = JS_AtomToCString(ctx, tab[i].atom);
        if (!name)
            goto fail;
        FARPROC proc = GetProcAddress(hmod, name);
        if (!proc)
        {
            JS_ThrowInternalError(ctx, "GetProcAddress failed: %s", name);
            JS_FreeCString(ctx, name);
            goto fail;
        }
        JSValue sig = JS_GetProperty(ctx, sigs, tab[i].atom);
        if (JS_IsException(sig))
        {
            JS_FreeCString(ctx, name);
            goto fail;
        }
        if (qw_bound_count >= QW_MAX_BOUNDS)
        {
            JS_FreeValue(ctx, sig);
            JS_FreeCString(ctx, name);
            JS_ThrowInternalError(ctx, "too many bound FFI functions");
            goto fail;
        }
        QwBoundFn *fn = &qw_bounds[qw_bound_count];
        memset(fn, 0, sizeof(*fn));
        fn->fp = (void *)proc;
        fn->abi_cdecl = abi_cdecl;
        if (qw_parse_sig(ctx, sig, fn) < 0)
        {
            JS_FreeValue(ctx, sig);
            JS_FreeCString(ctx, name);
            goto fail;
        }
        JS_FreeValue(ctx, sig);

        int magic = qw_bound_count;
        JSValue bound = JS_NewCFunctionData(ctx, js_ffi_bound_call,
                                            fn->n_args, magic, 0, NULL);
        if (JS_IsException(bound))
        {
            JS_FreeCString(ctx, name);
            goto fail;
        }
        if (JS_SetPropertyStr(ctx, result, name, bound) < 0)
        {
            JS_FreeValue(ctx, bound);
            JS_FreeCString(ctx, name);
            goto fail;
        }
        JS_FreeCString(ctx, name);
        qw_bound_count++;
    }

    JS_FreePropertyEnum(ctx, tab, tab_len);
    return result;

fail:
    JS_FreePropertyEnum(ctx, tab, tab_len);
    JS_FreeValue(ctx, result);
    return JS_EXCEPTION;
}

static JSValue js_ffi_buffer_ptr(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    size_t size;
    void *ptr = JS_GetArrayBuffer(ctx, &size, argv[0]);
    if (!ptr)
        return JS_ThrowTypeError(ctx, "argument must be an ArrayBuffer");
    return JS_NewInt64(ctx, (int64_t)(intptr_t)ptr);
}

static JSValue js_ffi_read_byte(JSContext *ctx, JSValueConst this_val,
                                int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    int64_t ptr;
    if (JS_ToInt64(ctx, &ptr, argv[0]) < 0)
        return JS_EXCEPTION;
    return JS_NewInt32(ctx, *(uint8_t *)(intptr_t)ptr);
}

static JSValue js_ffi_write_byte(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    int64_t ptr, val;
    if (JS_ToInt64(ctx, &ptr, argv[0]) < 0)
        return JS_EXCEPTION;
    if (JS_ToInt64(ctx, &val, argv[1]) < 0)
        return JS_EXCEPTION;
    *(uint8_t *)(intptr_t)ptr = (uint8_t)val;
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry ffi_funcs[] = {
    JS_CFUNC_DEF("ffiCall", 5, js_ffi_call),
    JS_CFUNC_DEF("dlopen", 3, js_ffi_dlopen),
    JS_CFUNC_DEF("bufferPtr", 1, js_ffi_buffer_ptr),
    JS_CFUNC_DEF("readByte", 1, js_ffi_read_byte),
    JS_CFUNC_DEF("writeByte", 2, js_ffi_write_byte),
};

static int js_ffi_init(JSContext *ctx, JSModuleDef *m)
{
    JS_SetModuleExportList(ctx, m, ffi_funcs, sizeof(ffi_funcs) / sizeof(ffi_funcs[0]));
    return 0;
}

JSModuleDef *js_init_module_ffi(JSContext *ctx)
{
    JSModuleDef *m;
    m = JS_NewCModule(ctx, "ffi", js_ffi_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, ffi_funcs, sizeof(ffi_funcs) / sizeof(ffi_funcs[0]));
    return m;
}
