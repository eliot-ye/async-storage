## Context

仓库零测试，storage-core 是对外公共 API 所在层。`createAsyncStorage` / `createSyncStorage` 的工厂设计支持注入任意 `StorageEngine` 实例（`libs/types.ts` 定义接口），因此 storage-core 可在零浏览器依赖下测试——只需手写一个内存 mock engine。见 proposal.md 的 Why 节了解动机。

现有 storage-core 行为（reverse-spec 反推，详见 `openspec/specs/storage-core/spec.md`）包含若干 quirky 行为，characterization test 要锁定的是"当前就是这样"，不是"应该这样"。

## Goals / Non-Goals

**Goals:**
- 建立 `npm test` 可运行的测试基础设施（Vitest + test script）
- 手写 mock `StorageEngine`（内存 Map 实现，同步 + 异步两版），注入 storage-core
- 锁定 `createAsyncStorage` 与 `createSyncStorage` 的现有行为，覆盖：基本读写、初始值回退、键哈希、加密/序列化、增量合并、订阅防抖、空 keys 初始化、无 engine 错误处理
- 锁定已知 quirky 行为（见下"Decisions §3"），为后续修 bug 提供对照锚点

**Non-Goals:**
- 不测 engine 分系统（EIndexedDB / ELocalStorage / ECookie）——需 jsdom / 浏览器环境，延迟到后续 change
- 不测 utils 分系统（MD5 / debounce / getOnlyStr）——内部实现，覆盖价值低于 storage-core
- 不测 demo-app（`src/main.ts`）——非发布产物
- 不改任何源码——本 change 纯新增测试文件 + devDependency
- 不引入 jsdom / happy-dom / fake-indexeddb——tier-small 简单优先
- 不引入 CI 配置——本 change 只建测试基础设施，CI 是独立 change

## Decisions

### 1. 测试框架：Vitest

**选择**：Vitest。

**理由**：
- Vite 原生——共享 `vite.config.ts` 的 resolve 别名与 TS 编译配置，零额外配置
- `tier-small` "简单优先"——不引入异构工具链（Jest 需额外 ts-jest / babel 配置）
- API 与 Jest 兼容（`describe/it/expect`），迁移成本低
- 内置 watch mode 与 coverage，后续可用

**备选**：Jest（需 `ts-jest` + `jest.config.ts`，配置量更大，与 Vite 构建链割裂）；Mocha + Chai（配置更碎）。两者均违反 tier-small 简单优先。

### 2. Mock engine 设计：内存 Map，同步 + 异步两版

**选择**：手写 `MockEngine` 类，用 `Map<string, any>` 存储，实现 `StorageEngine<true>` 与 `StorageEngine<false>` 两版接口。同步版 setItem/getItem/removeItem 直接操作 Map；异步版包 `Promise.resolve()`。可配置 `supportObject`（默认 true）与 `onReady`（异步版默认立即可用）。

**理由**：
- storage-core 工厂签名 `(initialData, engines, option)` 的第二参数是 `StorageEngine[]`——天然支持注入，不需要 monkey-patch 或 module mock
- 比 vitest 的 `vi.fn()` 更好——能真实走完 storage-core 的序列化/哈希/合并逻辑，不只是验证"被调用了"
- 两版分开（而非一个类假装同时支持同步异步）——与 `StorageEngine<IsAsync>` 的泛型设计一致，类型安全

**备选**：vitest `vi.mock("../libs/engine/...")` 模块 mock——需 mock 整个 engine 模块，耦合更高，且 storage-core 接受的是实例而非模块引用，模块 mock 多此一举。

### 3. Characterization 纪律：锁定当前行为，含 quirky 行为

**选择**：测试断言当前实际行为，包括以下已知 quirky 行为：

| # | 行为 | 测试断言 |
|---|---|---|
| Q1 | 异步 `set` 无 engine 返回 `Error` 实例（非 throw、非 reject） | `expect(await set(...)).toBeInstanceOf(Error)` |
| Q2 | 异步 `get` 无 engine `Promise.reject` | `await expect(get(...)).rejects.toThrow(ErrorMessage.NOT_ENGINE)` |
| Q3 | 异步 `remove` 无 engine `Promise.reject` | `await expect(remove(...)).rejects.toThrow(...)` |
| Q4 | 同步 `set` 无 engine 返回 `Error` 实例 | `expect(set(...)).toBeInstanceOf(Error)` |
| Q5 | 同步 `get` 无 engine `return new Error(...) as any` | `expect(get(...)).toBeInstanceOf(Error)` |
| Q6 | `get` 解密失败后回退 `JSON.parse(密文)`，失败后 `console.warn` 并返回原始密文 | 断言返回值是密文字符串 + `vi.spyOn(console, 'warn')` |
| Q7 | `subscribe(fn, [])` 只执行一次初始化，不返回 unsubscribe | `expect(subscribe(fn, [])).toBeUndefined()` |

**理由**：characterization test 的纪律是"锁当前行为"。后续修这些 bug 时，对应测试从"锁定旧行为"改为"断言新行为"——这正是 characterization → refactor → update test 工作流。如果现在写"正确行为"，测试会 fail，就不是 characterization 了。

**备选**：只测正常路径，跳过 quirky 行为——安全网有漏洞，后续改这些行为时无法检测回归。不可接受。

### 4. 测试文件组织

```
tests/
├── mock-engine.ts          # MockEngine 类（同步 + 异步两版）
├── asyncStorage.test.ts    # createAsyncStorage 的 characterization test
└── syncStorage.test.ts     # createSyncStorage 的 characterization test
```

**理由**：与 `libs/` 平级，TS 项目常见约定。asyncStorage 与 syncStorage 的逻辑高度重复但接口签名不同（Promise vs 同步），分文件测更清晰。mock-engine 是共享 fixture，独立文件。

### 5. Vitest 配置

**选择**：不新建 `vitest.config.ts`——Vitest 自动读取 `vite.config.ts`。只在 `vite.config.ts` 里视需要加 `test` 字段（Vite 5 + Vitest 2 支持 `/// <reference types="vitest" />` 指令）。若 `vite.config.ts` 现有配置不冲突，可能完全零配置。

**理由**：tier-small 简单优先——零配置 > 最小配置 > 独立配置文件。

## Risks / Trade-offs

- **[只覆盖 storage-core，engine 无安全网]** → 显式取舍，记录在 proposal 的"系统工程影响评估"。后续改 engine 前，先补 engine 的 characterization test（需引入 jsdom，是独立 change 的 scope）。
- **[Vitest 版本与 Vite 5 兼容性]** → Vitest 2.x 要求 Vite ≥5.0（与现有 `vite@^5.0.8` 兼容）。`npm install -D vitest` 取最新 2.x 稳定版，装完后 `npm test` 验证。
- **[mock engine 与真实 engine 行为差异]** → mock 不模拟 IndexedDB 的事务 / localStorage 的配额 / cookie 的编码细节。这是 storage-core 层测试，不是 engine 层测试——mock 只需满足 `StorageEngine` 接口契约即可。
- **[quirky 行为被锁定后，修复需先改测试]** → 这是 characterization 的预期工作流。修 bug 的 change 在 proposal 里要声明"修改 Q1-Q7 中哪些 characterization test 的断言"。
- **[tsconfig.json 的 test 文件可能不在 include 范围]** → 现有 `tsconfig.json` 的 include 可能只覆盖 `libs/` + `src/`，需在 tasks 里确认 `tests/` 是否被 TS 编译覆盖（Vitest 用 esbuild 不依赖 tsc，但 `npm run build` 的 `tsc` 步骤可能报 test 文件的类型错误）。

## Migration Plan

1. `npm install -D vitest`（新增 devDependency）
2. `package.json` 新增 `"test": "vitest run"` script
3. 创建 `tests/mock-engine.ts`、`tests/asyncStorage.test.ts`、`tests/syncStorage.test.ts`
4. 视需要更新 `vite.config.ts`（加 `test` 字段）或 `tsconfig.json`（确保 `tests/` 在 include 或 exclude）
5. `npm test` 验证全绿

**回滚**：`npm uninstall vitest` + 删除 `tests/` 目录 + 移除 test script。无源码改动，回滚零成本。

## Open Questions

无。所有决策点都是可逆的（two-way door），信息已足够闭合。
