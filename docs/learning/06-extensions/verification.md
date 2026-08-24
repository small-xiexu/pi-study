# Extension 验证与证据边界

本文汇总静态源码、纯逻辑、Fake API、真实 Runner、内存 SessionManager、隔离 CLI、本地真实 Pi、新进程与真实 Provider各自能证明的范围。自动层锁定 Pi `0.84.1` 开发依赖，5.10 真实动态矩阵使用 Pi `0.84.2`；具体 Red/Green、测试计数和学习验收只见[完整学习计划](../../plans/pi-complete-learning-plan.md)。阶段 5 总览见[Pi Extensions](../06-extensions.md)。

## 实验材料与证据边界

实验实现位于 [`.pi/extensions/pi-study-guard/`](../../../.pi/extensions/pi-study-guard/README.md)。当前项目自动发现的主工厂登记只读 Tool `pi_study_inspect`、直接 Command `/study-inspect`、诊断 Flag、取消实验 Flag、生命周期诊断、默认关闭的取消门禁和常驻 Shell 双入口门禁；错误传播 Tool 仍留在 `fixtures/error-propagation/`，必须由 CLI 显式加载，不会随主工厂出现。Fake API 按各测试需要实现对应的 Tool 注册、Flag、事件和 Context 能力；来源与重载探针仍位于不会被项目自动递归发现的 `fixtures/loading/`。

| 标签 | 已保存的稳定证据 | 边界 |
|---|---|---|
| 源码证据 | `0.84.1` 的来源顺序、规范路径去重、Trust 两阶段复用、真实 API 对象创建、`await factory(api)`、注册写入记录和 `jiti` 加载 | 不证明本机已实际走过分支 |
| 运行证据（真实 Pi） | Trust 拒绝场景的帮助输出只出现 CLI 与全局探针 Flag | 只证明对应工厂登记完成；具体学习验收和后续实验状态见计划 |
| 运行证据（`tsc`） | 基线通过；两个本项目受控错误分别产生 `TS2322` 与 `TS2345`，恢复后再次通过 | 只证明当前配置仍检查项目源码和 Pi 公开类型 |
| 运行证据（Fake/Runner） | 直接调用工厂与 Handler/Executor，并用真实 `ExtensionRunner` 核对普通事件和 `tool_call` 的异常顺序 | 不证明真实 Pi 发现、Provider 调用、Core 错误 Tool Result或 TUI 呈现 |
| 用户理解验收 | 只由计划台账记录 | 文档、源码、真实运行、`tsc` 或 Fake 均不能自动替代 |

### 四层测试与手工验收矩阵

同一能力按“局部逻辑、宿主合同、真实加载、最终运行”逐层取证。较高层不会让较低层失效，也不能替代较低层的大量错误输入覆盖。

| 层级 | 当前入口 | 直接证明 | 不能证明 |
|---|---|---|---|
| 纯逻辑与真实文件 | 分类器、Markdown Parser、临时文件和可控 Timer | 已列举输入的分类、解析、路径、截断、取消和清理合同 | Pi 已加载模块或派发事件 |
| Fake API 与真实宿主组件 | 工厂/Handler Fake、`ExtensionRunner`、`SessionManager.inMemory` | 注册内容、Handler 返回形状、异常顺序、Branch 重放和无默认 Executor 等局部宿主合同 | 真实 CLI Loader、Provider、TUI 绘制或磁盘 Session |
| 隔离真实 Pi CLI | 锁定 Pi `0.84.1` 的 `--help` 对照 | 同一最小环境中，未加载时课程 Flag 为 `0`，唯一增加 `-e index.ts` 后为 `1`；真实 Loader 已导入工厂并完成 Flag 注册 | Handler、Tool、Command、TUI 或 Provider 正确 |
| 真实运行手工验收 | TUI、Print、真实 Model/Provider或无 Provider Command | 指定模式下真实 Pi 已走过目标链路并产生对应可见结果 | 所有输入、并发、版本、终端或 OS 权限均安全 |

真实运行层按能力和模式保存如下统一索引；每一行的详细命令、顺序、FAIL/PASS 和学习状态仍只在计划台账中维护。

| 能力 | 模式与外部链路 | 已验证的成功/拒绝/异常观察 | 证据边界 |
|---|---|---|---|
| 生命周期与 Context | TUI、Print；无需普通 Provider 请求 | `factory -> session_start -> Command -> session_shutdown`；TUI 通知与 Print `stderr` fallback 分流 | 只覆盖实际触发的事件和当前模式，不给出全局事件总顺序 |
| 协作取消 | TUI + 真实 Model/Provider + 内置 `read` | Handler 已进入后按 Esc，出现 `start -> cancelled` 和 `Operation aborted`，没有 Executor 后事件 | 不证明任意 Executor、子进程终止或副作用回滚 |
| 错误传播 | TUI + 真实 Model/Provider + 课程 Tool | observer 异常后继续；gate 异常在执行前失败；executor 异常形成错误 Tool Result | 不外推到其他 Tool、Provider、重试或所有错误类型 |
| 只读 Tool | TUI + 真实 Model/Provider | Model 选择一次 `pi_study_inspect`，界面与后续 Model Turn 获得一致的有界统计 | 单次合法成功不证明非法 Schema、路径、取消和全部文件；这些由自动层覆盖 |
| Slash Command | TUI、Print；Handler 本身不请求 Provider | 补全、一次有界通知、Print `stdout/stderr` 分离，并确认 0 Tool Call/Tool Result | 不证明 JSON/RPC 客户端或未知 Command |
| 双入口 Shell Gate | 用户 Shell 无 Provider；Model `bash` 使用真实 Model/Provider；另有 Print | SAFE 放行，未知命令默认拒绝，TUI No/Esc/Yes 与 marker 副作用形成对照，Print 无本机审批时拒绝 | 不是 Shell 语义解析器或 OS 沙箱；未知并发和其他 Extension 组合未证明 |
| Branch 状态 | TUI；用户 Shell 与只读 Probe 无普通 Provider请求 | 持久 Session 的 Reload/Tree/Fork/Resume 重放，以及 `--no-session` 同进程 Reload 延续、全新进程归零 | 不证明事务持久化、崩溃恢复、安全擦除或系统全局零写 |
| Widget | TUI、Print | 单一稳定状态牌完成初始、拒绝、允许、Reload和窄终端观察；Print 无 Widget 文本、错误或挂起 | 状态牌只展示快照，不负责门禁，不证明快照已落盘或任意终端兼容 |

### 资源所有权、并发与模式收口

课程 Guard 把一次 Extension 工厂调用视为一个 Runtime 的所有权边界：工厂只创建 Store、Widget Controller 和 Handler 注册，不启动脱离生命周期的后台资源；`session_start` 与 `session_tree` 总是先从当前 Branch 重放状态，再绑定并渲染当前 Context；`session_shutdown` 先清除 Widget，再把 Store 关闭。Reload、New、Fork 和 Resume 都可能替换 Runtime或 Context，因此不能把旧 Context、SessionManager 或 UI 引用当作长期全局对象复用。

并发层只依赖同步的 Store 提交作为最终串行点，不假设同轮 Tool Call 或用户输入天然顺序执行。自动测试把一个等待 TUI 确认的 Model Shell 与另一个用户 Shell 交错，最终两个决定都基于最新快照且阻止计数没有丢失；另一条测试在确认尚未返回时执行 Shutdown，即使随后确认返回允许，提交也因 Store 已关闭而失败，Executor 不启动并形成固定 `state_error` 拒绝。这里证明的是当前单进程事件循环和同步提交合同，不是跨进程锁、分布式事务或任意异步副作用安全。

真实 Pi `0.84.2` 动态矩阵覆盖连续 Reload、New、Tree、Fork、Resume、正常退出和 Print：每次 Runtime 替换都观察到对应 Shutdown、一个新 factory 和新 start；Tree 在同一 Runtime 中按目标 Branch 恢复；全程只显示一个稳定 key 的 Widget且Shell决定没有重复派发。Print模式只输出固定 Model回复，追踪为一次 factory、一次 startup、一次 quit shutdown，并且没有 `user_bash` 或 `shell_gate` 事件。自动类型与测试使用项目锁定的 Pi `0.84.1` 开发依赖，具体历史计数只见唯一计划；真实 `0.84.2` TUI/Print 证据用于补足公开运行路径。两层不能互相冒充，也不覆盖 JSON/RPC动态呈现、崩溃退出、任意版本、Provider稳定性或所有文件描述符与内存资源绝无泄漏。

当前材料包含受控 Flag、课程诊断、纯内存错误探针、临时 marker，以及只读统计 `docs/learning/` 顶层 Markdown 的首个业务 Tool。主 Tool 不写文件、不执行 Shell、不跟随 Markdown 链接、不主动联网；这仍不是 OS 沙箱。所有动态状态、当前断点与下一步均链接计划，不在本文件重复维护。
