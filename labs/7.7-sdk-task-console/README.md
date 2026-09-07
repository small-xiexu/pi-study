# 7.7 SDK 本地终端任务台

原理：[26 构建任务台与异常测试](../../docs/tutorials/26-构建任务台与异常测试.md)。返回[实验总入口](../README.md)。

运行边界：`check` 不调用真实 Provider；`console` 会解析现有认证，普通任务会调用模型并保存记录；`smoke` 直接发起固定真实任务。后两类入口须单独确认，不能代替离线检查；依赖已准备时无需重新安装。

本 Lab 使用 Pi SDK `0.84.3` 构建单任务终端入口。运行时固定为 `openai/gpt-5.6-sol`、Thinking `off`、仓库根工作目录、严格 `tools=[read]` 和专用 fixture 路径门禁。它不是复杂 TUI，也不提供写文件或 Shell Tool。

## 自动门禁

```bash
cd labs/7.7-sdk-task-console
npm ci --ignore-scripts --omit=optional
npm run check
```

`check` 执行严格 TypeScript 与确定性测试，不访问真实认证或 Provider。真实 SDK Agent Loop 使用纯内存凭据和脚本 ModelRuntime，在零网络下分别验证允许 fixture 的两 Turn `read`，以及拒绝路径在 Executor 前形成错误 Tool Result。矩阵还覆盖 Path Gate 的输入集合、已有 Hook 改参后的终检、Tool 错误锁存、输入边界、信号/EOF、EPIPE、退出码、Session 文件拒绝、双进程租约、安全输出和资源释放。

## 交互入口

```bash
npm run console
```

启动时会恢复课程专用目录中最近的 Session；没有可恢复记录时创建新 Session。默认目录为 `~/.pi/agent/sessions/pi-study-7.7-sdk-task-console`，可用 `PI_STUDY_77_SESSION_DIR` 覆盖。Runtime 会把目录规范化并拒绝仓库内路径。首次创建时写入固定 owner marker；后续只接管 marker 内容完全匹配的目录，目录中只允许 marker、单写者租约和普通 `.jsonl` 文件。缺少 marker、符号链接、hard link、FIFO、目录或其他文件都会在改权限前拒绝，不删除现有内容。通过所有权检查后，POSIX 目录权限才会收紧并验证为 `0700`。

Runtime 在加载 Model 前取得原子单写者租约并校验已有 JSONL。任何既有租约都会导致 `SessionDirectoryBusy`；程序不会根据 PID 自动删除租约，避免两个启动进程同时回收时破坏单写保证。JSONL 必须是 UTF-8，只接受 Pi `0.84.3` 当前 Session v3：每个非空物理行都是对象，首行为当前仓库的 Header，后续九类 Entry、五类 Message、父节点与嵌套字段均需符合当前联合类型。旧版不自动迁移；损坏、不可读、不可追加或目录不可写时启动失败，不修改原文件。正常协作退出释放租约。硬退出、崩溃、`SIGKILL` 或断电可能留下租约，恢复前需人工核实没有 Writer，或使用新的专用 SessionDir；程序不自动执行破坏性恢复。

终端不会输出 Session ID、Session 路径或条目正文；Session JSONL 仍会以明文保存 Prompt、消息和 Tool Result，不应提交或共享。

输入规则：

- 普通非空文字提交一个任务；运行期间第二个普通任务返回 `BUSY`，不会排队。
- 空行忽略。
- 每个逻辑行在 trim 前最多 `8192` 个 UTF-8 字节；空闲时超限返回 `FAILED/RUNTIME/InputTooLong`，不调用 SDK，随后恢复 READY。运行中的普通输入仍只返回 BUSY。
- LF 与 CRLF 都形成一个逻辑行；EOF 不形成任务，进入与 `/quit` 相同的清理链。
- `/cancel` 请求协作取消；任务真正结束前仍由原任务 Promise 持有运行资源。
- `/quit` 会先取消并等待活动任务结束，再取消订阅并释放 Session。

需要读取文件时，受支持输入必须明确要求 `read` 下述唯一 fixture。其他路径请求不在任务台支持合同内；自然语言 Prompt 不是门禁本身，Assistant 声称“已读取”或“已拒绝”也不能替代 Tool Result 与 Executor 证据。

### `read` 路径门禁

| 分支 | 合同 |
|---|---|
| 允许 | `path` 精确等于规范相对路径 `labs/7.7-sdk-task-console/fixture.txt`，或精确等于 `path.resolve(repositoryRoot, 该相对路径)` 得到的规范绝对路径 |
| 拒绝 | 其他仓库内路径、仓库外路径、`./`、`..`、重复分隔符等别名、硬链接、目录、缺失目标、非字符串参数、已取消请求，以及最终项、任一父目录、仓库根本身或其任一祖先为符号链接 |
| Hook 组合 | 初检通过后才调用已有 `beforeToolCall`；已有 Hook 的 block 原样保留，若它改写参数则再次执行同一终检 |

拒绝原因固定为 `Read request blocked by task path policy`。Pi Core 把它形成 `isError=true` 的 Tool Result，真实 `read.execute` 调用次数保持为零。Runtime 只接受带布尔 `isError` 的 `read` 结束事件，终态优先级取决于先发生的事实：若取消请求已先锁存，随后由取消产生的 Tool error 保持 `CANCELLED`；若 Tool error 先到，则锁存 `ToolContractViolation` 并请求协作取消，后续取消、正常且已保存的 Assistant final 都不能覆盖，本轮只能输出 `status=FAILED stage=RUNTIME errorKind=ToolContractViolation`，不能输出 Answer 或 `COMPLETED`。

门禁会核对目标是单链接普通文件，并用 `realpath` 确认其仍是规范仓库根下的唯一 fixture。终检完成到 SDK Executor 实际打开 pathname 之间仍存在同用户替换文件的 TOCTOU 窗口；这是进程内能力门禁，不是 OS 沙箱。

状态通道只输出固定字段：`STARTING`、`READY`、`RUNNING`、`READING`、`COMPLETED`、`FAILED`、`CANCELLED` 和 `BUSY`。并行 `read` 尚有任一调用未结束时保持 `READING`。错误诊断不包含原始 Error message、Prompt、Tool 参数/正文、Session 标识、路径、URL、Key 或原始事件。

Context File 不使用 DefaultResourceLoader 的自动扫描。入口以稳定只读快照显式注入仓库根 `AGENTS.md`，全局或祖先 Context 不进入最终集合；根文件缺失、替换或读取期间变化时启动失败。Extension、Skill、Prompt Template、Theme、System Prompt 和 Append Prompt 继续全部禁用。

严格 `tools=[read]` 与 Path Gate 只约束当前 Agent Tool 面，不降低 Pi 进程的操作系统权限。内置 `read` 仍以当前用户权限打开门禁放行的 pathname；交互任务不得要求读取凭据或其他敏感文件，也不能把支持集合外的 Prompt 当成安全测试。

## 退出与清理

`/quit` 和 EOF 正常退出为 `0`；交互终端 `Control-C` 与外部 `SIGINT` 为 `130`，`SIGTERM` 为 `143`。首个信号进入同一个幂等清理链：停止输入、取消并等待活动任务、取消 SDK/输出订阅、`dispose()` Session、清除 Listener/Timer 并释放租约。清理超过 5 秒或再次收到信号时才硬退出，第一信号决定退出码。

stdout `EPIPE` 会停止继续写 stdout，向仍可用的 stderr 最多输出一次 `FAILED/SHUTDOWN/BrokenPipe`，再执行同一清理并以非零状态退出。普通清理异常和超时分别使用固定 `ShutdownFailure`、`ShutdownTimeout`；原始 Error message、路径、Prompt 和 Session 内容不会写入诊断。stderr 也关闭时静默退出，避免递归报错。

自动进程测试使用 Fake Controller 验证 LF/CRLF/EOF、启动前后 SIGINT/SIGTERM、重复信号、超时、EPIPE 和清理失败；另用三个真实 Node 子进程验证同一 SessionDir 的“持有、拒绝、释放后再获取”。本机真实 TTY 已验证 READY 后 `Control-C` 退出 `130`；它不等于真实 Provider 取消或远端停止计费。

一次受控真实验收在 Model 产生首个 `READING tool=read` 后发送 SIGTERM：本地任务输出 CANCELLED，无 COMPLETED、Answer 或 FAILED，进程退出 `143`，租约释放且私有 SessionDir 只保留 owner marker 与普通 JSONL。该结果只证明本次真实 Model 首个 Tool Call 与本地协作取消链；不证明远端已停止计算或计费，也不读取 Session 正文。

只有本轮 Prompt 成功、观察到 `agent_settled`、最终 Assistant 为正常 `stop` 且有非空文字，并在 Prompt 返回后确认匹配时间戳的 Assistant Session 条目已新增，才输出 `status=COMPLETED saved=true`。随后最终回答以单个物理行 `answer=<JSON string>` 独立输出；ANSI、OSC 和危险控制字符会先移除，换行等内容由 JSON 转义，不能伪造新的 `status=` 或 `answer=` 记录。

## 有界真实 Smoke

```bash
npm run smoke
```

`smoke` 是唯一预置真实 Agent Run：最多提交一个固定任务，要求只读规范相对路径 `labs/7.7-sdk-task-console/fixture.txt`。成功必须同时满足最终回答精确等于 fixture marker、只出现一次 `read` 开始状态、`COMPLETED saved=true`，且没有 `FAILED` 或 `CANCELLED`。60 秒到期后先请求协作取消；再经过 5 秒 grace 仍未结束时，进程以非零状态硬退出，不会无限等待。

Retry 已关闭，但一次 Agent Run 仍可能因 Tool Loop 产生多次 Provider 请求。Smoke 会使用本机现有 Pi 认证解析，因此只能在自动门禁通过并取得单独真实调用授权后执行。不要把一次成功外推为费用准确、长期稳定、任意任务安全或生产可用。
