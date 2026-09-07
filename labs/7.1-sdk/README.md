# 7.1 SDK Agent Session 实验

原理：[22 使用 SDK 提交与控制任务](../../docs/tutorials/22-使用SDK提交与控制任务.md)。返回[实验总入口](../README.md)。

运行边界：`check` 不调用 Provider；`demo` 是使用现有认证的真实模型入口，可能产生费用，须单独确认。安装依赖与运行测试是两个动作，依赖已准备时直接运行 `check`。

本实验用 Pi SDK `0.84.2` 创建内存 `AgentSession`，通过 `DefaultResourceLoader` 发现当前仓库资源，显式选择 `openai/gpt-5.6-sol`，只开放 `read`，并订阅脱敏事件。真实 Model 读取专用 fixture 后返回固定 marker。

## Java 对照

| TypeScript / Pi | Java 类比 |
|---|---|
| npm 依赖 | Maven 依赖 |
| `createAgentSession()` | 工厂组装有状态服务 |
| `DefaultResourceLoader` | 启动期配置与插件扫描器 |
| `ModelRuntime` | 下游客户端目录、认证入口和路由器 |
| `subscribe()` | 注册 Listener |
| `SessionManager.inMemory()` | 只在进程内保存的会话 Repository |

## 固定条件

- 工作目录是仓库根，确保项目 `AGENTS.md` 可被发现。
- 使用内存 Session，不创建 Session JSONL。
- 只开放 `read`，fixture 为 `labs/7.1-sdk/fixture.txt`。
- 禁用项目 Extension 执行，避免安全门禁或 UI 行为干扰本次 SDK 主线；Skill、Prompt、Theme 和 Context File 仍按加载器规则发现。
- 禁用自动重试和 Compaction，使正常事件顺序保持单一。
- 不读取或输出 `auth.json`、`models.json` 内容；SDK 只通过默认运行时解析现有配置。

## 安装与自动验证

```bash
cd labs/7.1-sdk
npm install
npm run check
```

自动验证只证明类型、脱敏投影和预期事件契约检查函数，不调用 Provider。

## 真实 Model 实验

```bash
cd labs/7.1-sdk
npm run demo
```

预期输出由三类 JSONL 记录组成：

- `resources`：只显示资源数量和项目 `AGENTS.md` 是否发现。
- `model`：只显示 Provider、Model、API 和 Thinking Level。
- `event`：只显示事件序号、类型、角色、增量类型、Tool 名称和终态，不显示 Prompt、Tool 参数或消息正文。
- `result`：显示固定 fixture marker、消息/事件数量和契约偏差。

通过标准：项目 `AGENTS.md` 已发现；显式选择 `openai/gpt-5.6-sol`；`read` 恰好执行一次且成功；至少出现两个 Turn；`agent_end` 后出现 `agent_settled`；最终回答包含 `SDK_REAL_MODEL_MARKER_7101`；契约偏差为空。

一次通过最多证明该时间、账号、Model 和输入下的资源发现、认证、网络、协议、单次 `read` Tool Loop、事件订阅和响应链成功。它不证明任意资源都能加载、其他 Tool 安全、账单准确、长期稳定、回答质量或生产可用性。
