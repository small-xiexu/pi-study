# 7.4 Java RPC 客户端

本 Lab 使用 Java `ProcessBuilder` 启动长期 Pi RPC 子进程，通过严格 LF JSONL 发送 Command、关联 Response，并把异步 Agent Event 汇总为 Prompt 结果。

## 文件职责

| 文件 | 职责 |
|---|---|
| `PiRpcClient` | 子进程、stdin/stdout、Response Map、单活动 Prompt 与退出清理 |
| `StrictJsonlReader` | 只按 LF 分帧，兼容去除 LF 前的单个 CR |
| `PromptRunResult` | 区分成功、接收前拒绝、接收后失败和提前退出 |
| `RpcDemo` | 使用真实 Pi/Model 的有界 smoke 入口 |
| `FakeRpcServerMain` | 测试专用 Java RPC 子进程，不调用真实 Provider |

普通 Command Response 可通过 `id` 并发关联。普通 Agent Event 通常没有请求 `id`，因此高层 `runPrompt()` 同一时间只允许一个活动 Run，不猜测多个 Prompt 的事件归属。

## 确定性矩阵

```bash
cd /Users/sxie/xbk/pi-study/labs/7.4-rpc-java
mvn test
```

若当前非交互 Shell 找不到 Maven，可使用本机已确认入口：

```bash
/Users/sxie/maven/apache-maven-3.6.3/bin/mvn test
```

矩阵覆盖严格 LF/CRLF/U+2028、逆序 Response ID 关联、成功 accepted+settled、接收前拒绝、accepted 后运行失败、提前退出码和关闭 stdin 后正常退出。它不启动 Pi，也不调用真实 Model。

## 真实 RPC smoke

先构建可执行 jar：

```bash
mvn package
```

再单独运行：

```bash
java -Dpi.command=/opt/homebrew/bin/pi -jar target/pi-study-rpc-java-0.0.0-all.jar
```

程序启动 `pi --mode rpc --no-session --no-approve`，显式选择 `openai/gpt-5.6-sol`，提交一次无 Tool Prompt。通过标准是日志中的 `status=SUCCESS`、`accepted=true`、`settled=true`、`markerSeen=true`、`exitCode=0` 和 `passed=true`。

日志只输出固定状态、事件数量和退出码，不输出凭据、Prompt、Assistant 正文或原始 RPC 记录。一次成功只证明该时间、账号、Model 和固定输入下的 Java 子进程、协议、事件与退出链可用，不证明费用、回答质量、并发 Prompt、长期稳定或生产可用性。
