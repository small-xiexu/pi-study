# Pi 学习笔记

这份文档记录学习过程中已经讲解的概念、命令和安全边界，并持续更新。进度与验收状态以 `docs/plans/pi-complete-learning-plan.md` 为准；本机证据以 `docs/learning/00-environment-report.md` 为准。

## 1. 当前学习环境

| 项目 | 当前选择 |
|---|---|
| Pi | `0.82.1` |
| Provider | `openai`；课程中视为官方模型能力已完整接入 |
| API | `openai-responses` |
| Model | `gpt-5.6-sol` |
| Base URL | `https://sub2api.shelfcanvas.top`，不添加 `/v1` |
| 凭据 | 由 Pi 保存在 `~/.pi/agent/auth.json`，文件权限为 `0600` |

API Key 不写入项目文档、Git 仓库或聊天记录。

课程约定：底层中转不作为学习、验收或阻塞项；学习调用费用不设上限，无需逐次确认。Base URL 仅作为当前环境的可复现配置保留。

## 2. 基础工具

| 对象 | 作用 | 记忆方式 |
|---|---|---|
| Node.js | 运行 Pi、SDK 和 TypeScript Extension | 负责运行 |
| npm | 下载、安装和更新 Pi 及依赖 | 负责安装和管理 |
| Git | 记录项目版本、查看差异、建立检查点和回滚 | 保存项目历史 |
| 独立仓库 | 隔离学习修改与业务代码，降低误操作影响 | 限制练习范围 |

“程序能运行”只证明当前状态可以执行，不代表修改过程可追溯，也不代表失败后可以恢复。代码恢复依赖 Git。

独立仓库不是沙箱。Pi 仍继承当前系统用户权限，理论上可以访问仓库外的路径。

## 3. Pi 是什么

Pi 是极简的 Coding Agent Harness，不是空壳。它负责连接模型、组织对话、调用工具、保存 Session，并提供扩展入口。

当前内置工具：

- `read`：读取文件。
- `bash`：执行 Shell 命令。
- `edit`：按指定范围修改文件。
- `write`：创建或覆盖文件。
- `grep`：搜索文件内容。
- `find`：查找文件。
- `ls`：列出目录内容。

Pi 没有内置沙箱。`bash`、`edit` 和 `write` 可以产生真实修改，因此重要操作前仍需检查工作目录、Git 状态和命令影响范围。

### 输入类型与退出

| 输入形式 | Pi 的处理方式 | 示例 |
|---|---|---|
| 普通文字 | 作为用户消息发送给模型 | `exit` 只会让模型回复，不会退出 Pi |
| `/命令` | 由 Pi 自身执行 | `/quit`、`/model`、`/session` |
| `!命令` | 执行 Shell，并把输出发送给模型 | `!pwd` |
| `!!命令` | 执行 Shell，但不把输出发送给模型 | `!!git status` |

退出 Pi：

1. 输入 `/quit` 并回车，这是最明确的方式。
2. 输入框为空时按 `Ctrl+D`。
3. 连续按两次 `Ctrl+C`；第一次通常用于清空输入框。

在输入框中键入 `exit`、`quit` 或“再见”都属于普通消息，不会终止 Pi 进程。

## 4. MCP 与 Subagent

Pi 刻意不内置 MCP 和 Subagent，它们不是安装后的必备组件。

| 能力 | Pi 的实现方式 | 何时引入 |
|---|---|---|
| MCP | 通过 Extension 或 Package 接入 | 出现明确的外部系统调用需求后 |
| Subagent | 通过 Extension、Package、独立 Pi 进程或 tmux 实现 | 掌握工具、Session、费用和并发写入风险后 |

过早引入的主要成本：

- MCP 增加网络访问、凭据管理和数据共享边界。
- Subagent 增加模型调用费用、上下文复杂度和并发写文件冲突。
- 工具过多会增加模型选择错误工具的概率。

当前顺序：先掌握内置工具和 Session，再学习 Skill、Extension 与 Package，最后按真实需求引入 MCP 或 Subagent。

## 5. Session

Session 是 Pi 自动保存在本机的一次工作会话记录，不是模型的永久记忆，也不是项目版本快照。Session 以启动 Pi 时的工作目录作为项目作用域。

所有项目的 Session 根目录：

```text
~/.pi/agent/sessions/
```

Pi 会把工作目录编码为子目录。当前 `pi-study` 项目的实际目录是：

```text
~/.pi/agent/sessions/--Users-sxie-xbk-pi-study--/
```

这表示 Session 属于 `/Users/sxie/xbk/pi-study` 这个工作目录，但文件保存在用户目录中，不在 Git 仓库内。换到其他项目启动 Pi，会使用另一个项目分组目录。

Session 通常包含：

- 用户消息和模型回复。
- Tool Call、工具参数和 Tool Result。
- 使用的 Provider、Model 和会话元数据。
- Token、费用、分支和上下文压缩相关记录。

### 继续当前项目的 Session

先进入曾经启动 Pi 的项目目录，再执行恢复命令：

```bash
cd /Users/sxie/xbk/pi-study
pi -c
```

`pi -c` 会继续当前项目最近一次 Session。在其他目录执行，会查找那个目录对应的 Session，而不是 `pi-study` 的记录。

其他常用命令：

| 命令 | 含义 |
|---|---|
| `pi -c` | 继续当前项目最近一次 Session |
| `pi -r` | 浏览并选择当前项目的历史 Session |
| `pi --no-session` | 临时会话，不保存记录 |
| `/session` | 查看当前 Session 文件、ID、消息、Token 和费用 |
| `/resume` | 在 Pi 内选择当前项目的历史 Session |
| `/new` | 新建 Session |
| `/tree` | 查看并跳转会话树节点 |
| `/fork` | 从较早的用户消息创建新 Session |
| `/clone` | 将当前活动分支复制为新 Session |

### Session 与 Git

| 对象 | 保存内容 | 能否恢复项目文件 |
|---|---|---|
| Session | 对话、工具调用、工具结果和会话结构 | 不能可靠恢复 |
| Git | 项目文件的版本和差异 | 可以 |

Session 可能包含读取过的文件内容、命令输出和其他敏感信息，不应默认提交、上传或公开分享。

## 6. 当前验证边界

已验证：

- Pi `0.82.1` 可以启动和退出。
- `openai/gpt-5.6-sol` 可以通过当前中转站响应。
- API Key 已保存，凭据文件权限为 `0600`。
- Pi 可以执行只读 Shell 命令。
- 首次 Session 已自动保存。

尚未验证：

- 文件读取、编辑、写入和回滚的完整流程。
- Project Trust、危险命令控制和 Prompt Injection 防护。
- Session 恢复、Tree、Fork、Clone 和 Compaction。
- 图片输入、全部快捷键及长会话稳定性。
- Skill、Extension、Package、MCP 和 Subagent。

模型接入、底层数据处理和计费链路不再列入待验证范围；课程统一以模型能力已经完整可用为前提。

## 7. 官方资料

- `https://pi.dev/docs/latest/quickstart`
- `https://pi.dev/docs/latest/usage`
- `https://pi.dev/docs/latest/sessions`
- `https://pi.dev/docs/latest/models`
- `https://pi.dev/docs/latest/security`
