# 阶段 0.1 本机环境体检报告

- 采集日期：2026-07-29
- 采集范围：仅非敏感系统元数据、开发工具版本和当前仓库状态
- 当前状态：环境证据、Pi CLI 安装、中转认证、首次模型会话及四项理解验收均已完成
- 未执行：API Key 内容读取、破坏性工具调用、后续课程实操

## 环境结果

| 检查项 | 结果 | 在 Pi 学习中的作用 | 判断 |
|---|---|---|---|
| 操作系统 | macOS 26.4.1，Apple Silicon `arm64` | 决定安装路径、二进制架构和终端行为 | 可用 |
| Shell | `/bin/zsh` | Pi 的 Shell 工具通过命令解释器运行项目命令 | 可用 |
| Node.js | `v25.2.1`，路径 `/opt/homebrew/bin/node` | 运行 Pi、SDK 和 TypeScript Extension | 可用 |
| npm | `11.6.2`，路径 `/opt/homebrew/bin/npm` | 安装 Pi、管理 Package 和依赖 | 可用 |
| npm 全局目录 | `/opt/homebrew/lib/node_modules`，当前用户可写 | 存放全局安装的 Pi 包 | 可用，无需据此使用 `sudo` |
| Git | `2.50.1`，路径 `/usr/bin/git` | 保存检查点、审查差异和回滚实验 | 可用 |
| Pi | `0.82.1`，路径 `/opt/homebrew/bin/pi` | Pi CLI 本体 | 已安装并在实际终端启动 TUI |
| fd | `10.4.2`，路径 `~/.pi/agent/bin/fd` | 为 Pi 提供快速文件查找 | 首次启动时由 Pi 安装，已通过版本检查 |
| 磁盘空间 | 当前卷约 74 GiB 可用 | 安装依赖、保存会话和后续源码仓库 | 当前充足 |

## 版本兼容性

- 当前 npm 最新版 Pi：`@earendil-works/pi-coding-agent@0.82.1`。
- 该版本声明 Node.js 要求为 `>=22.19.0`。
- 本机 Node.js 为 `v25.2.1`，满足声明的版本范围。
- 已确认 npm 全局包和 `pi --version` 均为 `0.82.1`。
- 实际 zsh 终端已成功显示 Pi TUI；`openai/gpt-5.6-sol` 已通过中转站响应并保存 Session。

## 仓库隔离状态

- 当前目录和 Git 根目录均为 `/Users/sxie/xbk/pi-study`。
- 远程仓库为 `https://github.com/small-xiexu/pi-study.git`。
- 当前分支为 `main`，学习计划与本报告已经发布到 `origin/main`。
- `.idea/` 与 `.DS_Store` 通过 `.git/info/exclude` 仅在本机排除，不进入共享仓库。

结论：学习实验与现有业务仓库物理隔离。后续操作仍需限定在当前 Git 根目录，不能只依赖当前工作目录的视觉提示。

## 终端检测边界

自动化体检进程报告 `TERM=dumb`，这只反映自动化命令执行通道。用户已在实际 zsh 终端成功显示 Pi TUI，说明基础交互界面可以启动；颜色、图片和全部键盘快捷键仍需后续逐项验证。

## 0.1 理解验收

- 验收日期：2026-07-29
- 状态：已通过

| 题目 | 用户掌握的结论 |
|---|---|
| Node.js 与 npm | Node.js 负责运行；npm 负责安装和管理包。 |
| Git 与回滚 | Git 记录版本历史；能运行只证明当前状态可执行，不能保证修改失败后可以回滚。 |
| 独立仓库 | 限制练习影响范围，避免影响重要业务项目；独立仓库不是沙箱，Pi 仍有当前用户权限。 |
| Pi 能力边界 | 已验证安装启动、模型响应、Session 保存和只读 Shell；尚未验证文件编辑写入、Session 恢复、Extension、MCP/Subagent 和安全控制。 |
