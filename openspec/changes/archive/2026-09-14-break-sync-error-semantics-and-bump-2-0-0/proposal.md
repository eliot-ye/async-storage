## Why

`createSyncStorage.get()` 在无 engine 时返回 `new Error(ErrorMessage.NOT_ENGINE) as any`——运行时可能返回 `Error` 对象，但 TS 类型声明为 `T[K]`，下游代码 `syncLS.get("counter").toString()` 会在无 engine 场景下运行时崩溃且编译期无警告。对照异步版本 `get()` 无 engine 时 `Promise.reject(new Error(...))` 是**符合 Promise 语义的正确设计**（消费者必须 await 后处理），同步版本绕不开这个"类型说谎"——只能选择"让类型对齐运行时"（宽化为 `T[K] | Error`）或"让运行时对齐语义直觉"（改为 throw）。前者把代价永久压给下游（每次调用都要 `instanceof Error` 分支），后者与异步 reject 对称且类型声明保持不变——**改 throw 是唯一能让"库内类型与运行时一致"且"下游类型无感"的方案**。

同时，npm registry 上最高版本仍是 `1.5.1`（本地 `package.json` 已写到 `1.6.0` 但未发布），本次改动一并把版本号落地为 `2.0.0`，把此前所有 v1.6.0 计划（密钥组、加密契约强化）与本次 sync 语义破坏一并收敛到 major 版本。

补充工程卫生项：新增 CI 冒烟 workflow、README 说明 publish 路径、`.DS_Store` 清理——这些是 maintenance profile 下"改动前先建护栏"的前馈准备，与 breaking 语义绑定在同一个 release 上。

## What Changes

- **BREAKING** `createSyncStorage.get()` 无 engine 时改为 `throw new Error(ErrorMessage.NOT_ENGINE)`，与异步 `get()` 的 `Promise.reject` 对称；TS 类型 `get<K>(key: K): T[K]` **保持不变**（不再 `as any`，直接 throw 不需要类型断言）。
- **BREAKING（版本锚点）** 版本号 `1.6.0 → 2.0.0`，仓库内所有 `v1.6.0` 字样（`README.md` 3 处、`libs/asyncStorage.ts` 注释、`libs/syncStorage.ts` 注释、`src/main.ts` 注释、`tests/encryption-contract.test.ts` 注释、`tests/mock-engine.ts` 注释）改为 `v2.0.0`。
- 新增 `.github/workflows/ci.yml`（push + pull_request 触发；`checkout → setup-node@18 → npm ci → npm run build → npm test → npm pack --dry-run`），与既有 `npm-publish-github-packages.yml`（release 触发）互补共存。
- 新增 `CHANGELOG.md`，`## 2.0.0` 首条目说明所有 breaking 变化（sync get 抛错、密钥组、加密契约强化、HashFn 语义扩展）。
- README 补 "publish from dist/" 说明——解释为何 `package.json` `files: ["*"]` 在当前发布流程（`cd dist && npm publish`）下是空操作（B2c 决策：保持现状，不改 workflow、不改 files 字段）。
- 不引入新 capability；不新增 npm 依赖；不修改 `libs/asyncStorage.ts` 的 `createAsyncStorage` 逻辑（同步/异步的 error 处理仍不对称，但异步版本已正确）；不修改 engine / utils 分系统。

## Capabilities

### New Capabilities

（无——本次改动只强化既有分系统的错误语义，不引入新分系统）

### Modified Capabilities

- `storage-core`：`Requirement: 无 engine 时的错误处理` 中关于**同步版本**错误返回方式的描述变更——从"同步 set/get/remove 返回 Error 实例"改为"同步 set/remove 返回 Error 实例（保持）；同步 get 改为 throw Error"。既有异步 `get`/`remove` 用 `Promise.reject` 的语义不变，既有同步 `set`/`remove` 用 `return new Error(...)` 的语义不变（保持不对称——只有 `get` 因返回值直接进下游表达式而必须改为 throw；`set`/`remove` 的返回值通常不被消费，保持现状避免扩大破坏面）。

## Impact

- **受影响代码**：
  - `libs/syncStorage.ts` L135-137 — `get` 方法中 `return new Error(ErrorMessage.NOT_ENGINE) as any` 改为 `throw new Error(ErrorMessage.NOT_ENGINE)`。
  - `package.json` L3 — `"version": "1.6.0"` → `"version": "2.0.0"`。
  - 注释文本替换（6 处 `v1.6.0` → `v2.0.0`）：`libs/asyncStorage.ts`、`libs/syncStorage.ts`、`src/main.ts`、`tests/encryption-contract.test.ts`、`tests/mock-engine.ts`、`README.md`（3 处）。
  - `.github/workflows/ci.yml` — 新增文件（约 25 行）。
  - `CHANGELOG.md` — 新增文件（首条目 `## 2.0.0`）。
  - `README.md` — 新增"publish 流程"小节（约 3 行，说明 `cd dist && npm publish` 与 `files` 字段的关系）。
- **受影响测试**：
  - `tests/syncStorage.test.ts` — 追加 1 个 case：无 engine 时 `get` 抛错（对齐已有 characterization test 里 sync `set`/`remove` 返回 Error 的既有断言，`get` 现在必须 `expect(() => syncLS.get(...)).toThrow()`）。
  - 其余测试不受影响（无 engine 的 `set`/`remove` 行为不变；异步版本未变）。
- **公共契约**：
  - **BREAKING**：`createSyncStorage.get()` 无 engine 时的运行时行为从"return Error 对象"→"throw Error"。下游需 `try/catch`。
  - **TS 类型不变**：`get<K>(key: K): T[K]` 声明未改，下游 TS 编译无感（`as any` 被移除后编译依然通过）。
  - **BREAKING（版本号锚点）**：npm 从 1.5.1 跳到 2.0.0，跳过未发布的 1.6.0 语义。
  - 无新增字段；无字段废弃；无导出符号变化；`libs/index.ts` 导出列表不变。
- **依赖**：不新增 npm 依赖。GitHub Actions 使用 `actions/checkout@v3` / `actions/setup-node@v3`（与既有 publish workflow 同版本，不引入新 toolchain）。
- **版本**：major bump（`1.6.0 → 2.0.0`）。CHANGELOG 首次建立。
- **文档**：README 补 publish 流程说明；`openspec/specs/storage-core/spec.md` 更新同步 `get` 的错误语义；新增 CHANGELOG.md。

## 系统工程影响评估

（服务钱学森系统工程主基调第 3 条"从定性到定量的综合集成"——专家判断 + 数据 + 模型反复迭代上升到定量认识）

- **影响哪些分系统**：
  - `storage-core`（主要）：`createSyncStorage.get()` 错误语义、`Requirement: 无 engine 时的错误处理` 契约。
  - `engine`（不变）：`StorageEngine` 接口与 3 个内置引擎不动。
  - `utils`（不变）：`libs/utils/*` 不动。
  - **发布流水线**（新增护栏）：新增 CI workflow，不改既有 publish workflow。
  - **文档层**：README + CHANGELOG + specs + 源码注释统一版本锚点。
- **整体性能预期变化**：零运行时性能影响——sync `get` 无 engine 时提前 throw 而非构造 Error 对象返回，实际反而省一次对象分配；CI 增加 3-5 分钟 pipeline 时长（`npm ci + build + test + pack --dry-run`），仅在 push/PR 触发，不占发布路径。
- **这是局部优化还是全局协调**：**全局协调**。同步 error 语义变更看似单点（一个 `return → throw`），但必须与"版本锚点重锚（1.6.0 → 2.0.0）"、"CHANGELOG 建立"、"下游迁移路径"、"CI 护栏"协同发布——任何一环单独动作都会留下不一致状态（例如只改 throw 不 bump major 会让 1.x 用户静默踩雷）。
- **如果是局部优化，对全局失调的风险**：不适用（本次为全局协调）。若拆成多个 change 分别推进（例如"先改 throw"与"后 bump version"），下游会看到一个"类型不变但运行时突然 throw"的中间态——这正是 global 协调的边界。
- **预期行为模型**：
  1. 有 engine 时，`createSyncStorage.get()` 返回值与 v1.5.1 完全一致（不变）。
  2. 无 engine 时，`createSyncStorage.get()` 抛出 `Error`，消息为 `ErrorMessage.NOT_ENGINE`（= `"Storage not found"` 或该常量定义值），下游 `try { syncLS.get("k") } catch (e) { /* handle */ }` 能捕获。
  3. 无 engine 时，`createSyncStorage.set()` / `createSyncStorage.remove()` 仍返回 `Error` 对象（**未变**——保持不对称）。
  4. 异步版本 `createAsyncStorage.get()` / `set()` / `remove()` 行为完全不变（`Promise.reject` / `return Error` / `Promise.reject`）。
  5. 版本号 `npm view gpl-async-storage version` 首次出现 `2.0.0`；CHANGELOG.md 首条目 `## 2.0.0` 列出所有 breaking 变化；README 与源码注释内不再有 `v1.6.0` 字样（除 `openspec/changes/archive/` 历史档案外）。
  6. CI workflow 在 push/PR 时跑 `npm ci → build → test → pack --dry-run`，任一失败红灯。
  - **验证方式**：
    - 新增 1 个 characterization case：无 engine 的 sync `get` 抛错（模型 2）；
    - 既有 77 个 case 全部保留通过（模型 1、3、4）；
    - `grep -rn "v1.6.0"` 排除 `openspec/changes/archive/` 后应返回 0 匹配（模型 5）；
    - `npm run build && npm test && npm pack --dry-run` 在本地与 CI 均通过（模型 6）；
    - `openspec validate --all` 通过（spec 契约语法合规）。
- **与既有架构/风格的遵循关系**：
  - **遵循**：
    - 错误处理模式延续 `ErrorMessage.NOT_ENGINE` 常量（复用已有枚举，不新增）。
    - CI 与既有 publish workflow 共存，不合并、不替换（延续"发布 workflow 与冒烟 workflow 分离"的既有风格）。
    - 测试风格沿用 `tests/syncStorage.test.ts` 的 `describe` / `it` + `vi.mock` 惯例。
    - spec 编辑风格延续 `openspec/specs/storage-core/spec.md` 现有 Requirement → Scenario 层级。
    - README 编辑风格延续"vX.Y.Z 起"锚点格式。
  - **偏离（需说明）**：
    - 同步 `get` 抛错而 `set`/`remove` 仍返回 Error——**局部不对称**。理由：`get` 的返回值直接进入下游表达式（如 `syncLS.get("k").toString()`），类型说谎的代价最大；`set`/`remove` 的返回值通常不被消费（调用方通常忽略返回值），保持返回 Error 的破坏面最小。这是对"破坏面最小"原则的局部妥协，在 spec 里显式记录。
    - 不修改 `libs/index.ts` 导出，不引入新的 error 类——保持现有 error 常量模式。

## caller impact 分析

- **变更点清单**（按四类分类）：
  1. **② 公共行为变更**（`createSyncStorage.get()` 无 engine 时从 return Error → throw）：属于 **② 类（行为变更）+ ① 类（公共 API 返回值语义）**，**高危**。判断：**breaking change**——下游若在无 engine 场景下依赖"get 返回 Error 对象"的行为（如 `const v = syncLS.get("k"); if (v instanceof Error) ...`）会踩到 throw 而不是 return。仓库内 caller：`grep -rn "createSyncStorage" src/ tests/ libs/` 显示**项目内 0 处调用 `createSyncStorage.get()`**（`src/main.ts` 只用了 `createAsyncStorage`；tests 里的 `createSyncStorage` 仅用于加密契约校验的构造），**当前仓库内 caller 无风险**。
  2. **① 版本号锚点变更**（`package.json` `version: 1.6.0 → 2.0.0`）：属于 **② 类（装配点元数据）**，**非高危**（版本号是发布元数据，不进 API 契约）。
  3. **① 新增 CI workflow**（`.github/workflows/ci.yml`）：属于 **④ 类（基础设施）**，**非高危**——不影响下游消费者。
  4. **① 新增 CHANGELOG.md**：属于 **④ 类（基础设施）**，**非高危**。
  5. **① 文档锚点文本替换**（`v1.6.0 → v2.0.0`）：属于 **④ 类（文档）**，**非高危**。
- **高危标记**：仅变更点 1 为高危。go/no-go 判据：explore 阶段用户在决策 **c1** 中**显式选择 α 路径**（`throw` + major bump），并在后续追问"CHANGELOG 不需要说明 1.6.0"时确认 2.0.0 是独立锚点——**go**。
- **已知 caller**（仓库内，逐条判断）：
  - `src/main.ts`：**未调用 `createSyncStorage`**（只用 `createAsyncStorage`）——**无影响**。
  - `tests/syncStorage.test.ts`：调用 `createSyncStorage` 但**未调用 `.get()` 于无 engine 场景**（现有 tests 只测有 engine 的 get）——**无影响**；需新增 1 个 case 覆盖新行为。
  - `tests/encryption-contract.test.ts` L83+ `describe("createSyncStorage — 加密契约校验")`：调用 `createSyncStorage` 但只测**工厂 throw 契约**，不涉及 `.get()` 无 engine 路径——**无影响**。
  - `tests/integration.test.ts`：主要用 `createAsyncStorage`；若含 sync 分支不涉及 `.get()` 无 engine 路径——**无影响**（apply 阶段以 `git grep` 实测兜底）。

## 决策闭合状态

explore 阶段（本会话）已闭合的决策：

| # | 决策 | 结论 |
|---|---|---|
| a1 | CI 版本矩阵 | 单 Node 18 版本（保守，maintenance 优先） |
| b1 | npm files 字段 | B2c：保持现状，仅在 README 补说明 |
| b2 | `.DS_Store` 清理 | 直接 shell `git rm --cached libs/.DS_Store`，不进 change |
| c1 | sync get 无 engine 语义 | **C3：throw**（同步 throw 与异步 reject 对称） |
| c1-bis | 类型是否宽化 | 不需要——throw 不需要 `as any`，类型声明不变 |
| c1-tri | 版本锚点 | 从 1.5.1 直接跳 2.0.0（1.6.0 从未发布，跳过） |
| c1-quad | CHANGELOG 内容 | 建立新 CHANGELOG，2.0.0 首条目列 breaking 变化；**不说明 1.6.0** |
| d1 | async/sync 合并重复代码 | defer（不进本 change） |
| README 锚点替换 | `v1.6.0 → v2.0.0` | 全仓库 6 处替换（源码注释 + 测试注释 + README + mock-engine） |

delay-decision 检查：所有决策已闭合，无新信息需要延迟决策——直接进入实施。

## 实际系统工程影响 vs 预期（archive 复盘）

（tier-small 必填 2 字段；对照源：proposal 的"系统工程影响评估"节）

### 实际影响的分系统

- **storage-core**（主要，proposal 预期一致）：`libs/syncStorage.ts` L134-138 `get` 方法从无 engine 时 `return new Error(...) as any` 改为 `throw new Error(ErrorMessage.NOT_ENGINE)`；TS 类型 `get<K>(key: K): T[K]` 保持不变（`as any` 直接删除，无需替代断言）。同步 `set`/`remove` 保持 `return new Error(...)` 未变（局部不对称，破坏面最小）。异步版本 `libs/asyncStorage.ts` 零行为改动（仅 1 行 `v1.6.0 → v2.0.0` 注释替换）。`libs/index.ts` / `libs/engine/*` / `libs/utils/*` / `libs/types.ts` 零改动（`git diff --stat` 空）。
- **测试层**：`tests/syncStorage.test.ts` L193-197 修改 1 个既有 case（从断言"get 返回 Error 实例"改为"get throw"），非追加——既有断言与新语义冲突，追加会产生两个相互冲突的 case。总 case 数保持 77（未从 77→78，与 tasks.md T2.1 原措辞"追加 1 个"有偏差，已在 tasks.md 备注记录）。`tests/syncStorage.test.ts` 同步 `set`/`remove` 的既有断言（L184/L203）保持不变。`tests/mock-engine.ts` 零行为改动（仅 1 行注释替换）。
- **发布流水线**（旁支，proposal 预期一致）：新增 `.github/workflows/ci.yml`（23 行，push/PR 触发 `npm ci → build → test → cd dist && npm pack --dry-run`）；既有 `.github/workflows/npm-publish-github-packages.yml` 零改动（`git diff` 空）。架构 review warning 1（"workflow 里 pack 步骤要显式 `cd dist`"）已在 workflow 里落地——本地实测：从 root 跑 `npm pack --dry-run` 打包 82 文件（含 tests/src/openspec，与实际发布不一致），从 `dist/` 跑只打包 25 文件（84.7 kB），与发布产物一致。
- **文档 / 元数据**：新增 `CHANGELOG.md`（首条目 `## [2.0.0] - 2026-09-14`，Keep a Changelog 官方格式，`### Breaking Changes` 3 条 + `### Added` 2 条 + `### Changed` 1 条 + `### Documentation` 2 条，**不含 1.6.0 字样**——用户明确指令）；`README.md` 新增"发布流程"小节（L206-210，5 行，解释 `cd dist && npm publish` 与 `files: ["*"]` 的关系）；`package.json` `version: 1.6.0 → 2.0.0`（唯一 1 行 diff）；6 处 `v1.6.0 → v2.0.0` 注释替换（`libs/asyncStorage.ts` L20 / `libs/syncStorage.ts` L24 / `src/main.ts` L79 / `tests/encryption-contract.test.ts` L8 / `tests/mock-engine.ts` L81 / `README.md` L103+L107+L185）；`openspec/changes/archive/` 下历史档案保留 `v1.6.0` 字样（`design.md` 里 2 处）未替换。
- **未实施项**：`.DS_Store` 清理（`git rm --cached libs/.DS_Store`）**未执行**——apply 结束时用户要求"做 .DS_Store 清理"，核查发现 `git ls-files | grep DS_Store` 返回空、`.gitignore` L19 已忽略、`git check-ignore -v` 确认两处 `.DS_Store` 均被忽略、`cd dist && npm pack --dry-run` 25 文件不含 `.DS_Store`——**从未被 tracked**，`git rm --cached` 是空动作。此项原来自 explore 阶段 todo.md P1 条目的判据，事后核查发现判据错误（详见 openspec/todo.md P1 条目的关闭说明）。

### 预期行为模型验证

**预期模型**（proposal「系统工程影响评估 · 预期行为模型」节的 6 条）：

1. 有 engine 时，`createSyncStorage.get()` 返回值与 v1.5.1 完全一致（不变）。
2. 无 engine 时，`createSyncStorage.get()` 抛出 `Error`，消息为 `ErrorMessage.NOT_ENGINE`，下游 `try/catch` 能捕获。
3. 无 engine 时，`createSyncStorage.set()` / `remove()` 仍返回 `Error` 对象（未变——保持不对称）。
4. 异步版本 `createAsyncStorage.get()` / `set()` / `remove()` 行为完全不变。
5. 版本号 `npm view gpl-async-storage version` 首次出现 `2.0.0`；CHANGELOG.md 首条目 `## [2.0.0]` 列出所有 breaking 变化；README 与源码注释内不再有 `v1.6.0` 字样（除 `openspec/changes/archive/` 历史档案外）。
6. CI workflow 在 push/PR 时跑 `npm ci → build → test → pack --dry-run`，任一失败红灯。

**实际验证结果**：模型 1、2、3、4、5（本地部分）、6（本地部分）**全部验证通过**。模型 5 和 6 各有一条子项**依赖 npm registry 与 GitHub Actions 环境**，本地无法验证（需 publish 到 npm 后 `npm view` 才能看到；需 push 到 GitHub 才能触发 CI）。

- **模型 1**：`npm test` **77/77 passed**，`tests/syncStorage.test.ts` 14/14 passed（含所有既有有 engine 的 get/set/remove case 未变）。原有 25 个 characterization test 全绿未改断言 = legacy 路径行为 100% 保留。
- **模型 2**：`tests/syncStorage.test.ts` L193-197 新断言 `expect(() => LS.get("counter")).toThrow(ErrorMessage.NOT_ENGINE)`；TDD RED → GREEN 已验证（改源码前 1 fail / 13 pass，改后 14 pass）。
- **模型 3**：`tests/syncStorage.test.ts` L184-210 里 `set` 与 `remove` 的既有断言保持 `expect(result).toBeInstanceOf(Error)` 未改；`grep -c "return new Error(ErrorMessage.NOT_ENGINE)" libs/syncStorage.ts` = **2**（set + remove）。
- **模型 4**：`git diff --stat -- libs/asyncStorage.ts` = **仅 1 行注释替换**；async 版本 17/17 test pass 无变化。
- **模型 5（本地部分）**：`package.json` L3 = `"version": "2.0.0"`；CHANGELOG.md `grep -c "^## \[2.0.0\]"` = **1**、`grep -c "1\.6\.0"` = **0**；`grep -rn "v1\.6\.0" . --exclude-dir=openspec --exclude-dir=node_modules --exclude-dir=dist --exclude=package-lock.json --exclude=.git` = **0 matches**；`openspec/changes/archive/` 保留 `v1.6.0` 字样（`design.md` 里 2 处）。**"npm view 首次出现 2.0.0"** 子项需 publish 后验证（超出本 change 范围，属 npm 发布动作）。
- **模型 6（本地部分）**：`.github/workflows/ci.yml` 存在（23 行）；本地 `npm run build && npm test && cd dist && npm pack --dry-run` **全部 EXIT=0**（25 文件 / 84.7 kB unpacked）。**"CI 在 push/PR 时触发"** 子项需 push 后由 GitHub Actions 执行，本地无法验证。

**验证手段汇总**：

- `npm test`：**77/77 passed**（5 test files：asyncStorage 17 + syncStorage 14 + integration 7 + encryption-contract 12 + secretkeys 27）
- `npx tsc --noEmit`：**EXIT=0**
- `npm run build`：**✓ built in 1.97s**
- `cd dist && npm pack --dry-run`：**EXIT=0**，25 文件 / 84.7 kB unpacked
- `openspec validate --all --json`：**4/4 valid**（change + 3 specs）
- `git diff --stat -- libs/index.ts libs/engine/ libs/utils/`：**空**（3 处零改动）
- `git diff -- package.json`：**仅 1 行**（`version` 字段）
- `grep -rn "v1\.6\.0"` 排除 archive： **0 matches**
- 架构 review：**0 critical · 1 warning 已落地 · 2 nit 已归档**
- 收尾 code review：**0 critical · 0 warning · 2 nit**

**buffer 判定**：tasks.md T8 buffer 项按约定删除——T1/T2/T3/T4/T5/T6/T7 执行时**未暴露新工作**，所有关键链任务一次性通过，无 CI 首次红灯、无文本替换遗漏、无意外失败。这与 explore 阶段的预判一致（"仓库内 caller 面 = 0，无内部回归风险"）。

### 预期之外的副作用

1. **`.DS_Store` 清理未执行**（proposal 「决策闭合状态」表 b2 行原计划"直接 shell 命令"）：apply 阶段用户要求"做 .DS_Store 清理"，实测发现判据错误——`.DS_Store` 从未被 tracked（`git ls-files | grep DS_Store` 空、`.gitignore` L19 已忽略、`cd dist && npm pack --dry-run` 25 文件不含 `.DS_Store`）。原判据来自本会话 td-explore 阶段的 P1 条目，事后核查两点都不成立（"npm pack 脏包"错、".DS_Store tracked"错），已在 `openspec/todo.md` P1 条目关闭说明中记录。此副作用**不构成本 change 的破坏面**——原计划的 shell 命令是空动作，执行与否无影响；副作用是"explore 判据污染 backlog"这个流程层教训（已写入 global memory）。
2. **T2 从"追加 1 个 case"变为"修改 1 个 case"**（tasks.md T2.1 原措辞）：实施时发现既有 case L193 断言 `get 无 engine 返回 Error 实例` 与新语义冲突，追加会产生两个冲突 case。改为修改既有 case 后 test count 保持 14（未从 14→15），tasks.md T7.1 的"总 case 数从 77 → 78"预期也随之修正为"保持 77"。已在 tasks.md T2.1/T7.1 备注里记录偏差。**不属设计偏差**——只是任务的措辞需要实施阶段校正，测试覆盖语义完全一致（新 case 仍验证 `get` 无 engine 时 throw）。
3. **`describe("无 engine 错误处理（quirky）")` 分组名含过时字样**（收尾 review nit 1）：新语义（throw）不再是 quirky，未来清理时改为"错误语义"或"无 engine 时行为"。不影响行为，仅提示。
4. **CHANGELOG 首条目日期固定为 `2026-09-14`**：若实际 publish 日期推迟到未来某日，需手动更新日期。当前日期与 archive 日期一致，无偏差。

上述副作用均不构成全局失调——第 1 项是流程教训已入 memory，第 2 项是任务措辞已备注，第 3 项是命名建议可延后，第 4 项是日期字段可在 publish 时校对。核心 breaking 语义（sync get throw）+ 版本锚点（2.0.0）+ CI 护栏 + 文档补丁 四件事全部落地，与 proposal 预期一致。
