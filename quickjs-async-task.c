#include "quickjs-async-task.h"

static AsyncTaskRuntime *g_runtimes = NULL;
static int g_nruntimes = 0;
static int g_runtimes_capacity = 0;
static CRITICAL_SECTION g_async_lock;
static int g_async_lock_init = 0;

static AsyncTaskRuntime *find_runtime(JSRuntime *rt)
{
    for (int i = 0; i < g_nruntimes; i++) {
        if (g_runtimes[i].rt == rt)
            return &g_runtimes[i];
    }
    return NULL;
}

AsyncTaskRuntime *js_async_task_init(JSRuntime *rt)
{
    if (!g_async_lock_init) {
        InitializeCriticalSection(&g_async_lock);
        g_async_lock_init = 1;
    }
    EnterCriticalSection(&g_async_lock);
    if (g_nruntimes >= g_runtimes_capacity) {
        int newCap = g_runtimes_capacity ? g_runtimes_capacity * 2 : 4;
        AsyncTaskRuntime *p = realloc(g_runtimes, newCap * sizeof(AsyncTaskRuntime));
        if (!p) { LeaveCriticalSection(&g_async_lock); return NULL; }
        g_runtimes = p;
        g_runtimes_capacity = newCap;
    }

    AsyncTaskRuntime *r = &g_runtimes[g_nruntimes++];
    r->rt = rt;
    r->event = CreateEvent(NULL, FALSE, FALSE, NULL);
    r->slots_capacity = 16;
    r->slots = js_mallocz_rt(rt, r->slots_capacity * sizeof(AsyncTask));
    r->slot_count = 0;
    LeaveCriticalSection(&g_async_lock);
    return r;
}

HANDLE js_async_task_get_event(JSRuntime *rt)
{
    EnterCriticalSection(&g_async_lock);
    AsyncTaskRuntime *r = find_runtime(rt);
    HANDLE event = r ? r->event : NULL;
    LeaveCriticalSection(&g_async_lock);
    return event;
}

int js_async_task_slot_count(JSRuntime *rt)
{
    EnterCriticalSection(&g_async_lock);
    AsyncTaskRuntime *r = find_runtime(rt);
    int count = r ? r->slot_count : 0;
    LeaveCriticalSection(&g_async_lock);
    return count;
}

AsyncTask *js_async_task_make_task(JSRuntime *rt)
{
    EnterCriticalSection(&g_async_lock);
    AsyncTaskRuntime *r = find_runtime(rt);
    if (!r) { LeaveCriticalSection(&g_async_lock); return NULL; }
    AsyncTask *slots = r->slots;
    int slots_capacity = r->slots_capacity;
    HANDLE event = r->event;
    LeaveCriticalSection(&g_async_lock);

    for (int i = 0; i < slots_capacity; i++) {
        if (slots[i].state == 0) {
            slots[i].state = 1;
            slots[i].result = NULL;
            slots[i].arg = NULL;
            slots[i].on_complete = NULL;
            slots[i].event = event;
            EnterCriticalSection(&g_async_lock);
            r = find_runtime(rt);
            if (r) r->slot_count++;
            LeaveCriticalSection(&g_async_lock);
            return &slots[i];
        }
    }

    int newCap = slots_capacity * 2;
    AsyncTask *p = js_realloc_rt(rt, slots, newCap * sizeof(AsyncTask));
    if (!p) return NULL;
    EnterCriticalSection(&g_async_lock);
    r = find_runtime(rt);
    if (r) { r->slots = p; r->slot_count++; }
    LeaveCriticalSection(&g_async_lock);
    for (int i = slots_capacity; i < newCap; i++)
        p[i].state = 0;
    p[slots_capacity].state = 1;
    p[slots_capacity].event = event;
    return &p[slots_capacity];
}

void js_async_task_process(JSContext *ctx)
{
    JSRuntime *rt = JS_GetRuntime(ctx);
    EnterCriticalSection(&g_async_lock);
    AsyncTaskRuntime *r = find_runtime(rt);
    if (!r) { LeaveCriticalSection(&g_async_lock); return; }
    AsyncTask *slots = r->slots;
    int slots_capacity = r->slots_capacity;
    LeaveCriticalSection(&g_async_lock);

    int completed = 0;
    for (int i = 0; i < slots_capacity; i++) {
        AsyncTask *t = &slots[i];
        if (t->state == 2) {
            if (t->on_complete)
                t->on_complete(ctx, t);
            t->state = 0;
            t->result = NULL;
            t->on_complete = NULL;
            completed++;
        }
    }
    if (completed > 0) {
        EnterCriticalSection(&g_async_lock);
        r = find_runtime(rt);
        if (r) r->slot_count -= completed;
        LeaveCriticalSection(&g_async_lock);
    }
}

void js_async_task_destroy(JSRuntime *rt)
{
    EnterCriticalSection(&g_async_lock);
    AsyncTaskRuntime *r = find_runtime(rt);
    if (!r) { LeaveCriticalSection(&g_async_lock); return; }
    if (r->event) {
        CloseHandle(r->event);
        r->event = NULL;
    }
    js_free_rt(rt, r->slots);
    r->slots = NULL;
    r->slot_count = 0;
    r->slots_capacity = 0;
    LeaveCriticalSection(&g_async_lock);
}

void js_async_task_cleanup(void)
{
    EnterCriticalSection(&g_async_lock);
    free(g_runtimes);
    g_runtimes = NULL;
    g_nruntimes = 0;
    g_runtimes_capacity = 0;
    LeaveCriticalSection(&g_async_lock);
    DeleteCriticalSection(&g_async_lock);
    g_async_lock_init = 0;
}
