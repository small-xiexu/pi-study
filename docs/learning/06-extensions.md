# Pi Extensions

本文默认描述 Pi `0.84.1`；5.10 的真实 Runtime 切换与 Print 动态矩阵明确使用 Pi `0.84.2`。Extension 是 Pi 的可选可执行插件层，用于注册、监听或拦截能力；它不是内置 Tool 的执行前提，也不是系统级沙箱。学习进度、当前验收状态和下一步只见 [完整学习计划](../plans/pi-complete-learning-plan.md)。

## 版本范围与证据口径

除非另有说明，本文的 Pi 行为均限定为本机 `0.84.1`；标明 5.10 动态矩阵的结论限定本机 CLI `0.84.2`。官方 `latest` 文档是动态参考，不作为任一版本行为的固定证据。

| 标签 | 含义 | 不能替代 |
|---|---|---|
| 文档说明 | 官方文档公开承诺的用法或能力 | 本机源码实现、实际运行结果 |
| 源码证据 | 对本机 `0.84.1` 安装包的静态检查 | 真实进程已经走过该分支 |
| 运行证据 | 实际执行得到的观察；必须继续注明是真实 Pi、`tsc` 还是 Fake 测试 | 其他运行链或用户已经掌握 |
| 用户理解验收 | 用户能够用完整场景解释机制和边界 | 源码正确、程序运行正确或安全 |

同一结论可能同时有多层证据，但各层不能互相冒充。本文保存稳定知识和可复用证据边界，不维护各计划项的动态状态。

## 完整场景：一个 Extension 如何生效

先看 `pi-study-guard` 的完整过程：

1. 项目把插件文件放在 `.pi/extensions/pi-study-guard/index.ts`。
2. Pi 启动时发现该文件，并把 TypeScript 模块导入当前进程。
3. Pi 从模块取得默认导出的启动函数，为这个插件建立一份内部记录和一个可操作 Pi 的真实对象。
4. Pi 调用启动函数，并把真实对象作为普通函数参数传入。
5. 启动函数通过该对象登记一个命令行 Flag；登记结果立即写入当前插件记录。
6. 启动函数返回后，插件进入待命状态。此时只能证明加载和登记完成，不能证明任何运行时处理逻辑已经触发。
7. 后续若插件登记了事件、Command 或 Tool，Pi 才会在对应事件、用户命令或 Model Tool Call 出现时调用已登记的处理函数。

这条链的起点是“Pi 发现本地代码”，终点是“Pi 在真实入口出现时派发已登记能力”。Extension 不需要由 Model 猜测或主动启动。

## Extension 是什么、不是什么

Extension 是被 Pi 加载并执行的 TypeScript 模块。它可以注册 Tool、Command、Flag、快捷键和 UI，也可以监听 Agent、Session、Tool、Shell 等事件。Extension 默认不会调用大模型，但其代码可以主动调用模型、执行命令、读写文件或访问网络。

没有 Extension，Pi 仍能调用 Model、运行 Agent Loop、使用内置 Tool、管理 Session 和提供基础 TUI。Extension 只为团队或业务增加定制能力。

Tool 不全由 Extension 提供：

| Tool 来源 | 谁提供 | 是否需要 Extension |
|---|---|---|
| Pi 内置 Tool | Pi Core，例如读文件、Shell 和文件编辑能力 | 不需要 |
| SDK 自定义 Tool | 嵌入 Pi 的宿主程序直接传入 | 不需要 |
| CLI 自定义 Tool | Extension 通过 `registerTool` 注册 | 通常需要 |

Pi Package 是分发载体，不是第四种 Tool 运行机制。Package 中的自定义 Tool 通常仍由它携带的 Extension 注册。

Extension 按职责可以覆盖九类能力：

| 能力类别 | 典型能力 |
|---|---|
| Tool 扩展 | 注册、启停、包装 Tool，定义参数校验和结果渲染 |
| 命令与输入 | 注册 Slash Command、快捷键、Flag、补全，处理用户输入 |
| Agent 与上下文 | 监听 Agent/Turn/消息事件，调整系统提示或上下文 |
| Tool 与 Shell 门禁 | 在 Tool 执行前后检查调用，拦截用户 `!` Shell |
| Session 与状态 | 监听启动、恢复、Fork、Tree、Compaction、退出并保存状态 |
| Model 与 Provider | 切换 Model/Thinking，注册或调整 Provider |
| UI 与渲染 | 显示确认框、通知、状态、Widget、Footer 或自定义渲染 |
| 资源与生命周期 | 追加 Skill/Prompt/Theme 路径，响应重载并管理资源 |
| 外部集成 | 执行进程、访问网络、监听文件、触发 CI/Webhook 或事件总线 |

用 Spring 类比，Extension 更接近插件模块或 Starter；事件 Handler 接近 Interceptor、Filter 或 AOP Advice；自定义 Tool 接近面向 Model 的可调用服务入口；Slash Command 是用户直接触发的命令入口。把 Extension 只理解成拦截器，会漏掉它的注册、UI、状态和外部集成能力。

## 核心对象

| 对象 | 大白话 | 谁创建、何时使用 |
|---|---|---|
| TypeScript 模块 | 装着插件代码的文件；导入时顶层代码也可能执行 | Pi 导入 |
| 插件工厂 | 模块默认导出的启动入口函数 | Pi 对每个有效工厂调用 |
| `ExtensionAPI` 类型 | 规定插件可以调用哪些受支持方法 | TypeScript 类型检查使用 |
| 真实 `ExtensionAPI` 对象 | 连接当前插件记录与 Pi Runtime 的操作入口 | Pi 创建并传给工厂 |
| Extension 记录 | 保存该插件登记的 Handler、Tool、Command、Flag 等 | Pi 创建并管理 |
| Handler | 处理事件或 Command 的函数 | 工厂登记，Pi 在匹配入口出现时调用 |
| Executor | 执行某个自定义 Tool 的函数 | 工厂随 Tool 登记，Pi 在匹配 Tool Call 出现时调用 |

示例中的 `pi` 或 `api` 只是工厂参数的局部变量名，指向 Pi 传入的同一类真实 `ExtensionAPI` 对象，不是两套 API，也不是 Pi 的副本。插件工厂也不是 Spring `FactoryBean`；它只是普通函数。

`on`、`registerTool`、`registerCommand`、`registerFlag` 等注册方法在工厂加载期间可用，调用后立即写入当前 Extension 记录。部分发送消息等运行时 Action 此时尚未绑定，因此真实 API 对象不代表整个 Pi Runtime 已经全部可用。

## 主题地图

| 要解决的问题 | 文档 | 职责 |
|---|---|---|
| Extension 怎样发现、初始化、注册、Reload 和释放 Runtime | [Runtime 与加载](06-extensions/runtime-loading.md) | 工厂、生命周期、来源、Trust、TypeScript 和依赖 |
| Context 中有什么，Tool、Command、Event 怎样触发和传播结果 | [Context、Tool、Command 与 Event](06-extensions/context-tools-events.md) | 取消、Observer/Gate/Executor、只读 Tool 和直接 Command |
| 两类 Shell 入口怎样 fail-closed，状态怎样跟随 Branch，Widget 怎样显示 | [Shell Gate、Branch State 与 Widget](06-extensions/guard-state-ui.md) | 策略、双适配器、状态重放、`--no-session` 和 UI |
| 静态、Fake/Runner、本地 Pi、新进程和真实 Provider 分别证明什么 | [验证与证据边界](06-extensions/verification.md) | 分层测试、手工矩阵、资源所有权与模式边界 |

## 阅读顺序

1. 先读本页的完整生效场景和核心对象。
2. 再读 [Runtime 与加载](06-extensions/runtime-loading.md)，建立发现、工厂、注册和派发主线。
3. 按需进入 [Context、Tool、Command 与 Event](06-extensions/context-tools-events.md) 和 [Shell Gate、Branch State 与 Widget](06-extensions/guard-state-ui.md)。
4. 最后用 [验证与证据边界](06-extensions/verification.md) 判断当前结论属于静态、Fake、真实 Pi、新进程还是 Provider 证据。

## 顶层路径兼容

`06-extensions.md` 继续保留在 `docs/learning/` 顶层，因此现有 `pi_study_inspect` Tool、`/study-inspect 06-extensions.md` Command 和固定补全文件名合同不变。该 Tool 仍只接受一个顶层 Markdown basename，不递归读取本主题子目录。

阶段 5 历史记录中的 `40 headings / 7 links`、`43` 个标题/`10` 个链接和对应 SHA 都属于拆分前文件快照；当前 hub 的统计会随导航结构变化，不是测试或运行时兼容合同。历史原始证据只见唯一计划，子页保存稳定机制与证明边界。

## 相关主题与扩展边界

Agent Run、Turn 和停止条件见 [架构与 Model 上下文](01-architecture-and-context.md)，Package 与自定义集成见 [Packages、Models 与 Providers](07-packages-models-providers.md)。生命周期、自定义 Tool、直接 Command、Shell 双入口门禁、Branch 状态恢复、最小 Widget，以及资源、并发和模式边界由本章说明；本地课程 Guard 的结论不能扩大成通用沙箱保证。

Pi 不内置 MCP 和 Subagent：MCP 通过 Extension 或 Package 接入；Subagent 通过 Extension、Package、独立 Pi 进程或 tmux 实现。它们会增加网络与凭据边界、模型费用、上下文复杂度和并发写入冲突，应在掌握 Tool、Session、Extension 和 Package 后按真实需求引入。
