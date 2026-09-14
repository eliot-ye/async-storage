## Context

现有 `Option.secretKey` 单密钥模型见 `libs/types.ts:21-29` 与 `libs/asyncStorage.ts:35-42,105-133`——加密/解密完全依赖消费者注入的 `EncryptFn` / `DecryptFn`，密钥由消费者持有。v1.3.0 起不再内置加密模块（`README.md:70`）。项目 profile = brownfield、tier = small，见 `openspec/.td-state/profile-tier.yaml`。

explore 阶段（本会话）已闭合 7 个决策，见 proposal.md「决策闭合状态」节。本设计文档把这些决策落实为实现方案。

## Goals / Non-Goals

**Goals:**

- 引入 `secretKeys` 密钥组，支持多个密钥 + 时间窗口（`since` / `expiresAt`）+ 迁移期 `legacy` 标记。
- 密文格式扩展为 `[hash8:]<cipher>`，让"哪把钥匙解的"内嵌在密文里，跨实例、跨页面、跨重启一致。
- 惰性迁移：老数据无 metadata 头，读取时自动定位到 `legacy: true` 项，下次 `set` 覆盖时升级为新格式。
- 保持 `secretKey` 单密钥路径行为 100% 不变（characterization test 兜底），使变更向后兼容。
- 提供 `generateSecretKeys` 工具函数，让密钥随机生成对消费者是一行调用。

**Non-Goals:**

- 不内置加密算法（继续 v1.3.0 决定，加密由消费者注入 `EncryptFn` / `DecryptFn`）。
- 不做密钥的自动派生（如从单一 root 密钥派生多个子密钥）——本设计的"密钥组"是消费者显式配置的独立随机密钥。
- 不做密钥的下线自动化（消费者手动删除 `secretKeys[i]` 表示完成迁移）。
- 不修改 `StorageEngine` 接口（`libs/types.ts:5-19` 不动）。
- 不引入新依赖（`crypto.getRandomValues` 是 Web API，若环境缺失由消费者 polyfill）。
- 不在本 change 内移除 `secretKey` 字段（留到下个 major）。

## Decisions

### D1：密钥组的数据结构

```ts
export interface SecretKeyEntry {
  /** 密钥原文，消费者持有 */
  key: string;
  /** 生效时间（Unix 毫秒时间戳），默认视为一直有效 */
  since?: number;
  /** 失效时间（Unix 毫秒时间戳），到期后不再用于新写入；到期前的密文仍可解 */
  expiresAt?: number;
  /** 标记为旧 secretKey 的迁移期密钥；读取无 metadata 头的老密文时按此项解密 */
  legacy?: true;
}

export interface Option<T> {
  /** @deprecated 使用 secretKeys；本版本仍支持，作为一次性迁入的便利入口 */
  secretKey?: string;
  secretKeys?: SecretKeyEntry[];
  EncryptFn?: (message: string, key: string) => string;
  DecryptFn?: (message: string, key: string) => string;
  enableHashKey?: boolean;
  HashFn?: (message: string) => string;
  increments?: (keyof T)[];
}
```

**理由**：
- `since` / `expiresAt` 用 Unix 毫秒时间戳（不是 ISO 字符串），因为 `Date.now()` 直接比较，无解析成本。
- `legacy?: true` 用布尔字面量类型而非可选布尔，防止误传 `legacy: false`（无意义）。
- `secretKey` 保留为 `@deprecated`，本版本仍走完整路径（不删除）。

**替代方案（放弃）**：
- `{ active: boolean }` 标记——需要消费者每次改配置手动切换 active，无法支持"多 key 并存 + 时间驱动"。
- 位置约定（第一项为 active、最后一项为 legacy）——易错位，消费者重排数组即坏。

### D2：密钥选择时机（实例化时锁定）

在 `createAsyncStorage` / `createSyncStorage` 的初始化阶段：

```ts
const activeKey = pickActiveKey(secretKeys, Date.now());
```

`pickActiveKey` 逻辑：
1. 若 `secretKeys` 为空/未配置 → 返回 `null`（走 legacy `secretKey` 路径）。
2. 过滤出"当前活跃"：`(!entry.since || now >= entry.since) && (!entry.expiresAt || now < entry.expiresAt)`。
3. 排除 `legacy: true` 的项（legacy 只用于解密 fallback，不用于新写入）。
4. 多个活跃 → 取 `since` 最新的那个（最新启用者优先）。
5. 无活跃 → 返回 `null`，退回 legacy 路径。

**理由**：
- 实例内锁定 = 同一实例生命周期内所有 `set` 用同一密钥，密文格式稳定。
- 重启实例 → 按当前时间重新匹配，天然支持时间轮换。
- 排除 legacy 项，防止消费者误把 legacy key 作为日常写入密钥。

**替代方案（放弃）**：
- 每次 `set` 都重新匹配当前时间——同一实例内多次 set 可能用不同 key，同一对象的连续写入散落到多个密文，且 `increments` 合并时读到的旧值与新值可能不同 key，逻辑复杂。
- 消费者手动指定 active key——违背"按时间轮换"目标。

### D3：密文 metadata 头格式

`[<hash8>:]<cipher>`，其中 `<hash8>` = `HashFn(secret).slice(0, 8)`。

写入路径：
```ts
const hashPrefix = HashFn(activeKey).slice(0, 8);
const cipher = EncryptFn(JSON.stringify(value), activeKey);
await engine.setItem(getHashKey(key), `[${hashPrefix}]:${cipher}`);
```

读取路径（顺序）：
```ts
const raw = await engine.getItem(getHashKey(key));
if (raw === null || raw === undefined) return initialData[key];
if (typeof raw !== "string") return raw;  // supportObject 直存路径

// 新格式：有 metadata 头
if (raw.startsWith("[") && raw.includes("]:")) {
  const hashPrefix = raw.slice(1, raw.indexOf("]:"));
  const cipher = raw.slice(raw.indexOf("]:") + 2);
  const entry = secretKeys?.find(e => !e.legacy && HashFn(e.key).slice(0, 8) === hashPrefix);
  if (entry) {
    try { return JSON.parse(DecryptFn(cipher, entry.key)); }
    catch (e) { console.error(key, e); return JSON.parse(raw); }  // 兜底回退
  }
  // hash 未匹配（密钥已下线）→ 走下方 legacy 分支或最终回退
}

// 老格式 fallback 1：legacy 标记项
const legacyEntry = secretKeys?.find(e => e.legacy === true);
if (legacyEntry) {
  try { return JSON.parse(DecryptFn(raw, legacyEntry.key)); } catch (e) { console.error(key, e); }
}

// 老格式 fallback 2：secretKey（@deprecated，最终兜底）
if (secretKey && DecryptFn) {
  try { return JSON.parse(DecryptFn(raw, secretKey)); } catch (e) { console.error(key, e); }
}

// 最终回退：JSON.parse
try { return JSON.parse(raw); } catch (e) { console.warn(key, e); return raw; }
```

**理由**：
- 头部前缀用 `[hash8]:`，选 `[` 作为起始是因为 AES 密文通常以字母数字开头，撞车概率低；`]:` 作为分隔符同理。
- hash 只取前 8 字符（32 bit）：在 n ≤ 几十的量级下碰撞概率可忽略，同时节省 metadata 长度。
- 顺序：先试新格式（快路径，正常场景走这里），再 legacy fallback，再 secretKey 兜底，最后 JSON.parse——保证老数据不丢。

**替代方案（放弃）**：
- JSON 包装 `{h, c}`——每次多一次 JSON.parse/JSON.stringify 开销，且和"值本身是 JSON 字符串"的现有路径混淆。
- hash 用完整 32 位——浪费空间，metadata 头从 10 字符膨胀到 34 字符。

### D4：legacy 定位方式（纯 c1，不做 c3 遍历）

读无 metadata 头密文时，只在 `secretKeys` 里找 `legacy: true` 的那一项尝试解密。

**理由**（explore 阶段的技术分析）：
- `DecryptFn` 由消费者注入，典型实现是 `AES.decrypt(msg, key).toString(enc.Utf8)`——AES-CBC 用错 key 不报错，只返回乱码字节，无法区分"解对了"和"侥幸没抛错"。
- 遍历所有密钥逐一尝试 → 无法判断成功，且掩盖配置错误。
- 消费者显式标注 `legacy: true` → 确定性、O(1)、语义清晰。

**替代方案（放弃）**：
- c3 遍历兜底——见上，技术上不可靠。
- 引入 `VerifyFn` 作为 c3 兜底——属于公共契约新增，本 change 范围外，可作为后续 change。

### D5：`HashFn` 语义扩展的边界

`HashFn` 现在同时用于：
- 键哈希（`enableHashKey: true` 时，`getHashKey` 里）——现有语义，不变。
- Secret 哈希（计算 metadata 头 `<hash8>`）——新语义。

**约束（写入 README 与 spec）**：
- 默认 `MD5`（`libs/utils/encoding.ts:3-5`）满足两个场景。
- 消费者自定义 `HashFn` 时，必须保证**非可逆**——否则 secret 会通过 metadata 头泄露。README 显式警告。
- 仓库内 `grep -rn "HashFn" tests/ src/` 显示本项目内 caller 全部用默认 MD5，无安全风险。

**理由**：
- 用一个字段做两种"通用哈希"用途比新增 `SecretHashFn` 更简洁。
- 语义扩展的代价是文档警告，不是代码复杂度。
- explore 阶段用户显式选择此路线（决策 a7）。

**替代方案（放弃）**：
- 新增 `SecretHashFn` 字段——语义更清晰，但多一个配置项，用户需理解"两个 hash 用途"。

### D6：`generateSecretKeys` 工具

```ts
// libs/utils/secrets.ts（新文件）或 libs/utils/encoding.ts 追加
export interface GenerateSecretKeyOptions {
  /** 生成的密钥长度（字节），默认 32（256 bit） */
  bytes?: number;
}

export function generateSecretKey(opts: GenerateSecretKeyOptions = {}): string {
  const bytes = opts.bytes ?? 32;
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

export function generateSecretKeys(
  count: number,
  opts: GenerateSecretKeyOptions = {}
): string[] {
  return Array.from({ length: count }, () => generateSecretKey(opts));
}
```

**理由**：
- 使用 `crypto.getRandomValues`（Web Crypto API），现代浏览器与 Node 16+ 均原生支持。
- 默认 32 字节 = 256 bit，与 AES-256 的密钥长度匹配。
- 返回十六进制字符串（可直接作为 `AES.encrypt(msg, key)` 的 key 参数，crypto-js 支持 hex 字符串密钥）。
- 库不偷偷在初始化时生成——消费者显式调用后写入配置（决策 a1）。

**替代方案（放弃）**：
- 库初始化时自动生成随机密钥——违背 v1.3.0 "不内置加密" 约定。
- 支持多种输出格式（base64 / hex / raw bytes）——过度设计，本次只提供 hex。

### D7：`secretKey` legacy 路径行为不变

保留现有 `secretKey` 路径的完整行为：
- 写入：`EncryptFn(JSON.stringify(value), secretKey)`——**不加** metadata 头。
- 读取：`DecryptFn(_value, secretKey)` 后 `JSON.parse`——**不探测** metadata 头。

**触发条件**：`secretKey` 存在且 `EncryptFn`/`DecryptFn` 存在，且 `secretKeys` 未配置或无活跃 key。

**理由**：characterization test 锁定当前行为，改动会导致测试失败；向后兼容 = 老消费者升级无感。

**注意**：若 `secretKey` 和 `secretKeys` **同时**配置，`secretKeys` 优先（新写入走 secretKeys 路径）；读取侧则按 D3 的顺序 fallback 到 `secretKey`。

## Risks / Trade-offs

- **[R1] `HashFn` 语义扩展的安全回归** → 消费者自定义了可逆 `HashFn`（如 `toUpperCase`）时，secret 会泄露到 metadata 头。Mitigation：README + spec 明确警告"HashFn 必须非可逆"；仓库内 caller 只用默认 MD5，无风险。
- **[R2] legacy key 长期驻留 secretKeys** → 消费者迁移完后忘记删除 legacy 项，安全窗口无限延长。Mitigation：README 提供"迁移完成清单"；不做自动化检测（本 change 范围外）。
- **[R3] `crypto.getRandomValues` 在老环境缺失** → 老 RN、老 Node 环境调用 `generateSecretKey` 会抛 `ReferenceError`。Mitigation：README 提示用 polyfill（`react-native-get-random-values` 已在项目 `package.json` 依赖历史中出现过）；库不内嵌 polyfill。
- **[R4] 密文头 `[` 与 JSON 数组冲突** → 若解密后的原始值是 JSON 数组，其字符串形式以 `[` 开头，可能被误判为新格式。Mitigation：读取逻辑在 metadata 头探测失败时**继续走后续 fallback**（不立即失败），最终回退到 JSON.parse；且 `[hash8]:` 必须匹配 hash8 长度约束——但当前探测逻辑仅检查 `startsWith("[") && includes("]:")`，未校验 hash8 长度。**决策**：D3 的代码片段需要**加强**：hashPrefix 提取后必须**在 secretKeys 中实际匹配到对应 entry** 才算新格式命中；未匹配则走 legacy/secretKey 兜底。当前 D3 代码片段已按此实现。
- **[R5] 时间轮换的边界** → 消费者新增 `since` 但未移除旧 key 的 `expiresAt`，两个 key 同时活跃。Mitigation：D2 的 pickActiveKey 取"since 最新"的那个，行为确定；文档说明"新 key 覆盖旧 key 的时间窗口"惯例。
- **[R6] 多实例并发** → 同一时刻浏览器多个 tab 用同一 storage，A 写入用 key A、B 写入用 key B（若时间窗口重叠），A 的密文 B 也能解（因为 secretKeys 全量可用）。Mitigation：这是设计目标——多密钥并存就是为了让任意 tab 都能读到任意密钥加密的数据。

## Migration Plan

**Step 1（发布 v1.6.0）**：
- 新增 `secretKeys` 字段 + `generateSecretKeys` 工具，`secretKey` 标 `@deprecated`。
- 消费者无感升级——老代码不传 `secretKeys` 走原路径。

**Step 2（消费者迁移，可选但推荐）**：
- 消费者把现有 `secretKey: "xxx"` 改成：
  ```ts
  secretKeys: [{ key: "xxx", legacy: true }]
  ```
- 或删除 `secretKey` 前把 `secretKey` 值加入 `secretKeys` 数组并标 `legacy: true`。

**Step 3（引入新密钥，启用轮换）**：
- 消费者调用 `generateSecretKeys(1)` 生成新密钥，加入 `secretKeys` 数组（不标 legacy），设置 `since: Date.now()`。
- 重启实例后，新 `set` 走新密钥，新密文带 `[hash8:]` 头。
- 老数据（无头密文）通过 legacy 项仍可解。

**Step 4（清理 legacy）**：
- 消费者观察一段时间，确认老数据已被新 `set` 覆盖或不再访问后，从 `secretKeys` 中删除 `legacy: true` 的项。
- 完成迁移——从此只有新格式密文，legacy 路径不再触发。

**Rollback**：
- 本 change 是向后兼容的加法，`secretKey` 路径未改动 → 消费者可通过"删除 secretKeys 配置"回退到 v1.5 行为，无破坏性。
- 库层面：如需回滚发布，v1.6.0 → v1.5.1 即可（`secretKeys` 相关代码只在传入该字段时才执行）。

## Open Questions

无——explore 阶段 7 个决策已闭合，本设计文档全部可实施。
