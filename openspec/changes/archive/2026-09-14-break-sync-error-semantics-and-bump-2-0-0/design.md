## Context

见 `proposal.md` 的 Why 节。补充约束：

- 项目当前状态：`package.json` `version: "1.6.0"`（**npm registry 尚未发布 1.6.0**，最高发布版本为 `1.5.1`），本地工作树干净，HEAD 为 `cce4f42`。
- `createSyncStorage` 在仓库内的使用面：**0 处**——`src/main.ts` 只调用 `createAsyncStorage`；`tests/syncStorage.test.ts` 与 `tests/encryption-contract.test.ts` 使用 `createSyncStorage` 但从未在无 engine 场景下调用 `.get()`；`tests/integration.test.ts` 主要走 async 路径。
- 现有 CI：`.github/workflows/npm-publish-github-packages.yml`（`release: published` 触发，从 `dist/` 发布到 npm）。**无冒烟 workflow**——`package.json` `scripts` 只有 `dev` / `build` / `preview` / `test`。
- 现有错误处理枚举：`libs/types.ts` L45-47 `ErrorMessage.NOT_ENGINE = "No storage engine"` / `MISSING_ENCRYPT_FN`——本 change 复用 `NOT_ENGINE`，不新增枚举成员。
- 现有 spec 的 `Requirement: 无 engine 时的错误处理`（`openspec/specs/storage-core/spec.md` L136-143）声明"同步 set/get/remove 返回 Error 实例"——本 change 走 MODIFIED 流程，重写整个 Requirement 块，把同步 `get` 单独提出为 throw 语义，同步 `set`/`remove` 与异步 `set`/`get`/`remove` 语义保持不变。
- 现有 spec 里"订阅与防抖通知"的 concurrency 语义已经 characterization 锁定（上一 change archive），本 change 不触碰该 Requirement。
- maintenance profile 强度：不动公共契约（除非走 major）、不动生产流水线（除非明显增益）、避免为卫生动生产内部。本次同步 `get` throw 属公共契约变更 → 走 major bump 是符合 maintenance profile 强度的路径。

## Goals / Non-Goals

**Goals：**

1. `createSyncStorage.get()` 无 engine 时改为 `throw new Error(ErrorMessage.NOT_ENGINE)`，与异步 `get()` 的 `Promise.reject` 语义对称——让"库内类型与运行时一致"，且下游 TS 类型无感。
2. 版本号从 `1.6.0` 落地为 `2.0.0`，全仓库 `v1.6.0` 字样统一替换为 `v2.0.0`（6 处：README 3 + 源码注释 3 + 测试注释 1）。
3. 新增 GitHub Actions CI 冒烟 workflow（`.github/workflows/ci.yml`），push/PR 触发 `npm ci → build → test → pack --dry-run`，与既有 publish workflow 互补共存。
4. 建立 `CHANGELOG.md`，`## 2.0.0` 首条目记录所有 breaking 变化（sync get 抛错 + 密钥组 + 加密契约强化 + HashFn 语义扩展）——**不提及 1.6.0**（用户明确指令）。
5. README 补"publish 流程"说明——解释 `cd dist && npm publish` 与 `files: ["*"]` 字段的关系，让后续读配置的人不用逆向工作流。
6. 补 characterization test 覆盖新语义：无 engine 时同步 `get()` throw。

**Non-Goals：**

1. 不修改 `createSyncStorage.set()` / `remove()` 的错误语义——两者仍返回 Error 实例（保持局部不对称）。理由：`set`/`remove` 的返回值通常不被消费，破坏面最小；`get` 的返回值直接进下游表达式，必须对齐。
2. 不修改 `createAsyncStorage` 的任何逻辑——异步版本的错误语义已正确，不动。
3. 不修改 `libs/index.ts` 导出、`libs/types.ts` 类型定义、`libs/engine/*`、`libs/utils/*`——本次改动只碰 `libs/syncStorage.ts` 一处。
4. 不引入 `Error` 子类（如 `NoEngineError extends Error`）——保持现有 error 常量模式（`ErrorMessage.NOT_ENGINE` 字符串常量）。
5. 不引入新的 npm 依赖——CI 只用 `actions/checkout@v3` / `actions/setup-node@v3`（与 publish workflow 同版本）。
6. 不修改 `package.json` `files` 字段、`exports` 字段、`scripts` 字段——B2c 决策：保持现状，仅在 README 补说明。
7. 不修改 `vite.config.ts`、`tsconfig.json`——不改构建配置。
8. 不执行 `.DS_Store` 清理（B1）——那是独立的 shell 命令（`git rm --cached libs/.DS_Store`），不进本 change 的 tasks（避免让 breaking change 的验证被卫生工作稀释）。
9. 不合并 async/sync storage 重复代码（d1 已定 defer）——不进本 change。
10. 不在 CHANGELOG 里提及 1.6.0 版本（用户明确指令）。
11. 不修改 `openspec/changes/archive/` 下任何文件（历史档案）——`v1.6.0` 字样在 archive 里保留。

## Decisions

### D1：同步 `get` 抛错，同步 `set`/`remove` 仍返回 Error

- **选择**：只改 `libs/syncStorage.ts` L135-137 的 `get` 方法：`return new Error(ErrorMessage.NOT_ENGINE) as any` → `throw new Error(ErrorMessage.NOT_ENGINE)`。同步 `set`/`remove` 的 return Error 保持不变。
- **理由**：
  1. `get` 的返回值直接进入下游表达式（如 `syncLS.get("k").toString()`），"类型说谎"的代价最大——改 throw 后 TS 类型 `T[K]` 保持不变，但运行时行为对齐。
  2. `set`/`remove` 的返回值通常不被消费（调用方忽略返回值），保持返回 Error 的破坏面最小。
  3. 与异步版本对齐：`get` 用 `reject` / `throw`，`set`/`remove` 中 async `set` 也是 return Error（对称的不对称）。
- **备选**：全部同步方法都改为 throw。放弃——扩大破坏面，`set`/`remove` 的返回 Error 现状并无实际损害。
- **备选**：全部保持返回 Error，改 TS 类型为 `T[K] | Error`。放弃——把代价永久压给下游，每次调用都要 `instanceof Error` 分支。explore 阶段用户在决策 c1-bis 中显式选 α（throw）。

### D2：版本号从 1.6.0 直接跳 2.0.0，跳过未发布的 1.6.0

- **选择**：`package.json` `version: "1.6.0"` → `"2.0.0"`。CHANGELOG 首条目 `## 2.0.0`。**不在 CHANGELOG 里说明"1.6.0 未发布"**。
- **理由**：
  1. `npm view gpl-async-storage versions` 确认最高发布版本 `1.5.1`——1.6.0 从未进过 registry，无外部消费者。
  2. 从 1.5.1 到 2.0.0 的跳跃语义正确（有 breaking change 就该跳 major）。
  3. CHANGELOG 不说明 1.6.0：让 2.0.0 作为独立锚点，避免下游用户困惑"为什么中间少了 1.6.x"。这是用户明确指令。
- **备选**：先发 1.6.0 再发 2.0.0。放弃——1.6.0 从未有过 npm 消费者，发一个仅本地存在的版本再发 major 是浪费版本号空间。
- **备选**：改成 1.7.0（minor）。放弃——sync get throw 是运行时行为变更，属 breaking，minor 不合规。

### D3：CI workflow 与 publish workflow 共存，不合并

- **选择**：新增 `.github/workflows/ci.yml`，`on: [push, pull_request]`；既有 `.github/workflows/npm-publish-github-packages.yml` 不动（仍 `release: published` 触发）。
- **理由**：
  1. 发布 workflow 需要 `packages: write` 权限与 `NODE_AUTH_TOKEN` 密钥——冒烟 workflow 不需要这些敏感权限，独立文件更符合最小权限原则。
  2. 冒烟 workflow 应在 push/PR 就运行，若绑到 release workflow 则只在 release 时跑——失去提前拦截的意义。
  3. 独立 workflow 后续可以各自演进（例如冒烟加 Node 版本矩阵、加 lint；发布加 provenance）。
- **备选**：合并到 publish workflow 用 `if:` 分支。放弃——语义混杂，未来独立演进困难。
- **备选**：只用一个 workflow。放弃——见上。

### D4：CI 单 Node 18 版本，不加矩阵

- **选择**：CI 里 `node-version: 18`，与既有 publish workflow 对齐。
- **理由**：
  1. maintenance profile 强度：避免不必要的 CI 时长成本（矩阵是 3× 时长）。
  2. 项目 `package.json` 无 `engines` 字段声明支持的 Node 版本范围——单版本冒烟已足够拦截大多数构建失败。
  3. 若后续发现版本兼容问题，再扩矩阵——延迟决策，不预设。
- **备选**：Node 18/20/22 矩阵。放弃——CI 时长 3×，当前无证据需要。
- **备选**：加 `npm audit`。放弃——本次改动范围外，不引入新的失败原因。

### D5：CHANGELOG 只记 2.0.0 首条目，从简

- **选择**：`CHANGELOG.md` 用 Keep a Changelog 风格，首条目 `## 2.0.0 - 2026-09-14`（日期待 archive 时确认），列 breaking 变化 4 条 + 增强 1 条。**不写"从 1.5.1 跳过来"、不提 1.6.0、不写迁移指南**（README 已有加密迁移指南）。
- **理由**：
  1. 保持 CHANGELOG 简洁——用户明确指令"不需要说明 1.6.0"。
  2. 迁移指南已有：README 加密章节的 legacy 迁移段落；sync get throw 的行为差异在 spec.md 与 README 里都有。
  3. 版本锚点用具体日期而非"unreleased"，让 CHANGELOG 从建立第一天起就是"已发布记录"而非"待发布草稿"。
- **备选**：加 `## Unreleased` 段。放弃——本 change 直接发布 2.0.0，无 unreleased 中间态。
- **备选**：写详细迁移指南。放弃——已在 README / spec 里存在，CHANGELOG 不重复。

### D6：README 补 publish 流程说明，不改 `files` 字段

- **选择**：在 README 末尾"自定义存储引擎"章节之前插入一个 3-5 行的小节，说明"publish 从 `dist/` 目录执行（见 `.github/workflows/npm-publish-github-packages.yml`），因此 `package.json` 的 `files` 字段对实际发布是空操作"。`package.json` `files: ["*"]` **保持不变**。
- **理由**：
  1. B2c 决策：保持 workflow 与 files 字段现状——maintenance profile 不轻易动生产流水线。
  2. 但配置与实际流程的不一致是"隐性 bug"——未来读者（包括未来的自己）会误以为 `files: ["*"]` 意味着发布所有文件。补文档消除误导。
  3. 不改 `files` 字段的另一个原因：改了会破坏现有 publish 流程（`cd dist && npm publish` 场景下 `files: ["dist"]` 找不到 `dist/` 子目录）。
- **备选**：改 `files` 为 `["dist"]`。放弃——需同时改 workflow 为从 root 发布，扩大改动面。
- **备选**：什么都不做。放弃——隐性 bug 会传染给未来的读者。

### D7：`.DS_Store` 清理不进本 change

- **选择**：`.DS_Store` 清理作为独立 shell 命令 `git rm --cached libs/.DS_Store`，在实施阶段开始前的预备动作里执行；不列入 tasks.md 主体。
- **理由**：
  1. `.DS_Store` 是 hygiene 而非契约——与 breaking change 混在一个 change 里会稀释"验证 breaking 是否完整落地"的清晰度。
  2. 单独 shell 命令 5 秒完成，走 td 流程的成本 > 收益。
  3. 用户明确指令 b2："直接 shell 命令"。
- **备选**：列入 tasks.md 第一条。放弃——见上。

### D8：Characterization test 只加 1 个 case，不重构既有测试

- **选择**：`tests/syncStorage.test.ts` 追加 1 个 `it` case，验证无 engine 时 `get()` throw。既有 11 个 case 全部保留。
- **理由**：
  1. 新语义只需 1 个正向断言（throw 时抛的 error 消息等于 `ErrorMessage.NOT_ENGINE`）。
  2. 不重构既有测试——characterization 阶段的原则是"加不改"，重构会破坏回归锚点。
  3. 同步 `set`/`remove` 返回 Error 的既有测试保持不变——它们已经断言了正确的现状。
- **备选**：加 3 个 case（get/set/remove 各一个）覆盖同步错误处理。放弃——`set`/`remove` 语义未变，加 case 无信息增益。

### D9：v1.6.0 → v2.0.0 文本替换不引入搜索脚本

- **选择**：手工列出 6 处替换点（README 3 + `libs/asyncStorage.ts` 1 + `libs/syncStorage.ts` 1 + `src/main.ts` 1 + `tests/encryption-contract.test.ts` 1 + `tests/mock-engine.ts` 1），逐个 `edit_file`。
- **理由**：
  1. 6 处可枚举，无遗漏风险；手工 replace 每处都经过 review。
  2. 不用 `sed -i`（工作守则禁止）也不用 `search_replace`（跨多文件，需限定 glob）——`edit_file` 更精确。
  3. `grep -rn "v1\.6\.0" . --exclude-dir=openspec` 会在替换后验证为 0 匹配（archive 阶段）。
- **备选**：`search_replace` 全仓替换。放弃——会误伤 `openspec/changes/archive/`（历史档案保留 v1.6.0 字样），需 glob 排除；手工枚举更安全。
- **备选**：写脚本批量替换。放弃——6 处手写更快。

## Risks / Trade-offs

### R1：同步 `get` throw 是运行时 breaking，下游可能踩雷

- **风险**：下游若有无 engine 场景下调用 `syncLS.get("k")` 且不包 try/catch 的代码，从"运行时 return Error 对象"变成"throw 到顶层"，可能导致页面/组件崩溃。
- **缓解**：
  1. 本 change 走 major bump（2.0.0），CHANGELOG 明确声明；
  2. 项目内 caller 面 = 0（`grep` 确认），无内部回归；
  3. npm 上 1.5.1 是最高版本，1.6.0 从未发布，实际外部消费者基数 = 1.5.1 用户，`createSyncStorage` 在 1.5.1 的公开文档（README）里**没有示例**（`grep createSyncStorage README.md` 无匹配），说明该 API 在 1.x 期间曝光面极低。
- **判断**：可接受——破坏面在文档层面已隔离，且 npm 版本历史显示 1.x 期间 sync 版本曝光少。

### R2：`set`/`remove` 保持 return Error，与 `get` throw 形成"局部不对称"

- **风险**：下游可能对同步 API 的三个方法产生"错误处理语义不统一"的困惑。
- **缓解**：
  1. spec.md 里 `Requirement: 无 engine 时的错误处理` 明确列出所有 6 个（async 3 + sync 3）方法的错误语义——契约层面可查。
  2. proposal 里显式声明这个不对称是"局部妥协"（破坏面最小原则）。
  3. 未来若有需要，可以再提 change 把 `set`/`remove` 也改为 throw（进一步破坏面 + 独立 change）。
- **判断**：可接受——不对称是有据可查的设计决策，不是疏忽。

### R3：CI workflow 新增，可能引入新的红灯

- **风险**：`npm pack --dry-run` 在特定环境下可能因 `.npmignore` 缺失或 `files` 字段与 publish 路径不匹配而失败，产生新红灯。
- **缓解**：
  1. CI 步骤先本地跑一遍 `npm pack --dry-run` 确认行为，再入 workflow（tasks.md 显式要求）。
  2. CI 失败时可回退到"仅 build + test"（跳过 pack dry-run），不阻塞本 change。
- **判断**：可控——先本地验证，再入 workflow。

### R4：CHANGELOG 建立，但未来维护者可能误用格式

- **风险**：首条目格式若不规范，后续维护者复制时会延续错误格式。
- **缓解**：
  1. 首条目用 Keep a Changelog 官方格式（`## [version] - YYYY-MM-DD`）；
  2. 首条目内用 `### Breaking Changes` / `### Added` / `### Changed` 分节，与 Keep a Changelog 官方一致；
  3. 不加自定义扩展字段——保持格式标准化。
- **判断**：可控——遵循官方格式即可。

### R5：`v1.6.0 → v2.0.0` 替换遗漏

- **风险**：6 处文本替换可能遗漏（例如某处注释里"v1.6.0"没被 grep 到）。
- **缓解**：
  1. 替换后用 `grep -rn "v1\.6\.0\|1\.6\.0" . --exclude-dir=openspec --exclude-dir=node_modules --exclude-dir=dist --exclude=package-lock.json` 验证 0 匹配；
  2. `package-lock.json` 里的 `1.6.0` 是依赖包版本（如 `@jridgewell/sourcemap-codec@1.6.0`），**不替换**（会破坏 lockfile）。
- **判断**：可控——有明确的验证命令。

### R6：npm publish 前的最后一次校验

- **风险**：CI 只跑 push/PR，不跑 release workflow——若 release 时才发现构建产物有问题，会浪费 release。
- **缓解**：
  1. 本 change 实施阶段先在本地跑 `npm ci && npm run build && npm test && npm pack --dry-run` 完整链路（tasks.md 显式要求）；
  2. 发布 2.0.0 时的 workflow 仍是既有 publish workflow，本 change 不改它——发布风险与当前状态一致。
- **判断**：可接受——本 change 目标是"新增护栏"，不是"改造发布"。

### 风险分级

| 风险 | 严重度 | 概率 | 缓解强度 |
|---|---|---|---|
| R1 | 高（下游崩溃） | 低（曝光面小） | 强（CHANGELOG + major bump） |
| R2 | 中（体验不一致） | 中 | 强（spec 明确） |
| R3 | 中（CI 红灯） | 中 | 中（先本地验证） |
| R4 | 低（格式漂移） | 低 | 强（官方格式） |
| R5 | 低（残留锚点） | 低 | 强（grep 验证） |
| R6 | 低（发布阻塞） | 低 | 中（本 change 不修 publish） |

无 critical 风险——所有风险都有明确缓解路径，无阻塞项。
