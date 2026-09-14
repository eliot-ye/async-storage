## MODIFIED Requirements

### Requirement: 键哈希

当 `option.enableHashKey` 为真时，storage-core MUST 在所有对 engine 的 setItem/getItem/removeItem 调用中用 `option.HashFn`（默认 MD5）变换键后再透传；为假时 SHALL 直接使用原始键。

`option.HashFn` 除用于键哈希外，MUST 同时被用于计算 secret 的 metadata hash 前缀（见「值序列化与加密」Requirement）。消费者自定义 `HashFn` 时 MUST 确保其非可逆，否则 secret 会通过 metadata 头泄露。

#### Scenario: 启用键哈希

- **WHEN** `enableHashKey` 为 true 且 `HashFn` 默认为 MD5，消费者调用 `set("counter", 1)`
- **THEN** engine 收到的 key 为 `MD5("counter")` 而非 `"counter"`

### Requirement: 值序列化与加密

当 `option.secretKeys` 存在且至少有一个当前活跃的密钥条目（不满足 `expiresAt` 过期且未标记 `legacy: true`）时，storage-core MUST 在实例化阶段按 `Date.now()` 选择"当前活跃"密钥（多条活跃时取 `since` 最新者；无活跃条目时退回 legacy 路径），并在实例生命周期内锁定该密钥作为所有后续 set 使用的写入密钥。写入时 MUST 按以下顺序处理值：`JSON.stringify` → `EncryptFn(valueStr, activeKey)` 得到密文 → 前置 `[<hash8>:]` metadata 头（其中 `<hash8>` = `HashFn(activeKey).slice(0, 8)`）→ 交给 engine。读取时 MUST 按以下顺序尝试：

1. 若密文以 `[` 开头且包含 `]:`，提取 hash 前缀与密文主体，在 `secretKeys` 中查找 `HashFn(key).slice(0, 8)` 匹配且未标 `legacy: true` 的条目；命中则用对应密钥解密。
2. 未命中步骤 1 或密文无 metadata 头时，在 `secretKeys` 中查找 `legacy: true` 的条目；命中则用该条目密钥解密。
3. 未命中步骤 2 时，若 `option.secretKey` 存在，用其解密（`@deprecated` 路径）。
4. 所有解密尝试均失败或均未命中时，尝试 `JSON.parse` 原始值；再失败则返回原始字符串。

`secretKey` 与 `EncryptFn`/`DecryptFn` 同时提供且 `secretKeys` 未配置或无活跃条目时，MUST 沿用原路径：直接 `EncryptFn(JSON.stringify(value), secretKey)` 写入（不加 metadata 头），读取时用 `DecryptFn(_value, secretKey)` 解密再 `JSON.parse`。

当既未配置 `secretKey` 也未配置 `secretKeys`（或无活跃条目且无 legacy 兜底）且 engine 的 `supportObject` 为真时，SHALL 直接把对象原值交给 engine。

`secretKey` 字段在本版本标记为 `@deprecated`；本版本仍完整支持其路径，下一个 major 版本将移除。

#### Scenario: 加密读写

- **WHEN** 消费者配置了 `secretKey` 与 `EncryptFn`/`DecryptFn`，未配置 `secretKeys`，调用 `set("a", "x")` 后调用 `get("a")`
- **THEN** engine 存储的是 `EncryptFn("x", secretKey)` 的返回值（无 metadata 头），`get` 返回解密后的原值 `"x"`

#### Scenario: 对象直存

- **WHEN** engine 的 `supportObject` 为 true 且未配置 `secretKey` 与 `secretKeys`，消费者调用 `set("testObject", {a:1})`
- **THEN** engine 的 setItem 收到原始对象 `{a:1}` 而非 JSON 字符串

#### Scenario: 密钥组写入带 metadata 头

- **WHEN** 消费者配置 `secretKeys: [{ key: "k1" }]` 与 `EncryptFn`/`DecryptFn`，实例化后调用 `set("a", "x")`
- **THEN** engine 收到的 value 形如 `[<hash8>:]<cipher>`，其中 `<hash8>` = `HashFn("k1").slice(0, 8)`，`<cipher>` = `EncryptFn("\"x\"", "k1")`

#### Scenario: 密钥组读取定位密钥

- **WHEN** engine 中存有上一步写入的密文，消费者调用 `get("a")`
- **THEN** storage-core 按 metadata 头的 hash 前缀定位到 `secretKeys` 中 `HashFn(key).slice(0, 8)` 匹配的条目，用其密钥解密后 `JSON.parse` 返回原值 `"x"`

#### Scenario: 时间轮换后新密文用新密钥

- **WHEN** 初始配置 `secretKeys: [{ key: "k1" }]`，写入若干数据；随后消费者把配置更新为 `secretKeys: [{ key: "k1", expiresAt: T }, { key: "k2", since: T }]` 并重新创建实例（时间 > T）
- **THEN** 新实例的新 `set` 使用 `k2` 加密，密文 metadata 头 hash 对应 `k2`；老数据（k1 加密、旧 hash 头）仍可被正确读出

#### Scenario: legacy 项支持旧密文无 secretKey 可读回

- **WHEN** engine 中存有旧 `secretKey` 路径写入的密文（无 metadata 头），消费者配置 `secretKeys: [{ key: "oldKey", legacy: true }, { key: "newKey", since: Date.now() }]`，未配置 `secretKey`
- **THEN** `get` 用 `secretKeys` 中标 `legacy: true` 的条目解密老数据，成功返回原值

#### Scenario: 新写入覆盖后升级为新格式

- **WHEN** 上一步场景中，消费者随后调用 `set` 覆盖同一 key
- **THEN** engine 中该 key 的值变为带 `[<hash8>:]` 头的密文（用非 legacy 条目加密）；下次 `get` 走 metadata 头定位路径

#### Scenario: 完成迁移后删除 legacy 项

- **WHEN** 消费者确认老数据已被覆盖或不再访问，从 `secretKeys` 中删除 `legacy: true` 条目，engine 中已无该 legacy key 加密的旧密文
- **THEN** 所有 `get` 均走 metadata 头定位路径，legacy fallback 不再触发

#### Scenario: 密钥已下线无法解密时回退

- **WHEN** engine 中某密文的 metadata 头 hash 在 `secretKeys` 中找不到匹配条目（消费者已删除该密钥），且无 legacy 项匹配，且未配置 `secretKey`
- **THEN** storage-core 尝试 `JSON.parse` 原始密文字符串；失败则返回原始字符串并 `console.warn(key, error)`（沿用现有回退行为）

## ADDED Requirements

### Requirement: 密钥组类型契约

storage-core MUST 在 `libs/types.ts` 中定义并导出 `SecretKeyEntry` 接口，字段：

- `key: string` — 必需，密钥原文。
- `since?: number` — 可选，生效时间（Unix 毫秒时间戳）。未设置视为立即生效。
- `expiresAt?: number` — 可选，失效时间（Unix 毫秒时间戳）。到期后不再用于新写入；到期前的密文仍可解。
- `legacy?: true` — 可选布尔字面量，标记为旧 `secretKey` 的迁移期密钥；仅在读取无 metadata 头密文时作为 fallback 使用，不参与新写入的活跃密钥选择。

`Option<T>` MUST 新增 `secretKeys?: SecretKeyEntry[]` 字段，与 `secretKey` 并存。`secretKey` 保留但 MUST 标记 `@deprecated`。

#### Scenario: secretKeys 字段可写入

- **WHEN** 消费者传入 `Option<T>` 包含 `secretKeys: [{ key: "k" }]`
- **THEN** TypeScript 类型检查通过，且 `createAsyncStorage` / `createSyncStorage` 消费该字段

#### Scenario: legacy 字段类型安全

- **WHEN** 消费者尝试传入 `secretKeys: [{ key: "k", legacy: false }]`
- **THEN** TypeScript 类型检查报错（`legacy` 只接受 `true` 字面量）

### Requirement: 密钥选择规则

在实例化阶段，storage-core MUST 按以下规则从 `secretKeys` 中选择当前活跃密钥用于新写入：

1. `secretKeys` 为空或未配置 → 不选择活跃密钥（走 legacy 路径或对象直存路径）。
2. 过滤出满足 `(!since || now >= since) && (!expiresAt || now < expiresAt) && !legacy` 的条目为"活跃条目"。
3. 活跃条目为空 → 走 legacy 路径（见「值序列化与加密」Requirement 的回退顺序）。
4. 活跃条目 ≥ 2 → 取 `since` 最大的那条；`since` 均缺失时取数组中最后一项。
5. 选定后在实例生命周期内保持不变；实例重新创建时按当前时间重新选择。

#### Scenario: 单活跃密钥被选中

- **WHEN** `secretKeys: [{ key: "k1" }]`，实例化时 `Date.now() = 1000`
- **THEN** 新写入使用 `k1` 加密

#### Scenario: 多活跃取 since 最新

- **WHEN** `secretKeys: [{ key: "k1", since: 500 }, { key: "k2", since: 800 }]`，实例化时 `Date.now() = 1000`
- **THEN** 新写入使用 `k2` 加密（since 更新）

#### Scenario: legacy 项不参与活跃选择

- **WHEN** `secretKeys: [{ key: "old", legacy: true }, { key: "new", since: Date.now() }]`
- **THEN** 新写入使用 `new` 加密，`old` 仅作为 legacy fallback

#### Scenario: 无活跃条目走 legacy 路径

- **WHEN** `secretKeys: [{ key: "k1", expiresAt: 100 }]`，实例化时 `Date.now() = 200`
- **THEN** 新写入退回 legacy 路径（`secretKey` 若存在则用之；否则退回对象直存/JSON 明文路径）

### Requirement: 加密契约校验

工厂函数（`createAsyncStorage` 与 `createSyncStorage`）在**初始化阶段**MUST 校验加密契约，避免"配了密钥但没提供加解密函数"时**静默以明文落库**：

- 若 `option.secretKey` 存在，或 `option.secretKeys` 存在且为非空数组，则 `option.EncryptFn` 与 `option.DecryptFn` **必须同时提供**；否则工厂函数 MUST 立即 throw `Error(ErrorMessage.MISSING_ENCRYPT_FN)`。
- 校验在工厂函数 body 顶部执行，先于所有引擎初始化与订阅逻辑。
- 若 `option.secretKey` 与 `option.secretKeys` 均未配置（或 `secretKeys` 为空数组），不触发校验，工厂正常返回实例，走 `supportObject` 直存或 JSON 明文路径。

`ErrorMessage` 枚举 MUST 新增 `MISSING_ENCRYPT_FN` 成员，其消息明确说明"secret 配置了但未提供 EncryptFn/DecryptFn，拒绝以明文存储"。

#### Scenario: secretKey 存在但未提供 EncryptFn

- **WHEN** 消费者调用 `createAsyncStorage({}, [engine], { secretKey: "k" })`（未传 `EncryptFn`）
- **THEN** 工厂函数立即 throw `Error(ErrorMessage.MISSING_ENCRYPT_FN)`，未创建任何实例字段

#### Scenario: secretKeys 存在但未提供 DecryptFn

- **WHEN** 消费者调用 `createSyncStorage({}, [engine], { secretKeys: [{ key: "k" }], EncryptFn })`（未传 `DecryptFn`）
- **THEN** 工厂函数立即 throw `Error(ErrorMessage.MISSING_ENCRYPT_FN)`

#### Scenario: 无加密配置时不校验

- **WHEN** 消费者调用 `createAsyncStorage({}, [engine])`（不传 `secretKey` 也不传 `secretKeys`）
- **THEN** 工厂函数正常返回实例，后续 `set` / `get` 走 JSON 明文或 `supportObject` 直存路径

#### Scenario: secretKeys 空数组不触发校验

- **WHEN** 消费者调用 `createAsyncStorage({}, [engine], { secretKeys: [] })`
- **THEN** 工厂函数正常返回实例（空数组等同于"未配置密钥组"）
