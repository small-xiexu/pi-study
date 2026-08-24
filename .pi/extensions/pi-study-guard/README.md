# Extension 实验材料

这个目录保存可检查的 Extension 实现与受控实验材料，现已包含首个只读业务 Tool。学习状态和下一步只见 [`docs/plans/pi-complete-learning-plan.md`](../../../docs/plans/pi-complete-learning-plan.md)。

## 实现与文件地图

- `index.ts`：当前项目自动发现的 `pi-study-guard` 工厂；注册只读检查 Tool、`/study-inspect` Command、默认关闭的实验 Flag、生命周期诊断、Branch 状态、取消门禁和受控 Shell 审批门禁。
- `inspect-service.ts`：Tool 与 Command 共用、不接触 Extension Context 或 UI 接口的检查服务；接收 `cwd/file/signal`，返回统一检查报告并生成规范摘要。
- `inspect-tool.ts`：注册 `pi_study_inspect`，定义严格 Schema、Tool 适配、`content/details` 和有界 TUI renderer。
- `inspect-command.ts`：注册 `/study-inspect`，负责原始参数校验、固定 TUI 补全以及有 UI/无 UI 的反馈路由。
- `inspect-path.ts`：把读取范围限制在当前 `ctx.cwd/docs/learning/` 的顶层 Markdown 文件，并负责只读打开、文件对象校验、大小上限、分块读取和取消检查。
- `markdown-inspection.ts`：使用 Markdown Token 统计标题和链接，生成最多 20 个有界样本。
- `lifecycle-trace.ts`：5.2-5.7 共用的脱敏诊断模式；设置追踪环境变量后注册实验 Command 与事件 Handler，并为 Command、取消探针和 Shell 门禁记录有限状态。
- `cancel-probe.ts`：5.3 的 opt-in `tool_call` 取消门禁；只有显式开启 `--pi-study-cancel-probe` 才工作，且不注册自定义 Tool。
- `shell-policy.ts`：5.6 的纯 Shell 分类器；只逐字识别固定 SAFE 与 MARKER 课程命令，其他输入默认拒绝，不解析也不执行 Shell。
- `shell-gate.ts`：5.6-5.7 的双入口适配器；把同一策略分别映射为 Model `tool_call` 的 `block` 和用户 `user_bash` 的替代 `BashResult`，只在本机 TUI 对固定 MARKER 请求确认，并在最终返回前提交同一份 Branch 状态。
- `shell-state.ts`：5.7 的 Branch 状态服务；严格解析 v1 完整快照，从当前 `getBranch()` 根到叶重放，并在 `session_start/session_tree/session_shutdown` 维护当前实例状态。
- `shell-widget.ts`：5.8 的最小 TUI 状态牌；使用稳定 key 展示脱敏状态，状态提交成功后更新，生命周期切换和 Shutdown 时清除，非 TUI/无 UI 跳过。
- `test/factory.test.ts`：用 Fake API 验证工厂登记、Tool/Command 唯一注册、事件白名单、Context 脱敏、模式反馈、Shell 门禁真实派发顺序和追踪路径边界。
- `test/pi-cli-loading.test.ts`：在全新临时 `HOME`、`PI_CODING_AGENT_DIR` 和工作目录中启动锁定的真实 Pi CLI，对照不加载与显式 `-e index.ts` 时课程 Flag 的 `0 -> 1`；不请求 Provider，也不读取临时认证存储内容。
- `test/inspect-service.test.ts`：用真实临时 Markdown 和注入边界验证共享报告、规范摘要、显式 Context 参数、取消与异常脱敏。
- `test/inspect-command.test.ts`：验证 Command 注册、固定补全、参数拒绝、TUI/RPC 通知、Print/JSON fallback，以及与 Tool 的真实摘要一致性。
- `test/inspect-tool.test.ts`：验证严格 Schema、成功/失败合同、取消边界和 renderer 的清洗、截断与 fallback。
- `test/inspect-path.test.ts`：用真实临时文件对象验证合法读取、越界、符号链接、硬链接、特殊文件、大小限制、读取竞态与资源关闭。
- `test/markdown-inspection.test.ts`：用真实 Markdown Parser 验证标题、链接、代码块排除、顺序和输出上限。
- `test/cancel-probe.test.ts`：验证取消门禁默认关闭、目标匹配、活动 signal、超时和 fail-closed 分支。
- `test/shell-policy.test.ts`：验证两条固定课程命令的逐字分类，以及空白、换行、分号和近似字符串默认拒绝。
- `test/shell-gate.test.ts`：验证两个 Shell 入口的模式、确认、取消、异常和返回合同，并用真实 `ExtensionRunner` 对照 `user_bash` 裸异常的 fail-open 与生产适配器的 fail-closed。
- `test/shell-state.test.ts`：验证快照严格白名单、未知版本、Branch 重放、完整快照提交、append 失败锁存和生命周期恢复。
- `test/shell-state-gate.test.ts`：验证状态未就绪或提交失败时两个 Shell 入口都显式拒绝，并验证同一 Store 的累计计数。
- `test/shell-widget.test.ts`：验证稳定 key 原位更新、状态颜色/摘要边界、无 UI 跳过和幂等清除。
- `test/shell-state-session.test.ts`：用真实 `SessionManager.inMemory` 验证 A/B Branch 切换、当前 `getBranch()` 恢复、Custom Entry 的 Context 排除和 `--no-session` 边界。
- `fixtures/state-probe/index.ts`：5.7 的显式只读观测入口；只注册 `/pi-study-state-probe`，从当前 Branch 投影自有 Shell 状态，不接入主工厂，不追加 Entry，也不读取普通消息正文、Session 路径或 ID。
- `test/state-probe.test.ts`：验证 Probe 的当前 Branch 重放、固定有界摘要、路径脱敏、畸形状态拒绝、零追加及 Reload 后不复用旧 Command Context。
- `fixtures/cancellation/cooperative-delay.ts`：5.3 的纯本地协作延迟函数；只接收外部传入的 `AbortSignal` 和 Timer，由 opt-in 取消门禁与 Fake 测试共同复用。
- `test/cooperative-delay.test.ts`：用可控 Timer 对照未取消与运行中取消，并核对 Timer、Abort listener 和迟到回调边界。
- `fixtures/error-propagation/index.ts`：5.3 的显式错误传播实验入口；不被项目自动发现，只有明确传给 `--extension` 才加载。
- `fixtures/error-propagation/error-probe.ts`：按 `observer`、`gate`、`executor` 三种模式注入固定错误，并注册一个只在内存返回固定文本的课程 Tool。
- `test/error-probe.test.ts`：验证默认关闭、三种错误位置、真实 Runner 的 Handler 顺序、调用/Turn 熔断、显式入口和私有临时日志边界。
- `fixtures/loading/*.ts`：A-F 隔离实验使用的来源探针；它们位于自动发现深度之外，不会被当前项目自动加载。
- `fixtures/loading/reload.ts`：仅在设置 `PI_STUDY_RELOAD_MARKER` 时，向操作系统临时目录中的固定文件名追加 `V1`；不启动进程、Socket、Watcher 或 Timer。

## 依赖与验证

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

## 生命周期与 Context

5.2 追踪模式要求 `PI_STUDY_LIFECYCLE_TRACE` 指向操作系统临时目录中、当前用户拥有且组/其他用户不可访问的私有目录，并使用固定文件名 `pi-study-lifecycle.log`；目标必须是当前用户拥有、单链接且权限私有的普通文件，符号链接、硬链接、FIFO 和其他特殊对象均拒绝。首次成功写入会固定文件的 `dev/ino`，同路径替换成另一个安全文件也会拒绝；同步写入必须返回完整字节数。日志只记录序号、事件名和白名单元数据，不记录 Prompt、Command 参数、Shell 命令、Tool 参数/结果、文件路径、Model 标识或 Session 内容；Tool 名只保留 Pi `0.84.1` 的七个内置名称和课程 Tool `pi_study_inspect`，消息 Role 只保留当前固定宿主角色，其他任意 Tool 名或 Role 统一写为 `custom`。任一写入失败会把该追踪实例永久标记为不可用，后续门禁记录固定失败而不是恢复放行；对外只抛固定错误码，不扩散底层路径。Fake 测试只验证注册、文件门禁与脱敏写入逻辑，不证明真实 Pi 已派发这些事件。

5.3 的 `/pi-study-trace` Context 快照只记录 `mode`、`hasUI`、规范 cwd 是否与进程 cwd 相同、Trust，以及 Session File、Model、Signal 是否存在。TUI/RPC 使用 UI 通知；Pi `0.84.1` 的 TUI `info` 通知实际呈现为输入框上方聊天记录区中的灰色状态文字，而不是弹窗或 Toast。Print/JSON 将 fallback 写入 `stderr`，避免破坏非交互 stdout 协议。`present` 只表示对象或值存在，不证明文件已落盘、Model/Provider 可用或 Signal 已取消；`trusted` 与 cwd 相等也不是权限或安全判断。追踪先于通知或 fallback 写入，因此 `route` 只证明选择了哪条代码分支，不单独证明用户已经看到反馈或终端完成绘制。

## 取消与错误传播

5.3 的 Fake 协作取消对照只验证课程本地延迟函数：A 组不取消并手动驱动受控 Timer 到期，形成 `start -> completed`；B 组在确认 Timer 与 listener 已登记后取消，形成 `start -> cancelled`。两组都清理 Timer 与 listener；B 组在强制执行已捕获的旧 Timer 回调后仍不会补记 `completed`。回归还覆盖默认系统 Timer、`schedule()` 内同步完成、同步取消、合法的 `undefined` handle，以及清理抛出 `undefined` 时 Promise 仍明确拒绝。

同一延迟函数现在由 `index.ts` 注册的 opt-in `tool_call` Handler 复用，但 Flag 默认关闭。Flag 开启时，非目标 Tool、非目标路径、signal 缺失、超时和内部异常都 fail-closed；它不注册自定义 Tool，也不启动 Maven。本地 Green 只证明实现与 Fake API 契约，不证明真实 Pi 已把 `ctx.signal` 交给 Handler，也不证明用户按 `Esc`、Tool Executor 的显式 signal、`pi.exec`、进程树终止或副作用回滚；真实 TUI 结果只记录在唯一学习计划中。

错误传播探针与常驻 `pi-study-guard` 分离。它要求显式入口、固定名 `pi-study-error-probe.log` 和单一字符串 Flag `--pi-study-error-mode=observer|gate|executor`；未设置、非法值、日志不可用时都不激活实验 Tool。日志只能在操作系统临时目录下由当前用户拥有且无组/其他用户权限的目录中，以 exclusive-create 方式新建，拒绝已存在目标和符号链接。探针不读取业务文件、不执行 Shell/子进程、不主动访问网络；真实实验中的网络只来自用户授权的 Pi Provider 调用。

三种模式只改变固定错误的位置：`observer` 的一次性普通 `turn_start` Handler 抛错后，后置 Handler 与 Executor 仍可继续；`gate` 在 `tool_call` 阶段抛错，Executor 不应进入；`executor` 在 Executor 内抛错，不得记录成功。一次调用预算和 Turn 上限用于阻止 Model 自主重复调用；日志写失败时，熔断会先执行。若动态注册 Tool 后第一次 `armed` 写入恰好失败，Pi 没有对应的公开注销事务，Tool 可能仍出现在集合中，但探针保持未就绪：后续每个 Turn 都会 abort，门禁和 Executor 也只能 fail-closed，不能返回成功。

Fake 中手工送入的 `tool_result`、`tool_execution_end` 或 ToolResult message 事件，只验证探针如何记录宿主提供的字段，不证明 Pi Core 已产生这些事件。真实 `ExtensionRunner` 测试能证明普通 Handler 异常被记录后继续、`tool_call` 异常停止后置 Handler；只有用户实际运行 Provider/Model/TUI 后的固定错误文本和脱敏日志，才能证明本次真实错误 Tool Result 与 Agent 后续行为。

## Tool 与 Command

5.4 的 `pi_study_inspect` 只接受一个顶层 `.md` 文件名，允许根固定为每次执行现场的 `ctx.cwd/docs/learning/`。Executor 不写文件、不执行 Shell、不跟随 Markdown 链接，也不主动联网；它拒绝符号链接、硬链接和非普通文件，输入上限为 128 KiB。成功结果只返回标题/链接总数与合计最多 20 个样本；取消、安全拒绝、读取或解析失败通过抛出异常进入错误 Tool Result。

5.5 的 `/study-inspect` 只接受一个最终校验过的顶层 `.md` 文件名；补全只建议固定示例，不扫描目录，也不替代 Handler 校验。Command 与 Tool 复用 `inspect-service.ts`，但各自保留入口合同：Tool 返回 `content/details`，Command 返回 `void` 并主动反馈同一摘要。`ctx.hasUI=true` 时走一次通知；Print/JSON 等无 UI 模式把同一摘要写入 `stderr`，避免污染 JSON `stdout`。空闲 Command 的 `ctx.signal` 通常不存在，Esc 也不是它的自动取消机制。

## Shell Gate、状态与 Widget

5.6 的 Shell 门禁只是一份受控教学合同。纯分类器逐字放行固定 SAFE 命令，把固定 MARKER 写入命令标为需要审批，其余字符串一律拒绝；MARKER 只有在 `mode=tui`、`hasUI=true`、确认明确为 Yes且 signal 未取消时才放行。Model `bash` 拒绝返回固定 `block`，用户 `!`/`!!` 拒绝返回 `exitCode=126` 的替代 `BashResult`；策略、UI 或追踪写入异常都收敛为拒绝。生命周期追踪只记录入口、规则、决定、原因和 `excludeFromContext` 固定枚举，不记录原始命令。

自动测试验证分类器、双适配器、主工厂顺序、固定追踪以及 Pi `0.84.1` 的 `user_bash` 裸异常可能继续派发这一 Runner 合同。真实 TUI 又验证了 Model/用户两入口的安全放行、No、Esc、Yes与 marker 副作用；真实 Print 验证了无本机 TUI时 Model MARKER 默认拒绝。它们仍不证明 RPC/JSON、任意 Shell语法、其他 Extension组合或操作系统隔离；`shellCommandPrefix`、后置参数修改器和直接子进程调用仍是独立边界。

5.7 的 Shell 状态使用固定 `customType=pi-study-guard.shell-gate-state` 和 v1 完整快照，只保存 `mode/blockedCount/lastDecision` 及固定枚举，不保存原始命令、cwd、路径、Prompt、异常正文或凭据。当前 Branch 中任一同类型未知版本或畸形快照都会让状态保持不可用；恢复不会迁移、修复、跳过坏节点或追加新 Entry。主工厂只创建一个 Store，生命周期 Handler 在 `session_start/session_tree` 先清旧内存再读取当前 `getBranch()`，Model 与用户 Shell Gate 共用该 Store；`session_shutdown` 只清理。

Gate 先提交完整快照，再记录最终脱敏追踪；状态未就绪，或状态提交返回 `false`/抛错时，统一形成 `state_error` 拒绝，追踪可用时再记录该固定结果。状态未就绪会在分类和确认前拒绝；首次 MARKER 已经完成确认后才可能遇到提交失败，后续请求则在下一次明确恢复前继续 fail-closed。`appendEntry()` 正常返回不是磁盘持久化确认，抛错也不代表 SessionManager 内存树已原子回滚；若状态提交成功后追踪失败，Gate 仍拒绝，但已提交快照仍只表示 Gate 评估。自动测试和真实 `SessionManager.inMemory` 已覆盖严格解析、A/B Branch 恢复、双入口累计和 Custom Entry 不进入构建后的 Model Context；这些证据不证明真实 JSONL、跨进程恢复或真实 `/reload`、Tree、Fork、Resume 生命周期，动态验收仍只记录在学习计划中。

## 证据边界

自动测试、类型检查和无 Provider 的 Pi 帮助预检，只能证明当前源码、局部宿主合同与模块加载入口。5.4 的自动证据不证明 Provider 一定选择 Tool、真实 Pi Core 已形成预期 Tool Result 或真实 TUI renderer；5.5 的自动证据也不证明真实 Pi 已命中 Slash Command、TUI 已接入补全/通知、Print 已正确分离 `stdout/stderr`，或真实路径确为 0 次 Provider。5.6 的真实确认与执行证据同样必须单独验收；5.7 的内存 Branch Green也不能冒充真实磁盘 Session 恢复。动态验收仍以唯一学习计划为准。业务逻辑只读和 Extension 门禁都不等于操作系统权限被限制。
