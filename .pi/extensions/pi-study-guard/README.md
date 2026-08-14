# Extension 实验材料

这个目录保存可检查的 Extension 实现与受控实验材料，现已包含首个只读业务 Tool。学习状态和下一步只见 [`docs/plans/pi-complete-learning-plan.md`](../../../docs/plans/pi-complete-learning-plan.md)。

- `index.ts`：当前项目自动发现的 `pi-study-guard` 工厂；注册只读检查 Tool、默认关闭的实验 Flag、生命周期诊断和取消门禁。
- `inspect-tool.ts`：注册 `pi_study_inspect`，定义严格 Schema、Executor、`content/details` 和有界 TUI renderer。
- `inspect-path.ts`：把读取范围限制在当前 `ctx.cwd/docs/learning/` 的顶层 Markdown 文件，并负责只读打开、文件对象校验、大小上限、分块读取和取消检查。
- `markdown-inspection.ts`：使用 Markdown Token 统计标题和链接，生成最多 20 个有界样本。
- `lifecycle-trace.ts`：5.2-5.3 共用的脱敏诊断模式；设置追踪环境变量后注册实验 Command 与事件 Handler，并为 Command 和取消探针记录有限状态。
- `cancel-probe.ts`：5.3 的 opt-in `tool_call` 取消门禁；只有显式开启 `--pi-study-cancel-probe` 才工作，且不注册自定义 Tool。
- `test/factory.test.ts`：用 Fake API 验证工厂登记、Tool 唯一注册、事件白名单、Context 脱敏、模式反馈分支和追踪路径边界。
- `test/inspect-tool.test.ts`：验证严格 Schema、成功/失败合同、取消边界和 renderer 的清洗、截断与 fallback。
- `test/inspect-path.test.ts`：用真实临时文件对象验证合法读取、越界、符号链接、硬链接、特殊文件、大小限制、读取竞态与资源关闭。
- `test/markdown-inspection.test.ts`：用真实 Markdown Parser 验证标题、链接、代码块排除、顺序和输出上限。
- `test/cancel-probe.test.ts`：验证取消门禁默认关闭、目标匹配、活动 signal、超时和 fail-closed 分支。
- `fixtures/cancellation/cooperative-delay.ts`：5.3 的纯本地协作延迟函数；只接收外部传入的 `AbortSignal` 和 Timer，由 opt-in 取消门禁与 Fake 测试共同复用。
- `test/cooperative-delay.test.ts`：用可控 Timer 对照未取消与运行中取消，并核对 Timer、Abort listener 和迟到回调边界。
- `fixtures/error-propagation/index.ts`：5.3 的显式错误传播实验入口；不被项目自动发现，只有明确传给 `--extension` 才加载。
- `fixtures/error-propagation/error-probe.ts`：按 `observer`、`gate`、`executor` 三种模式注入固定错误，并注册一个只在内存返回固定文本的课程 Tool。
- `test/error-probe.test.ts`：验证默认关闭、三种错误位置、真实 Runner 的 Handler 顺序、调用/Turn 熔断、显式入口和私有临时日志边界。
- `fixtures/loading/*.ts`：A-F 隔离实验使用的来源探针；它们位于自动发现深度之外，不会被当前项目自动加载。
- `fixtures/loading/reload.ts`：仅在设置 `PI_STUDY_RELOAD_MARKER` 时，向操作系统临时目录中的固定文件名追加 `V1`；不启动进程、Socket、Watcher 或 Timer。

依赖全部固定为开发依赖：Pi 包提供官方 Extension 类型，`typebox` 定义参数 Schema，`pi-tui` 提供公开的 `Text` 与 `Marked`，TypeScript 负责 `noEmit` 检查，`@types/node` 提供 Node API 类型。真实运行时的 `ExtensionAPI` 仍由 Pi 宿主传入。

依赖清单和锁文件完成审计后，安装证据对应的命令是：

```bash
npm ci --ignore-scripts --omit=optional --audit=false --fund=false
```

安装命令要求 npm 跳过生命周期脚本并省略 optional 包，但这不证明依赖本身安全。安装后分别运行：

```bash
npm run typecheck
npm test
```

初始类型检查被 Pi 传递依赖声明文件中的模块解析和 JSON import 错误挡住。当前配置启用 `skipLibCheck`；它只跳过依赖声明文件的内部检查，仍使用公开类型检查本项目源码。

已保存的类型检查 Green/Red/Green 证据为：正常源码通过；把本项目字符串常量临时赋值为数字后，`tsc` 报告 `TS2322`；把 `registerFlag` 的字符串名称临时改为数字后，Pi 公开签名触发 `TS2345`；两次受控错误恢复后，当前源码继续通过类型检查。具体测试计数属于动态验证结果，只记录在学习计划中。

这些结果只证明当前 TypeScript 配置和 Fake API 测试覆盖的局部行为，不证明真实 Pi 的来源、Trust、去重、热重载或用户理解。A-F 的运行与验收状态不在本文件维护。

5.2 追踪模式要求 `PI_STUDY_LIFECYCLE_TRACE` 指向操作系统临时目录中的固定文件名 `pi-study-lifecycle.log`。日志只记录序号、事件名和白名单元数据，不记录 Prompt、Command 参数、Shell 命令、Tool 参数/结果、文件路径、Model 标识或 Session 内容。Fake 测试只验证注册与脱敏写入逻辑，不证明真实 Pi 已派发这些事件。

5.3 的 `/pi-study-trace` Context 快照只记录 `mode`、`hasUI`、规范 cwd 是否与进程 cwd 相同、Trust，以及 Session File、Model、Signal 是否存在。TUI/RPC 使用 UI 通知；Pi `0.84.1` 的 TUI `info` 通知实际呈现为输入框上方聊天记录区中的灰色状态文字，而不是弹窗或 Toast。Print/JSON 将 fallback 写入 `stderr`，避免破坏非交互 stdout 协议。`present` 只表示对象或值存在，不证明文件已落盘、Model/Provider 可用或 Signal 已取消；`trusted` 与 cwd 相等也不是权限或安全判断。追踪先于通知或 fallback 写入，因此 `route` 只证明选择了哪条代码分支，不单独证明用户已经看到反馈或终端完成绘制。

5.3 的 Fake 协作取消对照只验证课程本地延迟函数：A 组不取消并手动驱动受控 Timer 到期，形成 `start -> completed`；B 组在确认 Timer 与 listener 已登记后取消，形成 `start -> cancelled`。两组都清理 Timer 与 listener；B 组在强制执行已捕获的旧 Timer 回调后仍不会补记 `completed`。回归还覆盖默认系统 Timer、`schedule()` 内同步完成、同步取消、合法的 `undefined` handle，以及清理抛出 `undefined` 时 Promise 仍明确拒绝。

同一延迟函数现在由 `index.ts` 注册的 opt-in `tool_call` Handler 复用，但 Flag 默认关闭。Flag 开启时，非目标 Tool、非目标路径、signal 缺失、超时和内部异常都 fail-closed；它不注册自定义 Tool，也不启动 Maven。本地 Green 只证明实现与 Fake API 契约，不证明真实 Pi 已把 `ctx.signal` 交给 Handler，也不证明用户按 `Esc`、Tool Executor 的显式 signal、`pi.exec`、进程树终止或副作用回滚；真实 TUI 结果只记录在唯一学习计划中。

错误传播探针与常驻 `pi-study-guard` 分离。它要求显式入口、固定名 `pi-study-error-probe.log` 和单一字符串 Flag `--pi-study-error-mode=observer|gate|executor`；未设置、非法值、日志不可用时都不激活实验 Tool。日志只能在操作系统临时目录下由当前用户拥有且无组/其他用户权限的目录中，以 exclusive-create 方式新建，拒绝已存在目标和符号链接。探针不读取业务文件、不执行 Shell/子进程、不主动访问网络；真实实验中的网络只来自用户授权的 Pi Provider 调用。

三种模式只改变固定错误的位置：`observer` 的一次性普通 `turn_start` Handler 抛错后，后置 Handler 与 Executor 仍可继续；`gate` 在 `tool_call` 阶段抛错，Executor 不应进入；`executor` 在 Executor 内抛错，不得记录成功。一次调用预算和 Turn 上限用于阻止 Model 自主重复调用；日志写失败时，熔断会先执行。若动态注册 Tool 后第一次 `armed` 写入恰好失败，Pi 没有对应的公开注销事务，Tool 可能仍出现在集合中，但探针保持未就绪：后续每个 Turn 都会 abort，门禁和 Executor 也只能 fail-closed，不能返回成功。

Fake 中手工送入的 `tool_result`、`tool_execution_end` 或 ToolResult message 事件，只验证探针如何记录宿主提供的字段，不证明 Pi Core 已产生这些事件。真实 `ExtensionRunner` 测试能证明普通 Handler 异常被记录后继续、`tool_call` 异常停止后置 Handler；只有用户实际运行 Provider/Model/TUI 后的固定错误文本和脱敏日志，才能证明本次真实错误 Tool Result 与 Agent 后续行为。

5.4 的 `pi_study_inspect` 只接受一个顶层 `.md` 文件名，允许根固定为每次执行现场的 `ctx.cwd/docs/learning/`。Executor 不写文件、不执行 Shell、不跟随 Markdown 链接，也不主动联网；它拒绝符号链接、硬链接和非普通文件，输入上限为 128 KiB。成功结果只返回标题/链接总数与合计最多 20 个样本；取消、安全拒绝、读取或解析失败通过抛出异常进入错误 Tool Result。

自动测试、类型检查和无 Provider 的 Pi 帮助预检，只能证明当前源码、局部宿主合同与模块加载入口。它们不证明 Provider 一定选择该 Tool、真实 Pi Core 已形成预期 Tool Result、真实 TUI 的折叠/展开效果或用户已理解；这些动态验收仍以唯一学习计划为准。业务逻辑只读也不等于操作系统权限被限制。
