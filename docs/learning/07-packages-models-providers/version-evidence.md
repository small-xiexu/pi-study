# Pi 0.84.2 版本证据与差异

本页集中保存 Pi `0.84.2` 随包文档、公共类型和当前源码之间需要同时保留的差异，以及这些静态证据不能外推的行为。运行历史和学习状态只见[完整学习计划](../../plans/pi-complete-learning-plan.md)；阶段 6 总览见[Packages、Models 与 Providers](../07-packages-models-providers.md)。

## 证据类型与边界

- Pi `0.84.2` 的 `custom-provider.md`、Extension 公共类型和 pi-ai `Provider`/事件类型支持完整 Provider 与 ProviderConfig 两种注册形态、动态目录、认证、流事件和注销接口；ModelRuntime、Extension Loader/Runner 与 Agent Core 源码支持初始排队、绑定后立即生效、Provider 重组、请求路由和终态处理。这些是静态契约，不证明某个实现运行正确。
- 当前源码显示 `unregisterProvider()` 不删除 CredentialStore，`/reload` 也不自动清空 ModelRuntime 的 Extension Provider Map；因此凭据删除、远端撤销、Reload 清理和当前 Model 重选必须分别验证。该结论限定于 Pi `0.84.2` 当前制品，未来版本需重查。
- `streamSimple` 公共类型要求发送前调用 `onPayload` 并采用替换 payload，收到响应后且读取 body 前调用 `onResponse`；随包自定义流示例未完整展示这两个钩子。忽略它们会破坏其他 Extension 的 Provider 请求观察或改写合同。
- 当前 ProviderConfig 文档把定义 Model 时的 `apiKey` 写成除 OAuth 外必需，组合源码则允许后续 `/login`、存储凭据或 CLI Key；Custom Provider 文档又把 Overflow 主要描述为错误文案匹配，源码还使用成功/截断终态、Usage 与 Context Window。课程保留这些 Pi `0.84.2` 差异并按请求源码解释实际行为。
- Pi `0.84.2` 随包 `models.md` 和 `model-config.js` 支持 Provider/Model 字段、四类声明式 API、Schema 校验及 Model 默认值；`provider-composer.js`、`model-runtime.js` 和 `pi-ai` API registry 支持配置组合、认证/Header 准备、按 API 路由和流处理调用链。它们是静态契约证据，不证明用户配置、端点、协议或真实能力。
- 当前 `models.md` 的 Model 字段表遗漏源码支持的 Model 级 `baseUrl`/`headers`，且其 Custom Model 与 `modelOverrides` 顺序说明和 `provider-composer.js` 的非 Header 字段实现相反；Header 又使用独立的请求期合并顺序。课程按 Pi `0.84.2` 当前源码记录实际行为，并保留文档差异；未来版本必须重新核对。
- Pi `0.84.2` 随包 `providers.md` 把认证顺序写成 CLI、`auth.json`、环境变量、`models.json` Key；当前 `runtime-credentials.js`、`pi-ai` 的 `auth/resolve.js` 和 `provider-composer.js` 实现的请求顺序则是运行时覆盖、存储凭据、Extension/`models.json` 配置 Key、最后才是内置 ambient/env 认证。该差异是当前制品的静态版本证据，不证明未来版本仍保持此行为。
- `resolve-config-value.js`、`auth-storage.js`、`model-runtime.js` 和随包 `models.md` 支持 `$ENV`、字面值、转义、`!command` 及两类命令执行/缓存边界：认证存储命令可能在可用性刷新读取凭据时执行并使用进程缓存，Provider 配置命令只在请求时执行且不缓存。`pi-ai` 的 `auth/resolve.js` 支持请求路径 OAuth 的五分钟窗口、带锁复查、十五秒刷新超时与持久化顺序。课程未读取凭据、执行命令、登录或调用 Provider，因此不证明任何真实认证结果。
- Pi `0.84.2` 随包 `providers.md` 明确区分：兼容受支持 API 的新 Provider 可通过 `models.json` 声明；需要自定义 API 实现或 OAuth 流程时使用 Extension。该文档结论不能替代某个真实服务的协议、认证或运行验证。
- Pi `0.84.2` 随包 `models.md` 记录四类受支持 API、内置 Provider 覆盖和 Model 合并规则；`custom-provider.md` 记录 `registerProvider()`、动态 Model 发现、自定义认证与非标准流处理入口。必要源码进一步确认内置目录、`models.json` 和 Extension 注册层会组合进同一 Model Runtime，并按 Model 的 API 路由到现有适配器或自定义流处理器。这些均为当前版本静态证据，不证明真实 Provider、认证、请求、计费或生产可用性。
- Pi `0.84.2` 随包 `docs/packages.md`、`dist/core/package-manager.js` 和 `dist/utils/git.js` 属于静态证据，可支持本版本的 Source 身份、解析目录和更新分支；它们不能证明某次运行已经经过这些分支。
- Pi `0.84.2` 的 `package-manager-cli.js`、`config-selector.js`、`resource-loader.js`、`agent-session-services.js` 和随包 `docs/extensions.md` 属于静态证据，可支持 `pi config` 切换时写入配置、`Esc` 关闭选择器、`/reload` 重建 Extension runtime 及 shutdown/reload 顺序；它们不能证明某个第三方 Extension 已正确清理副作用。
- 本机 npm `11.6.2` 的 `npm-rebuild` 文档属于静态证据，可支持 rebuild 补跑 lifecycle scripts 的命令语义；它本身不能证明具体 Package 的脚本可用、安全、幂等或可回滚。

本页只保存版本化静态契约与差异，不记录学习者执行时间线、当前进度或下一步。
