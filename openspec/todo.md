# TODO（待办池）

项目级待办池。每条未勾选条目是一个潜在 change 的候选。

profile: `profile-maintenance` × `tier-small`（见 `.td-state/profile-tier.yaml`）

## 进行中

## 已完成

- [x] 密钥组轮换与老数据迁移
  - [x] change: add-secretkeys-with-rotation-and-legacy-migration

## 待办

### P0 · 线上稳定性与安全

- [ ] [P0] 补 CI 冒烟
  - 现状：`package.json` 只有 `test: vitest run`，无任何 CI 配置
  - 目标：GitHub Actions 最少覆盖 `npm ci && npm run build && npm test && npm pack --dry-run`
  - 触发原因：maintenance profile 瓶颈 = 部署 pipeline（`profile-maintenance.md` §4）
  - 参考：本会话 td-explore 探索记录（a1 组）

### P1 · 工程卫生与打包

- [ ] [P1] 收紧 npm 打包 `files` 白名单并清理 tracked `.DS_Store`
  - 现状：`package.json` `files: ["*"]` 会把 `tests/`、`src/`、`dist/`、`node_modules/` 之外的仓库杂物打进 npm 包；`libs/.DS_Store` 被 explicit add 到 git（`.gitignore` 有 `.DS_Store` 但被覆盖）
  - 目标：`files` 改为 `["dist"]`（或精确白名单 `["index.*", "cookie.*", "localStorage.*", "indexedDB.*"]`）；`git rm --cached libs/.DS_Store`
  - 触发原因：npm pack 脏包 + 已发 1.5.1 的下游用户拿到不必要的文件
  - 参考：本会话 td-explore 探索记录（b1 / b2 组）

### P1 · 类型契约与 API 语义

- [ ] [P1] 澄清 `engines[]` 数组 API 的语义（只用第一个 vs 加 fallback）
  - 现状：`createAsyncStorage` / `createSyncStorage` 接受 `engines: (...)[]`，但内部只取 `_engines[0]`（`libs/asyncStorage.ts` L19-20）
  - 三选一路径（需 human-in-loop 裁决，属通用基线第 1 类：公共契约变更）：
    - 加真 fallback（第一个 null 时尝试下一个）
    - 参数改成单个 engine（breaking change，走 major version）
    - 保持现状 + JSDoc 显式说明"数组仅取第一个可用 engine"（最小改动）
  - 触发原因：`src/main.ts` L12 `[EIndexedDB(), ELocalStorage()]` 是误导性示例
  - 参考：本会话 td-explore 探索记录（c4 组）

- [ ] [P1] 修 `createSyncStorage.get()` 的类型契约
  - 现状：`get<K>(key: K): T[K]` 但无 engine 时 `return new Error(...) as any`（`libs/syncStorage.ts` L101-104）——运行时可能返回 Error，类型却是 `T[K]`
  - 目标：改成 `T[K] | Error`（宽化，向后兼容）；或在 JSDoc 里明确"调用前需先确认 engine 存在"
  - 触发原因：异步版本用 `Promise.reject` 规避了这个，同步版本绕不开
  - 参考：本会话 td-explore 探索记录（c4 组）

### P2 · 技术债与代码卫生

- [x] [P2] 补 subscribe 并发 set 的 characterization test + spec 补语义
  - 现状：`effectKeys` 是实例级共享闭包变量，`effectHandler` 结束时清空；单线程 JS 里"并发 set 丢更新"复现不出来（每次 set 重新 push，不会跨事件循环被清空）
  - 目标：characterization test 锁定当前行为 + spec 补"effectHandler 触发后清空 effectKeys"语义；若未来复现出真实竞态再升级为修复
  - 参考：本会话 td-explore 探索记录（2026-09-14）
  - [x] change: add-subscribe-characterization-and-spec-gap

- [ ] [P2] 合并 async/sync storage 的重复代码
  - 现状：`libs/asyncStorage.ts` 与 `libs/syncStorage.ts` 的 `getHashKey` / `subscribeMap` / `effectKeys` / `effectHandler` / `subscribe` / `get` 加密+JSON.parse 回退路径几乎逐行一致，共 ~40 行相同代码
  - 影响：改 `get` 加密分支时两个文件必须同步改，漏改一个就产生异步/同步行为漂移；`tests/integration.test.ts` 只测了一路，未检测漂移
  - 目标：抽 `libs/core/` 共享内部工具（保持两个工厂导出不变），或用 TS 泛型 `IsAsync extends boolean` 做一个工厂
  - 触发原因：技术债，不紧急；延后到 secretKeys change archive 之后
  - 参考：本会话 td-explore 探索记录（c1 组）

- [ ] [P2] 清理 `libs/utils/tools.ts` 的未引用工具函数
  - 现状：140 行里只有 4 个被真实引用（`MD5` 实际在 `encoding.ts`；`debounce` / `getOnlyStr` / `CusLog` 被 storage-core 引用）；`getUrlQuery` / `getValueFromStringKey` / `toTitleCase` / `toEachTitleUpperCase` / `getRandomInteger` / `throttle` / `logNameValueBase` 共 7 个未被引用
  - 影响：仍在构建产物里（`vite.config.ts` 的 `rollupOptions.external: []` 不打 tree-shake）
  - 目标：删除 7 个死函数；同步更新 `openspec/specs/utils/spec.md`（当前只 spec 化了 4 个函数，反向 spec 漏网）
  - 参考：本会话 td-explore 探索记录（c2 组）

- [ ] [P2] 统一 demo 与库的加密库使用
  - 现状：`src/utils/encoding.ts`（demo 用）用 `crypto-js`，`libs/utils/encoding.ts`（库用）用 `js-md5`，两个 `MD5()` 函数并存
  - 影响：demo 不进包，不影响线上用户；但 demo 是"用户照着抄"的示例，用不同加密库会误导
  - 目标：demo 改用 `js-md5` + 占位 `EncryptFn`/`DecryptFn`，或删除 demo 的加密路径
  - 参考：本会话 td-explore 探索记录（c5 组）

### P2 · Spec 覆盖补齐（reverse-spec 漏网）

- [ ] [P2] 补齐 `openspec/specs/` 的覆盖缺口
  - 缺口 1：`specs/utils/spec.md` 未 spec 化 7 个未引用函数（对应"清理 utils 死代码"条目，可在删除前 spec 化以留追溯）
  - 缺口 2：`specs/storage-core/spec.md` 未 spec 并发 set 的语义（对应 P0 "subscribe 通知丢失更新"条目，需先 spec 现有 buggy 行为再修）
  - 缺口 3：`specs/engine/spec.md` 未 spec 多实例并存时的独立 db 语义（如 `EIndexedDB()` + `EIndexedDB("LSSecret")` 是两个独立数据库）
  - 触发原因：reverse-spec 建立 baseline 时漏网；不阻塞当前工作，但下次 propose 前建议补齐
  - 参考：本会话 td-explore 探索记录（d2 组）
