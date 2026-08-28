# Pi 学习资料索引

这里保存 Pi 学习过程中已经讲解并核对过的主题知识、命令和环境证据。

学习进度、验收结论和下一步只以 [完整学习计划](../plans/pi-complete-learning-plan.md) 为准；主题文档不重复维护完成状态。

本目录也是未来学习网站的唯一内容源，不维护另一套网页专用笔记。

## 继续学习

1. 先打开[完整学习计划的当前断点](../plans/pi-complete-learning-plan.md#当前断点)，确认唯一状态、验收证据和下一步。
2. 再从下表进入当前主题文档；主题文档只保存稳定知识，不根据文件是否存在推断完成状态。
3. 需要动手时，从[实验入口](#实验入口)找到对应材料；自动脚本、Fake/Mock、本地 Pi、新进程和真实 Provider 仍是不同证据。

## 当前主题文档

| 文档 | 对应阶段 | 内容 |
|---|---:|---|
| [00-environment-report.md](00-environment-report.md) | 0.1 | 本机环境、版本、路径和已执行的验证证据 |
| [01-architecture-and-context.md](01-architecture-and-context.md) | 0.2 | Pi、Provider、Model、Agent Loop、Tool、Session 的职责边界，以及 Model 上下文组装 |
| [02-terminal-and-tools.md](02-terminal-and-tools.md) | 1 | Pi `0.83.0` 终端实验快照、基础工具、输入类型、退出方式、内置 Tool 与安全边界 |
| [03-project-configuration.md](03-project-configuration.md) | 2 | 全局与项目配置、Project Trust、Settings 合并规则、CLI 临时调整与优先级实验 |
| [04-session-tree-compaction.md](04-session-tree-compaction.md) | 3 | Session 生命周期、JSONL 结构、Tree/Fork/Clone、Compaction、Branch Summary、长任务断点及其与工作区和 Git 的边界 |
| [05-prompt-skill-theme.md](05-prompt-skill-theme.md) | 4 | Prompt Template、Skill、Theme，以及资源加载、选择、执行与重载边界 |
| [06-extensions.md](06-extensions.md) | 5 | Extension 总入口；从 hub 分别进入 Runtime/加载、Context/Tool/Event、Shell Gate/Branch State/Widget 和验证边界子页；默认 Pi `0.84.1`，5.10 动态矩阵为 `0.84.2` |
| [07-packages-models-providers.md](07-packages-models-providers.md) | 6 | Pi `0.84.2` 阶段总入口；从 hub 分别进入 Package、模型选型与认证、Custom Model、Custom Provider 和版本证据子页 |
| [08-sdk-rpc-json-tui.md](08-sdk-rpc-json-tui.md) | 7 | Pi `0.84.2` SDK、Agent Session、RPC 与 JSON Event Stream；Pi `0.84.3` TUI Component、焦点、Overlay、输入和刷新主线 |

## 实验入口

| 阶段 | 实验材料 | 直接入口 | 最大证明范围 |
|---|---|---|---|
| 1.2 | 基础 Tool 文件闭环 | [`labs/1.2-tools/tool-lab.txt`](../../labs/1.2-tools/tool-lab.txt) | 指定 Session 中的 Tool Call、文件结果与 Git 差异；不证明 Tool 自动安全 |
| 2.4 | Network 单次请求超时 | [`labs/2.4-network/README.md`](../../labs/2.4-network/README.md) | 回环 Fake Provider 下的一次请求超时；不证明整个 Agent Run 总时限 |
| 4.4-4.5 | Skill 触发、注入与脚本执行 | [`OrderService.java`](../../labs/4.4-skill/OrderService.java)、[`4.5-skill-security/`](../../labs/4.5-skill-security/)、[`script-execution-lab`](../../.agents/skills/script-execution-lab/SKILL.md) | 受控样例中的 Skill/Tool 行为；读取脚本不等于执行，单次未受注入不等于普遍安全 |
| 5.1-5.10 | `pi-study-guard` Extension | [Extension 实验材料](../../.pi/extensions/pi-study-guard/README.md) | 静态、Fake/Runner、本地 Pi 和真实模式的分层证据；不是 OS 沙箱 |
| 6.1-6.4 | Package 来源、安全、制品和管理 | [6.1](../../labs/6.1-package-sources/README.md)、[6.2](../../labs/6.2-package-security/README.md)、[6.3](../../labs/6.3-local-package/README.md)、[6.4](../../labs/6.4-package-management/README.md) | 课程 fixture 与本机固定版本的受控链路；不证明第三方 Package、真实 Registry 或生产可用性 |
| 7.1 | SDK Agent Session | [SDK 实验材料](../../labs/7.1-sdk/README.md) | Pi SDK `0.84.2` 的内存 Session、资源发现、显式选模、单次 `read`、事件追踪与一次真实 Model smoke；不证明费用、质量、长期稳定或生产可用性 |
| 7.2 | SDK 高级控制 | [SDK 控制面实验材料](../../labs/7.2-sdk-controls/README.md) | Pi SDK `0.84.2` 的 Tool 限制、取消、两层重试、队列、Compaction 和持久化；区分本地故障注入与一次真实 Model 主线，不证明生产可用性 |
| 7.4 | Java RPC 客户端 | [Java RPC 实验材料](../../labs/7.4-rpc-java/README.md) | 严格 LF JSONL、Response ID 关联、单活动 Prompt、四类结果、Fake 子进程矩阵与一次真实 RPC smoke；不证明并发 Prompt或生产可用性 |

后续编号预留给尚未开始的主题。只有开始学习并产生实质内容后，才创建对应文档：

| 预留文档 | 对应主题 |
|---|---|
| `09-source-and-capstone.md` | 源码阅读与毕业综合项目 |

阶段 8 开始前仍从唯一计划的当前断点进入；只有开始学习并产生稳定内容后才创建 `09-source-and-capstone.md`。

## Legacy migration entry

[pi-learning-notes.md](pi-learning-notes.md) 只保留旧笔记迁移入口，不属于课程主导航，也不继续追加主题正文。

## 阅读顺序

推荐顺序：`00（首次环境搭建时按需） -> 01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08`。

每次继续学习前，先从完整学习计划的“当前断点”恢复进度；主题文档用于按上述顺序学习或查阅，不承担进度恢复。

## 维护规则

- 学习计划是唯一进度台账；主题文档只保存稳定知识和可复用操作。
- 环境报告只记录实际验证证据，不把计划项存在当成完成证据。
- 一个知识点只在最合适的主题文档中完整说明，其他文档使用链接引用。
- 重点机制在用户理解确认后及时写入对应主题文档；优先保留大白话场景、流程图、关键边界和版本证据，不把对话记录原样堆入正文。
- 主题变大时优先增加清晰的小节；只有职责明显不同且检索受影响时才继续拆分。
- 每个成熟模块尽量保留原理、实验步骤、验证证据、结论与边界；网站只负责呈现这些内容。
- 旧入口 `pi-learning-notes.md` 只保留迁移说明，不再追加正文。
- 不记录 API Key、OAuth Token、原始 Session、个人敏感路径或未经脱敏的终端输出。

## 官方资料

- 总览：`https://pi.dev/docs/latest`
- 快速开始：`https://pi.dev/docs/latest/quickstart`
- 日常使用：`https://pi.dev/docs/latest/usage`
- 会话：`https://pi.dev/docs/latest/sessions`
- 模型：`https://pi.dev/docs/latest/models`
- 安全：`https://pi.dev/docs/latest/security`
- Extensions：`https://pi.dev/docs/latest/extensions`
