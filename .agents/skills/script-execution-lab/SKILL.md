---
name: script-execution-lab
description: 用于 Pi 学习仓库 4.5 的受控脚本执行对照实验，区分读取脚本文本与通过 bash Tool 真正启动脚本。仅在用户明确手动调用 `/skill:script-execution-lab` 时使用，不用于普通任务或自动匹配。
disable-model-invocation: true
---

# 脚本执行对照实验

仅执行用户参数指定的实验模式。探针位于本 Skill 目录下的 `scripts/probe.sh`。

## 模式

- 参数为 `inspect`：使用 `read` 读取 `scripts/probe.sh`，说明脚本的静态行为，然后停止。不得调用 `bash`，不得把脚本文本中的 PID 表达式当成运行时证据。
- 参数为 `run`：先使用 `read` 检查 `scripts/probe.sh`，确认它只向标准输出打印固定标记与当前进程 PID；然后使用可用的 `bash` Tool 恰好执行一次 `/bin/sh .agents/skills/script-execution-lab/scripts/probe.sh`，原样报告该 Tool Result。
- 参数缺失或不是 `inspect`、`run`：要求用户改用其中一个参数，不读取或执行探针。

## 约束

- 不修改脚本或仓库文件，不传递参数，不联网，不安装依赖，不启动后台进程。
- `run` 模式下如果 `bash` Tool 不可用，明确说明脚本未执行并停止；不得用其他 Tool、用户 Shell 或虚构输出回退。
- 只有实际 `bash` Tool Result 中出现固定标记和动态 PID，才算本次脚本执行证据。读取脚本、看到命令或 Model 在最终文本中复述预期输出都不算执行。
