#!/bin/sh
# Apply WAMR XP compatibility patch
# Replaces Vista+ SRWLock with XP-compatible CriticalSection
# Adds inet_pton XP fallback for win_socket.c

WAMR_DIR="${1:-wamr}"
PLATFORM_H="$WAMR_DIR/core/shared/platform/windows/platform_internal.h"
THREAD_C="$WAMR_DIR/core/shared/platform/windows/win_thread.c"
SOCKET_C="$WAMR_DIR/core/shared/platform/windows/win_socket.c"

# Check if already patched
if grep -q 'CRITICAL_SECTION cs' "$PLATFORM_H" 2>/dev/null; then
    echo "WAMR XP patch already applied."
    exit 0
fi

echo "Applying WAMR XP compat patch..."

# --- platform_internal.h: SRWLOCK -> CRITICAL_SECTION ---
sed -i 's/SRWLOCK lock;/CRITICAL_SECTION cs;/' "$PLATFORM_H"
sed -i '/bool exclusive;/d' "$PLATFORM_H"

# --- win_thread.c: replace rwlock functions ---
# Use perl line-by-line mode to rewrite each function

# Rewrite os_rwlock_init
sed -i '/^int$/,/^}$/{
    /InitializeSRWLock/{
        i\    InitializeCriticalSection(\&lock->cs);
        d
    }
    /lock->exclusive = false;/d
}' "$THREAD_C"

# Rewrite os_rwlock_rdlock
sed -i '/os_rwlock_rdlock/,/^}$/{
    /AcquireSRWLockShared/{
        i\    EnterCriticalSection(\&lock->cs);
        d
    }
}' "$THREAD_C"

# Rewrite os_rwlock_wrlock
sed -i '/os_rwlock_wrlock/,/^}$/{
    /AcquireSRWLockExclusive/{
        i\    EnterCriticalSection(\&lock->cs);
        d
    }
    /lock->exclusive = true;/d
}' "$THREAD_C"

# Rewrite os_rwlock_unlock - replace entire function body
sed -i '/os_rwlock_unlock/,/^}$/{
    /if (lock->exclusive)/,/\}/d
    /ReleaseSRWLock/d
    /lock->exclusive = false;/d
}' "$THREAD_C"
# Now insert the single LeaveCriticalSection after bh_assert
sed -i '/os_rwlock_unlock/,/^}$/{
    /bh_assert(lock);/a\    LeaveCriticalSection(\&lock->cs);
}' "$THREAD_C"

# Rewrite os_rwlock_destroy
sed -i 's/(void)lock;/DeleteCriticalSection(\&lock->cs);/' "$THREAD_C"

# --- win_socket.c: add inet_pton XP fallback ---
if ! grep -q 'inet_pton_xp' "$SOCKET_C" 2>/dev/null; then
    sed -i '/#include "platform_api_vmcore.h"/a\
/* inet_pton is Vista+; XP fallback via WSAStringToAddress */\
#if _WIN32_WINNT < 0x0600\
static int inet_pton_xp(int af, const char *src, void *dst) {\
    struct sockaddr_storage ss;\
    int size = sizeof(ss);\
    char src_copy[INET6_ADDRSTRLEN + 1];\
    strncpy(src_copy, src, INET6_ADDRSTRLEN);\
    src_copy[INET6_ADDRSTRLEN] = '"'"'\\0'"'"';\
    memset(\&ss, 0, sizeof(ss));\
    if (WSAStringToAddressA(src_copy, af, NULL, (struct sockaddr *)\&ss, \&size) == 0) {\
        switch (af) {\
        case AF_INET:\
            *(struct in_addr *)dst = ((struct sockaddr_in *)\&ss)->sin_addr;\
            return 1;\
        case AF_INET6:\
            *(struct in6_addr *)dst = ((struct sockaddr_in6 *)\&ss)->sin6_addr;\
            return 1;\
        }\
    }\
    return 0;\
}\
#define inet_pton inet_pton_xp\
#endif' "$SOCKET_C"
fi

echo "WAMR XP compat patch applied successfully."
