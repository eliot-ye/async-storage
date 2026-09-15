## MODIFIED Requirements

### Requirement: 无 engine 时的错误处理

storage-core MUST 在底层 engine 不存在（engines 全为 null 或工厂函数返回 null）时，对 set/get/remove 采取以下错误处理策略：

- **异步 `get` / `remove`**：`Promise.reject(new Error(ErrorMessage.NOT_ENGINE))`——符合 Promise 语义，消费者在 `await` 后以 `try/catch` 或 `.catch` 处理。
- **异步 `set` / 同步 `set` / 同步 `remove`**：返回 `new Error(ErrorMessage.NOT_ENGINE)` 实例——返回值通常不被消费，保持"惰性 Error"形态以最小化破坏面。
- **同步 `get`（本版本变更）**：**抛出** `throw new Error(ErrorMessage.NOT_ENGINE)`——同步 `get` 的返回值直接进入下游表达式（如 `syncLS.get("k").toString()`），若返回 Error 对象会与 TS 声明类型 `T[K]` 不一致造成运行时崩溃且编译期无警告；改为 throw 后与异步 `get` 的 `Promise.reject` 语义对称，且 TS 类型 `get<K>(key: K): T[K]` 保持不变（不再需要 `as any` 类型断言）。

#### Scenario: set 无 engine

- **WHEN** engines 数组全部为 null，消费者调用异步 `set("counter", 1)` 或同步 `set("counter", 1)`
- **THEN** 返回一个 `Error(ErrorMessage.NOT_ENGINE)` 实例

#### Scenario: 异步 get 无 engine

- **WHEN** engines 数组全部为 null，消费者调用异步 `get("counter")`
- **THEN** 返回的 Promise 以 `Error(ErrorMessage.NOT_ENGINE)` reject

#### Scenario: 异步 remove 无 engine

- **WHEN** engines 数组全部为 null，消费者调用异步 `remove("counter")`
- **THEN** 返回的 Promise 以 `Error(ErrorMessage.NOT_ENGINE)` reject

#### Scenario: 同步 get 无 engine

- **WHEN** engines 数组全部为 null，消费者调用同步 `get("counter")`
- **THEN** 抛出 `Error(ErrorMessage.NOT_ENGINE)`；下游必须以 `try/catch` 捕获

#### Scenario: 同步 remove 无 engine

- **WHEN** engines 数组全部为 null，消费者调用同步 `remove("counter")`
- **THEN** 返回一个 `Error(ErrorMessage.NOT_ENGINE)` 实例
