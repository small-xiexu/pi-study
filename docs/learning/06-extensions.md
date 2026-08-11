# Pi Extensions

本文默认描述 Pi `0.84.1`。Extension 是 Pi 的可选可执行插件层，用于注册、监听或拦截能力；它不是内置 Tool 的执行前提，也不是系统级沙箱。学习进度、当前验收状态和下一步只见 [完整学习计划](../plans/pi-complete-learning-plan.md)。

## 版本范围与证据口径

除非另有说明，本文的 Pi 行为均限定为本机 `0.84.1`。官方 `latest` 文档是动态参考，不作为该版本行为的固定证据。

| 标签 | 含义 | 不能替代 |
|---|---|---|
| 文档说明 | 官方文档公开承诺的用法或能力 | 本机源码实现、实际运行结果 |
| 源码证据 | 对本机 `0.84.1` 安装包的静态检查 | 真实进程已经走过该分支 |
| 运行证据 | 实际执行得到的观察；必须继续注明是真实 Pi、`tsc` 还是 Fake 测试 | 其他运行链或用户已经掌握 |
| 用户理解验收 | 用户能够用完整场景解释机制和边界 | 源码正确、程序运行正确或安全 |

同一结论可能同时有多层证据，但各层不能互相冒充。本文保存稳定知识和可复用证据边界，不维护 5.1 的动态状态。

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

## 加载、初始化、注册与运行时派发

```mermaid
flowchart TD
    A["Pi 启动或执行 /reload"] --> B["导入 Extension 模块"]
    B --> C["取得默认导出的工厂"]
    C --> D["创建 Extension 记录和真实 ExtensionAPI 对象"]
    D --> E["await factory(api)"]
    E --> F["注册调用立即写入 Extension 记录"]
    F --> G["等待运行时入口"]
    G --> H{"入口类型"}
    H -->|"生命周期事件"| I["按事件名调用 Handler"]
    H -->|"用户 Slash Command"| J["按命令名调用 Handler"]
    H -->|"Model Tool Call"| K0["调用已登记的 tool_call Handler"]
    K0 --> K["按 Tool 名调用内置或自定义 Executor"]
    I --> L["返回事件处理结果"]
    J --> M["返回命令处理结果"]
    K --> N["返回 Tool Result"]
```

一次加载中，每个经规范路径去重、成功导入且默认导出有效工厂的 Extension 调用一次工厂；`/reload` 会建立新一轮。运行时入口可能从未出现，也可能多次出现。

从调用工厂到同步返回或异步 `Promise` 完成，统称初始化：

| 方式 | 工厂行为 | Pi 的处理 |
|---|---|---|
| 同步 | 准备内存状态、登记能力并立即返回 | 返回后继续启动 |
| 异步 | 返回代表整个初始化过程的 `Promise`，内部等待有限 I/O 后登记能力 | 等待 `Promise` 完成后继续启动 |

同步或异步只描述一次性准备如何完成，不描述 Handler 或 Executor 如何触发。工厂可能在不启动 Session 的命令中执行，因此这里只做有限准备；不要在工厂中启动进程、Socket、Watcher 或 Timer。长期资源应延后到 `session_start` 或真实使用入口，并由幂等的 `session_shutdown` 清理。

证据链必须逐层建立：

`发现文件 -> 导入模块 -> 执行工厂 -> 注册能力 -> 触发 Handler/Executor -> 行为正确且安全`

前一层通过不能证明后一层通过。Extension 是拥有 Pi 进程和当前系统用户权限的本地代码；它可以实现门禁，也可以绕过门禁直接产生副作用。

## 四类加载来源与实验探针

同一个 Extension 文件可以通过四类入口交给 Pi。来源由 Pi 找到文件的入口决定，不由代码内容或文件名决定。

| 来源类别 | 默认位置或配置 | 当前实验探针 | 持续性 | Project Trust |
|---|---|---|---|---|
| CLI 临时加载 | `-e/--extension <path>` | `<lab>/cli.ts` | 当前进程 | 不控制 |
| 全局自动发现 | `~/.pi/agent/extensions/*.ts` 或子目录 `index.ts` | `<lab>/agent/extensions/global-auto.ts` | 持续 | 不控制 |
| 项目自动发现 | `.pi/extensions/*.ts` 或子目录 `index.ts` | `<lab>/project/.pi/extensions/project-auto.ts` | 持续 | 控制 |
| Settings 附加路径 | 全局或项目 `settings.json` 的 `extensions` | `<lab>/project/project-settings.ts`，由项目 Settings 引用 | 持续 | 项目 Settings 受控制；全局 Settings 不受控制 |

项目 Settings 的探针配置为：

```json
{
  "extensions": ["../project-settings.ts"]
}
```

相对路径从 `<lab>/project/.pi/settings.json` 所在目录解析，所以最终指向 `<lab>/project/project-settings.ts`。文件不在自动发现目录中；删除 Settings 引用后，Pi 不会仅凭文件名找到它。

`--no-extensions` 关闭常规 Extension 发现，但显式 `-e` 仍可加载指定文件。Package 不是这四类本地文件入口，留到阶段 6。

## Project Trust、顺序、去重与重载

四类入口在最终集合中占五个排序槽位，因为 Settings 是一种入口，但分为项目 Settings 和全局 Settings 两个位置。

```mermaid
flowchart TD
    A["启动 Pi"] --> B{"CLI 是否显式给出<br/>--approve 或 --no-approve？"}
    B -->|"是"| C["Trust 结果已知<br/>单遍加载允许的来源"]
    B -->|"否"| D{"启动时是否需要解析<br/>Project Trust？"}
    D -->|"否"| C
    D -->|"是"| E["先按项目未信任加载<br/>CLI 与全局来源"]
    E --> F{"Project Trust 结果"}
    F -->|"信任"| G["复用已加载实例<br/>补载项目 Settings 与项目自动发现"]
    F -->|"不信任"| H["复用已加载实例<br/>忽略两类项目来源"]
    C --> I["汇总允许来源"]
    G --> I
    H --> I
    I --> J["五个槽位排序<br/>CLI -> 项目 Settings -> 项目自动发现<br/>-> 全局 Settings -> 全局自动发现"]
    J --> K["按规范真实路径去重<br/>同一文件保留首项"]
    K --> L["初始化并注册"]
```

【源码证据】Pi `0.84.1` 在没有显式 Trust 覆盖且需要询问时，先加载 CLI 与全局 Extension；信任后复用这些实例并补载项目 Extension，不会再次执行已有工厂。Project Trust 只控制项目 Settings 和项目自动发现资源，既不控制 CLI/全局 Extension，也不降低操作系统权限。

加载顺序不是统一的覆盖规则：【源码证据】同一真实文件按规范路径去重；不同 Extension 的同名 Tool 由先加载者生效；同名 Command 会保留并增加编号后缀；事件 Handler 按加载与注册顺序运行，是否短路由事件类型决定。自动发现目录的字母顺序不是稳定契约，这些冲突行为仍需受控运行验证。

【文档说明】自动发现位置支持 `/reload`。【源码证据】`0.84.1` 还会重新解析 Settings 和 CLI 路径，但这不是跨版本承诺。实验必须把官方承诺、当前源码行为和本机运行结果分别记录。

## TypeScript 直接加载与独立类型检查

【文档说明】Pi 使用 `jiti` 直接加载 TypeScript Extension，不要求预先生成 `dist/index.js`。`jiti` 负责即时转换语法、解析 `import` 并执行模块，不执行完整 TypeScript 类型检查。官方入口见 [Extensions 文档](https://pi.dev/docs/latest/extensions)；该 `latest` 链接是动态参考。

同一份源码必须走两条互不替代的路线：

```mermaid
flowchart LR
    S["同一份 Extension 源码"] --> J["Pi / jiti 加载"]
    S --> T["tsc --noEmit"]
    J --> JA["证明当前语法、import 和工厂加载链可执行"]
    T --> TA["证明纳入配置的源码满足静态类型契约"]
    JA --> B["合并记录两类证据"]
    TA --> B
```

| 路线 | 能证明 | 不能证明 |
|---|---|---|
| Pi/`jiti` 加载 | 当前语法可转换、`import` 可解析、工厂可执行 | 静态类型正确、Handler/Executor 行为正确或安全 |
| `tsc --noEmit` | 纳入当前配置的类型声明和使用满足静态契约 | Pi 一定能加载、运行时行为正确、未纳入文件正确 |

`--noEmit` 只表示不生成输出文件；检查范围与严格程度仍由命令参数和 `tsconfig.json` 决定。`skipLibCheck` 跳过第三方 `.d.ts` 内部检查，但仍读取依赖公开类型并检查项目源码。启用后必须保留本项目受控类型错误的 Red/Green 对照，证明项目源码没有被一起跳过。

## 5.1 的四条依赖判断

5.1 只要求能正确配置和排查，不展开 npm 内部解析或 Package 发布策略：

| 判断 | 例子与边界 |
|---|---|
| 运行时第三方库放 `dependencies` | `ms` 提供 Node 实际执行的代码；只放开发依赖可能在生产安装后缺失 |
| 开发工具和类型声明放 `devDependencies` | TypeScript、测试工具和 `@types/ms` 服务于开发检查；类型声明不能代替真实运行代码 |
| Pi 核心包由宿主提供 | Extension 运行时的真实 `ExtensionAPI` 对象由 Pi 传入；具体 `peerDependencies` 发布配置留到阶段 6 |
| 锁文件固定完整解析结果 | `package-lock.json` 记录直接与传递依赖的解析树；`node_modules` 才是当前机器供 Node 加载的代码 |

锁文件只有在安装流程实际使用且与 `package.json` 一致时才帮助复现，也不能证明依赖安全、类型正确或行为正确。`npm ci`、完整性字段、上游 shrinkwrap、多版本树和 Maven 依赖调解等审计细节不属于 5.1 的教学主线；本次实验的具体审计证据保留在计划台账，Package 发布语义留到阶段 6。

## 实验材料与证据边界

实验骨架位于 [`.pi/extensions/pi-study-guard/`](../../.pi/extensions/pi-study-guard/README.md)。主工厂只登记唯一 Flag；Fake API 只实现 `registerFlag`；来源探针和重载探针位于不会被项目自动递归发现的 `fixtures/loading/`，只复制到隔离临时目录使用。

| 标签 | 已保存的稳定证据 | 边界 |
|---|---|---|
| 源码证据 | `0.84.1` 的来源顺序、规范路径去重、Trust 两阶段复用、真实 API 对象创建、`await factory(api)`、注册写入记录和 `jiti` 加载 | 不证明本机已实际走过分支 |
| 运行证据（真实 Pi） | Trust 拒绝场景的帮助输出只出现 CLI 与全局探针 Flag | 只证明对应工厂登记完成；具体学习验收和后续实验状态见计划 |
| 运行证据（`tsc`） | 基线通过；两个本项目受控错误分别产生 `TS2322` 与 `TS2345`，恢复后再次通过 | 只证明当前配置仍检查项目源码和 Pi 公开类型 |
| 运行证据（Fake） | 直接调用主工厂时，Fake API 收到预期 Flag 登记 | 不证明真实 Pi 发现、Trust、去重、重载或运行时派发 |
| 用户理解验收 | 只由计划台账记录 | 文档、源码、真实运行、`tsc` 或 Fake 均不能自动替代 |

实验材料只处理受控 Flag 和临时 marker，不注册业务能力、不联网、不启动后台资源。所有动态状态、当前断点与下一步均链接计划，不在本文件重复维护。

## 后续能力地图

### Shell 门禁预览

Shell 门禁属于后续实现主题。下面的图只负责 Model `bash` Tool Call 的允许/拒绝链，不代表通用 Extension 生命周期：

```mermaid
sequenceDiagram
    participant M as Model
    participant A as Provider / API Adapter
    participant P as Pi / Agent Loop
    participant E as 安全 Extension
    participant T as bash Tool

    M-->>A: Tool Call：执行命令
    A-->>P: 解析并交给 Agent Loop
    P->>E: tool_call Handler 检查 bash
    E-->>P: 允许、拒绝或要求确认
    alt 允许
        P->>T: 调用 bash Executor
        T-->>P: Tool Result
    else 拒绝
        P->>P: 生成被阻止的 Tool Result
    end
    P->>A: 携带结果发起后续请求
    A->>M: 按协议发送
```

用户直接输入 `!命令` 或 `!!命令` 时走 `user_bash`，绕过 Model 决策和 `tool_call`；前者输出进入 Model 上下文，后者不进入。完整保护必须分别覆盖 Model `bash` 和用户 Shell。交互模式可询问用户；无 UI 模式必须预先定义默认拒绝等明确策略。

### 其他能力

Agent Run、Turn 和停止条件见 [架构与 Model 上下文](01-architecture-and-context.md)。后续按计划继续学习事件生命周期、自定义 Tool/Command、状态、UI 和资源释放。

Pi 不内置 MCP 和 Subagent：MCP 通过 Extension 或 Package 接入；Subagent 通过 Extension、Package、独立 Pi 进程或 tmux 实现。它们会增加网络与凭据边界、模型费用、上下文复杂度和并发写入冲突，应在掌握 Tool、Session、Extension 和 Package 后按真实需求引入。
