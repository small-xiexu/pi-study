# Pi Session、Tree 与 Compaction

本篇先记录已经讲解的 Session 基础。后续学习 Tree、Fork、Clone 和 Compaction 时继续在这里补充；完成状态仍以 [完整学习计划](../plans/pi-complete-learning-plan.md) 为准。

## Session 是什么

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

## 继续当前项目的 Session

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

## Session 与 Git

| 对象 | 保存内容 | 能否恢复项目文件 |
|---|---|---|
| Session | 对话、工具调用、工具结果和会话结构 | 不能可靠恢复 |
| Git | 项目文件的版本和差异 | 可以 |

Session 可能包含读取过的文件内容、命令输出和其他敏感信息，不应默认提交、上传或公开分享。

Session 当前活动分支如何转换成 Model 的 `messages`，见 [架构与上下文](01-architecture-and-context.md) 的“盒子二：`messages`”。
