## ADDED Requirements

### Requirement: 密钥随机生成

`generateSecretKey(options?: GenerateSecretKeyOptions)` 与 `generateSecretKeys(count: number, options?: GenerateSecretKeyOptions)` MUST 提供随机密钥生成能力：

- 底层使用 `crypto.getRandomValues`（Web Crypto API）生成随机字节。
- `GenerateSecretKeyOptions` 含 `bytes?: number` 字段，默认 32（256 bit，匹配 AES-256 密钥长度）。
- 返回值 MUST 为十六进制字符串，每个字节编码为两位小写十六进制字符（因此返回字符串长度为 `bytes * 2`）。
- `generateSecretKeys(count, options)` MUST 返回长度恰好为 `count` 的字符串数组，每个元素独立调用 `generateSecretKey`。

`generateSecretKey` 与 `generateSecretKeys` MUST 从 `libs/utils/` 导出。库 MUST NOT 在 `createAsyncStorage` / `createSyncStorage` 内部自动调用这两个函数——密钥所有权始终由消费者持有。

#### Scenario: 默认生成 32 字节密钥

- **WHEN** 消费者调用 `generateSecretKey()`
- **THEN** 返回一个长度为 64 的十六进制字符串（32 字节 × 2 字符/字节）

#### Scenario: 自定义字节数

- **WHEN** 消费者调用 `generateSecretKey({ bytes: 16 })`
- **THEN** 返回一个长度为 32 的十六进制字符串

#### Scenario: 批量生成

- **WHEN** 消费者调用 `generateSecretKeys(3)`
- **THEN** 返回长度为 3 的字符串数组，每个元素均为合法的十六进制字符串，且默认情况下三个元素互不相同

#### Scenario: 随机性

- **WHEN** 同一进程内连续调用 `generateSecretKey()` 多次
- **THEN** 每次返回值不同（除密码学上无法避免的极低概率碰撞外）

#### Scenario: 库不偷偷生成密钥

- **WHEN** 消费者仅传入 `secretKeys` 配置（不调用 `generateSecretKey`）
- **THEN** storage-core 的初始化流程不会隐式调用 `generateSecretKey` 或 `generateSecretKeys`
