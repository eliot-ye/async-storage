## 关键链（critical chain）

**T1 → T2 → T3 → T7**：源码改动 → 测试补语义 → 版本锚点替换 → 全量验证。

- **T1**（源码：sync `get` 改 throw）必须先于 **T2**（测试补 throw case）——测试断言要锚定源码实际行为；若 T1 未落地，T2 写完会跑出"return Error"的旧行为，测试无法过。
- **T2**（测试）依赖 T1；与 **T3**（版本号 + 文本替换）可并行——两者无相互依赖。
- **T4**（CI workflow）独立于 T1/T2/T3——CI 是新增文件，不涉及既有代码修改；可与任意步骤并行。
- **T5**（CHANGELOG）依赖 T1/T2/T3——CHANGELOG 首条目要记录所有 breaking 变化，需先确认这些变化已落地才能准确描述。
- **T6**（README）独立——publish 流程说明与 breaking 语义无关；可并行。
- **T7**（全量验证）是所有前序的汇合点，串行最后一步。

**关键链路径**：`T1 → T2 → T3 → T7`；T4/T5/T6 为旁支，汇入 T7。

## Project buffer（tier-small 表 1 比例 5%）

按 tier-small 的 critical-buffer 强度：留 **1 项** buffer（T8）。buffer 不预先写具体动作，若关键链任一步骤暴露新工作（例如 T3 的文本替换遗漏、T4 的 CI 首次红灯、T7 的意外失败），把该工作追加到 buffer 项；不暴露则删除 buffer 项（archive 前清理）。

## 1. 源码改动：sync `get` 改 throw

- [x] 1.1 修改 `libs/syncStorage.ts` 的 `get` 方法：把 `if (!_engine) { return new Error(ErrorMessage.NOT_ENGINE) as any; }` 改为 `if (!_engine) { throw new Error(ErrorMessage.NOT_ENGINE); }`（约 L135-137），验证：`npx tsc --noEmit` 通过（去掉 `as any` 后 TS 类型 `T[K]` 仍匹配）
  - 验证证据：TDD RED → GREEN 已跑（tests/syncStorage.test.ts 14/14 pass）
  - 验证证据：`grep -n "as any" libs/syncStorage.ts` 中 `get` 方法内匹配已删除（其余位置的 `as any` 如有则保留，本条只针对 L136）
- [x] 1.2 确认 `libs/syncStorage.ts` 的 `set` 与 `remove` 方法未变（仍 `return new Error(ErrorMessage.NOT_ENGINE)`），验证：`grep -c "return new Error(ErrorMessage.NOT_ENGINE)" libs/syncStorage.ts` → **2**（set + remove）
  - 验证证据：`grep -c "return new Error(ErrorMessage.NOT_ENGINE)" libs/syncStorage.ts` → **2**
- [x] 1.3 确认 `libs/asyncStorage.ts` 未被本次改动触及（仅注释文本替换），验证：`git diff --stat -- libs/asyncStorage.ts` 只显示 1 行 v1.6.0→v2.0.0 注释变更
  - 验证证据：`git diff -- libs/asyncStorage.ts` → 仅 1 行注释替换

## 2. 测试补新语义

- [x] 2.1 在 `tests/syncStorage.test.ts` L193 修改既有 `it("get 无 engine 返回 Error 实例（Q5，非 Promise / 非 throw）")` case 为 `it("get 无 engine 抛出 Error（v2.0.0 起：与异步 reject 语义对称）")`，用 `expect(() => LS.get("counter")).toThrow(ErrorMessage.NOT_ENGINE)` 断言；同步 `set`/`remove` 既有断言不变
  - 备注：tasks.md 原措辞"追加 1 个 case"，实施时发现既有 case 断言与新语义冲突，改为"修改 1 个 case"（test count 保持 14，非 14→15）；`set`/`remove` 现有断言（L184/L203）保持不变
  - 验证证据：`npx vitest run tests/syncStorage.test.ts` → **14 passed（1 个 case 语义更新）**
  - 验证证据：TDD RED → GREEN 已验证（改源码前 1 fail / 13 pass；改后 14 pass）

- [x] 2.2 确认新增 test 使用既有 mock engine / test helper（不引入新基础设施），验证：`git diff --stat -- tests/mock-engine.ts` → 只显示 1 行 v1.6.0→v2.0.0 注释变更（不改 mock 行为）
  - 验证证据：`git diff -- tests/mock-engine.ts` → 仅 1 行注释替换，无 mock 逻辑改动

## 3. 版本锚点替换

- [x] 3.1 修改 `package.json` L3：`"version": "1.6.0"` → `"version": "2.0.0"`，验证：`grep "\"version\"" package.json` → `"version": "2.0.0"`
  - 验证证据：`grep "\"version\"" package.json` → `"version": "2.0.0"`

- [x] 3.2 替换 6 处源码/测试注释里的 `v1.6.0` → `v2.0.0`：
  - `libs/asyncStorage.ts` L20 注释 ✅
  - `libs/syncStorage.ts` L24 注释 ✅
  - `src/main.ts` L79 注释 ✅
  - `tests/encryption-contract.test.ts` L8 注释 ✅
  - `tests/mock-engine.ts` L81 注释 ✅
  - `README.md` 3 处（L103 / L107 / L185 附近的加密章节）✅
  - 验证：`grep -rn "v1\.6\.0" . --exclude-dir=openspec --exclude-dir=node_modules --exclude-dir=dist --exclude=package-lock.json --exclude=.git` → **0 matches**
  - 验证证据：命令 → **0 matches**

- [x] 3.3 确认 `openspec/changes/archive/` 下的 `v1.6.0` 字样**未被替换**（历史档案保留），验证：`grep -c "v1\.6\.0" openspec/changes/archive/2026-09-14-add-secretkeys-with-rotation-and-legacy-migration/*.md` → **≥ 1**
  - 验证证据：`grep -c "v1\.6\.0" openspec/changes/archive/2026-09-14-add-secretkeys-with-rotation-and-legacy-migration/design.md` → **2**（历史档案保留）

## 4. CI 冒烟 workflow

- [x] 4.1 新增 `.github/workflows/ci.yml`，内容包含：`on: [push, pull_request]`、`runs-on: ubuntu-latest`、`actions/checkout@v3`、`actions/setup-node@v3` with `node-version: 18` + `cache: npm`、步骤 `npm ci → npm run build → npm test → cd dist && npm pack --dry-run`
  - 验证证据：`test -f .github/workflows/ci.yml && echo "exists"` → **exists**
  - 验证证据：`grep -c "cd dist && npm pack --dry-run" .github/workflows/ci.yml` → **1**
- [x] 4.2 确认既有 `.github/workflows/npm-publish-github-packages.yml` **未被改动**，验证：`git diff --stat -- .github/workflows/npm-publish-github-packages.yml` → **空输出**
  - 验证证据：`git diff --stat -- .github/workflows/npm-publish-github-packages.yml` → **空**
- [x] 4.3 本地跑 `npm pack --dry-run`，验证：CI 里的 pack 步骤在本地环境下行为一致
  - 验证证据：`cd dist && npm pack --dry-run` → **EXIT=0**，25 文件 / 84.2 kB unpacked
  - 验证证据（对比）：从 repo root 执行 `npm pack --dry-run` → 82 文件 / 367.8 kB unpacked（含 tests/src/openspec）——**确认架构 review warning 1 落地**：workflow 里必须 `cd dist && npm pack --dry-run`，否则 CI 绿灯不代表发布产物正确
  - 备注：架构 review warning 1 的落地路径已按建议采用（workflow 里显式 `cd dist`）

## 5. CHANGELOG 建立

- [x] 5.1 新建 `CHANGELOG.md`，格式遵循 Keep a Changelog，首条目 `## [2.0.0] - 2026-09-14`，含 `### Breaking Changes` 段（列 3 条：sync `get` 抛错语义、版本号从 1.5.1 直接跳 2.0.0、加密契约强化 `MISSING_ENCRYPT_FN` throw）与 `### Added` 段（列 1 条：`secretKeys` 密钥组 + 轮换 + legacy 迁移）
  - 验证证据：`grep -c "^## \[2.0.0\]" CHANGELOG.md` → **1**
  - 验证证据：`grep -c "^### Breaking Changes" CHANGELOG.md` → **1**
  - 验证证据：`grep -c "1\.6\.0" CHANGELOG.md` → **0**（用户明确指令：不说明 1.6.0）

## 6. README 补 publish 流程说明

- [x] 6.1 在 README 的"自定义存储引擎"章节之前插入 "发布流程" 小节，说明发布从 `dist/` 目录执行（`cd dist && npm publish`），因此 `files: ["*"]` 对实际发布是空操作
  - 验证证据：`grep -n "发布流程" README.md` → **L206**（新增段落存在）
  - 验证证据：`grep -c "cd dist && npm publish" README.md` → **1**
- [x] 6.2 确认 `package.json` `files` 字段**未被修改**（B2c 决策：保持 `["*"]`），验证：`grep -A2 '"files"' package.json` → 含 `"*"`
  - 验证证据：`grep -A2 '"files"' package.json` → 含 `"*"`

## 7. 全量验证（关键链汇合点）

- [x] 7.1 跑 `npm test`，验证：所有测试全绿。备注：因 T2.1 实际是"修改 1 个 case"而非"追加"（既有 case 与新语义冲突），总 case 数保持 77（未从 77→78）
  - 验证证据：`npm test` → **77 passed**（asyncStorage 17 + syncStorage 14 + integration 7 + encryption-contract 12 + secretkeys 27），0 fail
- [x] 7.2 跑 `npx tsc --noEmit`，验证：TypeScript 类型检查通过（sync `get` 去掉 `as any` 后仍类型安全）
  - 验证证据：`npx tsc --noEmit; echo "EXIT=$?"` → **EXIT=0**
- [x] 7.3 跑 `npm run build`，验证：构建产物生成正常
  - 验证证据：`npm run build` → **✓ built in 1.97s**，无 error
- [x] 7.4 跑 `npm pack --dry-run`（在 dist/ 目录下），验证：发布产物内容与预期一致
  - 验证证据：`cd dist && npm pack --dry-run` → **EXIT=0**，25 文件 / 84.7 kB unpacked（含 index/asyncStorage/syncStorage/cookie/localStorage/indexedDB + secrets/tools chunk + LICENSE + README + package.json + CHANGELOG）
- [x] 7.5 跑 `openspec validate --all --json`，验证：change artifact 集合无结构性问题
  - 验证证据：`openspec validate --all --json` → **4/4 valid**（change + 3 specs 全绿）
- [x] 7.6 跑 `grep -rn "v1\.6\.0" . --exclude-dir=openspec --exclude-dir=node_modules --exclude-dir=dist --exclude=package-lock.json --exclude=.git`，验证：全仓库非 archive 区域 0 处残留 `v1.6.0` 字样
  - 验证证据：命令 → **0 matches**
- [x] 7.7 跑 `git diff --stat -- libs/index.ts libs/engine/ libs/utils/ package.json`，验证：`libs/index.ts` / `libs/engine/` / `libs/utils/` 未变；`package.json` 仅 `version` 字段变化
  - 验证证据：`git diff --stat -- libs/index.ts libs/engine/ libs/utils/` → **空**（3 处路径无改动）
  - 验证证据：`git diff -- package.json | grep -E "^\+|^-" | grep -v "^---\|^+++"` → **仅 1 行 diff**：`- "version": "1.6.0",` / `+ "version": "2.0.0",`

## 8. Buffer（tier-small 5% · 1 项）

Buffer 判定：T2/T3/T4/T5/T6/T7 执行时**未暴露新工作**——所有关键链任务一次性通过，无 CI 首次红灯、无文本替换遗漏、无意外失败。Buffer 项按 tasks.md 原约定在 archive 前删除。
