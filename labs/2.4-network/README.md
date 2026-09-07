# 2.4 Network 单次请求超时实验

原理：[10 常用设置与配置排查](../../docs/tutorials/10-常用设置与配置排查.md)。返回[实验总入口](../README.md)。

本实验启动真实 Pi CLI 和本机假 Provider，不请求远端模型。脚本未锁定 CLI：优先采用 `PI_BIN`，否则尝试 Homebrew Pi，再查 PATH；运行前核对实际版本，历史结果不等于当前版本已复验。

## 这次要证明什么

只证明一件事：

> `retry.provider.timeoutMs` 可以限制一次 Model 请求等待多久。

它不代表整个 Agent Run 只能运行这么久。一个 Run 还可能继续发起新的 Model 请求、执行 Tool 或重试。

## 用大白话看完整过程

```text
脚本启动一个只监听 127.0.0.1 的假 Provider
                  |
                  v
脚本为 Pi 创建一份临时 models.json 和 settings.json
                  |
                  v
Pi 向假 Provider 发出一次 Model 请求
                  |
                  v
假 Provider 收到请求，但故意一直不回答
                  |
                  v
单次请求超过 400 ms，Pi 报超时并退出
                  |
                  v
脚本检查请求次数、错误原因和安全看门狗，打印 PASS 或 FAIL
```

## 怎么运行

在 `pi-study` 仓库根目录执行：

```bash
node labs/2.4-network/timeout-probe.mjs
```

不需要手工粘贴多行 JavaScript，也不需要先改 Pi 的个人配置。

## 怎么验收

终端应按顺序出现四步：

```text
[1/4] 启动本机假 Provider
[2/4] Pi 发出 Model 请求
[3/4] 假 Provider 收到请求，但故意不响应
[4/4] Pi 进程退出，核对它为什么退出
```

最后四项检查都应为 `PASS`，并显示：

```text
实验结果：PASS
```

其中“Provider 共收到 1 次请求”很重要。它证明本实验同时关闭了 Agent Retry 和 Provider/SDK Retry，没有把自动重试误算成新的实验步骤。

## 安全边界

- 假 Provider 只监听本机 `127.0.0.1`。
- Pi 配置写入系统临时目录，退出时自动删除。
- 子进程不读取当前 Shell 中常见的 API Key、Token 或 Secret 环境变量。
- 模型配置使用固定假 Key `local-dummy-key`。
- 实验不修改 `~/.pi/agent`，也不调用真实 Model Provider。
- 8 秒外层看门狗只是防止实验意外挂住，不属于 Pi 的 Network 配置；如果它介入，实验会显示 `FAIL`。

## 脚本分成哪几块

| 函数 | 职责 |
|---|---|
| `startFakeProvider()` | 启动本机 HTTP 服务，收到请求后故意不回答 |
| `writeJson()` | 把隔离的 Pi 模型目录和超时设置写进临时目录 |
| `runPi()` | 用隔离环境启动一次 Print 模式的 Pi 请求 |
| `printCheck()` | 把每一项验收结果明确打印为 `PASS` 或 `FAIL` |
| `main()` | 按四步组织实验，并在结束后清理临时文件 |
