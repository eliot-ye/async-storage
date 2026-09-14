## MODIFIED Requirements

### Requirement: 订阅与防抖通知

storage-core SHALL 提供 `subscribe(fn, keys?)` 接口：订阅时立即执行一次 fn；后续 set 触发时，通过 debounce（wait=0）合并短时间内的多次 set，只通知受影响 key 的订阅者；传空 keys 数组时只执行一次初始化调用且不返回 unsubscribe。

防抖窗口结束时，storage-core MUST 完成对当前受影响 key 的订阅匹配通知，再清空受影响 key 集合；此后的 `set` 调用 MUST 重新登记自己的 key，与上一次防抖批次的 key 集合相互独立——即一次防抖批次的匹配结果不会被后续 `set` 的清空动作影响，后续 `set` 也不会被上一次批次的 key 集合污染。

#### Scenario: 多次 set 合并

- **WHEN** 消费者订阅了 `["counter"]`，连续调用 `set("counter", 1)` 与 `set("counter", 2)`
- **THEN** 防抖后订阅函数只被调用一次，此时 `get("counter")` 返回最新值 `2`

#### Scenario: 空 keys 只初始化

- **WHEN** 消费者调用 `subscribe(fn, [])`
- **THEN** fn 立即执行一次，且不返回 unsubscribe 函数，后续 set 不再触发 fn

#### Scenario: 并发 set 各自 key 都被通知

- **WHEN** 消费者分别以 `subscribe(fnA, ["a"])` 与 `subscribe(fnB, ["b"])` 订阅不同 key，随后在同一个微任务批次内调用 `set("a", 1)` 与 `set("b", 2)`
- **THEN** 防抖窗口结束后 `fnA` 与 `fnB` 各自被通知至少一次，任一订阅者的 key 匹配不丢失

#### Scenario: 跨防抖批次 set 匹配独立

- **WHEN** 消费者以 `subscribe(fnA, ["a"])` 订阅 key `"a"`、以 `subscribe(fnB, ["b"])` 订阅 key `"b"`；先调用 `set("a", 1)` 并等待防抖窗口结束，随后再调用 `set("b", 2)`
- **THEN** 第二次 `set("b", 2)` 之后 `fnB` 被通知至少一次——`fnA` 订阅 key 的清空动作不影响 `fnB` 订阅 key 的匹配结果
