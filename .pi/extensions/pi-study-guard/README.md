# Extension 实验材料

这个目录保存可检查的开发骨架，不实现业务 Tool 或 Handler。5.1 的当前状态、学习验收和下一步只见 [`docs/plans/pi-complete-learning-plan.md`](../../../docs/plans/pi-complete-learning-plan.md)。

- `index.ts`：当前项目自动发现的最小 `pi-study-guard`，只注册 `--pi-study-guard`。
- `test/factory.test.ts`：用只实现 `registerFlag` 的 Fake API 验证工厂登记行为。
- `fixtures/loading/*.ts`：A-F 隔离实验使用的来源探针；它们位于自动发现深度之外，不会被当前项目自动加载。
- `fixtures/loading/reload.ts`：仅在设置 `PI_STUDY_RELOAD_MARKER` 时，向操作系统临时目录中的固定文件名追加 `V1`；不启动进程、Socket、Watcher 或 Timer。

依赖全部是开发依赖：Pi 包提供官方类型，TypeScript 负责 `noEmit` 检查，`@types/node` 提供 Node API 类型。运行时的 `ExtensionAPI` 仍由 Pi 宿主传入。

依赖清单和锁文件完成审计后，安装证据对应的命令是：

```bash
npm ci --ignore-scripts --omit=optional --audit=false --fund=false
```

安装命令要求 npm 跳过生命周期脚本并省略 optional 包，但这不证明依赖本身安全。安装后分别运行：

```bash
npm run typecheck
npm test
```

初始类型检查被 Pi 传递依赖声明文件中的模块解析和 JSON import 错误挡住。当前配置启用 `skipLibCheck`；它只跳过依赖声明文件的内部检查，仍使用公开类型检查本项目源码。

已保存的类型检查 Green/Red/Green 证据为：正常源码通过；把本项目字符串常量临时赋值为数字后，`tsc` 报告 `TS2322`；把 `registerFlag` 的字符串名称临时改为数字后，Pi 公开签名触发 `TS2345`；两次受控错误恢复后，`npm run check` 通过且 Fake API 测试为 1/1。

这些结果只证明当前 TypeScript 配置和 Fake API 测试覆盖的局部行为，不证明真实 Pi 的来源、Trust、去重、热重载或用户理解。A-F 的运行与验收状态不在本文件维护。
