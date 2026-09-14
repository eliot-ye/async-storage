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
