# ArchVisual 二进制发布包

本目录是 `build_visual.py` 生成、经 `rel_visual.sh` 打包的独立运行产物。
版本见 `version.txt`，压缩包名称中的操作系统和 CPU 架构标识对应构建平台。

## 系统要求与依赖

- 使用与发布包操作系统、CPU 架构匹配的机器。例如 `linux.x86_64` 包面向
  Linux x86-64，不能直接用于 Windows 或 ARM64。
- Linux 的基础系统动态库（如 glibc）需要与构建产物兼容。平台标签不代表所有
  同架构发行版均已验证；最低系统版本应以该发布包的实际验证结果为准。
- 包内已包含运行所需的 Python 运行时、Django、pandas、NumPy、PyTables 等
  Python 依赖。正常使用无需另外安装 Python、pip、Nuitka 或编译器，也无需配置
  Python 环境变量。
- 完整解压并保留目录结构，包括动态库、模板和静态资源；不要只复制可执行文件。
- 解压需要支持 `.tar.bz2` 的工具；下面的 Shell 示例需要 Bash。查看页面需要
  支持 JavaScript 和 Canvas 的桌面浏览器。
- 服务进程需要读取数据文件的权限，以及临时文件、日志目录的写权限。
  内存与磁盘需求随数据规模增加。

## 解压与启动

将下面的包名替换为实际文件名：

```bash
tar -xjf archvisual.VERSION.OS.ARCH.tar.bz2
cd archvisual
./archvisual check
./archvisual runserver 0.0.0.0:8000 --noreload
```

`check` 检查应用配置；启动命令会在当前终端持续运行。`--noreload` 禁用开发环境
使用的自动重载。修改命令中的 `8000` 即可更换端口；前台运行时按 `Ctrl+C` 停止。

如果拿到的是匹配系统的 Windows 发布包，在解压后的 `archvisual` 目录运行：

```powershell
.\archvisual.exe check
.\archvisual.exe runserver 0.0.0.0:8000 --noreload
```

这些命令不构成不同操作系统已通过验收的声明。

## 浏览器访问

- 服务运行在本机：打开 `http://127.0.0.1:8000/`。
- 服务运行在远端：打开 `http://服务器IP或主机名:8000/`，并确保该端口可达。
- `0.0.0.0` 表示监听所有网络接口，是启动参数；浏览器访问时使用实际地址。
- 仅需本机访问时，可将启动参数改为 `127.0.0.1:8000`。

默认使用 Django 开发服务器，面向本机或可信内网的交互分析；当前配置启用了
DEBUG，也没有提供分析数据的访问认证，应在此范围内使用。

## 后台运行与停止（Bash）

在解压目录内启动，保存日志和服务进程 PID：

```bash
mkdir -p __output__
nohup ./archvisual runserver 0.0.0.0:8000 --noreload > __output__/archvisual.log 2>&1 &
echo $! > __output__/archvisual.pid
```

查看日志与停止该进程：

```bash
tail -f __output__/archvisual.log
```

退出日志查看后，或在另一个终端进入同一解压目录执行：

```bash
kill "$(cat __output__/archvisual.pid)"
```

`nohup` 用于后台运行，不提供开机启动或进程故障自动重启。

## 数据与输出目录

- MetricViewer 的 **Load → Local File** 从浏览器所在机器上传 `.csv` / `.h5`；
  **Server File** 读取服务进程所在机器可访问的路径。
- **Load → reload** 更新当前文件并保留已有 Plot；本地文件需要重新选择同名文件。
- Metric H5 的 `data` 是 sample 行、metric 列的 DataFrame；可选 `config.SamplePeriod`
  提供采样周期。CSV 为每个 metric 一行，可包含 `sample` 表头和 `samplePeriod` 行。
- 运行输出默认放在解压目录的 `__output__/`，上传临时文件使用 `__output__/tmp/`。
  若解压目录不可写，可显式指定一个可写的绝对路径（此选项仅控制输出位置）：

  ```bash
  ARCHVISUAL_OUTPUT_ROOT="$HOME/archvisual-output" ./archvisual runserver 0.0.0.0:8000 --noreload
  ```

已加载的数据保存在服务进程内存中，重启后需要重新加载。同一进程的浏览器客户端
共享数据状态；需要独立分析时，分别启动使用不同端口的服务进程。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| `Permission denied` | 检查程序执行权限、文件系统是否允许执行，以及输出目录写权限。必要时执行 `chmod +x ./archvisual`。 |
| `Exec format error` | 核对发布包操作系统与 CPU 架构是否匹配。 |
| `GLIBC_* not found` 或缺少系统动态库 | 使用兼容系统上的发布包，或由维护者在目标系统兼容环境重新构建。安装 Python 包不能解决系统库 ABI 不兼容。 |
| 端口已占用 | 将启动命令中的 `8000` 改为可用端口，并相应修改访问地址。 |
| 本机能访问，远端不能访问 | 核对监听地址、服务器地址、网络连接和防火墙端口配置。 |
| 模板、静态资源或模块缺失 | 重新完整解压发布包，保持所有附带文件，不要单独移动可执行文件。 |
| 加载数据时报写入失败 | 检查输出目录空间和权限，必要时设置 `ARCHVISUAL_OUTPUT_ROOT`。 |

报告问题时请附上 `version.txt` 内容、包名、目标系统/CPU 架构、启动命令和完整错误日志。
