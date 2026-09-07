# 7.2 SDK 控制面实验

原理：[22 使用 SDK 提交与控制任务](../../docs/tutorials/22-使用SDK提交与控制任务.md)。返回[实验总入口](../README.md)。

运行边界：`check` 使用脚本 Provider 和 Fetch 替身，不调用真实 Provider；`real` 使用现有认证并调用真实模型，可能产生费用，须单独确认。依赖已按锁文件准备时直接运行 `check`，不要把安装和真实入口当作自动后续步骤。

本 Lab 验证 Pi SDK `0.84.2` 的 Tool 限制、协作取消、Provider/Agent Retry、Steering/Follow-up、Compaction Context 和 Session JSONL 恢复。最终验收采用“真实 Model 主线 + 本地故障注入 + 纯状态检查”三类证据，三者不互相冒充。

## 自动矩阵

```bash
cd labs/7.2-sdk-controls
npm install
npm run check
```

自动矩阵执行严格 TypeScript 检查并覆盖以下场景；实际通过结果与历史证据统一记录在学习计划：

- Tool 集合：检查 allowlist、denylist 和 `noTools`。
- 取消：脚本 Provider 触发协作延迟 Tool，验证 AbortSignal、无晚完成和 settled。
- 队列：受控 Tool 固定排队窗口，验证 Steering 先于 Follow-up。
- Provider Retry：OpenAI-compatible 本地 Fetch 前两次返回 503，第三次返回固定 SSE。
- Agent Retry：脚本 Provider 前两次返回可重试错误，第三次成功。
- Compaction/Session：临时 JSONL 写入固定 Summary 和近期 Entry，再 open/continueRecent 重建 Context。
- 凭据隔离：临时子进程中的默认 Runtime 能看到虚构磁盘认证，脚本 Runtime 的凭据列表保持为空，仍能完成固定响应；样本内容不变，结束后清理。

`test-runtime.ts` 显式注入 `InMemoryCredentialStore`，不采用默认认证文件。Pi `0.84.2` 下现有 `modelsPath: null` 已采用内存目录缓存，`refreshOnCreate: false` 跳过创建时刷新。内存凭据不等于隔离全部环境变量或阻断网络；测试的无真实请求来自选定的脚本和 Fetch 替身。

这些结果证明 SDK 控制逻辑和测试夹具行为，不证明真实 Provider 的故障、延迟或稳定性。

## 真实 Model 主线

自动矩阵 Green 后，工程验证与学习者复现各执行一次：

```bash
npm run real
```

真实入口使用当前 `openai/gpt-5.6-sol`：先让 Model 调用协作延迟 Tool 并执行 `abort()`，再通过受控 Gate 固定 Steering/Follow-up 入队窗口，随后调用真实 Model 生成手动 Compaction Summary，关闭并重新打开临时 JSONL Session，最后提交恢复后 Prompt。凭据内容不读取、不输出；日志只包含 Provider/Model 和布尔验收结果；Session 只写 `mkdtemp` 专用目录并在 `finally` 清理。

两次结果一致：取消信号已被 Tool 观察、无晚完成、Session 已 settled；Steering 先于 Follow-up、队列归零；真实 Compaction Summary 已生成并进入重开后的 Context；恢复后 Model 返回固定 marker；Session 文件跨关闭/重开保持同一，最终 `passed=true`。

真实 Model 是否按 Prompt 调用指定 Tool 是运行证据的一部分；失败时不得把同一真实请求盲目重跑。精确 Retry 失败次数只由自动矩阵证明，不能冒充真实 Provider 故障。本次成功也不证明费用、回答质量、长期稳定、副作用回滚或生产可用性。
