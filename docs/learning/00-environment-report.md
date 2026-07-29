# 阶段 0.1 本机环境体检报告

- 采集日期：2026-07-29
- 采集范围：仅非敏感系统元数据、开发工具版本和当前仓库状态
- 当前状态：环境证据、Pi CLI 安装、中转认证及首次模型会话均已验证，等待用户完成理解验收
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

用户需要不看答案，用自己的话说明：

1. Node.js 和 npm 分别负责什么，为什么二者不能视为同一个东西？
2. Git 在这个学习仓库中的价值是什么，为什么“能运行”不等于“可安全回滚”？
3. 为什么必须使用独立的 `pi-study` 仓库，而不直接在重要业务仓库试验？
4. 当前已经证明 Pi 的哪些部分可以运行，哪些部分仍未验证？

四点回答准确后，0.1 才能标记完成。
