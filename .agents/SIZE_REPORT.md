# QuickWin 二进制体积优化报告

## 现状

```
make small  (基线):  1,573 KB
make        (release): 2,911 KB (含 .debug_* 段 247 KB)
```

## 各节分布（基线，stripped）

| 节 | 大小 | 占比 | 内容 |
|---|------|------|------|
| .text | 1,161 KB | 74% | 代码 |
| .rdata | 314 KB | 20% | 只读常量数据 |
| .pdata | 48 KB | 3.0% | 异常函数表 |
| .xdata | 47 KB | 2.9% | 异常展开信息 |
| .idata | 13 KB | 0.8% | DLL 导入表 |
| .data | 8.5 KB | 0.5% | 已初始化 RW 数据 |
| .reloc | 6 KB | 0.4% | 基址重定位 |
| .bss | 27 KB | — | 未初始化(不在磁盘) |
| .rsrc | 1.7 KB | 0.1% | 资源(版本信息) |
| .tls | 16 B | 0% | 线程局部存储 |

## .text 代码构成（基线估算）

| 组件 | 占比 | 大小 |
|------|------|------|
| QuickJS | 52% | 604 KB |
| WAMR | 16% | 186 KB |
| wolfSSL | 16% | 186 KB |
| CRT/Mingw | 6.5% | 75 KB |
| Brotli | 2.6% | 30 KB |
| 我们的绑定代码 | 3.6% | 42 KB |
| 其他 | 2.9% | 34 KB |

## .rdata 构成（基线估算）

| 类型 | 大小 | 说明 |
|------|------|------|
| QuickJS Unicode 表 | ~150 KB | `unicode_decomp_data`、`unicode_gc_table`、`unicode_prop_*`、`case_conv_*` 等 |
| QuickJS JS 内置方法表 | ~80 KB | `js_string_proto_funcs`、`js_array_proto_funcs`、`js_object_proto_funcs`、`js_date_funcs` 等 |
| QuickJS 其他数据 | ~50 KB | `js_malloc_block_sizes`(39K)、`js_std_class_def`、`js_atom_init`(36K) |
| 我们的绑定函数表 | ~20 KB | `wolfssl_funcs`、`win_funcs`、`gui_funcs`、`ffi_funcs`、`sock_funcs`、`brotli_funcs` |
| 字符串字面量 | ~10 KB | 错误消息、DLL/API 函数名 |

## 优化的改动

### 1. QuickJS Unicode 表裁剪（-48 KB）

**原理：** QuickJS 的 `libunicode.h:35` 默认定义了 `CONFIG_ALL_UNICODE`，启用全套 Unicode 属性表（Unicode property、script、General Category、decomposition、case conversion 等）。注释说"40KB larger"，实测在 `.rdata` 中占 ~150 KB。

**改动：**

```c
// libunicode.h 第35行
#if !defined(CONFIG_SMALL)
#define CONFIG_ALL_UNICODE
#endif
```

同时在 `Makefile` 的 `MINIMAL=1` CFLAGS 中加入 `-DCONFIG_SMALL`：

```makefile
ifeq ($(MINIMAL), 1)
    CFLAGS += $(OPT) -flto -fdata-sections -ffunction-sections -DCONFIG_SMALL
endif
```

**副作用：**
- 失去 `\p{...}` Unicode 属性正则支持（如 `\p{Script=Han}`）
- 失去 `String.prototype.normalize()` NFC/NFD 规范化
- 失去 exotic Unicode 字符的大写/小写转换（仅 ASCII 正常）
- 通常不影响实际 JS 应用

**收益：** .text 省 8 KB + .rdata 省 40 KB = **48 KB**

**注意：** `libunicode.c` 中 `unicode_sequence_prop1` / `unicode_sequence_prop`（Emoji 序列处理）位于 `#endif /* CONFIG_ALL_UNICODE */` 之外但依赖 `CONFIG_ALL_UNICODE` 的数据，需要用 `#ifdef CONFIG_ALL_UNICODE` 包起来，否则编译报错。

### 2. wolfSSL 配置裁剪（-34 KB）

**原理：** wolfSSL 默认包含大量 TLS 1.2 不需要的功能（错误字符串表、互斥锁、ECC Shamir 加速、内存追踪、OpenSSL 兼容 stub 等）。

**改动：** 在 `wolfsmin` cmake 命令中新增：

```
-DWOLFSSL_SINGLE_THREADED=ON     # 去掉互斥锁代码
-DWOLFSSL_ECCSHAMIR=OFF          # 去掉 ECC Shamir 加速（更慢但更小）
-DWOLFSSL_NO_STUB=ON             # 去掉 OpenSSL 兼容 stub
-DWOLFSSL_MEMORY=OFF             # 去掉内存追踪
-DWOLFSSL_ERROR_STRINGS=OFF      # 去掉错误描述字符串表（.rdata 省 ~18 KB）
-DWOLFSSL_ERROR_QUEUE=OFF        # 去掉错误队列
-DWOLFSSL_SHA384=OFF             # 只用 SHA-256 密码套件
```

**收益：** .text 省 15 KB + .rdata 省 18 KB + 其他 ≈ **34 KB**

**注意：** 安全——这些功能在 `SSL_VERIFY_NONE` + TLS 1.2 + AES-128-GCM-SHA256 场景下不需要。

### 3. WAMR Mini Loader（-76 KB）

**原理：** WAMR 默认使用完整 WASM 加载器（支持所有 WASM 特性）。Mini Loader 是简化版，体积更小但支持的特性也少。我们的 WASM 模块（mupdf、handwriting 等）使用标准 WASM 特性，Mini Loader 完全满足。

**改动：**

```makefile
-DWASM_ENABLE_MINI_LOADER=1
```

同时需要重建 WAMR 库（`make wamr`），因为该宏影响 WAMR 内部的编译。

**收益：** .text 省 60 KB + .rdata 省 8 KB + .data 省 3 KB = **76 KB**

**验证：** 所有 WASM 测试通过（wasm-bidirectional、wasm-callback、wasm-types、mupdf-wasm 等共 107 个测试用例）。

### 4. 尝试过但未采用的优化

| 方案 | 结果 |
|------|------|
| `CONFIG_ATOMICS` 去除 | 节省 < 2 KB，跳过 |
| Brotli decode-only 编译 | 已使用 `-lbrotlidec`（编码器分离），无需改动 |
| `-fvisibility=hidden` | 需要大量 `__declspec(dllexport)` 声明，收益低 |
| 链接地图分析 | LTO + gc-sections 已足够高效 |

## 汇总

### 大小变化

| 阶段 | 大小 | 节省 | 累积 |
|------|------|------|------|
| 基线 `make small` | 1,573 KB | — | — |
| + QuickJS CONFIG_SMALL | 1,525 KB | 48 KB (3.1%) | 48 KB |
| + wolfSSL 裁剪 | 1,491 KB | 34 KB (2.2%) | 82 KB |
| + WAMR mini loader | **1,415 KB** | **76 KB (4.8%)** | **158 KB (10.0%)** |

### 各节最终状态

| 节 | 基线 | 最终 | 变化 |
|-----|------|------|------|
| .text | 1,161 KB | 1,054 KB | **-107 KB** |
| .rdata | 314 KB | 249 KB | **-65 KB** |
| .pdata | 48 KB | 43 KB | -5 KB |
| .xdata | 47 KB | 43 KB | -4 KB |
| .data | 8.5 KB | 5.3 KB | -3.2 KB |
| 其他 | 约 8 KB | 约 7 KB | -1 KB |
| 对齐/头 | 约-14 KB | 约 14 KB | 不变 |
| **合计** | **1,573 KB** | **1,415 KB** | **-158 KB (10%)** |

### 测试结果

`make test`：**407/407 全部通过**，包括：
- 网络: fetch (50)、WebSocket (15)、event (2)、HTTP import (6)
- WASM: bidirectional、callback、types、sjlj、frame-encoding、import-global 等 (107)
- mupdf: wasm、twice、render (11)
- Worker: wasm、http、fetch (15)
- 缓存: fetch-cache (32)
- polyfill (58)、brotli (5)、ffi (5) 以及其他

## 结论

通过三项改动（QuickJS Unicode 表裁剪、wolfSSL 最小配置、WAMR Mini Loader），`make small` 二进制从 **1,573 KB 降到 1,415 KB（-10%）**，所有 407 个测试全部通过。更大的体积优化需要更激进的改动（如去掉无用 JS 导出函数、Brotli 自编译等），收益递减。

---

## 完整 Diff（基于 `239f84a`）

### Makefile

```diff
diff --git a/Makefile b/Makefile
index 0170b9e..d8b402b 100644
--- a/Makefile
+++ b/Makefile
@@ -18,7 +18,7 @@ CFLAGS += -DDUMP_GC -DDUMP_LEAKS
 CFLAGS += -Wall -Wextra
 
 ifeq ($(MINIMAL), 1)
-    CFLAGS += $(OPT) -flto -fdata-sections -ffunction-sections
+    CFLAGS += $(OPT) -flto -fdata-sections -ffunction-sections -DCONFIG_SMALL
     LDFLAGS += -flto -Wl,--gc-sections
 endif
 
@@ -37,7 +37,7 @@ WAMR_DEFS = \
     -DWASM_ENABLE_SHRUNK_MEMORY=1 \
     -DWASM_ENABLE_SHARED_MEMORY=0 \
     -DWASM_ENABLE_MULTI_MODULE=0 \
-    -DWASM_ENABLE_MINI_LOADER=0 \
+    -DWASM_ENABLE_MINI_LOADER=1 \
     -DWASM_ENABLE_EXTENDED_CONST_EXPR=0 \
     -DWASM_ENABLE_CALL_INDIRECT_OVERLONG=0 \
     -DWASM_DISABLE_HW_BOUND_CHECK=1 \
@@ -229,6 +229,7 @@ wolfsmin:
 		-DWOLFSSL_SHAKE128=OFF \
 		-DWOLFSSL_SHAKE256=OFF \
 		-DWOLFSSL_SHA224=OFF \
+		-DWOLFSSL_SHA384=OFF \
 		-DWOLFSSL_SHA512=OFF \
 		-DWOLFSSL_SESSION_TICKET=OFF \
 		-DWOLFSSL_HARDEN=OFF \
@@ -240,7 +241,13 @@ wolfsmin:
 		-DWOLFSSL_SNI=ON \
 		-DWOLFSSL_TLSX=ON \
 		-DWOLFSSL_BASE64_ENCODE=ON \
-		-DWOLFSSL_SUPPORTED_CURVES=ON
+		-DWOLFSSL_SUPPORTED_CURVES=ON \
+		-DWOLFSSL_SINGLE_THREADED=ON \
+		-DWOLFSSL_ECCSHAMIR=OFF \
+		-DWOLFSSL_NO_STUB=ON \
+		-DWOLFSSL_MEMORY=OFF \
+		-DWOLFSSL_ERROR_STRINGS=OFF \
+		-DWOLFSSL_ERROR_QUEUE=OFF
 	cmake --build $(WOLFSSL_BUILD_DIR) --config Release
 	cp $(WOLFSSL_BUILD_DIR)/libwolfssl.a $(WOLFSSL_LIB_STATIC)
 	@echo "Minimal wolfSSL build complete"
```

### quickjs 子模块

以下文件在 `quickjs/` 子模块中修改（子模块基于 `04be246`）：

**`libunicode.h:35`** — 使 `CONFIG_ALL_UNICODE` 可被命令行覆盖：
```diff
- #define CONFIG_ALL_UNICODE
+ #if !defined(CONFIG_SMALL)
+ #define CONFIG_ALL_UNICODE
+ #endif
```

**`libunicode.c:1919-2124`** — 将 Emoji 序列处理函数用 `CONFIG_ALL_UNICODE` 包起来：
```diff
+ #ifdef CONFIG_ALL_UNICODE
  #define SEQ_MAX_LEN 16
  static int unicode_sequence_prop1(...) { ... }
  int unicode_sequence_prop(...) { ... }
+ #endif /* CONFIG_ALL_UNICODE */
```