# Pi 学习资料索引

这里保存 Pi 学习过程中已经讲解并核对过的主题知识、命令和环境证据。

学习进度、验收结论和下一步只以 [完整学习计划](../plans/pi-complete-learning-plan.md) 为准；主题文档不重复维护完成状态。

本目录也是未来学习网站的唯一内容源。当前先完成 Pi 学习和本地实验，阶段 8 验收后再建设网站，不维护另一套网页专用笔记。

## 当前主题文档

| 文档 | 内容 |
|---|---|
| [00-environment-report.md](00-environment-report.md) | 本机环境、版本、路径和已执行的验证证据 |
| [01-architecture-and-context.md](01-architecture-and-context.md) | Pi、Provider、Model、Agent Loop、Tool、Session 的职责边界，以及 Model 上下文组装 |
| [02-terminal-and-tools.md](02-terminal-and-tools.md) | Pi `0.83.0` 终端实验快照、基础工具、输入类型、退出方式、内置 Tool 与安全边界 |
| [03-project-configuration.md](03-project-configuration.md) | 全局与项目配置、Project Trust、Settings 合并规则、CLI 临时调整与优先级实验 |
| [04-session-tree-compaction.md](04-session-tree-compaction.md) | Session 生命周期、JSONL 结构、Tree/Fork/Clone、Compaction、Branch Summary、长任务断点及其与工作区和 Git 的边界 |
| [05-prompt-skill-theme.md](05-prompt-skill-theme.md) | Prompt Template、Skill、Theme，以及资源加载、选择、执行与重载边界 |
| [06-extensions.md](06-extensions.md) | Pi `0.84.1` Extension 的完整加载场景、核心对象、通用生命周期、Command/User Bash/Model 切换/普通 Agent Loop 的真实对照、四类入口与五个排序槽位、Trust/去重/重载、TypeScript/依赖边界，以及后续能力地图 |

后续编号预留给尚未开始的主题。只有开始学习并产生实质内容后，才创建对应文档：

| 预留文档 | 对应主题 |
|---|---|
| `07-packages-models-providers.md` | Packages、Models 与 Providers |
| `08-sdk-rpc-json-tui.md` | SDK、RPC、JSON 与 TUI |
| `09-source-and-capstone.md` | 源码阅读与毕业综合项目 |

## Legacy migration entry

[pi-learning-notes.md](pi-learning-notes.md) 只保留旧笔记迁移入口，不属于课程主导航，也不继续追加主题正文。

## 阅读顺序

推荐顺序：`00（首次环境搭建时按需） -> 01 -> 02 -> 03 -> 04 -> 05 -> 06`。

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
