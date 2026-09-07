# 6.2 Package 安全审查实验

返回[实验总入口](../README.md)。本实验使用 Pi CLI `0.84.2`；虽无真实模型请求，仍会在临时目录执行课程 Package 的安装脚本和扩展代码。

本实验使用课程自建 npm Package，对照安装期 lifecycle scripts、加载期 Extension、定向 rebuild 和资源过滤。运行器只使用系统临时目录、隔离 Pi/npm 配置和监听 `127.0.0.1` 的临时 Registry；不读取现有认证文件，不请求 Model，不访问外网，也不安装第三方 Package。

## 静态清单

运行器在动态实验前核对实际 tarball：

| 对象 | 预期 |
|---|---|
| 文件 | `package.json`、`scripts/postinstall.mjs`、`extensions/load-marker.js` |
| 四类依赖 | 全部为空 |
| lifecycle scripts | 只有 `postinstall` |
| Pi Extension 入口 | 只有 `./extensions/load-marker.js` |

`postinstall` 只写固定的 `install-marker.txt`；Extension 工厂只递增 `load-count.txt`。两者都要求 marker 目录是绝对路径、位于系统临时目录的 `pi-study-6.2-package-security-` 前缀下且已经存在，否则立即失败。

## A/B/C/D 实验卡

| 组别 | 唯一控制点 | 预期观察 |
|---|---|---|
| A | 默认安装 | install marker 存在；Pi 启动后 load `0 -> 1` |
| B | 安装时启用 `ignore-scripts` | install marker 不存在；Pi 启动后 load 仍为 `0 -> 1` |
| C | 在 B 的实际安装根目录关闭 `ignore-scripts` 并定向 rebuild | 补出 install marker；rebuild 本身不加载 Extension，load 保持 `1 -> 1` |
| D | 在 C 的隔离 Package 配置中设置 `extensions: []`，再启动新 Pi 进程 | install marker 保留；load 保持 `1 -> 1` |

A 使用独立 scope；B、C、D 顺序复用另一套隔离 scope，以便观察“先跳过、再补执行、最后禁用加载”的状态变化。每次运行都会重新创建完整临时环境，结束后停止 Registry 并删除经过前缀校验的实验根。

## 运行

在仓库根目录执行：

```bash
node labs/6.2-package-security/scripts/run-package-security-lab.mjs
```

通过时摘要包含：

```text
network=loopback-only
a_install_marker=true
a_load=0->1
b_install_marker=false
b_load=0->1
c_install_marker=true
c_load=1->1
d_install_marker=true
d_load=1->1
result=PASS
```

自动测试：

```bash
node --test labs/6.2-package-security/test/package-security.test.mjs
```

## 证据边界

本实验只能证明本机 Pi `0.84.2`、npm `11.6.2` 和课程 fixture 的四条受控路径。自动测试只证明实现链可运行，不能替代学习者亲自观察。实验不证明第三方 Package 安全、任意脚本可用或可回滚，也不覆盖真实 Registry/认证/外网、传递依赖、卸载、缓存删除、同进程外部改配置后的 `/reload` 或操作系统级隔离。

原理见[19 打包安装与资源管理](../../docs/tutorials/19-打包安装与资源管理.md)；本页保留上述实验的具体条件和证据边界。
