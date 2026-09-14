## Purpose

engine 分系统提供 `StorageEngine` 接口的三个具体实现（EIndexedDB 异步、ELocalStorage 同步、ECookie 同步），各自封装一种浏览器底层存储介质，对上暴露统一的 setItem / getItem / removeItem（及异步版的 onReady）契约。每个实现都是工厂函数：检测环境可用性，不可用时返回 null，可用时返回一个 StorageEngine 实例。

## Requirements

### Requirement: IndexedDB 异步引擎

`EIndexedDB(name?, version?)` SHALL 返回一个异步 `StorageEngine<true>`：在 window.indexedDB 可用时打开/升级数据库，通过 objectStore（keyPath="key"）以 `{key, value}` 结构存储；在 indexedDB 不可用时返回 null。引擎 MUST 通过 `onReady()` 返回 Promise，在数据库连接成功后 resolve。

#### Scenario: 环境不可用返回 null

- **WHEN** `window.indexedDB` 不存在
- **THEN** `EIndexedDB()` 返回 `null`

#### Scenario: 异步读写

- **WHEN** 数据库已就绪，上层调用 `setItem("k", "v")` 后调用 `getItem("k")`
- **THEN** `getItem` 的 Promise 解析为 `"v"`

#### Scenario: 未就绪拒绝

- **WHEN** 数据库连接尚未完成，上层调用 `getItem("k")`
- **THEN** Promise 被 reject，错误为 `ErrorMessage.NOT_READY`

### Requirement: localStorage 同步引擎

`ELocalStorage(name?)` SHALL 返回一个同步 `StorageEngine<false>`：先以读写试探确认 localStorage 可用，不可用时返回 null，可用时把键映射为 `${name}_${key}` 后委托给 localStorage。

#### Scenario: 环境不可用返回 null

- **WHEN** localStorage 不可写（如隐私模式抛异常）
- **THEN** `ELocalStorage()` 返回 `null`

#### Scenario: 读写带前缀

- **WHEN** `name="LS"`，上层调用 `setItem("counter", 1)`
- **THEN** 实际写入 localStorage 的键为 `"LS_counter"`

### Requirement: Cookie 同步引擎

`ECookie(name?)` SHALL 返回一个同步 `StorageEngine<false>`：先试探 document.cookie 可写，不可用时返回 null，可用时把键值编码（encodeURIComponent）后以 `expires=Fri, 31 Dec 9999` 的长期 cookie 写入；remove 通过设过期时间为 1970 删除。

#### Scenario: 写入与编码

- **WHEN** `name="LS"`，上层调用 `setItem("token", "a b")`
- **THEN** document.cookie 中写入 `LS_token=a%20b` 且带远期 expires 与 secure 标记

#### Scenario: 删除

- **WHEN** 上层调用 `removeItem("token")`
- **THEN** 对应 cookie 的 expires 被设为 `Thu, 01 Jan 1970 00:00:00 GMT`

#### Scenario: 环境不可用返回 null

- **WHEN** document.cookie 不可写（试探失败）
- **THEN** `ECookie()` 返回 `null`
