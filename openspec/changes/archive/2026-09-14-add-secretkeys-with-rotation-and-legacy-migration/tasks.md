## 关键链与缓冲

**关键链**（按依赖顺序，最长路径）：
1.1 → 2.1 → 2.2 → 3.1 → 3.5 → 3.2 → 3.3 → 3.4 → 4.1 → 5.1 → 6.1

**关键链总估时**：约 6.5 小时（1.1=20min + 2.1=30min + 2.2=30min + 3.1=30min + 3.5=30min + 3.2=60min + 3.3=60min + 3.4=60min + 4.1=60min + 5.1=60min + 6.1=30min）

**project buffer（tier-small = 20%）**：约 1.3 小时 → 折算为 6.2 任务（README 与文档完善 + 集成回归）。

**支流**（并行/独立，可插入 project buffer 前的间隙）：
- 1.2（导出，30min）— 挂在 2.x 之后、3.x 之前
- 2.3（types.ts 导出 SecretKeyEntry，15min）— 与 2.1/2.2 并列
- 3.6（async/sync 校验路径单测，30min）— 挂在 3.5 之后、3.4 之前
- 4.2（src/main.ts 示例更新，20min）— 与 5.1 并列
- 4.3（integration.test 新增场景，40min）— 挂在 4.1 之后、5.1 之前

**关键链末端保护**：6.x（最终验证）不允许压缩，任何前序延误都吸收到 buffer（6.2 任务吸收）。

**合并入本 change 的安全契约强化（来自 explore 阶段 c2）**：
- 触发原因：maintenance 视角下，当前 `asyncStorage.ts` L109 `if (secretKey && EncryptFn)` 会在只提供 `secretKey` 未提供 `EncryptFn` 时**静默走 JSON 明文分支**，线上用户可能以为加密了实际是明文落库（`constraints/human-in-loop.md` 通用基线第 2 类：安全契约）。
- 用户裁决：合并进 secretKeys change 而非单独提一个小 change（一次改动、一次 review、一次版本发布）。
- 影响面：新增 3.5（初始化校验）+ 3.6（校验路径单测）两个任务，均在 storage-core 内部；不改公共签名，只改初始化时的错误行为。
- 兼容性判断：契约强化（`secretKey` 存在时必须同时提供 EncryptFn/DecryptFn），属"小破坏性"——之前"只传 secretKey"能跑（但走明文），之后会 throw；README 会显式警告。

---

## 1. 类型契约（关键链起点）

- [x] 1.1 在 `libs/types.ts` 中新增 `SecretKeyEntry` 接口（含 `key` / `since?` / `expiresAt?` / `legacy?: true`）
  - 文件：`libs/types.ts`
  - 风险：low
  - 验证：`npx tsc --noEmit` 通过；接口字段与设计文档 D1 一致
  - 分系统影响：storage-core
  - 依赖：无

- [x] 1.2 在 `libs/types.ts` 中给 `Option.secretKey` 加 `@deprecated` JSDoc 注释，新增 `secretKeys?: SecretKeyEntry[]` 字段
  - 文件：`libs/types.ts`
  - 风险：low
  - 验证：`npx tsc --noEmit` 通过；`secretKey` 仍为可选字段（向后兼容）；TypeScript IDE 悬停显示 `deprecated` 标记
  - 分系统影响：storage-core
  - 依赖：1.1

- [x] 1.3 在 `libs/index.ts` 中导出 `SecretKeyEntry` 类型
  - 文件：`libs/index.ts`
  - 风险：low
  - 验证：`import { SecretKeyEntry } from "gpl-async-storage"` 类型可用；`npx tsc --noEmit` 通过
  - 分系统影响：storage-core
  - 依赖：1.1

---

## 2. 密钥生成工具（关键链）

- [x] 2.1 新建 `libs/utils/secrets.ts`，实现 `generateSecretKey(options?)`（默认 32 字节 hex）
  - 文件：`libs/utils/secrets.ts`
  - 风险：low
  - 验证：单元测试 `tests/utils-secrets.test.ts` 覆盖 spec.md「默认生成 32 字节密钥」与「自定义字节数」Scenario；断言返回值为 64/32 字符的合法 hex 字符串
  - 分系统影响：utils
  - 依赖：1.1（无强依赖，但顺序上先有类型契约更清晰；实际可并行）

- [x] 2.2 在 `libs/utils/secrets.ts` 中实现 `generateSecretKeys(count, options?)`
  - 文件：`libs/utils/secrets.ts`
  - 风险：low
  - 验证：单元测试覆盖 spec.md「批量生成」与「随机性」Scenario；断言返回数组长度等于 count 且元素互不相同
  - 分系统影响：utils
  - 依赖：2.1

- [x] 2.3 在 `libs/utils/secrets.ts` 中导出并加入 `libs/index.ts` 主入口
  - 文件：`libs/utils/secrets.ts`、`libs/index.ts`
  - 风险：low
  - 验证：`import { generateSecretKey, generateSecretKeys } from "gpl-async-storage"` 可用；`npx tsc --noEmit` 通过
  - 分系统影响：utils + storage-core（入口）
  - 依赖：2.2

- [x] 2.4 验证 spec.md「库不偷偷生成密钥」Scenario：`createAsyncStorage` / `createSyncStorage` 内部不调用 `generateSecretKey`
  - 文件：`libs/asyncStorage.ts`、`libs/syncStorage.ts`（只读检查）
  - 风险：low
  - 验证：`grep -n "generateSecretKey" libs/asyncStorage.ts libs/syncStorage.ts` 无匹配
  - 分系统影响：storage-core
  - 依赖：2.3

---

## 3. 密钥选择与加解密路径改造（关键链核心）

- [x] 3.1 新建内部辅助函数 `pickActiveKey(secretKeys, now)` 与 `pickLegacyKey(secretKeys)`（放在 `libs/asyncStorage.ts` 附近或抽出到 `libs/utils/` 供 async/sync 共用——**决策**：抽到 `libs/utils/secrets.ts` 底部，供两个 factory 复用）
  - 文件：`libs/utils/secrets.ts`
  - 风险：medium（跨两个 factory 的共享逻辑）
  - 验证：单元测试覆盖 spec.md「密钥选择规则」4 个 Scenario（单活跃 / 多活跃取 since 最新 / legacy 排除 / 无活跃退回）
  - 分系统影响：storage-core
  - 依赖：1.1

- [x] 3.2 改造 `libs/asyncStorage.ts` 的 `set` 路径：若存在活跃 key，`JSON.stringify` → `EncryptFn` → 前置 `[<hash8>:]` metadata 头 → 写 engine；否则走原 legacy 路径
  - 文件：`libs/asyncStorage.ts`
  - 风险：high（写入路径核心变更）
  - 验证：characterization test 全部通过（legacy 路径行为不变）+ 新增测试覆盖 spec.md「密钥组写入带 metadata 头」Scenario；断言 engine 收到的值形如 `[<8位hex>]:<cipher>`
  - 分系统影响：storage-core
  - 依赖：3.1

- [x] 3.3 改造 `libs/asyncStorage.ts` 的 `get` 路径：按 metadata 头 → legacy 项 → secretKey → JSON.parse 的顺序回退
  - 文件：`libs/asyncStorage.ts`
  - 风险：high（读取路径核心变更 + 多分支）
  - 验证：新增测试覆盖 spec.md「密钥组读取定位密钥」「legacy 项支持旧密文无 secretKey 可读回」「密钥已下线无法解密时回退」Scenario；characterization test 全部通过
  - 分系统影响：storage-core
  - 依赖：3.2

- [x] 3.4 改造 `libs/syncStorage.ts` 的 `set` 与 `get` 路径（逻辑与 3.2/3.3 对称）
  - 文件：`libs/syncStorage.ts`
  - 风险：high（对称变更，但独立文件）
  - 验证：新增 syncStorage 版本的 metadata 头写入 / 头定位读取 / legacy 回退测试；characterization test 全部通过
  - 分系统影响：storage-core
  - 依赖：3.3

- [x] 3.5 在 `libs/asyncStorage.ts` 与 `libs/syncStorage.ts` 的工厂函数**初始化阶段**新增加密契约校验（合并自 explore c2）
  - 文件：`libs/asyncStorage.ts`、`libs/syncStorage.ts`
  - 风险：medium（错误路径新增，行为契约强化）
  - 规则：
    - 若 `option.secretKey` 存在，MUST 同时提供 `option.EncryptFn` 与 `option.DecryptFn`，否则工厂函数立即 `throw new Error(ErrorMessage.MISSING_ENCRYPT_FN)`（`ErrorMessage` enum 增补 `MISSING_ENCRYPT_FN = "secretKey is provided but EncryptFn/DecryptFn is missing; refusing to store plaintext under a secret-key path"`）。
    - 若 `option.secretKeys` 存在且非空数组，MUST 同时提供 `option.EncryptFn` 与 `option.DecryptFn`，否则同样 throw。
    - 若两者都未配置（或 `secretKeys` 为空数组），保持现状：走 `supportObject` 或 JSON 明文路径，不 throw。
    - 校验在工厂函数 body 顶部执行（在 `readyCallbacks` / `subscribeMap` 等初始化之前），确保任何后续引用都基于契约成立的实例。
  - 验证：
    - `tsc --noEmit` 通过；`ErrorMessage.MISSING_ENCRYPT_FN` 常量在 `libs/types.ts` 中定义并导出。
    - 新增单元测试覆盖 4 个 case（见 3.6）。
    - 现有 characterization test 全部通过（既有测试都同时传了 secretKey + EncryptFn/DecryptFn 或都不传，无触发校验的 case）。
  - 分系统影响：storage-core + types（ErrorMessage 枚举扩展）
  - 依赖：1.2（`secretKeys` 字段先落地）

- [x] 3.6 新增 `tests/encryption-contract.test.ts` 覆盖 3.5 的初始化校验路径
  - 文件：`tests/encryption-contract.test.ts`
  - 风险：low（纯测试新增）
  - 覆盖 4 个 Scenario（每个 Scenario 各测异步 + 同步两个版本，共 8 个 `it`）：
    1. `secretKey` 存在、缺 `EncryptFn` → 工厂 throw `ErrorMessage.MISSING_ENCRYPT_FN`
    2. `secretKey` 存在、缺 `DecryptFn` → 同上
    3. `secretKeys` 非空、缺 `EncryptFn` → 同上
    4. 两者都未配置 → 工厂正常返回实例，走 JSON 明文或 supportObject 路径
  - 验证：`npx vitest run tests/encryption-contract.test.ts` 全部通过；测试中 `expect(() => createAsyncStorage(...)).toThrow(ErrorMessage.MISSING_ENCRYPT_FN)` 使用。
  - 分系统影响：测试
  - 依赖：3.5

---

## 4. 单元测试覆盖

- [x] 4.1 在 `tests/mock-engine.ts` 中让 `mockEncrypt` / `mockDecrypt` 支持 metadata 头格式（识别并剥离 `[<hash8>:]` 前缀）
  - 文件：`tests/mock-engine.ts`
  - 风险：medium（测试基建变更，影响面广）
  - 验证：现有基于 mockEncrypt/mockDecrypt 的 characterization test 全部通过；新增 mock 版本的 metadata 头识别单元测试
  - 分系统影响：测试基建
  - 依赖：3.4

- [x] 4.2 新增 `tests/secretkeys.test.ts`，覆盖 spec.md 的 storage-core 全部新增 Scenario
  - 文件：`tests/secretkeys.test.ts`
  - 风险：medium
  - 验证：`npx vitest run tests/secretkeys.test.ts` 全部通过；覆盖「时间轮换后新密文用新密钥」「新写入覆盖后升级为新格式」「完成迁移后删除 legacy 项」等 Scenario
  - 分系统影响：测试
  - 依赖：4.1

- [x] 4.3 新增 `tests/integration.test.ts` 中 secretKeys + 真实 engine 的集成场景
  - 文件：`tests/integration.test.ts`
  - 风险：medium
  - 验证：`npx vitest run tests/integration.test.ts` 全部通过；覆盖 ELocalStorage + secretKeys 的完整读写 + legacy 迁移链路
  - 分系统影响：测试 + storage-core
  - 依赖：4.2

---

## 5. 文档与示例更新（关键链末端）

- [x] 5.1 更新 `README.md` 加密章节：
  - 新增 `secretKeys` 用法示例（含 `generateSecretKeys` 调用）
  - 新增 legacy 迁移步骤示例
  - 新增「HashFn 必须非可逆」警告段落（引用 spec.md 相应 Requirement）
  - `secretKey` 段落标注 `@deprecated`
  - 文件：`README.md`
  - 风险：low
  - 验证：README 中的代码示例 `npx tsc --noEmit` 通过（可临时抽到临时文件检查）；spec.md 中所有 Scenario 在 README 至少有一处示例对应
  - 分系统影响：文档
  - 依赖：3.4

- [x] 5.2 更新 `src/main.ts`（demo 入口）从 `secretKey` 改为 `secretKeys` + `generateSecretKey` 示例
  - 文件：`src/main.ts`
  - 风险：low
  - 验证：`npm run dev` 启动 demo 不报错；`npx tsc --noEmit` 通过
  - 分系统影响：示例代码
  - 依赖：3.4、5.1（顺序上不严格依赖，但示例应先与文档一致）

---

## 6. 项目缓冲吸收（project buffer ≈ 1.2 小时）

- [x] 6.1 端到端回归：`npm test` 全量跑通（characterization test + 新增 secretKeys 测试 + 集成测试）
  - 文件：无（验证任务）
  - 风险：medium
  - 验证：`npm test` 退出码 0；`npm run build` 通过（Vite 打包无 TS 错误）
  - 分系统影响：全系统
  - 依赖：4.3、5.2

- [x] 6.2 版本 bump 到 1.6.0，更新 `package.json` 的 `version` 字段
  - 文件：`package.json`
  - 风险：low
  - 验证：`grep "\"version\"" package.json` 显示 `"version": "1.6.0"`
  - 分系统影响：发布元数据
  - 依赖：6.1

---

## 关键链与依赖图（可视化）

```
[1.1] 类型契约 (SecretKeyEntry)
   ├──> [1.2] Option 加 secretKeys 字段 + secretKey @deprecated
   │        ├──> [1.3] 导出 SecretKeyEntry
   │        └──> [3.5] 加密契约校验（secretKey/secretKeys + EncryptFn/DecryptFn 同时）
   │                  └──> [3.6] encryption-contract.test.ts
   │
   └──> [2.1] generateSecretKey ──> [2.2] generateSecretKeys ──> [2.3] 导出
                                                                 └──> [2.4] 检查库不偷偷生成

   [3.1] pickActiveKey / pickLegacyKey ──> [3.2] asyncStorage set ──> [3.3] asyncStorage get ──> [3.4] syncStorage set+get

                                                              ┌──> [4.1] mockEncrypt/mockDecrypt 支持 metadata 头
                                                              │      └──> [4.2] secretkeys.test.ts ──> [4.3] integration.test.ts
                                                              │
[3.4] ──┤
        ├──> [5.1] README 更新 ──> [5.2] src/main.ts 示例
        │
        └──> [6.1] npm test + build ──> [6.2] version bump 1.6.0
```

**关键链路径**（最长）：1.1 → 2.1 → 2.2 → 3.1 → 3.5 → 3.2 → 3.3 → 3.4 → 4.1 → 4.2 → 4.3 → 5.1 → 6.1 → 6.2

**并行机会**：
- 1.2 / 1.3 与 2.1 可并行（无数据依赖）
- 3.5 与 3.1 可并行（3.5 只依赖 1.2；两者都动 `libs/asyncStorage.ts` 但不重叠：3.5 在函数顶部，3.2 在 set 内部）
- 3.6 与 3.4 可并行（3.6 只依赖 3.5）
- 4.x 系列与 5.x 可并行
- 2.4 与 3.1 可并行

**缓冲位置**：6.x 是 project buffer（1.2 小时），吸收前序所有非确定性延误；不允许压缩。

---

## 已知问题（架构 review 记录，不阻塞 apply）

以下 warning 在 proposal 定型后的架构 review 中发现，可延后处理或作为实施时的实现选择：

- **[warning] `pickActiveKey` 文件位置**（对应任务 3.1）
  - 问题：将 storage-core 的"密钥选择业务逻辑"放入 `libs/utils/secrets.ts` 会让 utils 分系统的"通用工具"定位变模糊。
  - 建议：实施时可选择抽到独立文件 `libs/utils/key-rotation.ts`（专门承载密钥选择/轮换逻辑），`libs/utils/secrets.ts` 只做密钥生成。
  - 影响面：仅内部模块组织，不影响公共契约、不影响测试。

- **[warning] 多 legacy 项行为未定义**（对应 specs/storage-core/spec.md「值序列化与加密」Requirement 步骤 2）
  - 问题：当 `secretKeys` 中有**多条** `legacy: true` 条目时，规格未定义选择哪一条。
  - 建议：实施时明确规则——推荐"取 `since` 最大者；`since` 均缺失时取数组中最后一项"（与活跃密钥选择的 tiebreaker 一致），并在 spec.md 该 Requirement 中补 Scenario。
  - 影响面：仅边界行为，正常运行场景下消费者至多保留一条 legacy 项（design.md Migration Plan Step 4 明确要求删除）。
