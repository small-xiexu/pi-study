# Packages、Models 与 Providers

本文是阶段 6 稳定知识的总入口，所有 Pi 行为结论限定到 `0.84.2`。Package、配置、目录、请求、真实 Provider、费用和生产可用性是不同证据；学习状态、Red/Green、失败、纠正与验收历史只见[完整学习计划](../plans/pi-complete-learning-plan.md)。

## 主题地图

| 要解决的问题 | 首选文档 | 文档职责 |
|---|---|---|
| Package 从哪里来、怎样打包、审查、筛选、更新和移除 | [Pi Packages](07-packages-models-providers/packages.md) | Source、Manifest、依赖、制品、安装与管理边界 |
| 应选内置 Provider、`models.json` 还是 Custom Provider；认证值从哪里来 | [Model 选型与认证](07-packages-models-providers/model-selection-auth.md) | 接入决策、Credential、Header、`!command` 与 OAuth |
| `models.json` 怎样形成 Model 并进入一次请求 | [Custom Model 请求链](07-packages-models-providers/custom-model.md) | 配置发现、默认值、组合、认证、API Adapter 与错误定位 |
| 需要运行时代码时怎样注册、流式转换、恢复和注销 | [Custom Provider 运行时合同](07-packages-models-providers/custom-provider.md) | 注册、目录、授权、Stream、Usage、Overflow、Reload 与测试门槛 |
| 随包文档与当前源码哪里不同 | [Pi 0.84.2 版本证据与差异](07-packages-models-providers/version-evidence.md) | 只保存版本化静态契约、差异及不可外推范围 |

## 三种模型接入方式怎么选

先固定同一个任务：用户让 Pi 审查一份 Java 订单代码。业务任务不变，只判断 Pi 怎样找到并调用 Model。

| 当前变化 | 首选入口 | 原因 |
|---|---|---|
| 目标 Model、认证和协议都已被 Pi 支持 | 内置 Provider | 只选择已有 Model，不增加配置或执行代码 |
| 地址或 Model 是新的，但服务兼容 Pi 已支持的 API，声明式配置足够 | `models.json` Custom Model | 复用已有请求编码和流解析，只补连接与 Model 元数据 |
| 登录、刷新、动态目录或协议需要现有机制无法表达的运行逻辑 | Custom Provider Extension | 需要执行代码并注册新的认证、目录或流处理能力 |

能力存在交集时，选择满足需求的最小入口。企业 OAuth 不自动等于 Custom Provider；Custom Provider 也不自动等于自写协议，它可以只处理认证或动态目录并复用内置 API Adapter。

## 推荐阅读顺序

1. 先读 [Pi Packages](07-packages-models-providers/packages.md)，理解一组资源怎样成为可管理制品。
2. 再读 [Model 选型与认证](07-packages-models-providers/model-selection-auth.md)，先决定最小接入入口。
3. 只有需要声明新兼容端点时读 [Custom Model 请求链](07-packages-models-providers/custom-model.md)。
4. 只有需要可执行认证、动态目录或非标准协议时读 [Custom Provider 运行时合同](07-packages-models-providers/custom-provider.md)。
5. 排查当前版本行为或文档矛盾时查 [版本证据与差异](07-packages-models-providers/version-evidence.md)。

## 证据阶梯

| 证据 | 最多能证明 | 不能证明 |
|---|---|---|
| 配置、目录或源码存在 | 对象和分支写在文件中 | Pi 已发现、执行或请求 |
| Fake/Mock | 受控输入下的局部逻辑和错误分支执行 | 真实 Loader、认证、网络或公司服务 |
| 本地真实 Pi | 当前进程完成发现、加载、注册或目录集成 | 真实 Provider 请求、账单或生产稳定性 |
| 全新 Pi 进程 | 旧进程内存没有带过来，当前磁盘来源被重新读取 | Credential、ambient 身份或远端 Token 已清理 |
| 单次真实 Provider 请求 | 该时间、账号、Model 和输入下的认证、网络、协议与响应链成功一次 | 其他输入、并发、限流、费用准确、安全或生产可用性 |
| Provider 账单与生产观测 | 对应账务或生产窗口内的实际结果 | 不能由 Pi 本地 Cost、单次响应或配置声明替代 |

阶段 6 的受控 Package 实验入口统一见 [Pi Packages 的实验材料](07-packages-models-providers/packages.md#实验材料)。6.5-6.8 只形成 Pi `0.84.2` 的稳定概念、公共接口和源码证据，不声称真实认证、Provider 请求、计费或生产可用性。
