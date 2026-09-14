## Why

`storage-core` 的订阅通知依赖实例级共享闭包变量 `effectKeys`，防抖窗口结束时的清空动作（`effectKeys = []`）未写入 spec 契约，也未通过 characterization test 锁定。当前单线程 JS 事件循环下"并发 set 丢更新"复现不出来（每次 `set` 重新 push 自己的 key，不会跨事件循环被清空），属代码卫生项而非线上故障；但 spec 没写、测试没锁，后续任何改 `effectHandler` / `set` 的动作都可能在不知情下破坏订阅通知语义，且改动时没有回归锚点。

按 `profile-maintenance` 的"改动前先锁定现状"纪律：先补 characterization test 锁死当前行为、把 spec 里"通过 debounce 合并"的模糊描述展开为可断言的语义，作为未来修复（若复现出真实竞态）的对比锚点。

## What Changes

- 新增 `tests/asyncStorage.test.ts` 与 `tests/syncStorage.test.ts` 的订阅并发 characterization case（每路 3 个：多订阅 + 并发 set、快速同 key set、跨事件循环 set）
- 更新 `openspec/specs/storage-core/spec.md`，在"订阅与防抖通知" Requirement 下补一个 Scenario，把"effectHandler 触发后清空 effectKeys；后续 set 会重新 push 自己的 key，匹配不受上一批影响"写入契约
- 不修改任何 `libs/` 源码——本 change 只做测试 + spec 契约补齐
- 不引入新 capability；不引入 breaking change

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `openspec/specs/storage-core/spec.md`：`Requirement: 订阅与防抖通知` 增补一个 Scenario，把防抖清空时机与后续 set 的匹配独立性写入契约。既有 3 个 Scenario（多次 set 合并 / 空 keys 只初始化）语义不变。

## Impact

- **新增测试**：`tests/asyncStorage.test.ts` 追加 3 个 `it`，`tests/syncStorage.test.ts` 追加 3 个 `it`——总测试数从当前 29 → 35（预期）
- **spec 变更**：`openspec/specs/storage-core/spec.md` L110-L123 附近追加一个 Scenario 段落；不新增 Requirement、不改 Requirement 名称、不删除任何已有 Scenario
- **不触及源码**：`libs/` 下所有文件不动，`git diff -- libs/` 应为空
- **不触及公共 API**：`createAsyncStorage` / `createSyncStorage` 签名与返回对象不变；`subscribe` / `set` / `get` / `remove` / `onReady` 全部不变
- **不触及 engine / utils 分系统**：本 change 只补 storage-core 层测试 + storage-core 契约
- **不触及 npm 包内容**：`package.json` 的 `files` 字段不动；新增测试文件不入包（`package.json` 已有 `files` 限定；若最终未限定则本 change 也不修改它，留待独立 change）

## 系统工程影响评估

（服务钱学森系统工程主基调第 3 条"从定性到定量的综合集成"——专家判断 + 数据 + 模型反复迭代上升到定量认识）

- **影响哪些分系统**：仅 storage-core 的契约层与测试层。engine 分系统（`libs/engine/*`）与 utils 分系统（`libs/utils/*`）不受影响——本 change 不修改 `libs/` 下任何源码，仅在 `tests/` 与 `openspec/specs/` 追加内容。
- **整体性能预期变化**：零运行时性能影响（测试代码不进 npm 包、不进构建产物）。开发态新增 6 个 vitest case，`npm test` 执行时间预估增加 <50ms（每个 case 只跑 1 次 debounce wait=0）。
- **这是局部优化还是全局协调**：局部优化——只补 storage-core 一个 Requirement 的契约 + 测试。但服务全局目标（维护阶段"改前先锁现状"的安全网），为将来可能的修复变更（若真实竞态复现）提供对比锚点，是全局协调的前馈准备环节。
- **如果是局部优化，对全局失调的风险**：低。三点边界控制：
  1. 源码零改动 → 不可能引入新的行为漂移；
  2. spec 只补 Scenario 不改 Requirement 主体 → 下游消费者无需重新读契约；
  3. 测试只加 assertion 不删 assertion → 现有 25+ 个 characterization 断言仍全部保留，回归风险为零。
- **预期行为模型**：这个改动的预期系统行为是"storage-core 订阅通知在并发 set / 快速同 key / 跨事件循环 set 三种场景下的当前行为被测试锁定；spec 契约明确了防抖清空时机与后续 set 的匹配独立性"。验证方式：
  1. `npm test` 全绿（29 + 6 = 35 个 case）—— 现有行为在测试侧被锁定；
  2. `openspec validate --all` 通过 —— spec 契约语法合规；
  3. `git diff -- libs/` 为空 —— 源码零改动，模型未被行为改变；
  4. `tsc --noEmit` 通过 —— 测试文件类型安全。
  这是综合集成的"模型"载体，`/td-archive` 步骤 3 用这四个锚点回答"预期行为模型是否被实际行为验证"。
- **与既有架构/风格的遵循关系**：遵循既有架构与风格——
  1. 测试文件放置：`tests/asyncStorage.test.ts` / `tests/syncStorage.test.ts`（沿用上一 change `add-characterization-tests` 建立的路径约定，不新建目录）；
  2. 测试风格：延续 characterization 惯例（锁定当前行为，assert 断言"现在就是这样"）；用 `vi.waitFor` 处理 debounce wait=0 的异步收敛；
  3. mock engine：复用 `tests/mock-engine.ts` 的现有 mock，不新建 mock 变体；
  4. spec 编辑风格：延续 `openspec/specs/storage-core/spec.md` 现有 Requirement → Scenario 层级，只用 `#### Scenario:` 追加，不引入新的 heading 层级或 marker；
  5. 无偏离点。

## caller impact 分析

tier-small 跳过（提醒性质）。本 change 不改任何公共符号、不改装配点、不改 API 形状——四类变更点均无。判断依据：

- ① 公共符号（`createAsyncStorage` / `createSyncStorage` / `StorageEngine` / `Option` / `SecretKeyEntry` / `ErrorMessage`）：均未新增、未修改、未删除
- ② 装配点（`index.ts` 导出、`vite.config.ts` 构建配置、`package.json` exports/files/scripts）：均未修改
- ③ 分系统边界（`libs/` 下文件拓扑、`tests/` 目录结构、`openspec/specs/` 层级）：均不变（仅追加内容）
- ④ 数据契约（密文格式、metadata 头格式、hash 前缀算法、key 哈希规则）：均未修改

完整 caller 清单不由本节承担，由 `/td-apply` 步骤 4 的引用搜索实测产出。

## 实际系统工程影响 vs 预期（archive 复盘）

（tier-small 必填 2 字段；对照源：proposal 的"系统工程影响评估"节）

### 实际影响的分系统

- **storage-core**（契约层 + 测试层）：契约层在 `openspec/specs/storage-core/spec.md` 的 `Requirement: 订阅与防抖通知` 下追加 2 个新 Scenario（并发 set 各自 key 都被通知 / 跨防抖批次 set 匹配独立），既有 3 个 Scenario 语义不变；测试层在 `tests/asyncStorage.test.ts` 与 `tests/syncStorage.test.ts` 各追加 3 个 characterization case。
- **engine / utils**：未触及（proposal 预期一致）——`git diff -- libs/` 为空。
- **新增文件**：无新增源码 / 测试基础设施文件；仅 change artifact 目录（`openspec/changes/add-subscribe-characterization-and-spec-gap/`，含 proposal / design / tasks / specs/storage-core/spec.md delta）。
- **源码改动**：`git diff --stat -- libs/` 为空——零源码改动，characterization 未修改任何行为。
- **测试规模变化**：`npm test` 从 71 → 77（+6：async +3、sync +3），5 个 test file 全绿。

### 预期行为模型验证

**预期模型**（proposal 原话）："storage-core 订阅通知在并发 set / 快速同 key / 跨事件循环 set 三种场景下的当前行为被测试锁定；spec 契约明确了防抖清空时机与后续 set 的匹配独立性"。

**实际验证结果**：模型成立，预期行为模型已验证。四个锚点全部命中：

1. `npm test` → **77/77 passed**（新增 6 个 case 一次性全绿）
2. `openspec validate --all --json` → change `add-subscribe-characterization-and-spec-gap` **valid: True, issues: []**
3. `git diff --stat -- libs/` → **空输出**（源码零改动，模型未被行为改变）
4. `npx tsc --noEmit` → **EXIT=0**（新测试文件类型安全）
5. `npx vitest run tests/integration.test.ts` → **7/7 passed**（跨 storage-core ↔ engine 边界冒烟通过）
6. `npm run build` → **✓ built in 2.19s**（构建产物不受影响）

**buffer 判定**：tasks.md T6 buffer 项按约定删除——T2/T3 执行时 6 个 characterization test 全部一次性通过，未复现真实并发 set 丢更新，单线程 JS 事件循环下的时序假设成立。这与 td-explore 阶段的代码推演结论一致（每次 set 重新 push 自己的 key，不会跨事件循环被清空）。

### 预期之外的副作用

1. **无新增副作用**——本 change 严格按前馈准备定位，未产生任何超出 proposal 声明的运行时行为变化。这是"补契约 + 加测试"的典型前馈准备的收益：零行为改变下获得未来改动的回归锚点。
2. **`npm test` 计数与 tasks.md 5.1 预判有出入**——tasks.md 5.1 写"总 case 数从 29 → 35"，实际是 71 → 77（因为上一轮 secretKeys change 落地后 case 基数已从 29 涨到 71）。差异原因：propose 阶段的 case 计数基于 explore 阶段的记忆（29 来自更早的 add-characterization-tests change），未随后续 change 更新。这不影响本 change 的正确性——断言的是"+6 case 全绿"而非"总数是 35"。后续 propose 前应重新跑一次 `npm test` 拿当前基数。
3. **spec 文本长度增加**——`openspec validate --all` 对 storage-core 报的 2 个 INFO（requirements[3] / requirements[9] 超 500 字符）在本次变更前已存在（对应"值序列化与加密"与"加密契约校验"两个 Requirement），本 change 的"订阅与防抖通知"Requirement 未触发新 INFO。可延后到 spec 结构整理 change 处理。

