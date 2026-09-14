## 1. 测试基础设施搭建

- [x] 1.1 安装 Vitest devDependency 并添加 test script ✅ vitest@2.1.9（固定 2.x，因 Vitest 3+/4+/5+ 需 Vite ≥6.4.0 而项目为 vite@5.0.8；来源：context7 /vitest-dev/vitest GitHub package.json）
  - 文件：`package.json`
  - 风险：low
  - 验证：`npm install -D vitest` 成功，`package.json` 出现 `"test": "vitest run"`，`npx vitest --version` 输出版本号
  - 分系统影响：无（仅 devDependency + script）
  - 依赖：无

- [x] 1.2 确认/调整 tsconfig 与 vite 配置覆盖 tests 目录 ✅ `tsconfig.json` include 加入 `"tests"`；`vite.config.ts` 无需改动（实测 `npx vitest run` 成功加载现有配置，Vitest 默认 include `**/*.{test,spec}.?(c|m)[jt]s?(x)` 已覆盖 tests 目录，本 change 无需自定义 test 选项——不动它遵循最小改动原则）
  - 文件：`tsconfig.json`、`vite.config.ts`
  - 风险：low
  - 验证：`npx tsc --noEmit` 不对 `tests/` 下文件报错；Vitest 能解析 `tests/` 下的 import（`import { createAsyncStorage } from "../libs"` 正常 resolve）
  - 分系统影响：无（仅配置）
  - 依赖：1.1

## 2. Mock Engine 实现

- [x] 2.1 创建 MockEngine（同步版 + 异步版）✅ `tests/mock-engine.ts` 导出 `createMockEngine<A>(isAsync, opts?)` + `mockEncrypt`/`mockDecrypt`；异步版 setItem/getItem/removeItem 均返回 Promise；`npx tsc --noEmit` EXIT=0
  - 文件：`tests/mock-engine.ts`
  - 风险：medium
  - 验证：`tests/mock-engine.ts` 导出 `createMockEngine(isAsync: boolean, opts?)` 函数，返回满足 `StorageEngine<true>` 或 `StorageEngine<false>` 接口的对象；`npx tsc --noEmit` 类型检查通过；mock engine 的 setItem/getItem/removeItem 操作内存 Map，异步版包 `Promise.resolve()`
  - 分系统影响：storage-core（通过接口注入，不改动 storage-core 源码）
  - 依赖：1.2

## 3. Characterization Test — 异步存储

- [x] 3.1 编写 createAsyncStorage characterization test（正常路径 + 键哈希 + 加密 + 增量合并）✅ 7 个用例全绿；mock engine `supportObject` 默认改 false 以匹配真实 engine 行为（消除增量测试的 JSON.parse console.warn）
  - 文件：`tests/asyncStorage.test.ts`
  - 风险：medium
  - 验证：`npx vitest run tests/asyncStorage.test.ts` 全绿；覆盖以下场景——基本读写（set 后 get 返回写入值）、初始值回退（engine 无数据时 get 返回 initialData）、键哈希（enableHashKey=true 时 engine 收到 MD5(key)）、加密读写（secretKey + EncryptFn/DecryptFn，engine 存的是密文，get 返回原值）、对象直存（supportObject=true 且无 secretKey 时 engine 收到对象）、增量合并（increments 含 key 时 set 合并旧值）
  - 分系统影响：storage-core
  - 依赖：2.1

- [x] 3.2 编写 createAsyncStorage characterization test（订阅 + 防抖 + quirky 行为）✅ 订阅/防抖/Q7/Q1/Q2/Q3/Q6 全绿；Q6 用 `engine.setItem("a", "not-a-valid-cipher")` 直接注入坏密文触发解密回退链，spy 验证 console.error + console.warn 双路输出
  - 文件：`tests/asyncStorage.test.ts`（同文件追加）
  - 风险：medium
  - 验证：`npx vitest run tests/asyncStorage.test.ts` 全绿；覆盖以下场景——订阅初始化执行一次、多次 set 防抖合并只通知一次、空 keys 只初始化不返回 unsubscribe（Q7）、无 engine 时 set 返回 Error 实例（Q1）、无 engine 时 get Promise.reject（Q2）、无 engine 时 remove Promise.reject（Q3）、解密失败回退返回密文 + console.warn（Q6）
  - 分系统影响：storage-core
  - 依赖：3.1

## 4. Characterization Test — 同步存储

- [x] 4.1 编写 createSyncStorage characterization test（正常路径 + 键哈希 + 加密 + 增量 + quirky 行为）✅ 11 个用例全绿；同步版覆盖 Q4/Q5/Q7，增量测试用可选属性类型 `{x?:number;y?:number}` 适配源码 `set<K>(key,value:T[K])` 的类型 quirk
  - 文件：`tests/syncStorage.test.ts`
  - 风险：medium
  - 验证：`npx vitest run tests/syncStorage.test.ts` 全绿；覆盖——基本读写、初始值回退、键哈希、加密读写、对象直存、增量合并、订阅防抖、空 keys 只初始化（Q7）、无 engine 时 set 返回 Error（Q4）、无 engine 时 get 返回 Error 实例（Q5）
  - 分系统影响：storage-core
  - 依赖：2.1

## 5. 集成验证

- [x] 5.1 运行全量测试 + 确认零源码改动 ✅ `npm test` 25/25 绿（2 个 test file 全过）；`git diff -- libs/` 输出为空（零源码改动）；`git status` 仅显示 `tests/` 新文件 + `package.json`/`package-lock.json`/`tsconfig.json` 变更 + `openspec/` 目录（`.td-state/` 已被 openspec/.gitignore 正确排除，git status --ignored 验证 `!! openspec/.td-state/`）
  - 文件：无（验证性 task）
  - 风险：low
  - 验证：`npm test` 全量绿；`git diff -- libs/` 输出为空（零源码改动）；`git status` 只显示 `tests/` 新文件 + `package.json` + `package-lock.json` 变更
  - 分系统影响：无
  - 依赖：3.2, 4.1

---

## 关键链标注

**关键链路径**：T1.1 → T1.2 → T2.1 → T3.1 → T3.2 → T5.1

（T4.1 与 T3.1/T3.2 并行，均依赖 T2.1；T3.2 比 T4.1 略多一个 quirky 行为场景组，取较长的 T3.2 路径为关键链。）

**关键链估时**：约 4 个工作单位（T1.1=0.5 + T1.2=0.5 + T2.1=1 + T3.1=1 + T3.2=0.5 + T5.1=0.5）

**Project buffer**：tier-small = 20% × 4 = 0.8 个工作单位，附在关键链末端（T5.1 之后）。

> buffer 不可压缩——它是吸收"Vitest 版本兼容问题 / mock engine 类型不匹配 / quirky 行为断言需调试"等不确定性的容量。若实际执行中发现 quirky 行为比预期复杂（如 Q6 解密回退链需多次调试），buffer 吸收该偏差；若偏差超出 buffer，触发 critical-buffer 约束重新评估。
