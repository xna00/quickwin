/* FFI i64 trampoline 测试 DLL（x64 + ia32 共用源） */
#include <stdint.h>

#ifdef _WIN64
#define QWSTD
#else
#define QWSTD __stdcall
#endif

__declspec(dllexport) uint64_t q_add64(uint64_t a, uint64_t b)
{
    return a + b;
}

__declspec(dllexport) int64_t q_add64s(int64_t a, int64_t b)
{
    return a + b;
}

__declspec(dllexport) uint64_t QWSTD q_add64_std(uint64_t a, uint64_t b)
{
    return a + b;
}

/* 混槽：u32(4B) + u64(8B) + i32(4B) = 16B，pad=0 */
__declspec(dllexport) uint64_t q_mix(uint32_t a, uint64_t b, int32_t c)
{
    return (uint64_t)a + b + (uint64_t)(int64_t)c;
}

/* ptr(4B) + u64(8B) = 12B，pad=4 → 测试对齐填充 */
__declspec(dllexport) void q_out64(uint64_t *p, uint64_t v)
{
    if (p)
        *p = v;
}

/* i64 入参 + 32 位返回（测试 eax 截断，edx 垃圾不外泄） */
__declspec(dllexport) uint32_t q_low32(uint64_t a)
{
    return (uint32_t)a;
}

/* 32 位入参 + i64 返回（测试 edx:eax 完整取回） */
__declspec(dllexport) int64_t q_i32_to64(int32_t a)
{
    return (int64_t)a;
}

/* 无参 + u32 返回（测试 case 0：n=0 时 trampoline 仅对齐后 call） */
__declspec(dllexport) uint32_t q_zero(void)
{
    return 0x2A5A;
}
