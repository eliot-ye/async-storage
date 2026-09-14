## 关键链（critical chain）

**T1 → T2 → T3 → T5**：spec 变更 → test 变更 → 测试通过 → 全量验证。

- T1（spec MODIFIED）必须先于 T2/T3（test 落地）——test 断言要锚定 spec 契约，若 spec 未落地，test 写完后要回头对齐断言描述，产生返工。
- T2/T3（async + sync 两路 test）可**并行**但都依赖 T1；两路 test 无相互依赖。
- T4（todo.md 回写）独立于 T1-T3，可在任意时间点执行；标在关键链外。
- T5（全量验证）是 T1+T2+T3 的汇合点，串行最后一步。

## Project buffer（tier-small 表 1 比例 5%）

按 tier-small 的 critical-buffer 强度：留 **1 项** buffer（T6）。buffer 不预先写具体动作，若关键链任一步骤暴露新工作（如 characterization test 揭示真实竞态），把该工作追加到 buffer 项；不暴露则删除 buffer 项（archive 前清理）。

## 1. Spec 契约补语义

- [x] 1.1 在 `openspec/changes/add-subscribe-characterization-and-spec-gap/specs/storage-core/spec.md` 里，按 MODIFIED Requirements 格式复制既有 `Requirement: 订阅与防抖通知` 全文，并追加 2 个新 Scenario（"并发 set 各自 key 都被通知" / "跨防抖批次 set 匹配独立"），验证：文件存在、`### Requirement:` 头文本与 `openspec/specs/storage-core/spec.md` L110 完全一致（whitespace-insensitive）、4 个 Scenario 都用 `####` 四级标题
  - 验证证据：`grep -c "^#### Scenario:" .../spec.md` → **4**；`grep "^### Requirement:" .../spec.md` → `订阅与防抖通知`（与 baseline 匹配）

## 2. Characterization test — 异步版

- [x] 2.1 在 `tests/asyncStorage.test.ts` 的 `describe("createAsyncStorage — 订阅与防抖")` 组内追加 3 个 `it`（并发 set 各自 key 都被通知 / 连续快速 set 同一 key 不丢通知 / 跨防抖批次 set 匹配独立），验证：`npx vitest run tests/asyncStorage.test.ts` 全绿
  - 验证证据：`npx vitest run tests/asyncStorage.test.ts` → `17 tests ✓ 17 passed (17)`（原 14 + 新 3）
- [x] 2.2 确认 3 个新 test 未依赖未来才改的源码行为：`grep -c "vi\.useFakeTimers" tests/asyncStorage.test.ts` 返回 0（不引入 fake timer，保持真实事件循环假设）
  - 验证证据：`grep -c "vi\.useFakeTimers" tests/asyncStorage.test.ts` → **0**

## 3. Characterization test — 同步版

- [x] 3.1 在 `tests/syncStorage.test.ts` 追加 3 个 `it`（对齐异步版的 3 个场景，但用连续同步调用模拟"并发"），验证：`npx vitest run tests/syncStorage.test.ts` 全绿
  - 验证证据：`npx vitest run tests/syncStorage.test.ts` → `14 tests ✓ 14 passed (14)`（原 11 + 新 3）
- [x] 3.2 确认同步版 3 个 test 与异步版语义对齐（同一 Requirement 的 2 个新 Scenario + 1 个既有 Scenario 补强），验证：`grep -c "^  it(" tests/syncStorage.test.ts` 返回 14（11 原 + 3 新）
  - 验证证据：`grep -c "^  it(" tests/syncStorage.test.ts` → **14**

## 4. TODO 池回写

- [x] 4.1 在 `openspec/todo.md` 的 P0 分节下，把"修复 subscribe 通知在并发 set 时丢失更新"主条目**降级为 P2**，并把描述改写为"补 characterization test + spec 补语义"（对齐 td-explore 结论）
  - 验证证据：`grep -c "P0.*修复 subscribe" openspec/todo.md` → **0**（P0 段已无该条）；`grep -c "P2.*characterization test.*subscribe" openspec/todo.md` → **1**（P2 段已加降级条目）
- [x] 4.2 在该主条目下追加 change 子项 `- [ ] change: add-subscribe-characterization-and-spec-gap`
  - 验证证据：`grep -c "change: add-subscribe-characterization-and-spec-gap" openspec/todo.md` → **1**

## 5. 全量验证（关键链汇合点）

- [x] 5.1 跑 `npm test`，验证：所有 test 全绿，总 case 数从 29 → 77（async 14→17 + sync 11→14 + encryption-contract 12 + secretkeys 27 + integration 7，实际输出为准）
  - 验证证据：`npm test` → `Test Files  5 passed (5)` `Tests  77 passed (77)`，0 fail
- [x] 5.2 跑 `npx tsc --noEmit`，验证：TypeScript 类型检查通过
  - 验证证据：`npx tsc --noEmit; echo "EXIT=$?"` → **EXIT=0**
- [x] 5.3 跑 `npm run build`，验证：构建产物不因新 test 文件引入副作用
  - 验证证据：`npm run build` → `✓ built in 2.19s`，无 error
- [x] 5.4 跑 `git diff --stat -- libs/`，验证：源码零改动
  - 验证证据：`git diff --stat -- libs/` → **空输出**（零源码改动，characterization 未触碰行为）
- [x] 5.5 跑 `openspec validate --all --json`，验证：change artifact 集合无结构性问题
  - 验证证据：`openspec validate --all --json` → change `add-subscribe-characterization-and-spec-gap` **valid: True, issues: []**

## 6. Buffer（tier-small 5% · 1 项）

Buffer 判定：T2/T3 执行时 6 个 characterization test 全部一次性通过（async 17/17、sync 14/14），未复现真实并发 set 丢更新——单线程 JS 事件循环下的时序假设成立。Buffer 项按 tasks.md 原约定在 archive 前删除。
