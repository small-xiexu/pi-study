# 6.1 Package 来源实验

返回[实验总入口](../README.md)。本实验使用 Pi CLI `0.84.2`；CLI 选择方法见总入口的版本说明，不直接使用其他版本的全局 Pi。

本实验卡覆盖 CLI `-e` 本地绝对路径 A/B、Git Branch/temporary 缓存/完整 Commit，以及 npm 精确版本/版本范围的对照行为。实验只使用课程自建、无依赖且无生命周期脚本的 Pi Package、隔离配置、本机文件和仅监听 `127.0.0.1` 的临时 Git/npm 服务；不读取现有认证文件，不请求 Model，不访问外网，也不安装第三方 Package。

## 第一组：本地路径 A/B

### 实验卡

- 真实场景：通过 CLI `-e` 传入同一个本地 Package 绝对路径，把内容从 A 原地改成 B，判断新 Pi 进程是否继续读取旧内容。
- 待验证结论：这条 CLI `-e` 本地绝对路径链直接加载当前磁盘内容；新 Pi 进程不会继续使用旧 A。
- 固定条件：Pi `0.84.2`、同一绝对路径、同一隔离配置根、每次启动新 Pi 进程、无 Session、无 Model 请求、无外网。
- 唯一变量：`local-package/extensions/source-marker.js` 注册的脱敏标记由 A 改为 B。
- A 预期：帮助输出只包含 `PI_STUDY_PACKAGE_A`。
- B 预期：原地切换后，帮助输出只包含 `PI_STUDY_PACKAGE_B`。
- 通过标准：Source 路径不变，A/B 两次输出准确切换，且反向标记不存在。
- 能证明：通过 CLI `-e` 传入的同一本地绝对路径，在新 Pi 进程中加载当前文件内容，没有继续以旧 A 作为加载来源。
- 不能证明：用户 Settings 或项目 Settings 中的本地路径、CLI `-e` 相对路径、同进程热重载、npm/Git 更新、缓存删除、Package 权限隔离或正式分发可复现。

### 操作边界

`switch-local-marker.mjs` 只允许把本课程 fixture 切换为 A 或 B。实验结束后必须恢复 A，并用 Git 差异确认 fixture 没有残留变化。

自动测试会把 fixture 复制到系统临时目录，以同一绝对路径通过 CLI `-e` 分别启动新 Pi 进程执行 A/B，不修改仓库内基线。自动 Green 只证明实验实现和这条真实 Pi CLI 加载链可运行，不能替代学习者亲自观察两次输出。

## 第二组：Git Branch、temporary 缓存与 Commit

### 实验卡

- 真实场景：Git 仓库的 `main` 从 A 前进到 B 后，区分“分支名称可移动”“Pi temporary checkout 是否自动刷新”和“完整 Commit 是否固定”三件事。
- 待验证结论：首次解析 `main` 得 A；远端前进到 B 后，同一 temporary 缓存仍保留 A；新隔离缓存重新解析 `main` 得 B；新隔离缓存解析完整 Commit A 仍得 A。
- 固定条件：Pi `0.84.2`、课程自建无依赖 Package、同一个临时 Git 仓库、只监听 `127.0.0.1` 的 Git daemon、每次使用新 Pi 进程、无 Session、无 Model、无外网。
- 唯一事件：本机 Git 仓库新增 B Commit，并让 `main` 从 Commit A 前进到 Commit B。
- 可观察结果：`branch_before_move=A`、`cached_branch_after_move=A`、`fresh_branch_after_move=B`、`commit_a_after_branch_move=A`。
- 通过标准：A/B 为不同的完整 40 位 SHA，四个标记与预期一致，最终 `result=PASS`。
- 能证明：本次 `main` 在新解析时由 A 变为 B；Pi `0.84.2` 的同一 pinned temporary checkout 不自动刷新；完整 Commit A 在分支前进后仍解析到 A。
- 不能证明：用户/项目 Settings 的安装和更新、Tag 行为、外部 Git 服务、SSH/HTTPS 认证、缓存删除、安全隔离或完整供应链复现。

### 操作边界

运行器只创建系统临时目录，启动仅监听回环地址的临时 Git daemon，并调用真实 Pi `-e --help`。它不读取现有认证文件，不请求 Model，不安装第三方 Package；结束时有界停止 daemon，并只删除自身创建且通过前缀校验的临时根。

Pi `0.84.2` 的裸 `git://` 解析与随包文档存在差异，因此运行器使用 `git:git://127.0.0.1/...` 明确表示 Git Source。该写法是当前版本实验口径，不外推到其他版本。

运行命令：

```bash
node labs/6.1-package-sources/scripts/run-git-source-lab.mjs
```

自动测试：

```bash
node --test labs/6.1-package-sources/test/git-source.test.mjs
```

## 第三组：npm 精确版本与版本范围

### 实验卡

- 真实场景：同一个 npm Package 先发布 A=`1.0.0`，再发布 B=`1.1.0`，判断精确版本和 `^1.0.0` 在显式 Package 更新后的实际结果。
- 待验证结论：两套隔离用户配置初始都安装 A；发布 B 并执行 `pi update --extensions` 后，精确 `1.0.0` 仍为 A，范围 `^1.0.0` 更新到 B。
- 固定条件：Pi `0.84.2`、npm `11.6.2`、课程自建无依赖/无生命周期脚本 tarball、只监听 `127.0.0.1` 的临时 registry、隔离 `HOME`/`PI_CODING_AGENT_DIR`/npm cache、无 Session、无 Model、无外网。
- 唯一事件：registry 在 A 已安装后新增 B=`1.1.0`，并把默认发布目标移到 B。
- 可观察结果：`exact_before_update=A@1.0.0`、`range_before_update=A@1.0.0`、`exact_after_update=A@1.0.0`、`range_after_update=B@1.1.0`。
- 通过标准：隔离 Settings 实际保存精确和范围 Source，帮助标记与安装目录版本一致，四项观察命中预期，最终 `result=PASS`。
- 能证明：本次 Pi `0.84.2` 用户级 install/update 链中，精确版本被跳过更新，版本范围在显式更新时重新选择范围内的 B。
- 不能证明：公共 npm Registry、认证、Tag/无版本 Source、项目 Settings、第三方依赖、生命周期脚本、tarball 永久可用、安全隔离或完整供应链复现。

### 操作边界

运行器在系统临时目录生成 A/B tarball，npm 子进程只继承最小环境并被强制指向回环 registry，同时禁用 lifecycle scripts、audit、fund 和 update notifier。两套用户 Settings、安装目录、`HOME` 和 npm cache 都位于实验临时根；结束后停止 registry，并只删除自身创建且通过前缀校验的临时根。

运行命令：

```bash
node labs/6.1-package-sources/scripts/run-npm-source-lab.mjs
```

自动测试：

```bash
node --test labs/6.1-package-sources/test/npm-source.test.mjs
```

## 未覆盖范围

本卡不覆盖本地 Source 的用户/项目 Settings、本地相对路径、Git Settings/Tag/外部认证、npm Tag/无版本 Source/项目 Settings/公共 Registry、同进程热重载和缓存清理；这些范围需要各自独立的合同与动态证据。

原理见[19 打包安装与资源管理](../../docs/tutorials/19-打包安装与资源管理.md)；本页保留上述实验的具体条件和证据边界。
