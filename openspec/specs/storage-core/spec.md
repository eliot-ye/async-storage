## Purpose

storage-core 是异步/同步本地存储库的工厂层：消费者传入初始数据与一个或多个 StorageEngine 实例（及可选加密/哈希配置），工厂返回一组类型安全的 get / set / remove / subscribe / onReady 接口，把读写细节委托给底层 engine，自身只负责键哈希、值序列化/加密、增量合并与订阅通知。

## Requirements

### Requirement: 异步存储工厂

storage-core SHALL 通过 `createAsyncStorage<T, B>(initialData, engines, option)` 对外提供异步存储实例，所有读写接口返回 Promise。

#### Scenario: 基本读写

- **WHEN** 消费者以初始数据 `{ counter: 0 }` 与一个异步 engine 创建实例并调用 `set("counter", 1)` 后调用 `get("counter")`
- **THEN** `get` 返回 `1`（Promise 解析为写入值）

#### Scenario: 初始值回退

- **WHEN** engine 中无某键对应的数据且消费者调用 `get(key)`
- **THEN** `get` SHALL 返回 `initialData[key]` 作为默认值

### Requirement: 同步存储工厂

storage-core SHALL 通过 `createSyncStorage<T>(initialData, engines, option)` 对外提供同步存储实例，读写接口为同步调用（非 Promise）。

#### Scenario: 基本读写

- **WHEN** 消费者以初始数据与一个同步 engine 创建实例并调用 `set("a", "x")` 后调用 `get("a")`
- **THEN** `get` 立即返回 `"x"`

### Requirement: 键哈希

当 `option.enableHashKey` 为真时，storage-core MUST 在所有对 engine 的 setItem/getItem/removeItem 调用中用 `option.HashFn`（默认 MD5）变换键后再透传；为假时 SHALL 直接使用原始键。

#### Scenario: 启用键哈希

- **WHEN** `enableHashKey` 为 true 且 `HashFn` 默认为 MD5，消费者调用 `set("counter", 1)`
- **THEN** engine 收到的 key 为 `MD5("counter")` 而非 `"counter"`

### Requirement: 值序列化与加密

当 `option.secretKey` 与 `option.EncryptFn` 同时提供时，storage-core MUST 先 `JSON.stringify` 再用 `EncryptFn` 加密，再交给 engine；读取时 MUST 用 `DecryptFn` 解密再 `JSON.parse`。当未提供 `secretKey` 且 engine 的 `supportObject` 为真时，SHALL 直接把对象原值交给 engine。

#### Scenario: 加密读写

- **WHEN** 消费者配置了 `secretKey` 与 `EncryptFn`/`DecryptFn`，调用 `set("a", "x")` 后调用 `get("a")`
- **THEN** engine 存储的是加密后的字符串，`get` 返回解密后的原值 `"x"`

#### Scenario: 对象直存

- **WHEN** engine 的 `supportObject` 为 true 且未配置 `secretKey`，消费者调用 `set("testObject", {a:1})`
- **THEN** engine 的 setItem 收到原始对象 `{a:1}` 而非 JSON 字符串

### Requirement: 增量合并

当 key 出现在 `option.increments` 列表中时，storage-core MUST 在 set 时先把当前值与新值浅合并（`{...current, ...newValue}`）再写入；异步版本使用 `await this.get(key)` 获取当前值，同步版本使用 `this.get(key)`。

#### Scenario: 增量写

- **WHEN** `increments` 含 `"testObject"`，当前值为 `{a:1,b:2}`，消费者调用 `set("testObject", {a:9})`
- **THEN** 存储值变为 `{a:9, b:2}`

### Requirement: 订阅与防抖通知

storage-core SHALL 提供 `subscribe(fn, keys?)` 接口：订阅时立即执行一次 fn；后续 set 触发时，通过 debounce（wait=0）合并短时间内的多次 set，只通知受影响 key 的订阅者；传空 keys 数组时只执行一次初始化调用且不返回 unsubscribe。

#### Scenario: 多次 set 合并

- **WHEN** 消费者订阅了 `["counter"]`，连续调用 `set("counter", 1)` 与 `set("counter", 2)`
- **THEN** 防抖后订阅函数只被调用一次，此时 `get("counter")` 返回最新值 `2`

#### Scenario: 空 keys 只初始化

- **WHEN** 消费者调用 `subscribe(fn, [])`
- **THEN** fn 立即执行一次，且不返回 unsubscribe 函数，后续 set 不再触发 fn

### Requirement: 无 engine 时的错误处理

storage-core MUST 在底层 engine 不存在（engines 全为 null 或工厂函数返回 null）时，对 set/get/remove 返回 `ErrorMessage.NOT_ENGINE`（异步 get/remove 为 Promise.reject，异步 set 与同步 set/get/remove 返回 Error 实例）。

#### Scenario: set 无 engine

- **WHEN** engines 数组全部为 null，消费者调用 `set("counter", 1)`
- **THEN** 返回一个 `Error(ErrorMessage.NOT_ENGINE)` 实例
