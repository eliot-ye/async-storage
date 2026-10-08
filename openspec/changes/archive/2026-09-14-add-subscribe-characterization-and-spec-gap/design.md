## Context

见 `proposal.md` 的 Why 节。补充约束：

- 现有测试文件已存在：`tests/asyncStorage.test.ts`（14 个 case）、`tests/syncStorage.test.ts`（11 个 case）、`tests/integration.test.ts`（4 个 case）、`tests/mock-engine.ts`（mock `StorageEngine` 实现）—— 本 change 只做追加，不新建文件。
- 现有 spec 的 `Requirement: 订阅与防抖通知` 已声明 3 个 Scenario（多次 set 合并 / 空 keys 只初始化）—— 本 change 走 MODIFIED 流程，全文复制现有 Requirement 块后追加 2 个新 Scenario，不改既有描述文本的语义。
- 单线程 JS 事件循环保证：`debounce(wait:0)` 排出的 `setTimeout(fn, 0)` 在每次 `await _engine.setItem()` 返回后有机会触发（因为 `setItem` 内部 await 至少一次微任务），因此"并发 set 丢更新"在当前实现下复现不出来——这是 characterization 的前提：断言当前行为，不修 bug。
- 已有测试辅助 `const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 20));` 用于等待 `debounce(wait:0)` 收敛；本 change 复用该辅助，不新引入测试基础设施。

## Goals / Non-Goals

**Goals：**

1. 用 characterization test 把 storage-core 订阅通知在并发 set 相关三个场景下的**当前行为**锁定——后续任何人改 `effectHandler` / `set` / `effectKeys`，若测试从 pass 变 fail，说明行为已变。
2. 把 spec 里"通过 debounce 合并"的模糊描述展开为可断言的语义——防抖清空时机与后续 set 的匹配独立性。
3. 为未来可能的修复变更（若真实竞态被复现）提供对比锚点：characterization 阶段测试断言"现在就是这样"，修复阶段把断言改为"应该这样"，两者 diff 就是修复的行为变更边界。

**Non-Goals：**

1. 不修复 `effectKeys` 共享变量本身的问题（a1 / a2 / a3 修复方案）——本 change 只做前馈准备。
2. 不改动 `debounce` 的实现、`set` 的调用序列、`_engine` 的 await 次数——任何源码改动都会把 characterization 变成 refactor，超出本 change 边界。
3. 不引入并发 set 的额外测试基础设施（如 jsdom、fake timers、并发调度器）——保持 vitest 原生 + `setTimeout` 辅助的现有测试栈。
4. 不触及 engine / utils 分系统的测试或 spec。
5. 不修改 `package.json`、`tsconfig.json`、`vite.config.ts`、`openspec/config.yaml`。

## Decisions

### D1：走 MODIFIED Requirements 而非新增独立 Requirement

- **选择**：在 `openspec/specs/storage-core/spec.md` 里，把整个 `Requirement: 订阅与防抖通知` 块复制到 delta 的 `## MODIFIED Requirements` 段，在原有 3 个 Scenario 后追加 2 个新 Scenario。
- **理由**：新加的场景约束是"防抖清空时机 + 匹配独立性"，属于既有 Requirement "订阅与防抖通知" 的语义细节，而不是一个独立可测的能力。拆成独立 Requirement 会引入不相关的能力命名，破坏 spec 的语义聚合。
- **备选**：新增独立 `Requirement: 订阅通知并发语义`。放弃——增加 spec 顶层条目数，未来读契约时难以判断"订阅相关"到底涉及几个 Requirement。

### D2：spec 只写"行为可观测"，不写 `effectKeys` 变量名

- **选择**：新 Scenario 用"受影响 key 集合"这种抽象术语，不出现 `effectKeys` 这个闭包变量名。
- **理由**：spec 是行为契约，不是实现约束。`effectKeys` 是 `asyncStorage.ts` 与 `syncStorage.ts` 里的实现细节，未来若重构为 `effectHandler(keys)` 参数化（a1）或 `Set<Key>` 快照（a2），变量名会变但契约不变。写进 spec 会让 spec 反过来锁死实现，违背"如果实现可以改变而外部行为不变，那就不属于 spec"的原则。
- **备选**：直接写 `effectKeys` 变量名。放弃——过度耦合实现。

### D3：Characterization test 只用 `vi.fn()` + 现有 `wait()`，不引入 fake timers

- **选择**：三个 test 都用 `vi.fn()` 计数订阅调用次数 + 现有 `wait()` 辅助（`setTimeout(resolve, 20)`）等待 debounce 收敛。
- **理由**：
  1. 现有 25+ 个 characterization test 都用这个模式，保持一致性（"测试风格统一"是本仓库的隐性代码约定）。
  2. `debounce(wait:0)` 的实现就是 `setTimeout(fn, 0)`，用真实 timer + 20ms 窗口足够稳定；fake timers 会把测试引入"时间被冻结"的场景，掩盖"多 set 之间是否真的跨事件循环"这一关键假设——而当前 characterization 的目的恰恰是**依赖**这个真实事件循环假设。
  3. 不新增依赖、不改 vitest 配置。
- **备选**：用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(1)` 精确控制防抖触发。放弃——测试复杂度上升，且与本 change "锁当前行为"的目标不对齐（fake timer 下无法验证真实事件循环下的行为）。

### D4：三个 test 场景对齐 spec 的两个新 Scenario + 一个覆盖性扩展

- **选择**：
  - `test 1`（并发 set 各自 key 都被通知）→ 覆盖新 Scenario "并发 set 各自 key 都被通知"
  - `test 2`（跨防抖批次 set 匹配独立）→ 覆盖新 Scenario "跨防抖批次 set 匹配独立"
  - `test 3`（连续快速 set 同一 key 不丢通知）→ 覆盖既有 Scenario "多次 set 合并" 的一个边界变体（"多次 set" 之前只测了同一 key 的两次，扩展到验证 fn 是否真的收到通知）
- **理由**：既有 spec 的"多次 set 合并" Scenario 用 `toHaveBeenCalledTimes(1)` 断言"合并行为"，但没有断言"合并后订阅函数真的被调用"（只测了 `toHaveBeenCalledTimes(1)` 隐含 `≥ 1`）——补这个断言让 spec 与 test 语义严格对齐。
- **备选**：只加 2 个 test 对齐 spec 新增的 2 个 Scenario。放弃——`test 3` 的断言补强成本低、覆盖价值高，且属于同一 Requirement 的 characterization 增量，不引入额外概念。

### D5：async + sync 两路各写 3 个 test，不合并成一个 parameterized

- **选择**：`tests/asyncStorage.test.ts` 追加 3 个 `it`，`tests/syncStorage.test.ts` 追加 3 个 `it`，两路各 3 个不合并。
- **理由**：
  1. 现有测试文件也是这个模式（异步/同步分文件），不打破文件组织约定。
  2. 异步版 `set` 是 `async` + `await _engine.setItem(...)`，同步版 `set` 是纯同步——两者的"并发"含义不同（异步靠事件循环排队，同步根本不存在并发），断言逻辑需分别写。
  3. 同步版的 `effectHandler` 触发依赖 `setTimeout(fn, 0)`（同样是异步 timer），所以"跨事件循环"的场景在两路都存在——只是同步版的"并发"场景用连续调用模拟。
- **备选**：用 vitest 的 parameterized test 或抽出 `describe.each` 共享。放弃——共享会掩盖 async/sync 行为差异，不利于 characterization 的清晰性。

## Risks / Trade-offs

- **[Risk] 20ms wait 在 CI 上偶发不稳** → Mitigation：现有 25+ 个 test 已用同一 `wait()` 通过 CI；本 change 不新增时序假设。若将来出现 flake，统一改造 `wait()` 辅助，不属本 change。
- **[Risk] characterization test 反过来限制未来修复** → Mitigation：spec 用抽象术语（"受影响 key 集合"）而非实现细节（`effectKeys`），修复阶段只需修改 test 断言的期望值（从"当前行为"到"应该行为"），不需要改 spec 契约。
- **[Risk] `test 3`（连续快速 set 同一 key）在异步版可能被 debounce 合并到"只通知一次"，与 fn 计数断言冲突** → Mitigation：`test 3` 的断言是 `toHaveBeenCalledTimes(1)`（合并后只调用一次），不是 `toHaveBeenCalledTimes(≥2)`——与既有"多次 set 合并" Scenario 一致。写 test 前先跑一次确认当前行为。
- **[Risk] spec MODIFIED 段落需要全文复制既有 Requirement** → Mitigation：这是 OpenSpec delta 的强制约定（"MODIFIED 必须包含完整更新内容，否则 archive 时丢失细节"），本 change 严格遵循——archive 时既有 3 个 Scenario 语义不变，新追加 2 个。
- **[Trade-off] 不修代码 = bug 依然存在** → 已接受：本 change 的目标是"前馈准备"，不是"修复"。若未来真实竞态复现，另立 change（如 `fix-subscribe-effectkeys-race`）走 refactor。

## Migration Plan

本 change 不涉及线上部署或数据迁移：

- **前向**：直接 commit 后随下一个 npm 版本发布（若 `package.json` 版本号有更新机制）——测试与 spec 变更不进入 npm 包 `files` 白名单，对下游消费者零影响。
- **回滚**：`git revert` 单次 commit 即可；无数据、无配置、无外部依赖变更。
- **对下游消费者**：无 API 变化、无行为变化、无类型变化——不需要任何迁移文档。

## Open Questions

无。所有决策已在 D1-D5 收敛；剩余"要不要真修 bug"的判断题是 `td-apply` 完成后由 `td-archive` 复盘判断，不属本 propose 阶段的 open question。
