# Pi 终端与基础工具

本篇记录 Pi 的当前运行环境、基础依赖、内置 Tool 和终端输入规则。实际验证证据见 [本机环境报告](00-environment-report.md)，学习进度见 [完整学习计划](../plans/pi-complete-learning-plan.md)。

## 当前学习环境

| 项目 | 当前选择 |
|---|---|
| Pi | `0.83.0` |
| Provider | `openai`；课程中视为官方模型能力已完整接入 |
| API | `openai-responses` |
| Model | `gpt-5.6-sol` |
| Base URL | `https://sub2api.shelfcanvas.top`，不添加 `/v1` |
| 凭据 | 由 Pi 保存在 `~/.pi/agent/auth.json`，文件权限为 `0600` |

API Key 不写入项目文档、Git 仓库或聊天记录。

课程约定：底层中转不作为学习、验收或阻塞项；学习调用费用不设上限，无需逐次确认。Base URL 仅作为当前环境的可复现配置保留。

## 基础工具

| 对象 | 作用 | 记忆方式 |
|---|---|---|
| Node.js | 运行 Pi、SDK 和 TypeScript Extension | 负责运行 |
| npm | 下载、安装和更新 Pi 及依赖 | 负责安装和管理 |
| Git | 记录项目版本、查看差异、建立检查点和回滚 | 保存项目历史 |
| 独立仓库 | 隔离学习修改与业务代码，降低误操作影响 | 限制练习范围 |

“程序能运行”只证明当前状态可以执行，不代表修改过程可追溯，也不代表失败后可以恢复。代码恢复依赖 Git。

独立仓库不是沙箱。Pi 仍继承当前系统用户权限，理论上可以访问仓库外的路径。

## Pi 与内置 Tool

Pi 是极简的 Coding Agent Harness，不是空壳。它负责连接模型、组织对话、调用工具、保存 Session，并提供扩展入口。

当前内置 Tool：

- `read`：读取文件。
- `bash`：执行 Shell 命令。
- `edit`：按指定范围修改文件。
- `write`：创建或覆盖文件。
- `grep`：搜索文件内容。
- `find`：查找文件。
- `ls`：列出目录内容。

Pi 没有内置沙箱。`bash`、`edit` 和 `write` 可以产生真实修改，因此重要操作前仍需检查工作目录、Git 状态和命令影响范围。

### `read`、`write`、`edit`、`bash` 系统地图

| Tool | 主要参数 | Executor 的核心行为 | 是否修改文件 | 主要风险 |
|---|---|---|---|---|
| `read` | `path`，可选 `offset`、`limit` | 读取文本或图片；文本默认保留开头最多 2000 行或 50KB，可用行偏移继续 | 否 | 读取并送入上下文的内容可能泄露敏感信息或包含 Prompt Injection |
| `write` | `path`、`content` | 自动创建父目录；文件不存在就创建，存在就整文件覆盖 | 是 | 路径错误或内容不完整会覆盖原文件 |
| `edit` | `path`、`edits[{oldText,newText}]` | 读取已有文件，对原文中唯一且互不重叠的精确文本块进行替换 | 是 | 范围比 `write` 精确，但目标或替换内容错误仍会产生真实修改 |
| `bash` | `command`，可选 `timeout` | 在当前工作目录启动真实 Shell 进程，合并返回标准输出和错误输出；默认没有超时 | 取决于命令 | 能读写删除文件、联网、启动进程和调用其他程序，能力面最广 |

四者都遵循同一条主线：Model 只产生 Tool Call；Pi 按名称找到 Tool，准备并校验参数，经过已注册的 Extension Handler 后，才由 Executor 使用 Pi 进程当前权限操作系统，最后把 Tool Result 交回 Model。Schema 校验只判断参数结构是否合法，例如 `bash.command` 是否为字符串，不判断命令是否危险。

“只读”只表示不修改文件，不等于没有安全风险；`edit` 只比整文件 `write` 更精确，不等于自动正确；`bash` 可以通过 Shell 命令覆盖其他 Tool 的大量能力，因此仅隐藏 `write` 或 `edit` 不能在 `bash` 仍可用时构成只读边界。

## TUI 四个区域

| 区域 | 所在位置 | 主要内容 |
|---|---|---|
| Startup header | 启动时最上方 | 快捷提示，以及已加载的上下文文件、Prompt Template、Skill 和 Extension |
| Messages | 中间历史区域 | 用户消息、Model 回复、Tool Call、Tool Result、通知和错误 |
| Editor | 靠近底部的输入框 | 编写尚未提交的草稿；边框颜色表示当前 Thinking Level |
| Footer | 最底部状态栏 | 工作目录、Session 名称、Token/缓存/费用/上下文用量和当前 Model |

滚动后 Startup header 可能离开当前视野，但仍属于本次 TUI 会话；Tool Call 和 Tool Result 属于 Messages，不是 Editor。只有 Editor 中尚未按 `↩ Return` 提交的内容仍是草稿。

## Project Trust、Tool 开关与系统隔离

这三类控制位于不同路径，不能互相替代：

| 控制 | 实际控制什么 | 不能保证什么 |
|---|---|---|
| Project Trust | 是否加载项目设置、Skill、Extension、Package 等受保护的项目级资源 | 不降低 Pi 进程的操作系统权限，也不证明资源内容安全 |
| `--no-tools` | 不向 Model 暴露可调用 Tool | 不关闭用户 Shell，也不阻止 Extension 自身执行代码 |
| Extension 门禁 | 在已经覆盖的 Tool 或用户 Shell 入口进行允许、确认或阻止 | 未加载或遗漏入口时不生效，不是系统级隔离 |
| 操作系统权限、容器、虚拟机或沙箱 | 从底层限制文件、进程和网络访问 | 需要单独设计和验证隔离策略 |

Project Trust 是“允许加载”的授权，不是“已经安全”的认证。即使选择信任，仍应审查项目级 Skill、Extension、Package 及其脚本和外部依赖。反过来，拒绝 Project Trust 也不表示 Pi 无法读取任何项目内容；例如项目说明文件、用户明确要求读取的文件和 Shell 路径有各自的加载或执行规则。

本仓库完成过一次最小对照实验：

1. 使用 `--no-approve` 启动时，项目级 `pi-learning-coach` 不出现在 `/skill:` 列表中。
2. 同时使用 `--no-tools` 时，用户直接输入 `!!pwd` 仍可成功执行，因为它走 `user_bash`，不是 Model Tool Call。
3. 使用 `--approve` 启动时，项目级 `pi-learning-coach` 被加载并出现在手动 Skill 命令列表中。

这个实验只证明三条路径彼此独立：Project Trust 控制项目资源加载，Tool 开关控制 Model 的 Tool 可见性，用户 Shell 使用 Pi 进程当前拥有的系统权限。它不能证明 Pi 已被沙箱化。

外部文件、网页、Tool Result 和项目资源还可能包含诱导 Model 改变行为的恶意指令，即 Prompt Injection。Project Trust、系统提示和 Model 自律都不能单独形成强隔离；高风险任务仍应组合使用最小 Tool 集、应用层门禁、人工确认和系统级隔离。

## macOS 交互快捷键

本文统一使用 macOS 符号：`⌃ Control`、`⌥ Option`、`⇧ Shift`、`⌘ Command`、`↩ Return`。Pi 是终端程序，多数快捷键使用 `⌃ Control`，不是普通 Mac 应用常见的 `⌘ Command`；Pi 配置和英文文档中的 `Alt` 对应 Mac 的 `⌥ Option`。

| 快捷键 | 功能 | 是否发送消息 | 本机状态 |
|---|---|---|---|
| `↩ Return` | 提交当前草稿；Agent 运行中时按消息队列规则处理 | 是 | 已验证 |
| `⇧↩` 或 `⌃J` | 在草稿中换行 | 否 | 已验证多行输入 |
| `⌃A` | 光标移到行首 | 否 | 已验证 |
| `⌃E` | 光标移到行尾 | 否 | 已验证 |
| `⌃W` | 删除光标前一个单词 | 否 | 已验证 |
| `⌃-` | 撤销上一次编辑 | 否 | 已验证 |
| `⌃G` | 用外部编辑器修改当前草稿 | 否 | 已验证；本机实际打开 `UW PICO 5.09` |
| `⌃C` | 清空当前编辑器；连续两次可退出 Pi | 否 | 已验证；不要在输入框键入 `clear` 代替 |
| `⌃D` | 输入框为空时退出 Pi | 否 | 已完成退出实验 |
| `⌃V` | 粘贴剪贴板中的图片或文字 | 仅粘贴时不发送 | 已验证完整图片读取链路 |
| `⇧Tab` | 循环切换当前 Model 支持的 Thinking Level | 否 | 已验证 |
| `⌃L` | 打开 Model 选择器；等价于 `/model` | 否 | 阶段 1.3 验证 |
| `⌃P` / `⇧⌃P` | 在 Scoped Models 中向前/向后切换 Model | 否 | 阶段 1.3 验证 |
| `⌃T` | 展开或隐藏 Thinking 内容，不改变 Thinking Level | 否 | 阶段 1.3 验证 |
| `⌥↩` | Agent 运行时排队 Follow-up 消息 | 是 | 阶段 1.5 验证 |

完整默认键位随 Pi 版本变化，以 `/hotkeys` 和本机安装包的 `docs/keybindings.md` 为准。本文只保留课程使用的常用键位及实测状态。

`⌃G` 实验中，Pi 将当前草稿交给临时 `prompt.md`，用户在 PICO 中修改、保存并退出后，Pi 重新载入了两行草稿。整个往返过程没有发送用户消息，也没有触发 Model 或 Tool；只有按 `↩ Return` 提交草稿后，才会开始一次 Agent Run。

### Model 与 Thinking Level

Footer 中的 `gpt-5.6-sol • medium` 分别表示当前 Model 和 Thinking Level。Thinking Level 的完整名称集合是 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；实际循环范围由当前 Model 和 Provider 配置决定，不支持的级别会被跳过或限制。

- 当前 TUI：按 `⇧Tab` 循环 Thinking Level，也可通过 `/settings` 选择。
- 启动时指定：`pi --thinking high`。
- 与 Model 一起指定：`pi --model openai/gpt-5.6-sol:high`。
- 切换 Model：输入 `/model` 或按 `⌃L`；`⌃P` 和 `⇧⌃P` 只在已配置的 Scoped Models 中循环。

Thinking Level 只影响后续 Model 请求的推理强度，通常也会影响响应时间和 Token 使用；它不改变 Tool 列表、Executor 权限或安全边界。本机 Pi `0.83.0` 已实测 `⇧Tab` 能切换 Footer 显示的 Thinking Level。

## 输入类型与退出

| 输入形式 | Pi 的处理方式 | 示例 |
|---|---|---|
| 普通文字 | 作为用户消息发送给模型 | `exit` 只会让模型回复，不会退出 Pi |
| 交互式 `@文件` | 模糊搜索项目文件并把路径插入普通消息；不会在此时读取文件 | `@docs/learning/00-environment-report.md` |
| `/命令` | 由 Pi 自身执行 | `/quit`、`/model`、`/session` |
| `!命令` | 执行 Shell，并把输出发送给模型 | `!pwd` |
| `!!命令` | 执行 Shell，但不把输出发送给模型 | `!!git status` |

交互式 `@文件` 的验证分两层：路径出现在草稿中，只证明文件搜索和路径插入成功；提交消息后出现对应的 `read` Tool Call，才证明文件被实际读取。CLI 启动参数中的 `@文件` 会由 Pi 主动附加文件内容，和交互式路径引用不是同一种行为。

本仓库的交互式实验已验证这两层：先通过 `@` 选择并插入 `docs/learning/00-environment-report.md`，此时没有读取；提交明确的读取请求后，Pi 才执行对应的 `read` Tool Call，Model 随后根据 Tool Result 返回了文件一级标题。

CLI 对照实验使用 `--no-tools --no-session -p @docs/learning/00-environment-report.md`。在没有任何 Tool Call 的情况下，Model 仍正确返回文件一级标题，证明命令行参数中的 `@文件` 由 Pi 在首次 Model 请求前主动读取并附加；`--no-session` 同时避免保存该次临时实验。

## macOS 剪贴板图片输入

在 macOS 使用 `⌃⇧⌘4` 框选画面，会把截图复制到剪贴板；其中额外的 `⌃ Control` 表示复制而不是保存到桌面。回到 Pi 后按物理 `⌃V`，不是普通 Mac 应用常用的 `⌘V`。Pi 会把剪贴板图片写为临时 `pi-clipboard-*.png`，并将该路径插入当前草稿。

临时图片路径出现在草稿中，只证明截图粘贴成功，不证明 Model 已收到或理解图片。提交后还必须出现针对该路径的 `read` Tool Call，并得到与图片内容一致的回答，才能证明完整图片读取链路通过。实验图片不得包含密钥、订单或其他敏感信息。

本仓库的图片实验已完成完整链路：Pi 将剪贴板截图写为临时 PNG 并插入草稿；提交后执行了针对该 PNG 的 `read` Tool Call，Tool Result 显示图片缩略图，Model 最终正确识别出截图中的“阶段 0.1 本机环境体检报告”。

退出 Pi：

1. 输入 `/quit` 并按 `↩ Return`，这是最明确的方式。
2. 输入框为空时按 `⌃D`（Control+D）。
3. 连续按两次 `⌃C`（Control+C）；第一次用于清空输入框。

在输入框中键入 `exit`、`quit` 或“再见”都属于普通消息，不会终止 Pi 进程。
