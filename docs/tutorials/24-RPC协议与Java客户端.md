# 用 RPC 让 Java 程序控制 Pi

你的应用不是 Node.js，仍想复用 Pi。可以让 Java 启动一个长期运行的 Pi 子进程：Java 写入 JSON 命令，Pi 返回 JSON 响应和事件。两边不共享对象，通过管道交换数据。

## RPC 把函数调用变成了什么？

RPC 意为远程过程调用，但这里的“远程”可以只是本机另一个进程。Java 无法直接拿着 Node.js 对象调用方法，于是把“请执行哪个操作、参数是什么”编码为消息，Pi 收到后再调用自己的功能。

这多出一条进程边界：对象必须序列化，错误必须通过协议或退出状态表达，任一边也可能先退出。好处是两边语言和发布方式可以独立；代价是你不能再假设一次本地函数调用就包含所有结果。

子进程拥有独立内存，但通常仍继承当前用户的系统权限。分进程有助于管理生命周期，不自动隔离文件、网络或凭据。

### 一次性 JSON 输出与 RPC 有什么本质差别？

一次性模式通常给输入、读完输出、等待进程退出。RPC 则把进程保留着，在持续输出事件的同时接收后续命令，例如查询状态或取消任务。客户端不能“先等整个任务结束，再读输出”，因为运行中的交互和有界管道都要求及时读取。

**管道缓冲区**是有限的暂存空间。若客户端不读 stdout 或 stderr，子进程写满后可能等待，双方就会互相卡住。这是 I/O 消费问题，不是模型一定还在思考。

### 为什么有 Command、Response 和 Event 三种记录？

Command 表达请求，Response 回答这个请求是否被接收或处理，Event 说明运行期间发生了什么。一条 Prompt Command 可以引发多轮模型请求与许多事件，因此不是“一问对应一行答案”。

请求 ID 只解决协议明确承诺的关联范围。它像回执上的编号，而不是自动附在所有后续工作上的任务身份。普通 Agent Event 没有这份编号，客户端就需要另一个可靠的归属策略；本例通过只允许一个活动 Prompt 消除歧义。

### 状态机为什么不是再造一套 Agent Loop？

客户端状态机只整理它已经观察到的事实：已发送、收到接收回执、看到本轮终态、进程是否退出。它不负责模型下一步选什么工具，而是判断这些事实是否足以兑现对调用方的承诺。

超时尤其体现这点：本地等待超时，只说明客户端不再愿意等；Pi 可能仍在运行。此时要发起取消或关闭，而不能把 Future 标成超时后遗忘下游。下面依次解释管道、分帧和事实合并，再看 Java 实现。

## 1. 三条管道各有用途

| 管道 | 方向 | 内容 |
|---|---|---|
| stdin | Java 到 Pi | Command 和扩展 UI 回答 |
| stdout | Pi 到 Java | Response、Agent Event、扩展 UI 请求 |
| stderr | Pi 到 Java | 独立诊断，不混入 JSON 协议 |

入口是 `pi --mode rpc`。它不显示本机交互编辑器；Java 必须持续消费输出，并处理超时、EOF 和退出。不要设置 `redirectErrorStream(true)`，否则普通错误文字可能破坏 JSON 流。

进程参数不自动限制工具。真实入口仍要显式指定模型、工具、资源和会话策略；启动成功也不代表已授权提交真实模型请求。

## 2. 一条记录只能由 LF 分隔

每个 JSON 对象序列化后追加 `\n` 并 flush。读取时只按 LF 分帧，可去掉 LF 前的单个 `\r`，从而接受 CRLF。

不能按网络块或 `read()` 返回次数切 JSON：一个对象可能被拆成多块，一块也可能包含多个对象。UTF-8 多字节字符也可能跨块，需要增量解码。

字符串中的 `U+2028`、`U+2029` 是合法数据，不是协议换行。不要用把所有 Unicode 行分隔符都当换行的通用拆行函数。

EOF 前没有 LF 的尾巴要制定明确策略。现有 Java Lab 接受可解析的最后一条尾记录；第 08 篇的一次性结果解析器则要求完整 LF。两者是不同的客户端合同，不能混写成 Pi 保证“半条消息也成功”。截断 JSON 必须失败。

## 3. 先区分回执与运行结果

Java 发出的命令：

```json
{"id":"book-1","type":"prompt","message":"只回复 BOOK_OK"}
```

Pi 的接收回执：

```json
{"id":"book-1","type":"response","command":"prompt","success":true}
```

`success: true` 仅表示已接受、排队或立即处理。普通模型任务仍会继续流出事件；接受后失败通常不会再给同一 ID 发送第二份失败 Response。

```mermaid
sequenceDiagram
    participant J as Java 客户端
    participant P as Pi RPC
    J->>P: prompt，带请求 ID
    P-->>J: response，确认接收
    Note over J,P: 事件与回执可能交错，不靠顺序猜归属
    P-->>J: 消息与工具事件
    P-->>J: agent_end
    P-->>J: 可能的自动继续
    P-->>J: agent_settled
    J->>J: 合并回执、本轮终态和验收条件
```

普通 Response 可以通过 `id` 关联并发命令。普通 Agent Event 通常没有请求 ID，因此本教程的客户端同一时间只允许一个活动 Prompt，不把两个任务的文字增量混在一起。

工具事件使用 `toolCallId` 关联。直接 RPC `bash` 的 `bash_execution_update` 可以带原命令 ID，这是特定事件的支持，不应推断所有事件都有 ID。

## 4. 四种结果比一个布尔值准确

| 结果 | 必要事实 |
|---|---|
| 成功 | 已接受、已 settled、本轮最终 Assistant 正常结束，且满足业务条件 |
| 接收前拒绝 | 对应 Response 为 `success: false` |
| 接收后失败 | 已接受，但最终消息错误、取消、截断或不满足合同 |
| 提前退出 | 运行尚未闭合，子进程就结束或协议流异常 |

事件可能先于客户端处理回执到达，所以状态机要能先保存事件事实，再合并 accepted 状态。不要在看到 `agent_settled` 时丢弃还没读到的回执，也不要把 `agent_end` 当成完成。

当前 JSON 事件不携带每次更新的累计消息快照。文字按 `contentIndex` 组装增量，最终以 `message_end.message` 为准；历史上读取 `assistantMessageEvent.partial` 的代码需要按实际版本核对。

## 5. 取消和退出分开做

`abort` 等待当前操作停止后响应，但队列中剩余内容可能继续执行。若要模拟交互界面的“停止并取回排队草稿”，先发 `clear_queue` 保存返回文本，再发 `abort`。

直接 Shell 命令使用 `abort_bash`。终止 Pi 进程则还要关闭 stdin、等待子进程退出、排空输出、关闭流和线程池；超过 grace 才升级终止。不能用“发送 abort 成功”代替所有资源已释放。

收到 stdout EOF 时，结合进程退出码和当前任务状态判断。退出码 `0` 也可能发生在尚未获得完整业务结果时；反过来，最后已生成答案也不代表清理失败可以忽略。

## 6. 扩展 UI 是另一组请求

RPC 中 `ctx.hasUI === true`，因为 Pi 能发 `extension_ui_request`，让客户端显示确认框。它不是本机 TUI；`ctx.mode === "rpc"`，自定义终端组件不在这里运行。

选择、确认、输入、编辑属于需要回答的对话，客户端按 UI 请求 ID 回 `extension_ui_response`。通知和状态更新通常不需要回答。

若客户端不支持危险操作审批，应明确拒绝或取消，不静默批准，也不让请求无限等待。TUI 内置 `/settings` 等命令不是任意 RPC Prompt 都能调用的服务接口，使用相应协议命令。

## 7. 看现有 Java 客户端怎样分工

仓库现有案例使用 Java 8、Jackson 和 JUnit 5，不是 Spring Boot 服务：

| 文件 | 读代码时关注什么 |
|---|---|
| [PiRpcClient.java](../../labs/7.4-rpc-java/src/main/java/com/xiexu/pistudy/rpc/PiRpcClient.java) | ProcessBuilder、Response Map、单活动 Prompt、三个 I/O 工作和 close |
| [StrictJsonlReader.java](../../labs/7.4-rpc-java/src/main/java/com/xiexu/pistudy/rpc/StrictJsonlReader.java) | 增量读取、LF 分帧、单条上限和尾记录 |
| [PromptRunResult.java](../../labs/7.4-rpc-java/src/main/java/com/xiexu/pistudy/rpc/PromptRunResult.java) | accepted、settled、最终状态与进程退出的不同含义 |

调用流程从 `start()` 开始：分别读 stdout、消费 stderr、观察进程退出。`sendCommand()` 先登记 ID 到 Future，再写入 JSON；写入失败要移除等待项。`runPrompt()` 先取得单任务占用，再同时等待回执和事件终态。

写端需要串行化一整条记录，避免两线程把 JSON 字符交错。退出时应让仍在等待的 Future 明确失败，不能遗留永远 pending 的调用。等待超时也不等于远端任务已经取消，调用方必须进入取消或关闭链。

这里阅读的是已有实现的职责，不保证它具备所有生产合同。例如尾记录接受策略、解码错误处理、超时后的活动任务和更多协议负例，都要按自己的应用要求再审查。

## 8. 先运行假的子进程

从本仓库根目录执行；需要可用 JDK、Maven 和已经缓存的依赖：

```bash
java -version
mvn -version
mvn -o -B -f labs/7.4-rpc-java/pom.xml test
```

测试启动的是 `FakeRpcServerMain`，不是 Pi，不使用真实认证。预期覆盖：LF/CRLF/Unicode 分隔符保留、逆序 Response ID、accepted 后 settled 成功、接收前拒绝、接收后错误、提前退出和正常关闭。

`-o` 是 Maven 离线模式；缺缓存就停止，另行确认安装，不把失败改写为“网络问题无需处理”。测试只证明这些固定协议场景，不证明真实 Provider、任意 Pi 版本或多 Prompt 并发。

## 9. 一分钟回忆

> **RPC 是长期进程加 JSONL 协议；ID 管回执，单任务状态机管事件，accepted、settled 和退出必须分别判断。**

实现与真实入口说明见[7.4 Java RPC 实验](../../labs/7.4-rpc-java/README.md)，其他实验见[总入口](../../labs/README.md)。可执行 jar 与上面的假子进程测试不同：它会启动实际 Pi、使用现有认证并请求模型，需要单独确认 CLI 版本和费用。

上一篇：[使用SDK提交与控制任务](23-使用SDK提交与控制任务.md)。下一篇：[终端组件与界面刷新](25-终端组件与界面刷新.md)。
