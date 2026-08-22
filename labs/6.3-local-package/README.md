# 6.3 本地 Package 源码与归档等价实验

本实验验证仓库根源码与同一次生成的 npm tarball 解包目录能否发现同一组课程资源，并核对实际发布清单。它不测试 Package 安装、更新、禁用或卸载。

## 实验卡

| 项目 | 内容 |
|---|---|
| A | Package Source 指向仓库根 |
| B | Package Source 指向本轮 tarball 解包根 |
| 固定条件 | Pi `0.84.2`、同一资源内容、同一观察器、两套隔离配置、无 Session/Model/外网 |
| 唯一变量 | Package Source 根目录 |
| 共同预期 | Extension Flag 与 Command、Skill、Prompt、Theme 各命中一次且无诊断 |
| 制品预期 | dry-run 与真实 tarball 清单一致，无 Settings、测试、学习实验、Session、缓存、凭据或 `node_modules` |
| 通过标准 | 静态清单、tarball SHA-256、A/B 资源结果、退出状态和清理全部通过 |

## 自动回归

在仓库根执行：

```bash
node labs/6.3-local-package/scripts/run-package-artifact-lab.mjs
```

最终应看到 `source_*` 与 `archive_*` 五项均为 `1`、`diagnostics=0`、`temp_residuals=0` 和 `result=PASS`。任一资源缺失、重复、出现诊断或 tarball 含越界文件时，运行器以非零状态退出。

该命令会自动完成打包、清单检查、解包和两组资源加载，只用于验证实验实现；学习者启动它并看到 PASS，不等于已经亲手理解每一步。

## 逐步手工验收

在完整源码仓库中按顺序操作，每一步都先观察原始结果，再进入下一步：

1. 读取根 `package.json` 的 `name`、`version`、`files` 和 `pi`，区分 Package 身份、发布白名单与资源入口。
2. 运行 `npm pack --dry-run --ignore-scripts --offline --json`，核对 npm 实际选择的文件，但不生成 tarball。
3. 用 `mktemp -d` 创建独立目录，再运行真实 `npm pack --ignore-scripts --offline --pack-destination <dir>`；核对退出状态、文件大小与 SHA-256。
4. 用 `tar -tzf` 查看归档内部路径并计数，确认只有预期的 `19` 个文件；再解包到另一独立临时目录。
5. 用 `cmp` 比较源码根与解包根的 `package.json`，确认本轮归档中的 Manifest 与打包源一致。
6. 为源码根和解包根分别创建新的隔离 `PI_CODING_AGENT_DIR`，各启动一个新的 `pi -e <root>` 进程；先观察 Extension Flag，再在 TUI 中核对 Extension、Skill、Prompt 和 Theme。
7. 正常退出 Pi，只删除本轮两个精确临时根，并确认没有课程临时目录残留。

手工验收证明的是“本机当前源码经过本轮打包后仍能被 Pi 发现为同一组资源”。它不证明真实发布、外部安装、任意环境兼容性或 Package 安全性。

## 安全边界

- npm 与 Pi 使用隔离 `HOME`、cache、Settings 和工作目录；Pi 设置 `PI_OFFLINE=1`。
- npm Registry 固定为不可达的本机回环地址并开启 offline；publish 只执行 `--dry-run`，所有 npm lifecycle scripts 均禁用。
- 真实 tarball 只写入系统临时目录，检查后删除；不写用户或项目 Settings，不保留 Package 缓存。
- 实验不读取现有认证文件，不调用 Model，不发布 Registry，不推送 Git，也不安装第三方 Package。
- PASS 只证明本机 Pi/npm 当前版本与本次制品的受控链路，不重新证明阶段 4-5 全部行为、真实发布、其他环境或安全隔离。

稳定原理和证据边界见 [`docs/learning/07-packages-models-providers.md`](../../docs/learning/07-packages-models-providers.md)。
