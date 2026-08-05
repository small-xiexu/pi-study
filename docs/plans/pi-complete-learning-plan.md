# Pi Coding Agent 完整学习计划

> 唯一进度台账：后续学习、练习、验收和断点信息均回写本文件。代码或文件已经存在，不等于计划项已经完成。

## 1. 计划基线

- 制定日期：2026-07-29
- 学习对象：Pi Coding Agent
- 官方文档基线：`https://pi.dev/docs/latest`
- npm 版本基线：`@earendil-works/pi-coding-agent@0.83.0`
- 参考会话：`019fa972-6149-7511-85fc-885b2be05368`
- 当前阶段：阶段 0 和阶段 1 已完成；阶段 2 尚未开始
- 下一步：进入 2.1；先建立全局配置、项目配置与启动参数的合并规则和优先级地图
- 预计投入：Pi 学习与综合项目 60-85 小时；学习网站另计 8-12 小时；按验收结果推进
- 建议节奏：每次 60-90 分钟，每周 4-5 次；先完成 Pi 主线，再用 1-2 周制作学习网站

### 当前环境快照

| 项目 | 当前状态 | 证据 |
|---|---|---|
| 学习仓库 | 已准备，当前以学习文档为主 | `/Users/sxie/xbk/pi-study` |
| Git 远程 | 已配置 | `https://github.com/small-xiexu/pi-study.git` |
| Node.js | 可用 | `v25.2.1` |
| npm | 可用 | `11.6.2` |
| Git | 可用 | `2.50.1` |
| Pi | 已安装、更新并启动 | `/opt/homebrew/bin/pi`，版本 `0.83.0`；命令与实际 TUI 启动均已核验 |
| 模型认证 | 已连接 | 中转站 `https://sub2api.shelfcanvas.top`；`openai-responses`；`openai/gpt-5.6-sol` 已实际响应；凭据文件权限 `0600` |

## 2. 学习目标

完成本计划后，应能够独立：

1. 安装、认证、配置并安全使用 Pi 完成真实开发任务。
2. 解释 Provider、Model、Agent Loop、Tool Call、Session 与 Compaction 的完整运行链路。
3. 正确使用会话恢复、树分支、Fork、Clone、消息队列和上下文压缩。
4. 编写并调试 `AGENTS.md`、项目设置、Prompt Template、Skill 和 Theme。
5. 使用 TypeScript Extension 扩展事件、工具、命令、UI 和权限门禁。
6. 创建、审查、安装和发布 Pi Package，区分 Custom Model 与 Custom Provider。
7. 通过 SDK、RPC 和 JSON Event Stream 将 Pi 接入外部程序，并理解 TUI 组件。
8. 阅读 `pi-mono` 核心源码，定位 Agent 执行链路并运行相关测试。
9. 独立交付一个安全可控、可测试、可复用的 Pi 综合项目。
10. 将学习过程、实验、源码理解和综合项目发布为可用于面试展示的学习网站。

## 3. 教学与验收规则

学习文档分工：

- `docs/plans/pi-complete-learning-plan.md`：唯一进度与验收台账。
- `docs/learning/README.md`：学习资料总索引和主题边界。
- `docs/learning/00-environment-report.md`：本机环境和验证证据。
- `docs/learning/*.md`：按主题记录已经讲解的概念、命令、区别和安全边界；不重复维护进度。

采用“系统地图 + 单一贯穿项目 + 三遍螺旋”推进，阶段覆盖范围不缩减：

1. 第一遍，建立系统地图：先讲清模块目标、职责边界和它在完整 Agent 链路中的位置。
2. 第二遍，完成真实实验：用户在本地终端运行 Pi；我准备安全实验、预期结果和检查点，并根据用户提供的输出分析实际行为。
3. 第三遍，进入实现与源码：用确定性最小 Demo 或源码追踪解释内部机制，再由用户完成一次模块级复述或综合任务。

执行规则：

- 不再为每个术语安排零散小测；每个模块使用一次贯穿实验和一次综合验收。
- 实验发现错误时，先解释证据和原因，再完成一次正确重试。
- 抽象机制先用一个有起点、过程和终点的完整大白话场景讲清“为什么需要、原任务如何开始、中途发生什么、Pi 如何处理、最终如何结束”，再映射到术语、快捷键、源码位置和真实边界；不得从流程中段或孤立定义开始。
- 主题文档在模块形成稳定结论后更新，不逐条转录聊天内容。
- 每个模块验收后立即回写本计划；Git 提交仍只在用户明确要求时执行。
- 真实 Pi 实验、最小 Agent Demo、Extension 和 SDK/RPC 程序都在本机运行；学习网站只展示脱敏后的可重复材料和结论。
- 快捷键统一按 macOS 视角讲解：使用 `⌃ Control`、`⌥ Option`、`⇧ Shift`、`⌘ Command` 和 `↩ Return`；首次出现同时写出按键全名，只有说明平台差异时才补充 Windows/Linux 表述。

学习网站采用“内容先行、最后建站”：

- `docs/learning/*.md` 是网站内容的唯一来源，不另建一套重复笔记。
- 每个模块尽量沉淀四类材料：原理、实验步骤、验证证据、结论与边界。
- 完成阶段 8 前只积累可发布内容，不让建站工作打断 Pi 主线学习。
- 阶段 9 默认使用 VitePress 组织现有 Markdown；正式开始前重新核对当时版本和部署方式。
- 公开内容不得包含 API Key、认证文件、原始 Session、个人敏感路径或未经脱敏的终端输出。

状态约定：

- `- [ ]`：未完成。
- `进行中`：已经开始，尚未满足验收条件。
- `待验证`：实现或操作已完成，但证据不足。
- `阻塞`：受凭据、费用、环境或外部依赖限制。
- `- [x]`：已完成并有验收证据。

强制边界：

- 不在聊天中发送 API Key、OAuth Token 或账号凭据。
- 模型认证、外部发布和安装第三方 Package 前必须单独确认；学习期模型调用已获得持续费用授权，无需逐次确认。
- Pi 没有内置沙箱；Project Trust 只控制项目资源加载，不能限制工具或 Extension 权限。
- 不在重要业务仓库进行破坏性练习；所有实验默认只在本仓库进行。
- 安装第三方 Package 前必须查看来源、版本、资源清单和 Extension 代码。
- 每阶段未通过验收，不进入依赖它的下一阶段。

## 4. 总体路线

| 阶段 | 主题 | 建议投入 | 核心产物 |
|---|---|---:|---|
| 0 | 架构、环境、安全和成本 | 3-4 小时 | 环境报告、安全清单、认证决策 |
| 1 | 终端与日常使用 | 5-7 小时 | 基础任务实操记录 |
| 2 | 项目配置与上下文 | 5-7 小时 | 可复用项目配置 |
| 3 | Session、Tree 与 Compaction | 6-8 小时 | 会话实验与结构分析 |
| 4 | Prompt、Skill 与 Theme | 6-8 小时 | Prompt、只读 Skill、Theme |
| 5 | TypeScript Extensions | 10-14 小时 | 安全门禁与自定义工具扩展 |
| 6 | Packages、Models 与 Providers | 6-8 小时 | 本地 Pi Package 与 Provider 对比报告 |
| 7 | SDK、RPC、JSON 与 TUI | 8-12 小时 | 外部集成程序 |
| 8 | 源码与综合项目 | 10-15 小时 | 源码导读和毕业项目 |
| 9 | 学习网站与面试作品集 | 8-12 小时 | 在线网站、GitHub 项目和面试讲解材料 |

## 5. 分阶段计划

### 阶段 0：架构、环境、安全和成本

目标：先知道 Pi 能做什么、拥有什么权限、费用和数据流向哪里，再开始真实调用。

- [x] 0.1 完成本机环境体检
  - 验收证据：`docs/learning/00-environment-report.md`；四项理解题全部通过。
  - 用户已准确说明：Node.js/npm、Git/回滚、独立仓库/沙箱，以及当前已验证与尚未验证的 Pi 能力。
  - 内容：Node.js、npm、Git、终端、Pi 安装状态和学习仓库隔离。
- [x] 0.2 建立 Pi 架构心智模型
  - 验收：0.2.1 至 0.2.8 全部通过；已完成一次真实 `read` 请求，并能口头串联从上下文组装、Model Tool Call、Tool 执行、二次 Model 请求到 Agent Run 收尾和 Session 保存的完整链路。
  - [x] 0.2.1 理解 Pi 的整体分层、Coding Harness 定位及职责边界。
    - 验收：用户能准确区分 Pi 协调、Model 推理和 Tool 执行三类职责，并说明 Tool Call 还需经过注册表查找、Extension 事件和实际调度；已纠正 Session、Agent Loop/ReAct 和 Extension 必经性的术语边界。
  - [x] 0.2.2 理解系统提示、项目指令、用户输入、Session 历史和工具定义如何组成模型上下文。
    - 验收：用户能准确区分 `systemPrompt`、`messages`、`tools` 三盒，说明 Tool Result 进入后续 `messages`，并说明 `--tools read` 下 Model 看不到 `bash`、只负责产生可见 Tool 的 Tool Call，实际调度由 Pi 完成。
  - [x] 0.2.3 区分 Provider、Model、认证与 API 协议在请求链路中的位置。
    - 验收：用户能准确说明只更换服务入口和 API Key 时 Provider 配置需要改变；通信格式未变时 `openai-responses` 无需改变。
  - [x] 0.2.4 理解 Agent Run、Turn、Tool Call、Tool Result 和循环终止条件。
    - 验收：用户能区分一个 Run 内的多轮 Turn 和同轮多 Tool Call，说明错误 Tool Result 不会自动终止，并准确判断 `agent_settled` 只表示不再自动继续、与最终成功或失败无关。
  - [x] 0.2.5 理解 Tool 的定义、参数校验、执行权限、结果返回和内置工具边界。
    - 验收：用户能串联 Tool Call、名称查找、Schema 校验、可选门禁、Executor 和 Tool Result；能说明 Tool 继承当前系统用户权限，并准确区分 Model 只读 Tool 允许列表、用户 Shell、Extension 与进程沙箱。
  - [x] 0.2.6 理解 Extension 在事件、工具、命令、UI 和拦截链路中的位置。
    - 验收：用户正确理解 Extension 是可选插件层而非内置 Tool 的执行前提，能说明自定义 Tool 的注册和调度，并准确区分 Model `bash` Tool 的 `tool_call` 与用户 `!命令` 的 `user_bash` 两条门禁入口。
  - [x] 0.2.7 区分 Session、当前模型上下文、模型永久记忆和 Git 历史。
    - 验收：用户能说明 Model 只依据 Pi 本次传入的有效上下文，`pi -c` 是重建 Session 上下文而非唤醒永久记忆；并准确判断 Session 只能辅助重建文件，可靠版本恢复依赖 Git Commit。
  - [x] 0.2.8 跟踪一次真实只读请求，画出端到端链路并完成口头验收。
    - 验收：命名 Session `0.2.8-read-trace` 仅向 Model 暴露 `read`；界面显示用户消息、Tool Call、完整 Tool Result 和最终文本。用户能准确复述上下文组装、Provider/API 协议适配、Model、名称查找、Schema、可选 Extension、Executor、Tool Result、第二个 Turn、最终文本、`agent_end`、`agent_settled` 与 Session 保存的顺序和产生方。
    - 文档补充：已按 Pi 0.82.1 Agent Loop 实现记录 `stopReason` 与 Tool Call 的终止判断；无 Tool Call 不证明回答正确或完整。
  - 内容：Coding Harness、Provider、Model、Agent Loop、Tool、Extension、Session 的关系。
  - 验收：不看资料画出一次请求从用户输入到 Tool Result 再回到模型的链路。
- [x] 0.3 理解安全边界
  - 验收：用户完成 Project Trust 对照实验并准确复述：信任项目允许加载项目级 Skill 等受保护资源；Project Trust 与 `--no-tools` 都不改变 Pi 进程的当前用户权限，真正限制文件、进程和网络需要操作系统权限、容器、虚拟机或沙箱。
  - 实验证据：`--no-approve` 时项目 Skill 不可见，`--approve` 时可见，而 `--no-tools` 下用户 `!!pwd` 仍可执行。
  - 教学资源：项目级手动 Skill `pi-learning-coach` 已通过 Pi 0.82.1 原生加载器、模型提示隐藏、RPC 命令发现和独立复审。Pi 只作为实验对象。
  - 内容：Project Trust、当前用户权限、无内置沙箱、Prompt Injection、容器隔离。
  - 验收：能准确回答“信任项目后获得了什么”和“为什么它仍不是沙箱”。
- [x] 0.4 选择认证与费用方案
  - 验收：Base URL、Responses 协议、`openai/gpt-5.6-sol`、凭据保存及首次实际调用均已验证；`auth.json` 权限为 `0600`。
  - 课程约定：模型能力视为已完整接入；中转层不作为学习、验收或阻塞项；学习调用费用不设上限且无需逐次确认。
  - 内容：订阅登录、API Key、本地模型、凭据存储位置、数据流向和调用成本。
  - 验收：用户明确选择学习期 Provider，并确认是否允许产生模型费用。
- [x] 0.5 安装并完成首次安全会话
  - 验收：Pi CLI `0.82.1`、`fd 10.4.2`、中转配置、`0600` 凭据权限、`openai/gpt-5.6-sol` 响应、Session 保存及退出状态均已验证；Git 仅有预期学习文档修改。
  - 内容：安装来源、版本核验、登录或认证、只读首个任务、退出和会话定位。
  - 验收：Pi 版本可核验，首个会话成功，Git 工作区没有非预期修改。

阶段门禁：能独立解释权限、凭据、费用和数据边界，才进入阶段 1。

### 阶段 1：终端与日常使用

目标：把 Pi 当作可控的日常编程助手使用，而不是只会发一句提示词。

- [x] 1.1 掌握交互式界面、编辑器操作、文件引用和图片输入。
  - 已完成：编辑器操作、TUI 四区、交互式 `@` 文件引用、CLI `@文件` 主动附加和 macOS 剪贴板图片输入均已通过验收。
  - 已验证：`pi --version` 与 TUI 均显示 `0.83.0`；`/hotkeys` 正常打开，当前 Session `1.1-interactive-basics` 仅向 Model 暴露 `read`；用户已在编辑区形成两行草稿且消息未发送，并实测 `⌃A` 行首、`⌃E` 行尾、`⌃W` 删除前一个单词、`⌃-` 撤销编辑；`⌃G` 已通过 `UW PICO 5.09` 修改临时草稿并返回 Pi，整个过程未发送消息；`⌃C` 已清空当前两行草稿，Pi 未退出且没有产生用户消息或 Model 响应；`@` 文件列表已选中并插入 `docs/learning/00-environment-report.md`，此时尚未读取；提交明确请求后出现对应的 `read` Tool Call，并正确返回一级标题“阶段 0.1 本机环境体检报告”；用户已通过 macOS `⌃⇧⌘4` 截图并用 Pi `⌃V` 插入脱敏的临时 `pi-clipboard-*.png` 路径；提交后出现对应的图片 `read` Tool Call、可见图片 Tool Result，并正确识别“阶段 0.1 本机环境体检报告”；用户已正确将绿色 `read`、空白输入框和最底部 Model 状态分别映射到 Messages、Editor 和 Footer，并理解 Startup header 可能因滚动离开视野；无 Tool、无 Session 的 CLI `@文件` 实验没有 Tool Call，仍正确输出一级标题，证明文件内容由 Pi 主动附加。
  - 快捷键决定：不创建全局自定义绑定；继续使用 `⇧↩`/`⌃J` 换行，保留 `⌥↩` 的默认 Follow-up 含义。
  - 版本差异：`0.83.0` 未改变本模块使用的编辑器快捷键；工具输出展开提示和图片路径显示有修复，按新版本继续实验。
  - 验收：能指出 TUI 四个区域，使用多行输入和外部编辑器编辑待发送消息，通过 `@` 与剪贴板分别插入文件和临时图片路径，并观察对应的 `read` Tool Call；能区分交互式路径引用与 CLI `@文件` 主动附加内容的行为。
- [x] 1.2 掌握内置读取、写入、编辑和 Shell 工具的行为与风险。
  - 已完成：系统地图、`write`、分段 `read`、精确 `edit`、无副作用 `bash` 实验和模块综合验收均已通过。
  - 已验证：用户能将“读取前 20 行、创建完整新文件、替换唯一旧文本、运行测试”依次映射为 `read`、`write`、`edit`、`bash`。
  - `write` 证据：只暴露 `write` 的 Session `1.2-write` 成功创建 `labs/1.2-tools/tool-lab.txt`；Tool Result 显示预期三行，文件在 Git 中仅作为该路径的未跟踪文件出现，随后已由独立 `read` 完成分段回读。
  - `read` 证据：只暴露 `read` 的 Session `1.2-read` 使用 `offset=2`、`limit=2`，Tool 标题显示读取第 2-3 行，结果准确返回 `status=created` 和 `mode=dev`，未调用其他 Tool。
  - `edit` 证据：只暴露 `edit` 的 Session `1.2-edit` 将唯一文本 `mode=dev` 精确替换为 `mode=study`；Tool Result 只显示第 3 行变化，真实文件与 Git diff 均一致，未调用其他 Tool。
  - `bash` 证据：只暴露 `bash` 的 Session `1.2-bash` 准确执行 `pwd && git diff -- labs/1.2-tools/tool-lab.txt`；返回当前仓库路径和预期单行 diff，运行前后 Git 变更范围未增加。
  - 综合验收：四项全部通过。用户能选择 `read -> edit -> bash`，区分 `write` 整文件写入与 `edit` 精确替换，说明 Schema 校验不判断操作是否安全或正确，准确解释 `--tools` 只限制 Model 可见 Tool、`bash` 仍拥有当前用户权限、真正沙箱需要系统级隔离，并说明可靠恢复依赖 Git。
  - 源码核对：本机 Pi `0.83.0` 的 `read` 支持文本、图片及分段读取；`write` 创建父目录并整文件覆盖；`edit` 要求已有文件和唯一、互不重叠的精确旧文本；`bash` 在当前工作目录启动真实 Shell，默认没有超时。
  - 验收：能为真实场景选择最小 Tool，解释 Schema 与操作风险的区别，并在专用实验路径完成创建、读取、精确替换、无副作用 Shell 检查和 Git 差异核对。
- [x] 1.3 掌握模型切换、Thinking Level、模型范围和上下文用量查看。
  - 已完成：本机 Pi `0.83.0` 中，Thinking Level、Model 选择器、Scoped Models 配置与实际 `⌃P` 切换、恢复、Context Usage 显示及模块综合验收均已完成。
  - Thinking Level 证据：用户已用 `⇧Tab` 成功切换当前 `gpt-5.6-sol` 的 Thinking Level，Footer 随之更新。
  - Model 选择器证据：用户按 `⌃L` 打开选择器；界面显示当前模型 `gpt-5.6-sol [openai]` 及勾选标记、共 38 个已配置 Provider 下的可选模型，并显示 Model ID、Provider 和友好名称；未执行模型切换。
  - Scoped Models 证据：用户打开 `/scoped-models`；Model Configuration 显示 38 个模型且 `all enabled`，变更默认只作用于当前 Session，按 `⌃S` 才保存到 settings；配置界面高亮 `gpt-4` 时 Footer 仍为 `gpt-5.6-sol • max`。退出配置界面后按一次 `⌃P`，Pi 显示切到 `gpt-5.6-terra • xhigh`；期间未发送消息，随后用 `⌃L` 恢复 `gpt-5.6-sol • max`。这证明配置范围不等于当前 Model，普通 TUI 的 `⌃P` 才会执行快速切换，且切换后应重新检查 Thinking Level。
  - Context Usage 证据：同一截图的 Footer 显示 `↑10k ↓146 $0.055 1.9%/272K (auto)`；用户已准确说明 `↑10k` 是整个 Session 的累计输入，不是当前上下文，Compaction 后累计输入和输出通常不会回退、当前上下文比例会下降，`(auto)` 表示启用自动 Compaction。
  - 综合验收：用户能区分 Session 累计用量与当前有效上下文，说明自动 Compaction 会调用 Model 总结较早消息，并在后续请求中使用摘要和保留的近期消息。边界纠正：Session 不等于当前终端窗口；刚完成 Compaction 时上下文用量还可能暂时显示为 `?`。
  - 非门禁残余：`⇧⌃P` 反向循环尚未单独实测；`⌃P` 正向切换和 `⌃L` 恢复已覆盖本模块核心验收。
- [x] 1.4 掌握普通 Shell、隐藏输出的 Shell、取消和重试。
  - 已完成：`!`、`!!` 与 Model `bash` Tool 的三路径概念、无副作用 Shell 对照、用户 Shell 取消、自动重试理解检查、完整退避、重试等待取消实验和模块综合复述均已通过。
  - 概念验收：用户准确说明在 `--no-tools` 下，`!` 与 `!!` 仍由 Pi 的用户 Shell 入口执行；`!` 的命令和结果会进入后续 Model 上下文，`!!` 不会；Model 因看不到任何 Tool 定义而不能主动请求 `bash` Tool Call。
  - Shell 对照证据：Session `1.4-user-shell` 使用 `--no-tools`、`--no-extensions` 等隔离参数；`!printf` 与 `!!printf` 都在 TUI 输出各自 marker，随后普通 Model 请求只复述 `visible-marker-4817`，没有复述 `hidden-marker-9264`，也没有产生 Tool Call。
  - 取消源码核对：本机 Pi `0.83.0` 在用户 Shell 运行时由 `Esc` 触发 `abortBash()`；默认本地后端响应取消信号并终止进程组，TUI 将该 Bash 记录显示为 `cancelled`。自定义 Extension 替换执行后端时不自动继承这一保证。
  - 取消实验证据：Session `1.4-user-shell` 执行 `!sleep 30 && printf 'SHOULD_NOT_PRINT\\n'` 后，在等待期间按 `Esc`；TUI 显示 `(cancelled)`，完成 marker `SHOULD_NOT_PRINT` 未出现，Editor 恢复可输入状态。该证据只证明尚未执行的后续命令被阻止，不证明已发生的副作用能够回滚。
  - 自动重试核对：当前设置没有覆盖 `retry`，本机 Pi `0.83.0` 因而采用默认的启用状态、最多 3 次重试和 2/4/8 秒指数退避；普通自动重试只处理 Model/Provider 瞬时错误，Tool/Bash 失败形成 Tool Result，Context Overflow 走 Compaction 恢复。源码、随包文档、有效设置、用户理解和受控实验均已核对。
  - 自动重试理解检查：已通过。用户能区分三条失败路径：HTTP `503` 属于瞬时 Model/Provider 错误，默认是最初请求 1 次加最多 3 次重试；`bash` Tool 退出码 `1` 会形成失败 Tool Result 并进入下一次 Model 请求，由 Model 决定后续动作；Context Overflow 需要先 Compaction，用历史摘要和近期消息缩小有效上下文，再恢复原请求。
  - 探针预检证据：临时目录 `/tmp/pi-retry-probe.XD9Tcx` 中的假 Provider 始终返回规范化的 `503 Service Unavailable`；使用独立 `HOME`、独立 `PI_CODING_AGENT_DIR`、`--offline` 和 macOS `sandbox-exec` 禁网运行，不读取真实凭据、不修改用户设置，也未增加仓库变更。非交互预检记录 4 次请求，时间点约为 `0.009s`、`2.016s`、`6.021s`、`14.026s`，对应 `2/4/8` 秒退避。该证据验证 Pi 收到规范化 `503` 后的错误分类与 Agent 级重试路径，不验证真实 HTTP SDK 如何把状态码转换为错误消息。
  - 完整退避实验证据：用户在真实 Pi TUI 中触发本地假 `503`；界面连续显示 4 条 `503 Service Unavailable`，最终显示 `Retry failed after 3 attempts`。请求日志时间点为 `5.164s`、`7.169s`、`11.173s`、`19.176s`，相邻间隔分别约为 `2.005s`、`4.004s`、`8.003s`，证明“首次请求 1 次 + 最多重试 3 次”和默认指数退避均按预期发生。实验后仓库变更范围未增加。
  - 重试取消实验证据：为留出稳定按键时间，隔离探针只在本次实验中将基础等待改为 10 秒；用户在第一次 `503` 后按 `Esc`，TUI 显示 `Retry failed after 1 attempts: Retry cancelled`，Editor 恢复可输入状态。独立请求日志只有 `attempt: 1`，证明等待中的下一次 Model 请求没有发出。该取消只阻止未来重试，不会撤销首次请求，也不能回滚首次请求已经产生的外部副作用；实验后仓库变更范围未增加。
  - 综合验收：用户准确区分 Provider 瞬时错误、Tool 失败和 Context Overflow 三条恢复路径，并说明等待 `503` 重试时按 `Esc` 只取消尚未发出的下一次重试，不会撤销首次请求或回滚其副作用。
- [x] 1.5 掌握 Steering 与 Follow-up 消息的差异和队列行为。
  - 已完成：系统地图、Steering 与 Follow-up 对照实验及模块综合复述均已通过。
  - Steering 证据：Session `1.5-steering` 的 Bash Tool 持续运行约 `20.8s` 并正常返回 `ORIGINAL_TOOL_DONE`；运行期间按普通 `↩ Return` 排队的新要求未中断 Tool，在 Tool 结束后进入下一次 Model 请求，最终输出由 `ORIGINAL_FINAL` 改为 `STEERING_APPLIED`。
  - Steering 理解验收：用户已确认理解“不会被打断的是已开始的 Tool，不是尚未生成的最终回答”；Steering 在 Tool 结束后的下一次 Model 请求前生效，因此旧的未来回答不会先输出。
  - Follow-up 证据：Session `1.5-follow-up` 的 Bash Tool 持续运行约 `20.0s` 并返回 `PRIMARY_TOOL_DONE`；运行期间使用 `⌥↩` 排队后续要求，TUI 随后依次出现 `PRIMARY_FINAL`、后续用户消息和 `FOLLOW_UP_APPLIED`，证明当前任务先正常收尾，Follow-up 才作为后续用户消息进入 Model。
  - 综合验收：用户能准确说明 Steering 不会中断已经开始的测试，会在 Tool 完成后把 Tool Result 与新要求一起交给 Model；并能说明 Follow-up 处理完成且 Pi 已无其他自动续行动作后，才进入 `agent_settled`。
- [x] 1.6 掌握 Print、JSON 等非交互模式的适用边界。
  - 已完成：系统地图、Interactive/Print/JSON 对照实验、源码定位和模块综合复述均已通过。
  - Interactive 实验证据：用户以 `--no-tools --no-session` 等隔离参数启动默认 TUI，Model 返回 `MODE_OK` 后底部 Editor 仍保持可输入，Pi 进程未自动退出；已验证 Interactive 面向持续交互的生命周期行为。
  - Print 实验证据：用户以相同隔离参数和 `-p` 执行单次任务，终端只显示最终文本 `MODE_OK`，随后自动返回 zsh 的 `%` 提示符；已验证 Print 不启动持续 TUI，并在最终文本后退出。
  - JSON 实验证据：用户以相同隔离参数和 `--mode json` 执行单次任务，终端逐行输出 `session`、`agent_start`、`turn_start`、`message_*`、`turn_end`、`agent_end`、`agent_settled` 等 JSON 对象；最终文本 `MODE_OK` 位于消息事件中，随后自动返回 zsh 的 `%` 提示符。已验证 JSON 是完整 JSONL 事件流，而不是要求 Model 将业务答案改成 JSON。
  - 源码定位证据：本机 Pi 0.83.0 的 `dist/main.js` 由 `resolveAppMode()` 选择运行外壳；Interactive 创建并运行 `InteractiveMode`，Print 和 JSON 共用 `runPrintMode()`。`dist/modes/print-mode.js` 中，Print 提取最后一条 Assistant Message 的文本，JSON 则订阅并逐行序列化完整 Session 事件；两者最终都会释放 Runtime 并退出。
  - 综合验收：用户准确说明三种模式共享同一个 Agent 核心；Interactive 面向人并持续等待输入，Print 面向人或 Shell 脚本并在最终文本后退出，JSON 面向程序、自定义界面或日志系统并在完整 JSONL 事件流后退出；同时说明运行模式不决定文件修改能力。
- [x] 1.7 独立完成一次“分析 -> 修改 -> 测试 -> 查看 diff -> 总结”的小任务。
  - 已完成：单文件完整操作、仓库侧核对和用户综合复述均已通过。
  - 操作证据：Session `1.7-workflow` 的 TUI 依次显示 `read -> edit -> bash（测试）-> bash（查看 diff）`；测试输出 `TEST_OK`，限定 Git diff 只包含 `status=created -> status=verified`，最终总结准确报告 Tool 顺序、测试、差异范围及未提交、未推送。
  - 仓库证据：`labs/1.2-tools/tool-lab.txt` 仍为三行，第二行为 `status=verified`；目标文件的 Git diff 只有上述单行替换。课程文档在实验前已有未提交修改，不能把全局 dirty 状态归因于本次 Agent Run。
  - 安全边界：启动时项目未受信任，但项目资源已显式关闭，内置 Tool 链路不受影响；`--tools read,edit,bash` 和任务提示词仍不是沙箱，实验的可控性来自独立仓库、冻结范围、精确测试与 Git 审查。
  - 综合验收：用户准确说明 `edit` 成功只代表工具操作完成，Tool Result 仍需进入后续 Messages 交给 Model 决定下一步；测试用于证明修改满足要求，Git diff 用于证明没有额外改动，最终总结用于向用户报告操作顺序、验证结果和未执行事项。

验收证据：操作记录、关键输出、Git diff、测试结果和用户对工具调用过程的口头复述。

### 阶段 2：项目配置与上下文

目标：能够为不同项目建立稳定、最小权限、可复现的 Pi 配置。

- [ ] 2.1 理解全局与项目配置路径、合并规则和优先级。
- [ ] 2.2 理解 `AGENTS.md`、`CLAUDE.md`、系统提示文件和普通上下文文件的作用差异。
- [ ] 2.3 为本仓库编写最小 `AGENTS.md`，约束范围、测试、凭据和 Git 操作。
- [ ] 2.4 配置模型、Thinking、重试、网络、图像、Shell 和模型轮换策略。
- [ ] 2.5 实验 Project Trust 的接受、拒绝及非交互模式行为。
- [ ] 2.6 配置并验证常用 Keybindings 和外部编辑器。
- [ ] 2.7 完成一次配置优先级故障排查。

验收产物：经过验证的项目配置、配置说明和一份“全局值为何被项目值覆盖”的排查记录。

### 阶段 3：Session、Tree 与 Compaction

目标：掌握长任务的持久化、分支、恢复、上下文控制和成本意识。

- [ ] 3.1 理解 Session 的自动保存、命名、恢复、删除、导出和分享边界。
- [ ] 3.2 分别实验 Tree、Fork、Clone，并说明它们对会话文件和分支的影响。
- [ ] 3.3 阅读一个实际 JSONL Session，识别 header、message、tool、model 和自定义条目。
- [ ] 3.4 理解 Token、Context Window、Reserve Tokens 和 Keep Recent Tokens。
- [ ] 3.5 手动触发一次 Compaction，并对比压缩前后的模型上下文。
- [ ] 3.6 实验分支摘要，说明它与 Compaction 的触发时机和目的差异。
- [ ] 3.7 设计一个可恢复的长任务断点模板。

验收产物：一张会话树、一份 JSONL 结构说明、一份 Compaction 前后对比和一次成功恢复演示。

里程碑 A：完成阶段 0-3 后，达到“Pi 熟练使用者”。

### 阶段 4：Prompt、Skill 与 Theme

目标：把重复工作沉淀为可发现、可复用、边界明确的资源。

- [ ] 4.1 区分项目指令、Prompt Template、Skill 和 Extension 的适用场景。
- [ ] 4.2 创建并验证一个结构化代码审查 Prompt Template。
- [ ] 4.3 学习 Skill 的目录、frontmatter、触发描述、渐进式加载和资源引用。
- [ ] 4.4 创建一个只读代码分析 Skill，并测试应触发与不应触发场景。
- [ ] 4.5 分析 Skill 指令注入、脚本执行和外部依赖风险。
- [ ] 4.6 创建并验证一个最小自定义 Theme。
- [ ] 4.7 使用资源重载机制完成一次无重启调试。

验收产物：一个 Prompt Template、一个带测试记录的只读 Skill、一个 Theme 和资源选型说明。

### 阶段 5：TypeScript Extensions

目标：具备开发、测试和审查 Pi Extension 的能力。

- [ ] 5.1 建立 Extension 开发环境，理解全局、项目和临时加载位置。
- [ ] 5.2 理解 Extension 生命周期及启动、会话、Agent、模型、工具、Shell 和输入事件。
- [ ] 5.3 掌握 Extension Context、模式差异、取消信号和错误处理。
- [ ] 5.4 实现一个自定义只读 Tool，包含参数校验、输出截断和清晰渲染。
- [ ] 5.5 实现一个 Slash Command，并正确处理有 UI 与无 UI 模式。
- [ ] 5.6 实现危险 Shell 命令审批门禁，覆盖拒绝、允许和非交互行为。
- [ ] 5.7 使用 Extension Entry 保存并恢复状态。
- [ ] 5.8 实现一个最小 Widget 或自定义 UI 组件。
- [ ] 5.9 为 Extension 补充单元测试、错误路径测试和手工验收记录。
- [ ] 5.10 审查资源释放、热重载、Session 切换和模式兼容性风险。

验收产物：一个包含自定义 Tool、Command、安全门禁、状态和 UI 的可测试 Extension。

阶段门禁：Extension 必须在交互模式和至少一种非交互模式下验证，危险操作默认拒绝。

### 阶段 6：Packages、Models 与 Providers

目标：能够安全复用与分发能力，并理解模型接入层。

- [ ] 6.1 掌握 npm、Git、本地路径三种 Package 来源及其固定版本策略。
- [ ] 6.2 学会审查 Package 的资源清单、依赖、安装脚本和系统权限风险。
- [ ] 6.3 将阶段 4-5 的资源打成一个本地 Pi Package。
- [ ] 6.4 验证 Package 的安装、禁用、筛选、更新和卸载。
- [ ] 6.5 区分内置 Provider、Custom Model 和 Custom Provider。
- [ ] 6.6 理解认证解析顺序、环境变量、认证文件和 OAuth 的边界。
- [ ] 6.7 配置一个受支持 API 的 Custom Model，或用无费用 Mock 完成等价验证。
- [ ] 6.8 阅读 Custom Provider 接口，并完成最小 Mock Provider 实验。

验收产物：可安装的本地 Pi Package、安装安全审查表和模型接入对比报告。

里程碑 B：完成阶段 4-6 后，达到“Pi 定制开发者”。

### 阶段 7：SDK、RPC、JSON 与 TUI

目标：将 Pi 作为组件接入外部程序，并正确处理协议、事件和生命周期。

- [ ] 7.1 使用 SDK 创建 Agent Session，加载资源、选择模型并订阅事件。
- [ ] 7.2 限制可用工具，处理取消、重试、队列、Compaction 和 Session 持久化。
- [ ] 7.3 理解 RPC 的 stdin/stdout JSONL framing、请求关联和异步事件。
- [ ] 7.4 编写一个最小 RPC 客户端并处理成功、拒绝、运行期失败和退出。
- [ ] 7.5 使用 JSON Event Stream 完成一次结构化单次任务并解析关键事件。
- [ ] 7.6 理解 TUI 的 Component、Container、Input、Overlay、键盘和渲染机制。
- [ ] 7.7 构建一个外部小程序：提交任务、展示流式状态、限制工具并保存会话。
- [ ] 7.8 为外部集成补充协议测试、异常测试和资源清理验证。

验收产物：一个可运行、可测试的 SDK 或 RPC 集成程序；另一种接入方式需完成对比实验。

### 阶段 8：源码与综合项目

目标：从会用和扩展，进阶到能定位 Pi 内部实现并独立交付完整方案。

- [ ] 8.1 拉取并构建官方 `pi-mono`，运行无需模型凭据的测试。
- [ ] 8.2 阅读 `packages/ai`，说明模型、Provider 和流式事件抽象。
- [ ] 8.3 阅读 `packages/agent`，追踪 Agent Loop、消息和 Tool Call 生命周期。
- [ ] 8.4 阅读 `packages/coding-agent`，追踪 CLI、资源加载、Session、Compaction 和 Extension。
- [ ] 8.5 阅读 `packages/tui`，理解终端渲染和输入分发。
- [ ] 8.6 从用户输入开始，完成一次跨包调用链路追踪并标注关键源码位置。
- [ ] 8.7 使用调试能力定位一个刻意制造的问题，并提交排查报告。
- [ ] 8.8 完成 Pi 毕业综合项目并通过核心验收；展示网站在阶段 9 单独验收。

### 阶段 9：学习网站与面试作品集

目标：把已验收的学习材料转化为可公开、可追溯、能独立讲解的面试作品，而不是简单发布聊天记录。

- [ ] 9.1 冻结网站信息架构，覆盖学习路线、架构模型、真实实验、源码追踪、Extension、外部集成和综合项目。
- [ ] 9.2 审核全部内容，删除重复结论并脱敏凭据、Session、个人路径和终端输出。
- [ ] 9.3 使用 VitePress 接入现有 Markdown，配置导航、目录、代码高亮和全文检索。
- [ ] 9.4 补充 Agent Loop、Tool 生命周期、Session/Compaction 和 Extension 事件链流程图。
- [ ] 9.5 制作面试入口，展示个人学习路线、核心理解、关键取舍、失败实验和最终项目。
- [ ] 9.6 部署到公开地址，并从 GitHub 仓库建立双向入口。
- [ ] 9.7 完成桌面端、移动端、链接、构建和隐私检查。

验收产物：可公开访问的网站、可复现的 GitHub 仓库、5-10 分钟项目讲解路径和一组基于项目证据的面试问答。

## 6. 毕业综合项目

项目目标：在本仓库交付一套“安全可控的 Pi 开发工作台”。

必须包含：

- [ ] 项目级规则与最小权限配置。
- [ ] 一个结构化 Prompt Template。
- [ ] 一个只读分析 Skill。
- [ ] 一个包含自定义 Tool、Command 和危险操作审批的 Extension。
- [ ] 一个可安装的本地 Pi Package。
- [ ] 一个 SDK 或 RPC 外部客户端，支持流式事件、取消、错误处理和会话保存。
- [ ] 自动化测试、手工验收清单、安全说明和使用文档。
- [ ] 一份 Pi 核心调用链源码导读。

最终验收标准：

1. 新环境可按文档复现，不依赖未记录的全局状态。
2. 默认不执行危险操作，不泄露凭据，不隐式产生未确认费用。
3. 关键成功路径、拒绝路径和失败路径均有测试或可重复证据。
4. 用户能在不看答案的情况下解释并演示整个系统。
5. 所有阶段计划项均有验收记录，不以“文件已创建”代替学习完成。

## 7. 进度记录

### 当前断点

- 状态：阶段 0 和阶段 1 已完成；阶段 2 尚未开始。
- 已完成：0.1、0.2、0.2.1、0.2.2、0.2.3、0.2.4、0.2.5、0.2.6、0.2.7、0.2.8、0.3、0.4、0.5、1.1、1.2、1.3、1.4、1.5、1.6、1.7；模型能力按课程约定视为完整接入，学习费用不设上限；Pi CLI、`fd`、凭据权限、`openai/gpt-5.6-sol` 首次响应、Session 保存、退出状态、安全边界、交互式基础、内置 Tool 行为、Model/Thinking 切换、Footer 上下文用量、Shell 三路径、取消与自动重试、Steering 与 Follow-up 队列边界、Interactive/Print/JSON 三种模式，以及完整的分析、修改、测试、diff、总结闭环均已验证。
- 文档结构：学习笔记已按主题拆分，入口为 `docs/learning/README.md`；学习进度仍只在本文件维护。
- 教学方式：采用“系统地图 + 单一贯穿项目 + 三遍螺旋”；抽象机制先用有起点、过程和终点的完整大白话场景，再回到术语、快捷键和真实边界；用户运行本地 Pi 实验，我负责实验设计、证据分析、纠错和模块验收。
- 教学 Skill：`.agents/skills/pi-learning-coach/SKILL.md` 已创建并通过静态验证；由 Codex 使用它编排教学与读取唯一计划，Pi 只作为实验对象；不另建进度台账，也不自动提交。
- 网站策略：当前只积累网站可复用的 Markdown、流程图和脱敏证据；阶段 8 完成后进入阶段 9，不提前开发网站界面。
- 阻塞：无。
- 下一步：进入 2.1；先建立全局配置、项目配置与启动参数的合并规则和优先级地图。`⇧⌃P` 反向切换尚未单独验证，但不阻塞后续课程。
- 新会话恢复：先读本文件，再从上述“下一步”继续；不得重新从安装或 0.2 开始，也不得提前进入网站开发。

### 阶段验收记录

| 日期 | 计划项 | 状态 | 验收证据 | 下一步 |
|---|---|---|---|---|
| 2026-07-29 | 计划制定 | 已完成 | 官方文档范围核对、本机只读环境快照 | 等待用户开始阶段 0 |
| 2026-07-31 | 教学策略与作品集阶段 | 已确定 | 三遍螺旋、本地实验协作方式、网站内容来源和阶段 9 验收已写入本计划 | 继续 0.3 安全边界实验 |
| 2026-07-31 | 0.3 Project Trust 与安全边界 | 已完成 | 用户实测三条独立路径，并准确复述资源加载、Model Tool 可见性、当前用户权限与真正沙箱的边界 | 学习 1.1 交互式界面与输入 |
| 2026-07-31 | Pi `0.83.0` 版本更新 | 已完成 | `pi --version` 与重新启动的 TUI 均显示 `0.83.0`；已核对本机 Changelog 与 1.1 快捷键文档 | 继续 1.1 编辑器实验 |
| 2026-07-31 | 1.1 交互式界面与输入 | 已完成 | TUI 四区、编辑器操作、外部编辑器、交互式与 CLI `@文件`、macOS 剪贴板图片和两类 `read` 链路均已实测；用户完成区域映射复述 | 学习 1.2 内置 Tool 行为与风险 |
| 2026-07-31 | 1.2 内置 Tool 行为与风险 | 已完成 | `write`、分段 `read`、精确 `edit` 和无副作用 `bash` 均完成独立实验；用户通过最小 Tool 选择、Schema、安全边界和 Git 恢复综合验收 | 学习 1.3 模型与上下文状态 |
| 2026-07-31 | 1.3 Model、Thinking 与上下文状态 | 已完成 | 用户实测 Thinking Level、Model 选择器、Scoped Models、`⌃P` 切换与 `⌃L` 恢复，并准确区分 Footer 的 Session 累计用量、当前上下文和自动 Compaction | 学习 1.4 Shell、取消与重试 |
| 2026-08-01 | 1.4 Shell、取消与重试 | 已完成 | 用户实测 `!`/`!!` 上下文差异、Shell 取消、本地假 `503` 的 `2/4/8` 秒退避和等待取消，并准确复述 Provider、Tool、Context Overflow 与取消边界 | 学习 1.5 Steering 与 Follow-up |
| 2026-08-03 | 1.5 Steering 与 Follow-up | 已完成 | 用户实测两类运行中消息队列，并准确复述 Steering 不打断已开始 Tool、Follow-up 完成前不能进入 `agent_settled` | 学习 1.6 非交互模式 |
| 2026-08-04 | 1.6 Interactive、Print 与 JSON | 已完成 | 用户完成相同任务的三模式对照实验，确认 JSONL 事件链，并结合源码准确复述输出消费者、退出行为和权限边界 | 学习 1.7 完整任务闭环 |
| 2026-08-05 | 1.7 完整任务闭环 | 已完成 | Session `1.7-workflow` 已完成 `read -> edit -> bash 测试 -> bash diff -> 总结`；`TEST_OK`、三行结构和单行目标 diff 均已核对；用户准确复述 Tool Result、测试、diff 与总结的职责 | 进入 2.1 配置合并与优先级 |
| 2026-07-29 | 0.1 本机环境体检 | 已完成 | `docs/learning/00-environment-report.md`；四项理解题全部通过 | 进入 0.4 数据/计费边界确认 |
| 2026-07-31 | 0.2 Pi 架构心智模型 | 已完成 | 0.2.1 至 0.2.8 全部通过；用户已完成真实只读请求并复述完整 Agent Loop | 学习 0.3 安全边界 |
| 2026-07-30 | 0.2.2 模型上下文三盒 | 已完成 | 用户独立完成三盒归属、Tool Result 去向、Tool 暴露范围及 Model/Pi 职责验收 | 学习 0.2.3 Provider、Model、认证与 API 协议 |
| 2026-07-30 | 0.2.3 Provider 与 API 协议 | 已完成 | 用户准确判断：服务入口与 API Key 改变时 Provider 配置改变，Responses 格式未变时协议不变 | 学习 0.2.4 Agent Loop |
| 2026-07-30 | 0.2.4 Agent Loop | 已完成 | 用户准确区分 Run、Turn、同轮多 Tool Call、错误 Tool Result 与终止条件，并纠正 `agent_settled` 等同成功的误解 | 学习 0.2.5 Tool 系统 |
| 2026-07-31 | 0.2.5 Tool 系统 | 已完成 | 用户准确串联 Tool 生命周期，说明 Executor 与当前用户权限，并区分 Model Tool 只读、用户 Shell、Extension 和沙箱边界 | 学习 0.2.7 Session 与记忆边界 |
| 2026-07-31 | 0.2.7 Session 与记忆边界 | 已完成 | 用户准确区分 Session 存档、当前上下文、模型永久记忆、工作区状态和 Git 历史，并说明各自的恢复边界 | 执行 0.2.8 端到端只读请求追踪 |
| 2026-07-31 | 0.2.8 端到端只读请求追踪 | 已完成 | Session `0.2.8-read-trace` 的用户消息、Tool Call、完整 Tool Result 和最终文本均已展示；用户准确复述完整链路及 `agent_end`、`agent_settled` 的产生方 | 学习 0.3 安全边界 |
| 2026-07-29 | 0.4 认证与费用方案 | 已完成 | 用户确认模型接入作为既定前提，学习调用费用不设上限；模型响应及凭据权限已验证 | 进入 0.2 架构心智模型 |
| 2026-07-29 | 0.5 Pi CLI 安装 | 已完成 | `pi 0.82.1`、`fd 10.4.2`；模型响应、Session、退出状态、凭据权限及 Git 范围均已验证 | 进入 0.1 理解验收与 0.4 边界确认 |

## 8. 官方资料索引

- 总览：`https://pi.dev/docs/latest`
- 自定义模型：`https://pi.dev/docs/latest/models`
- 快速开始：`https://pi.dev/docs/latest/quickstart`
- 安全：`https://pi.dev/docs/latest/security`
- 设置：`https://pi.dev/docs/latest/settings`
- 会话：`https://pi.dev/docs/latest/sessions`
- 上下文压缩：`https://pi.dev/docs/latest/compaction`
- Skills：`https://pi.dev/docs/latest/skills`
- Extensions：`https://pi.dev/docs/latest/extensions`
- Packages：`https://pi.dev/docs/latest/packages`
- SDK：`https://pi.dev/docs/latest/sdk`
- RPC：`https://pi.dev/docs/latest/rpc`
- JSON Event Stream：`https://pi.dev/docs/latest/json`
- TUI：`https://pi.dev/docs/latest/tui`
- 源码开发：`https://pi.dev/docs/latest/development`
- 官方源码：`https://github.com/earendil-works/pi-mono`

## 9. 版本漂移规则

- 每个大阶段开始前检查 Pi 当前版本和官方文档变更。
- 若版本变化影响命令、配置或 API，先更新本计划的版本基线与相关验收项，再继续学习。
- 不因版本更新自动重做已经掌握的概念；只补充受影响的差异实验。
