## Purpose

utils 分系统是 storage-core 与 engine 共用的工具函数集合，提供键哈希（MD5）、订阅 ID 生成、set 通知防抖与开发态日志四类能力，无对外公共契约，仅被同库内部引用。

## Requirements

### Requirement: MD5 哈希

`MD5(message)` SHALL 返回输入字符串的 MD5 哈希的字符串形式，底层使用 js-md5 库；storage-core 在 `enableHashKey` 且未自定义 `HashFn` 时默认引用本函数。

#### Scenario: 默认键哈希

- **WHEN** 上层对键 `"counter"` 调用 `MD5("counter")`
- **THEN** 返回一个固定长度的十六进制字符串

### Requirement: 订阅 ID 生成

`getOnlyStr(comparative, length=8)` SHALL 返回一个不在 `comparative` 集合中的随机字符串；当生成的串已存在时 MUST 递归重生成直到唯一。storage-core 用它为每个 subscribe 调用分配唯一订阅 ID。

#### Scenario: 唯一性

- **WHEN** `comparative = ["abc12345"]` 且生成的随机串恰好为 `"abc12345"`
- **THEN** 函数递归重新生成，最终返回一个不在 `comparative` 中的新字符串

### Requirement: 防抖

`debounce(callback, {wait, immediate})` SHALL 返回一个防抖函数：`immediate=false`（默认）时在最后一次调用后等待 `wait` 毫秒执行 callback；`immediate=true` 时立即执行一次并锁定 `wait` 毫秒。storage-core 用 `wait=0` 的防抖合并多次 set 的订阅通知。

#### Scenario: 默认延迟执行

- **WHEN** `debounce(fn, {wait: 100})` 返回的函数被连续调用两次
- **THEN** fn 在最后一次调用后约 100ms 执行一次

### Requirement: 开发态日志

`CusLog` SHALL 仅在 `import.meta.env.DEV` 为真时输出带样式的 console 日志（success 绿色、error 红色），生产构建中不产生输出。engine 在初始化失败与运行时 error 时引用 `CusLog.error` 记录。

#### Scenario: 生产构建静默

- **WHEN** `import.meta.env.DEV` 为 false，engine 初始化触发 `CusLog.error(...)`
- **THEN** 不向 console 输出任何内容

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
