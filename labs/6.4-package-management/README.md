# 6.4 Package 管理实验

本实验在隔离环境中管理 6.3 的 `pi-study-workbench` Package，分别观察 Settings、Pi 受管理安装内容和新一轮资源发现。它使用只监听 `127.0.0.1` 的临时 npm Registry，不读取真实用户 Settings 或认证，不请求 Model，不访问外网，也不发布 Package。

## 逐步手工教学

学习验收使用 guided 入口。它只准备 A/B 归档、回环 Registry、隔离 HOME、`PI_CODING_AGENT_DIR`、npm cache 和临时项目，不代替学习者执行任何 `install`、`list`、`config`、`update` 或 `remove`：

```bash
node labs/6.4-package-management/scripts/run-package-management-lab.mjs --guided
```

看到 `guided_status=READY` 后保持该终端运行。输出中的 `env_file` 是权限为 `0600` 的临时环境文件；在另一个终端加载它后，所有后续 Pi 管理命令都会指向本次隔离环境。课程每次只给出一条原生命令，并在继续前分别核对：

1. Settings 是否记录 Source。
2. Pi 受管理安装目录是否存在。
3. 新一轮 Pi 进程是否发现对应资源。

需要让范围版本看到 B 时，在运行 guided 的第一个终端输入 `publish-b`；它只改变回环 Registry 提供的版本，不执行更新。实验结束时在第一个终端输入 `quit`，运行器会停止 Registry 并删除本次临时根。若中途停止，也应回到第一个终端用 `quit` 或 `Ctrl+C` 触发清理，并关闭加载过临时环境的第二个终端。

`guided_status=READY` 只证明隔离环境准备完成，`management_commands=0` 只证明运行器没有代做管理动作；它们不证明任何 Package 已经安装、更新或移除。

## 自动管理矩阵

在仓库根目录执行：

```bash
node labs/6.4-package-management/scripts/run-package-management-lab.mjs
```

运行器把当前 `0.1.0` 归档作为 A，只在系统临时目录生成 `0.1.1` 的 B，并在隔离用户目录和临时项目中依次验证：

| 步骤 | Settings | 受管理内容 | 新一轮资源发现 |
|---|---|---|---|
| 用户级安装 A | 用户级 Source 存在 | 用户级 A 存在 | 四类资源可发现 |
| 项目级安装 A | 用户级、项目级 Source 都存在 | 两级 A 都存在 | 项目普通项优先 |
| 普通筛选 | 项目项依次写入空数组、排除、精确加回、精确排除 | 不删除 | Extension 按 `0 -> 1 -> 0` 变化，其他资源保留 |
| 项目 delta | 用户级 Source 保留，项目项为 `autoload:false` | 项目安装内容已移除 | 空 delta 不改变继承结果，`-path` 只禁用目标 Extension |
| 范围更新 | 用户级 Source 仍为 `^0.1.0` | 用户级 A 更新为 B | B 的资源可发现，项目 delta 仍可禁用目标 Extension |
| 两级移除 | 先移除项目项，再移除用户项 | 对应安装内容分别消失 | 最终四类资源都不可发现 |
| 重装 | 用户级 Source 恢复 | 用户级 B 恢复 | 四类资源恢复 |

通过时摘要应包含 `user_install=A@0.1.0`、`ordinary_precedence=0->1->0`、`update=0.1.0->0.1.1`、两级 `remove` 结果、`temp_residuals=0` 和 `result=PASS`。

自动测试：

```bash
node --test labs/6.4-package-management/test/package-management.test.mjs
```

自动矩阵通过结构化接口写入隔离项目 Settings，以便稳定覆盖所有筛选分支；它没有证明学习者亲自操作过 `pi config` TUI。

## 独立 `pi config` TUI 回归

完成自动矩阵观察后，另行执行：

```bash
node labs/6.4-package-management/scripts/run-package-management-lab.mjs --config-tui
```

运行器会先在新的隔离用户级 scope 安装 A，然后打开真实 `pi config -l --approve`：

1. 直接输入 `pi-study-guard`，筛选到课程 Extension。
2. 确认顶部为 `Project Local Resources`；`-l` 已直接进入项目模式，无需按 `Tab`。
3. 按一次 `Space`，把继承的启用状态切换为项目级 `-`。
4. 设置在切换时已经写入；按 `Esc` 关闭，不要按 `Ctrl+C`。

退出后，运行器会验证项目 Settings 写入 `autoload:false` delta，并确认新的资源解析只禁用 Extension、仍保留 Skill、Prompt 和 Theme。通过时最终显示 `project_autoload=false`、`resources=extension:0,other:3`、`temp_residuals=0` 和 `result=PASS`。

## 证据边界

- 三个入口每次都创建并删除独立的 `HOME`、`PI_CODING_AGENT_DIR`、npm cache、临时项目和 Registry；不修改真实用户或当前仓库的 Pi Settings。
- npm lifecycle scripts 被禁用；实验只安装当前仓库打出的课程归档，不安装第三方 Package。
- 自动测试证明实现链和本机 Pi `0.84.2` 管理行为可运行，不替代学习者亲自执行。
- `--config-tui` 的 PASS 只证明本次隔离项目中的真实 TUI 写入与后续资源解析；不证明当前已运行的其他 Pi 进程会立即卸载 Extension。
- 移除后的 Settings、受管理路径与资源结果在本次实验中分别核对；这不证明共享 npm 缓存、Package 目录外副作用、真实 Registry、认证、其他版本或通用安全性。

稳定原理和证据边界见 [`docs/learning/07-packages-models-providers.md`](../../docs/learning/07-packages-models-providers.md)。
