## Why

仓库目前零测试：`package.json` 无 test script、无测试框架依赖、无 `tests/` 目录。作为 brownfield 项目，后续任何改老代码（修 bug、重构）都缺少安全网。按 `profile-brownfield` 的 TDD 边界规则——"重构老代码前先加 characterization test 锁定现有行为"——现在先建立测试基础设施并锁定 storage-core 的当前行为，为后续改动提供回归保护。

## What Changes

- 新增 `vitest` devDependency（Vite 原生测试框架，零额外配置，共享 `vite.config.ts` 的 resolve 别名）
- 新增 `npm test` script（`vitest run`，单次运行模式，适合 CI）
- 新增 `tests/` 目录，含手写 mock `StorageEngine` 实现（内存 Map，同步与异步两版）
- 新增 storage-core 的 characterization test 文件，覆盖 `createAsyncStorage` 与 `createSyncStorage` 的现有行为（含已知 quirky 行为）
- 不修改任何源码

## Capabilities

本 change 不引入新 capability，不修改任何既有 spec 的 requirement。Characterization test 锁定的是**现有行为**，不改 spec 级行为——按 OpenSpec 约定 opt out specs（`.openspec.yaml` 已设 `skip_specs: true`）。

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

- **新增 devDependency**：`vitest`（预计 ^2.x，`npm install -D vitest` 时取最新稳定版）
- **package.json**：新增 `"test": "vitest run"` script
- **新增文件**：`tests/mock-engine.ts`（mock StorageEngine）、`tests/asyncStorage.test.ts`、`tests/syncStorage.test.ts`
- **不触及源码**：`libs/` 下所有文件不动
- **不触及 engine / utils 分系统**：本轮只覆盖 storage-core（td-explore 闭合结论——engine 测试需 jsdom，延迟到后续 change）
- **不触及公共 API**：不改变 `createAsyncStorage` / `createSyncStorage` 的签名或行为

## 系统工程影响评估

（服务钱学森系统工程主基调第 3 条"从定性到定量的综合集成"——专家判断 + 数据 + 模型反复迭代上升到定量认识）

- **影响哪些分系统**：仅 storage-core（通过测试间接锁定其行为）。engine / utils 不受影响。新增 `tests/` 是独立目录，不改变既有分系统边界。
- **整体性能预期变化**：无运行时性能影响（测试代码不进入 npm 包 `files` 字段，不参与构建产物）。开发态新增 `npm test` 入口，CI 可用性提升。
- **这是局部优化还是全局协调**：局部优化——为 storage-core 加安全网。但它服务全局目标（为后续改动提供回归保护），不是为测试而测试。
- **如果是局部优化，对全局失调的风险**：低。唯一风险是"只测 storage-core，engine 无覆盖"——后续改 engine 时仍无安全网。这是可接受的有意取舍（engine 测试需 jsdom，延迟到后续 change），在本 proposal 显式记录。
- **预期行为模型**：这个改动的预期系统行为是"storage-core 的现有行为被测试锁定"——后续改动 storage-core 时，如果测试从 pass 变 fail，说明行为发生了变化。验证方式：`npm test` 全绿 = 现有行为被锁定。characterization test 的 assert 断言的是"当前就是这样"（含 quirky 行为），不是"应该这样"——这是模型验证的锚点。
- **与既有架构/风格的遵循关系**：遵循既有架构——测试文件放在新 `tests/` 目录（与 `libs/` 平级，符合常见 TS 项目约定）；mock engine 实现 `StorageEngine` 接口（`libs/types.ts` 已定义），不引入新接口；测试框架选 Vitest（Vite 原生，与既有 Vite 5 构建链一致，不引入异构工具链）。无偏离点。

## caller impact 分析

tier-small 跳过（提醒性质）。本 change 不改任何公共符号、不改装配点、不改 API 形状——四类变更点均无。判断依据：characterization test 是纯新增文件，不触及 `libs/` 下任何源码，`package.json` 只新增 devDependency 与 test script（不改 exports / main / module 字段）。

## 实际系统工程影响 vs 预期（archive 复盘）

（tier-small 必填 2 字段；对照源：proposal 的"系统工程影响评估"节）

### 实际影响的分系统

- **storage-core**：通过 25 个单元测试间接锁定其现有行为——覆盖全部对外 API（get/set/remove/subscribe/onReady）的正常路径 + 7 个 quirky 行为（Q1-Q7）。
- **engine**（仅验证层，无代码改动）：步骤 6.2 系统级验证新增 `tests/integration.test.ts`，用真实 `ELocalStorage` engine 注入 storage-core 跑 4 个集成冒烟测试——验证 mock engine 与真实 engine 在 `StorageEngine<false>` 契约层面等价。
- **utils**：未触及（proposal 预期一致）。
- **新增文件**：4 个（proposal 预期 3 个 + 步骤 6.2 追加的 integration.test.ts）。
- **源码改动**：`git diff -- libs/` 空——零源码改动，characterization 未修改任何行为。

### 预期行为模型验证

**预期模型**（proposal 原话）："storage-core 的现有行为被测试锁定——后续改动 storage-core 时，如果测试从 pass 变 fail，说明行为发生了变化。验证方式：`npm test` 全绿 = 现有行为被锁定。"

**实际验证结果**：模型成立，预期行为模型已验证。

- `npm test`：29/29 绿（asyncStorage 14 + syncStorage 11 + integration 4）
- `tsc --noEmit`：EXIT=0
- `npm run build`：EXIT=0
- `git diff -- libs/`：空（零源码改动，characterization 未触碰行为）

### 预期之外的副作用

1. **Vitest 版本必须固定到 2.x**——proposal 原写"预计 ^2.x"，实际执行发现 Vitest 3+/4+/5+ 需 Vite ≥6.4.0，而项目是 vite@5.0.8。已在 tasks.md 1.1 记录来源（context7 /vitest-dev/vitest GitHub package.json）。后续 upgrade vite 到 6.x 时，Vitest 也需同步升级。
2. **源码的 TypeScript 类型 quirk 在测试侧显式暴露**：`set<K>(key, value: T[K])` 类型上要求传完整对象，但 increments 实际靠 spread 合并部分对象；同步 `get` 无 engine 时 `return new Error(...) as any` 用 `as any` 强转。测试侧用可选属性类型 `{x?:number;y?:number}` 与 `as unknown as Error` 适配。这些 quirk 是后续修 bug 的候选入口——修时同步改对应测试的断言（characterization → refactor → update test 工作流）。
3. **mock engine `supportObject` 默认值**：初版设 `true`，触发增量测试的 `JSON.parse(对象)` console.warn。改为默认 `false` 匹配真实 engine 行为（ELocalStorage/ECookie/EIndexedDB 均未设 `supportObject: true`）。这是 characterization 纪律的体现——mock 行为要匹配真实 engine 契约，否则锁定的是"mock 行为"而非"系统行为"。
4. **tsconfig include 加 `tests`**——`npm run build`（tsc + vite build）会类型检查 tests 文件。这是有意的：让 `tsc` 覆盖测试文件的类型安全，而非把测试排除在类型系统外。

这些副作用均不构成全局失调——均为测试层与配置层的局部改动，无跨分系统契约影响。
