#!/usr/bin/env python3
"""Apply WAMR XP compatibility patch.
Replaces Vista+ SRWLock with XP-compatible CriticalSection.
Adds inet_pton XP fallback for win_socket.c.
Idempotent: safe to run multiple times.
"""
import os, sys

wamr_dir = sys.argv[1] if len(sys.argv) > 1 else "wamr"
platform_h = os.path.join(wamr_dir, "core/shared/platform/windows/platform_internal.h")
thread_c = os.path.join(wamr_dir, "core/shared/platform/windows/win_thread.c")
socket_c = os.path.join(wamr_dir, "core/shared/platform/windows/win_socket.c")

# Check if already patched
with open(platform_h, "r") as f:
    if "CRITICAL_SECTION cs" in f.read():
        print("WAMR XP patch already applied.")
        sys.exit(0)

print("Applying WAMR XP compat patch...")

# --- platform_internal.h ---
with open(platform_h, "r") as f:
    content = f.read()
content = content.replace("SRWLOCK lock;", "CRITICAL_SECTION cs;")
content = content.replace("    bool exclusive;\n", "")
with open(platform_h, "w") as f:
    f.write(content)

# --- win_thread.c: replace rwlock functions line by line ---
with open(thread_c, "r") as f:
    lines = f.readlines()

RWMAP = {
    "os_rwlock_init":   "InitializeCriticalSection(&lock->cs);",
    "os_rwlock_rdlock": "EnterCriticalSection(&lock->cs);",
    "os_rwlock_wrlock": "EnterCriticalSection(&lock->cs);",
    "os_rwlock_unlock": "LeaveCriticalSection(&lock->cs);",
    "os_rwlock_destroy": "DeleteCriticalSection(&lock->cs);",
}

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]

    # Detect: line before is "int\n" and this line starts a rwlock function
    if line.strip() == "int" and i + 1 < len(lines):
        next_stripped = lines[i + 1].strip()
        func_name = None
        for name in RWMAP:
            if next_stripped.startswith(name + "("):
                func_name = name
                break

        if func_name:
            # Skip entire original function (int + name + body with braces)
            depth = 0
            started = False
            i += 1  # skip "int" line
            i += 1  # skip function name line
            i += 1  # skip opening "{"
            # skip to closing "}"
            while i < len(lines):
                if "{" in lines[i]:
                    depth += lines[i].count("{")
                    started = True
                if "}" in lines[i]:
                    depth -= lines[i].count("}")
                    if started and depth == 0:
                        i += 1  # skip closing "}"
                        break
                i += 1

            # Write replacement function
            new_lines.append("int\n")
            new_lines.append(f"{func_name}(korp_rwlock *lock)\n")
            new_lines.append("{\n")
            new_lines.append("    bh_assert(lock);\n")
            new_lines.append(f"    {RWMAP[func_name]}\n")
            new_lines.append("    return BHT_OK;\n")
            new_lines.append("}\n")
            # skip trailing blank line
            if i < len(lines) and lines[i].strip() == "":
                i += 1
            continue

    new_lines.append(line)
    i += 1

with open(thread_c, "w") as f:
    f.writelines(new_lines)

# --- win_socket.c: add inet_pton XP fallback ---
with open(socket_c, "r") as f:
    content = f.read()

if "inet_pton_xp" not in content:
    fallback = """/* inet_pton is Vista+; XP fallback via WSAStringToAddress */
#if _WIN32_WINNT < 0x0600
static int inet_pton_xp(int af, const char *src, void *dst) {
    struct sockaddr_storage ss;
    int size = sizeof(ss);
    char src_copy[INET6_ADDRSTRLEN + 1];
    strncpy(src_copy, src, INET6_ADDRSTRLEN);
    src_copy[INET6_ADDRSTRLEN] = '\\0';
    memset(&ss, 0, sizeof(ss));
    if (WSAStringToAddressA(src_copy, af, NULL, (struct sockaddr *)&ss, &size) == 0) {
        switch (af) {
        case AF_INET:
            *(struct in_addr *)dst = ((struct sockaddr_in *)&ss)->sin_addr;
            return 1;
        case AF_INET6:
            *(struct in6_addr *)dst = ((struct sockaddr_in6 *)&ss)->sin6_addr;
            return 1;
        }
    }
    return 0;
}
#define inet_pton inet_pton_xp
#endif
"""
    content = content.replace(
        '#include "platform_api_vmcore.h"',
        '#include "platform_api_vmcore.h"\n' + fallback, 1)
    with open(socket_c, "w") as f:
        f.write(content)

print("WAMR XP compat patch applied successfully.")
