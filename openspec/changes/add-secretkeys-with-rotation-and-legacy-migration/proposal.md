## Why

`Option.secretKey` 只有单密钥、无轮换能力：一旦密钥泄露，只能整体作废并清空存储，无法通过"引入新密钥 + 保留旧密钥解密"平滑过渡。同时密钥必须硬编码进运行时配置，任何静态分析工具都能从 bundle 中捞出明文。本次改动引入密钥组 + 时间轮换 + 密文内嵌密钥标识的机制，让密钥轮换成为**日常运维操作**，并在过渡期提供旧密文无 `secretKey` 也能读回的能力。

## What Changes

- 新增 `Option.secretKeys?: SecretKeyEntry[]`，每项含 `key` / 可选 `since` / 可选 `expiresAt` / 可选 `legacy: true` 标记。
- 新增 `SecretKeyEntry` 公共类型（`libs/types.ts`）。
- 新增 `generateSecretKeys(count, opts)` 工具函数（`libs/utils/`），基于 `crypto.getRandomValues`，库不偷偷在初始化时生成。
- 加密路径改造：写入时选择"当前活跃"密钥（实例化时按 `Date.now()` 匹配 `since/expiresAt`，实例内锁定），密文前拼 metadata 头 `[hash8:]<cipher>`，`hash8` 取 `HashFn(secret)` 的前 8 字符。
- 解密路径改造：先探测密文是否以 `[` 开头，是则按头定位 key；否则走 legacy fallback——遍历 `secretKeys` 中标 `legacy: true` 的项尝试解密；`secretKey` 存在时作为最终兜底。
- `Option.secretKey` 标记 `@deprecated`（本版本保留，仅作为"一次性迁入"便利入口；下个 major 移除）。
- **BREAKING** 语义：`Option.HashFn` 的语义**扩展**为"通用字符串哈希"——除 `enableHashKey` 场景外，也用于计算 secret 的 metadata hash。README 与 spec 必须明确"HashFn 需确保非可逆"，否则 secret 会泄露到密文头。
- **安全契约强化（合并自 explore 阶段 c2）**：`secretKey` 与 `EncryptFn` / `DecryptFn` 必须同时提供，否则在工厂初始化时立即抛错——避免"配了 `secretKey` 但没提供加密函数"的**静默明文落库**路径（当前实现 `asyncStorage.ts` L109 `if (secretKey && EncryptFn)` 会静默走 JSON 明文分支）。此为契约强化而非放宽，属向后兼容范围内的小破坏性。
- 更新 `openspec/specs/storage-core/spec.md` 的"值序列化与加密"Requirement；更新 `openspec/specs/utils/spec.md` 增补 `generateSecretKeys` Requirement。
- 更新 `README.md` 加密钥组示例、迁移指南、HashFn 非可逆警告。

## Capabilities

### New Capabilities

（无——本次改动扩展既有分系统的能力，不引入新分系统）

### Modified Capabilities

- `storage-core`：值序列化与加密 Requirement 重写（新增密钥组轮换、metadata 头、legacy 定位与 fallback）；键哈希 Requirement 不变但需在描述中体现 `HashFn` 也被用于 secret hash。
- `utils`：新增 `generateSecretKeys` Requirement（密钥生成工具）。

## Impact

- **受影响代码**：
  - `libs/types.ts` — `Option` 接口 + 新增 `SecretKeyEntry` 类型 + `secretKey` 标 `@deprecated`。
  - `libs/asyncStorage.ts` / `libs/syncStorage.ts` — 加密读写路径重构。
  - `libs/utils/encoding.ts` 或新增 `libs/utils/secrets.ts` — `generateSecretKeys` 实现。
  - `README.md` — 示例与迁移指南。
- **受影响测试**：`tests/asyncStorage.test.ts` / `tests/syncStorage.test.ts` / `tests/integration.test.ts` 需新增 secretKeys 用例；`tests/mock-engine.ts` 的 `mockEncrypt` / `mockDecrypt` 需支持 metadata 头。既有 characterization test 全部保留（legacy 路径行为不变）。
- **公共契约**：
  - **新增字段**：`secretKeys`（向后兼容）。
  - **弃用字段**：`secretKey` 标 `@deprecated`（本版本仍工作）。
  - **语义扩展**：`HashFn` 承担"通用哈希"职责（**唯一一处破坏性语义扩展**——但只在消费者显式传了可逆函数时暴露安全风险，见 design.md）。
  - **密文格式变化**：新写入的密文带 `[hash8:]` 前缀（旧密文无头仍可读，见 migration 设计）。
- **依赖**：不新增 npm 依赖。`crypto.getRandomValues` 为 Web API，若目标环境缺失（老 Node），README 提示消费者用 `react-native-get-random-values` 或类似 polyfill——项目 `package.json` 已有 `@types/crypto-js` 说明历史曾面临过 RN 环境兼容问题。
- **版本**：minor 版本 bump（1.5.1 → 1.6.0），因 `secretKey` 未移除。
- **文档**：README 加密章节重写；`openspec/specs/` 两个 spec.md 更新。

## 系统工程影响评估

- **影响哪些分系统**：
  - `storage-core`（主要）：`Option` 契约、加密读写路径、fallback 逻辑。
  - `utils`（次要）：新增 `generateSecretKeys`。
  - `engine`（不变）：`StorageEngine` 接口不动。
- **整体性能预期变化**：
  - 写入侧：每次 `set` 多一次 `HashFn(secret)` 计算（O(1)，MD5 单次约 1–2μs），无感。
  - 读取侧：多一次 metadata 头探测（`startsWith("[")` O(1)），无感；legacy fallback 分支只在无头密文时触发，正常情况不走。
  - 实例化：多一次 `Date.now()` + `secretKeys` 数组扫描选活跃 key，O(n) 且 n 通常 ≤ 3，无感。
- **这是局部优化还是全局协调**：**全局协调**。密钥轮换涉及 API 契约、加密格式、迁移策略、文档四个层，任一层的局部决策都会影响其他层。本次通过"密文带 metadata 头 + legacy 标记定位"实现跨版本、跨实例、跨页面的密钥轮换一致性——是全局协调而非单点优化。
- **如果是局部优化，对全局失调的风险**：不适用（本次为全局协调）。
- **预期行为模型**：
  1. 新配置（`secretKeys` 数组）下，同一实例生命周期内多次 `set` 产生的密文使用同一密钥，metadata 头中 hash 前缀一致。
  2. 消费者按时间新增 `secretKeys[i+1]`（设置 `since`），重启实例后新 `set` 走新密钥，旧密文（旧 hash）仍可正确读回。
  3. 消费者移除 `secretKey` 配置后，只要 `secretKeys` 里存在 `legacy: true` 项，老数据仍可读出。
  4. 消费者把旧密钥从 `secretKeys` 里删掉后，老数据不再可读——这是显式的"完成迁移"信号。
  - **验证方式**：新增单元测试覆盖上述 4 个场景 + characterization test 验证 legacy `secretKey` 路径行为不变。
- **与既有架构/风格的遵循关系**：
  - **遵循**：
    - 加密函数仍由消费者注入（延续 v1.3.0 "不再内置加密模块" 决策）。
    - `HashFn` 默认仍为 `MD5`（`libs/utils/encoding.ts` 已有实现，复用）。
    - 错误处理沿用现有模式（`console.error` / `console.warn`，无抛出）。
    - 类型风格遵循 `Option<T>` 泛型扩展。
    - utils 分系统承载跨 storage-core / engine 共享的工具函数（`generateSecretKeys` 归此）。
  - **偏离（需用户确认，见 caller impact 分析）**：
    - `HashFn` 语义从"仅键哈希"扩展为"通用字符串哈希"（见下方 caller impact 高危项）。这是**局部动作从整体性能反推**下的权衡：多一个字段更清晰但用户配置负担略增；单一字段更简洁但语义混淆。用户在 explore 阶段选择"单一字段 + 文档警告"路线。

## caller impact 分析

- **变更点清单**（按四类分类）：
  1. **① 公共类型扩展**（`libs/types.ts` `Option` 接口新增字段 + `secretKey` 标 `@deprecated` + 新增 `SecretKeyEntry`）：属于 **① 类（公共符号）**，**高危**。判断：向后兼容——老代码不传 `secretKeys` 走 legacy 路径，行为不变。
  2. **② 公共行为变更**（`createAsyncStorage` / `createSyncStorage` 的加密读写路径改造）：属于 **③ 类（装配点）**，**高危**。判断：`secretKey` 单密钥路径的行为 100% 保留（characterization test 会兜底验证）；新增 `secretKeys` 路径是**加法**。
  3. **③ 公共契约语义扩展**（`Option.HashFn` 从"仅键哈希"扩展为"通用哈希"）：属于 **① 类（公共符号语义）**，**高危**。判断：**唯一存在潜在不兼容**的变更点——若消费者之前显式传了可逆函数（如 `toUpperCase`）到 `HashFn`，升级后 secret 会泄露到 metadata 头。判断依据：`grep -rn "HashFn" tests/ src/` 显示本项目内的 `HashFn` 只走默认 `MD5`，无自传函数——**当前仓库内 caller 无风险**；外部消费者需自行审视。
  4. **④ 密文格式变化**（新写入的密文带 `[hash8:]` 前缀）：属于 **② 类（行为变更，但兼容旧格式）**。判断：无 metadata 头的老密文仍可解（走 legacy fallback 或 `secretKey` 兜底）。
  5. **⑤ 新增公共函数**（`generateSecretKeys` 从 `libs/utils/` 导出）：属于 **① 类（公共符号）**，但为**加法**，无破坏性。
- **高危标记**：变更点 ①、③（公共符号 + 装配点 + 语义扩展）为高危。go/no-go 判据：
  - ① 已在 explore 阶段确认为"向后兼容"（老代码不传 `secretKeys` 行为不变），go。
  - ③ 由 explore 阶段用户在 `HashFn 复用` 决策中**显式选择"e3 + README 警告"**路线，go。
  - ② 由 characterization test 兜底，go。
- **已知 caller**（仓库内）：
  - `tests/asyncStorage.test.ts:63,64,65`（用 `secretKey` + `mockEncrypt`/`mockDecrypt`）——**兼容**：走 legacy 路径。
  - `tests/syncStorage.test.ts:51,52,53`（同上）——**兼容**。
  - `tests/integration.test.ts:78,79,80`（同上）——**兼容**。
  - `src/main.ts:74,75,76`（README 示例代码，用 `secretKey: "123456"`）——**兼容**，但建议本次一并更新为 `secretKeys` 示例（见 tasks.md）。
  - `libs/asyncStorage.ts:44` / `libs/syncStorage.ts:35`（`HashFn = MD5` 默认赋值）——**需适配**：默认值不变，但需要理解其被 secret hash 路径复用。

## 决策闭合状态

explore 阶段（本会话）已闭合的 7 个决策：

| # | 决策 | 结论 |
|---|---|---|
| a1 | 随机密钥来源 | 库提供 `generateSecretKeys`，消费者写入 `secretKeys` 配置 |
| a2 | 轮换粒度 | 实例化时按 `Date.now()` 选活跃 key，实例内锁定 |
| a3 | 密文格式 | `[hash8:]<cipher>` metadata 头 |
| a4 | 迁移 | 惰性迁移 + `legacy:true` 标记定位旧 key |
| a5 | `secretKey` 命运 | 本版本保留 `@deprecated`，下个 major 移除 |
| a6 | c3 兜底 | 放弃（`DecryptFn` 无法判断解密成功） |
| a7 | HashFn 复用 | 复用 `Option.HashFn`，README + spec 写清非可逆警告 |
