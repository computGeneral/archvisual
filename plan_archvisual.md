# ArchVisual MetricViewer Heat mode 实现与验收

## 用户批准与当前状态

- 2026-11-02：用户 review 实现方案后明确回复“同意方案，开始实现”。
- 设计边界见 [spec_archvisual.md](spec_archvisual.md)。
- 已实施：Heat 模式、逐 sample 方格、独立原始数据、统一/逐行色标、无效数值标记、双向滚动、Line/Heat 切换及双面板状态隔离。
- 2026-11-03 多次 Plot 方案已获用户确认并实施：按次追加独立热力图、同面板横轴联动、各图独立色标；该轮最终验收与证据见“Heat 多次 Plot 纵向追加独立热力图”。
- 初版验收：已完成。Django 检查、11 项后端测试、4 项 JavaScript 数据测试通过；重启验收服务后，初版源码的完整浏览器验收通过，包括真实 replay H5、本地上传、双面板、过期响应隔离和加载文件前的空状态操作。后续 UI 调整的当前结果见下节。
- 尚未提交；`archvisual/` 是独立 Git 子模块，本次修改仅限本功能文件。根目录已有其他会话修改不纳入本任务。

## 验收命令与证据

所有 Python 命令在 `scripts/shared_env.sh` 选择 repo-root `.venv/bin/python` 并持有共享环境锁后运行。

```bash
.venv/bin/python -B archvisual/archvisual.py check
.venv/bin/python -B archvisual/archvisual.py test dataviewer --noinput
node archvisual/dataviewer/test_metric_heat.cjs
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

保留原 MetricViewer 模板的 CRLF 行尾，diff 检查显式识别该行尾形式，不修改子模块 Git 配置。

本次输出目录：`__output__/archvisual/heat_mode_ejm3cirg/`。

- `before/`：修改前的文件副本；`head.txt`：开始时父仓库 HEAD。
- `fixtures/`：60 个端口指标 × 2,000 个 sample，以及零值、常量、缺失值、单 sample 和乱序字符串标签数据。
- `browser-smoke.cjs`：本机无头 Chrome 浏览器验收脚本；Browser 技能连接后报告无可用浏览器，因此使用现有本机 Chrome 与 Playwright，无新增依赖。
- `browser-result.json`、`heat-*.png`：最近一次成功浏览器验收结果和截图。
- `browser-first-attempt.*`：首次脚本定位文件名时遗漏文件图标前缀，未进入 H5 加载，保留失败证据；修正定位后首轮验收通过。
- `browser-second-attempt.*`：扩展验收时文件浏览器的初次目录响应与跳转目录请求竞争；脚本改为等待初次目录加载完成后导航，不据此宣称真实 H5 已通过。
- `browser-layout-attempt.*`：扩展验收捕获 ECharts tooltip 的异步回调引用已销毁 HTML 元素；修复为复用 tooltip 组件，并在重绘前隐藏悬停提示。修复后完整重跑通过，不屏蔽前端异常。
- `django-check.log`、`django-tests.log`、`js-tests.log`、`diff-check.log`：当前检查输出。
- `replay-expected.json`：从真实 replay H5 读取的四个非零请求字节计数实例及完整 15 个 sample 序列。
- `checks.json`、`final-check-*.log`：最终命令及退出码，全部为 0；`source-files.json`、`archvisual.patch`：本次文件哈希及子模块改动。
- 空状态扩展检查曾使用 Django 缓存的旧模板，第二面板尚无 Line 图表实例时触发错误；当前代码已保护该路径，停止并重建验收服务后完整重跑通过。该失败保存在 `browser-failure.*`，成功结果单独保存在 `browser-result.json`。

## 已验证的行为

- 真实输入：`__output__/perfmodel/replay_smoke_a2.0_verified_20261102_xLoSfa/replay_smoke_perf_metric_a2.0_s100.h5`。
- 完整核对 `SPC0_L2I_R_REQ_BYTES`、`SPC0_FSP0_L1S_R_REQ_BYTES`、`SPC0_FSP0_L1V_R_REQ_BYTES`、`SPC0_FSP0_L1I_R_REQ_BYTES` 四个具体计数实例的 15 个 sample，共 60 个单元格。原值精确相等，不使用容差、跨实例求和或排除 sample。
- 60 行 × 2,000 列数据的当前可见窗口原值核对、24×24 像素方格、双向滚动、固定全序列色标、逐行归一化、显式颜色上下限、缺失值与零值区分。
- Line/Heat 指标和 sample 范围往返保留；删除行后再切换不会恢复该行；重新加载使用新数据，缺失指标在状态栏报告。
- 单 sample、常量值、字符串 sample 标签、sample 原顺序、左右/上下分屏、嵌入布局、真实悬停 tooltip、本地 H5 上传。
- 连续 Plot 请求合并待绘指标；人为延迟的旧查询响应到达后，不能覆盖较新的选择结果。
- 第一、第二面板均验证了加载文件前的 Heat → Clear → Line → Heat 操作，无前端异常。
- 没有运行与本功能无关的 perfmodel、funcmodel 或框架全量回归。

## Heat 子面板状态与控制栏位置调整（2026-11-02）

- 用户要求 Heat 模式的状态/控制栏放入子页面，避免占用主页面顶部。已完成，无剩余阻塞。
- 将全局 Heat 控制栏替换为子面板内的独立控件实例；状态信息也保留于子面板内。移除主页面因 Heat 模式产生的额外高度。控件回调直接绑定所属面板，焦点进入该控件时激活对应面板。
- 保留之前要求的 UI 微调：Line/Heat 菜单前不显示 Mode 字样，下拉箭头使用与 Load 一致的 `▾`。
- 当时的浏览器验收：30 项检查通过，前端异常和对话框均为 0。包括两侧 Heat 工具栏同时可见、操作非活动面板的控件、两侧独立色标/格子大小、混合 Line/Heat 工具栏可见性及主页面内容顶部坐标不变；同时重新通过原有 Heat 浏览器验收与真实 replay H5 逐格核对。该轮未充分覆盖普通滚动条及持续布局稳定性，用户随后反馈闪烁，不能以该 PASS 证明无闪烁。
- 证据：`__output__/archvisual/heat_panel_controls_h1z6mezn/`，包含修改前快照、浏览器脚本、`browser-result.json`、`heat-panel-controls.png`、上下分屏与嵌入布局截图。该目录与初版验收证据分开保存。
- 本次没有修改数据读取接口、计数计算、归一化算法或原始采样值。

## Heat 子面板闪烁与尺寸反馈修复（2026-11-02）

- 用户报告子面板持续闪烁抖动，并要求继续检查。已确认 ResizeObserver 回调直接同步重绘，且滚动时无条件执行 ECharts resize/setOption；普通滚动条环境下捕获实际 `ResizeObserver loop completed with undelivered notifications.` 警告。持续空闲抖动在本机未按用户环境完整复现，不能将该警告等同于所有浏览器上的唯一原因。
- 修复：ResizeObserver/scroll 合并到下一动画帧；尺寸与可见内容未变时不修改图表；图表只在尺寸改变时 resize；按实际内容区尺寸向下取整，避免小数像素溢出；为滚动区域保留滚动条空间并隔离子内容尺寸，裁剪画布溢出。Heat JS 缓存版本更新为 `v=2`。
- 当前验证：已完成。108 组普通滚动条/单面板/左右与上下分屏/小数尺寸/长标签悬停场景，修复后 ResizeObserver 警告为 0，空闲 resize 与重绘均为 0。独立的 20 项浏览器稳定性回归通过，包含单面板及 tooltip 各 5 秒的静置观察；原有 30 项完整 Heat 交互回归重新通过，实际 replay H5 的 60 个单元格仍精确对应原值。Django check、4 项 JavaScript 数据测试与语法/差异检查通过。
- 新增持久回归入口：`archvisual/dataviewer/test_heat_stability.cjs`，使用真实示例 H5、普通滚动条，并断言空闲与无变化滚动通知不触发 resize/重绘，真实滚动仍更新数据，tooltip 保持稳定。
- 负对照：用修改前的 Heat JS 替换测试浏览器中的资源，回归正确失败于 `unchanged viewport must not repaint or resize`；源码未回退，失败仅发生于独立负对照浏览器。
- 证据目录：`__output__/archvisual/heat_stability_uejyn6jn/`。`before-*.json`、`after-*.json`、`probe-comparison.json` 保存前后布局测量；`regression-final/stability-result.json` 保存最终稳定性 PASS；`browser-result.json` 保存完整 Heat 功能 PASS；`negative/` 保存负对照 FAIL；`result.json` 汇总当前结果。修改尚未提交。

## Heat 子面板 ArchToy 水印（2026-11-03）

- 用户要求 Heat 页面也显示 ArchToy 水印。当时实施：复用现有水印的字体、字重和透明度，在每个 Heat 画布内居中显示，窄视口缩小字号；使用绝对定位及 `pointer-events:none`。该方案已被下节的透明背景方案替代，历史验收仅对应当时实现。
- 浏览器验证通过：单面板和左右分屏均可见，Line 的原水印保留，1 秒空闲观察中额外重绘为 0，前端异常为 0；模板差异检查通过。
- 证据：`__output__/archvisual/heat_watermark_zy9vkb_u/`，包含修改前模板、单面板/分屏截图及 `result.json`。本次实现仅调整模板 CSS。

## Heat 透明背景与原始页面水印（2026-11-03）

- 用户指出子状态/控制栏使 Heat 独立水印看起来下移或缩小，提出通过透明背景直接显示原页面水印。已完成，无剩余阻塞。
- 将 `.heat-viewport` 背景改为透明，移除 `.heat-canvas::after` 独立水印；直接显示原有 `body::after` 的 ArchToy 水印，保留相对于整个浏览器视口居中的位置和 120px 字号，不再由 Heat 子控制栏或分屏宽度决定水印布局。
- 当前定向浏览器验收通过：加载真实示例 H5，单面板、左右分屏和上下分屏中，Heat 绘图区域及其祖先元素背景透明、画布空白像素 alpha 为 0、无重复水印；原页面水印的样式和位置与 Line 模式一致。每种布局静置 1 秒均无额外重绘，前端异常为 0。模板差异检查通过。
- 本次只修改模板 CSS，未重复运行后端测试或完整 Heat 功能回归；不以历史 PASS 作为本次全量验收。
- 证据：`__output__/archvisual/heat_transparent_jqnom5f5/`，包含修改前模板、临时验收脚本 `verify.cjs`、`result.json` 和三种布局截图。修改尚未提交。

## Heat Color 选项命名调整（2026-11-03）

- 用户明确批准将 `Shared raw values` 改名为 `Shared raw scale`，将 `Per metric [0,1]` 改名为 `Per-metric normalized`。已完成菜单与 README 中的对应说明更新。
- 此次仅替换显示文字，选项值仍为 `raw` / `row`，数据与颜色映射算法保持原样。此前讨论的按 2× 步进时间聚合功能已由用户明确暂时放弃，未实施。
- 当前定向检查通过：两个文件均精确执行上述两处文字替换，保留原始行尾，模板选项值正确；子模块差异检查通过。本次为文字调整，未运行完整浏览器或后端回归。
- 证据：`__output__/archvisual/heat_color_labels_x7mzxu_u/`，保存修改前文件与 `result.json`。修改尚未提交。

## Line/Heat 选择菜单位置调整（2026-11-03）

- 用户要求将 Line/Heat 选择菜单放在 View 按钮右侧。已完成：主工具栏顺序为 `View → Line/Heat → Load → Templ`。
- 仅移动原有菜单 HTML，保留菜单样式、统一下拉箭头及原有事件绑定；字节核对确认模板其他内容未变。
- 当前浏览器定向检查通过：菜单顺序及同一行对齐正确，View 与 Load 菜单可打开，View 分屏操作与 Line/Heat 切换正常，前端异常为 0；模板差异检查通过。此次布局调整未运行完整功能回归。
- 证据：`__output__/archvisual/heat_menu_position_433hpc2r/`，保存修改前模板、工具栏截图 `toolbar.png` 和 `result.json`。修改尚未提交。

## ASGI 入口首行引号修复（2026-11-03）

- 用户指出 `visualizer/asgi.py` 首行缺失一个双引号，阻断 ASGI 部署入口；这一错误不能据此
  推断 WSGI 开发服务器也会失败。已按该影响范围修复，无剩余阻塞。
- 修复前实际语法解析报 `SyntaxError: unterminated triple-quoted string literal`；错误定位
  指向后续文档字符串，根因是首行引号不完整。本次仅在文件开头补入一个双引号，其余字节不变。
- 当前验证通过：ASGI 源码语法解析、ASGI application 导入、WSGI application 导入、Django
  `check` 与文件差异检查。未进行真实 ASGI 服务部署或新的 WSGI HTTP 请求测试；先前开发服务器
  验证仅对应其实际 WSGI 通路，不作为 ASGI 部署验证。
- 证据：`__output__/archvisual/asgi_quote_5wzotols/`，包含修改前源码及 `result.json`。修改尚未提交。

## TraceViewer 键盘平移与双视图同步检查（2026-11-03）

- 用户要求检查当前版本的 A/D 平移与父页面同步，随后澄清：所提供的是当前版本的问题描述，
  离线版本已经修复。此前将该描述误读为离线修改引入错误，现予更正；未取得离线修复源码，
  不评价其具体改动。当前工作树与当前子模块 HEAD 均不含小写 `viewwidth`，但存在下述
  `viewWidth` 未定义及平移未通知父页面的实际问题。本次未修改生产源码。
- 已确认的问题：`catapult_trace_viewer.js:12763` 中小写 a/d/e 使用 `this.viewWidth_`，可平移；
  大写 A/D 使用未定义的 `viewWidth`，实际回调抛出 `ReferenceError`，视窗不变。
- 当前 `queueSmoothPan_()` 只排队平移动画，没有父页面通知。浏览器加载已有 replay trace 后，
  运行实际注册的快捷键回调，a/d/e 的 panX 改变，但父页面通知次数均为 0。以 w 缩放作为
  正对照，其实际回调改变视窗并成功通知父页面；不将键盘回调直接调用等同于完整实体按键测试。
- 此前基于误读，仅在内存中模拟了将 `this.viewWidth_` 改为 `viewwidth` 的假设变体，
  a/d/e 均在进入平移方法前抛出 `ReferenceError`。该实验不是对真实离线修复的验证，
  不支持“离线修改有问题”的结论，该结论已撤回。保留原始实验记录；生产 JS 的 SHA256 未变。
- 检查时同步范围尚待确认：现有父页面回调通过 BroadcastChannel 发送 `SYNC_TRACE_TO_METRIC`，对应
  Trace→Metric 联动；没有向 TraceViewer 的第二个 Trace iframe 转发的逻辑。用户所说“双视图”
  究竟指 Metric/Trace 组合，还是两个 Trace 面板，当时尚未确认；后续用户确认与修复见下节。
- 当时状态：检查完成、问题已复现、尚未修复。证据：
  `__output__/archvisual/trace_keyboard_check_aq7R2f/`，包含实际视窗变化、通知次数、捕获的回调
  异常、上述假设变体实验及 `result.json`；检查脚本为该目录的 `check_trace_keyboard.cjs`。

## Metric/Trace 键盘平移同步修复（2026-11-03）

- 范围确认：用户明确“双视图是 Metric 与 trace 联动”。按该范围修复当前版本，不把离线版
  已完成的修复误判为新回归；不增加两个 Trace 面板之间的同步。
- 已实施并完成当前验收：大写 A/D 改用 `this.viewWidth_`；平移动画入队后通知其目标中心与
  当前持续时间，包含连续按键时接管动画的累计位移；Metric 的 dataZoom 处理遵守已有
  `disable_propagation` 标记，阻止接收的 Trace 范围再次回传。保留现有 1.25 留白与时间换算。
- 首轮真实键盘测试发现 Catapult 的 body 焦点宿主不可聚焦，点击后按键没有进入 Trace iframe，
  并非以回调调用代替真实按键验收。诊断实际记录 `document.hasFocus() = false`、无键盘事件；
  允许焦点宿主程序化聚焦后，实际按键进入并触发平移。已在 Catapult HTML body 增加
  `tabindex="-1"`，沿用既有焦点控制器且不增加顺序 Tab 导航停靠点。
- 更新 Catapult HTML/JS 与 Trace iframe 的缓存版本为 `20261103pan`，同步 README 与规范。
- 当前真实浏览器回归：17 项通过，前端异常 0。覆盖 1×/2× 像素密度下的 Metric→Trace 原有
  同步、a/d/e 与 Shift+A/D 的真实按键、Trace 目标中心/持续时间与 Metric 范围对应、无反向
  消息、平移不缩放、快速连续平移累计目标、Sync 关闭后 Metric 独立及无父回调的独立 Trace。
- 负对照：仅在独立测试浏览器替换资源，不回退生产源码。修改前 JS 正确失败于
  `a: exactly one Trace range notification`（实际 0）；修改前 Metric 模板正确失败于
  `a: Metric must not echo`（实际反向消息 1）。两项均为预期失败，证明回归能检出对应缺陷。
- 当前 JavaScript 语法与文件差异检查通过；不重复运行与此次前端改动无关的后端或模型全量回归。
- 状态：当前批准范围已实施、已验证、未提交。剩余独立问题：窄分屏时主工具栏可能换行，Sync
  复选框被图表画布遮挡；本次没有调整工具栏布局。Sync 关闭行为通过真实键盘聚焦复选框并按
  Space 验证，不将该验证描述为鼠标操作通过；鼠标遮挡问题单列待后续处理。

### 命令与当前证据

服务使用 repo-root `.venv/bin/python`，先选择工作区 Python 并持有共享环境锁；测试使用现有
Chrome 与 Playwright，无安装依赖。回归入口：

```bash
node archvisual/dataviewer/test_trace_metric_sync.cjs http://127.0.0.1:8097
node --check archvisual/dataviewer/static/js/catapult_trace_viewer.js
node --check archvisual/dataviewer/test_trace_metric_sync.cjs
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

当前证据目录：`__output__/archvisual/trace_metric_pan_q3b9x68k/`。

- `before/`：源码与文档的修改前副本；`session.patch`、`source-files.json`：本次增量与哈希。
- `regression/result.json`：首次实际按键因焦点未进入 iframe 而失败，不记作通过。
- `focus-probe.cjs`：焦点诊断脚本；最初复制脚本后的示例文件相对路径错误保留在 `focus-probe/`，
  修正为原始示例绝对路径后确认焦点原因；不将该路径错误归因于产品。
- `regression-focused/`：焦点修复后普通/大写及连续平移已通过，但鼠标关闭 Sync 被画布遮挡。
- `regression-final/result.json` 与截图：最终 17 项真实键盘回归 PASS；同步关闭使用键盘操作。
- `negative-old-js/`、`negative-old-metric/` 与对应日志：上述两项预期 FAIL。
- `result.json`：最终状态、检查及证据汇总。

## 发布脚本版本与压缩包保护检查（2026-11-03）

- 用户提供离线优化版本的对照意见，要求检查当前 `rel_visual.sh` 是否缺少成功后更新版本、
  临时文件原子替换和平台标签命名。当前检查已完成，以下缺陷属实；本次未修改发布源码或运行真实发布。
- `rel_visual.sh:76` 在调用构建前写回 `version.txt`，无回滚处理。隔离副本注入构建退出 42，
  版本仍从 `1.2.3` 变成 `1.2.4`。
- `rel_visual.sh:100` 先删除同名压缩包，随后直接向最终文件名运行 tar，没有临时包及原子替换。
  独立注入 tar 退出 66，原包内容丢失，最终文件名下留下不完整压缩包，版本号也未恢复。
- 额外路径：`build_visual.py:147` 清理整个 dist/output 目录，而发布脚本也把压缩包存于该目录。
  因此旧版本压缩包在构建开始时就可能被删除，不仅是同名包会在打包前删除。隔离测试复用
  当前清理步骤并注入后续构建失败，旧包已不存在。
- `rel_visual.sh:98` 文件名仅含版本号 `archvisual.<version>.tar.bz2`，未包含操作系统或处理器架构标签。
- 历史核对：本地所有可见 refs 只有 `6d11265` 和 `8debb00` 两次该文件修改；初版已采用上述
  提前写版本、rm 后直接 tar 的逻辑，后者主要改变 Python/输出路由。没有取得离线优化版本源码，
  不据此断言具体历史退化发生在哪次提交，也不否认离线版本已完成优化。
- 验证边界：执行的是未改动发布脚本的隔离副本，以构建/环境辅助函数和 tar 故障夹具验证控制流；
  所有 Python 执行仍为已选择且持共享锁的工作区 `.venv/bin/python`。不将夹具通过作为真实
  Nuitka 构建或发布成功。真实版本仍为 `0.4.0`，真实发布脚本 SHA256 未变，`bash -n` 通过。
- 当时待 review 的修复建议，后续确认与实施见下节：构建暂存目录与持久发布目录分离；先生成候选
  版本，不修改正式版本号；压缩包先写临时文件并验证，成功后原子提交；全部成功后更新版本并保留
  失败恢复路径；发布名包含 OS/处理器架构标签，建议 `archvisual.<version>.<os>.<arch>.tar.bz2`。
- 证据目录：`__output__/archvisual/release_check_13wn64ih/`。`result.json` 包含两项故障注入的命令、
  退出码、版本变化和旧包状态；各隔离目录保存完整副本、构建/tar 夹具及 stdout/stderr。
  `rel_visual-source.sh`、`build_visual-source.py` 与历史脚本副本供核对。当前状态：检查完成、
  当时修复方案待用户 review、未改发布源码、未提交。

## 发布脚本安全更新与原子提交修复（2026-11-03）

- 用户明确回复“确认，按此方案修复”。设计与边界已更新至本线 spec 的“发布版本与压缩包事务”。
- 已实施：独立构建暂存目录、持久 releases 目录、候选版本、平台标签命名、包内容验证、
  两步原子提交与失败补偿、项目发布互斥、冲突版本检查、恢复失败时保留证据、umask 文件权限。
  `build_visual.py` 编译失败及缺失产物现明确报错，避免正常返回误判成功。
- 当前默认位置：`__output__/archvisual/releases/archvisual.<version>.<system>.<machine>.tar.bz2`。
  构建只清理本次 `.release-staging/release.XXXXXX/`，旧版 `output/` 中的历史包不会被本次
  发布构建清理，也不自动迁移历史产物。旧输出覆盖环境变量仅兼容不在清理区域内的路径。
- 当前验证：28 项测试通过，包含完整发布脚本的隔离成功流、构建/tar 失败、损坏包、缺失或
  无执行权限的产物、maj/mid/min、参数和路径检查、并发互斥、SIGTERM、外部版本修改、版本
  提交失败补偿及恢复失败保留目录；库级故障注入覆盖两次 rename 后的中断、旧包恢复、无旧包
  时只移除新包、原子操作次序、权限及清理错误。Linux/Darwin/Windows 标签映射作定向单元验证，
  不作为不同平台真实编译通过。
- 初始 24 项通过；事务清理边界补充后 25 项通过；权限检查补充后 26 项通过；最后补齐发布
  入口层的版本提交失败与恢复失败检查，最终 28 项通过。各轮日志分开保留，没有实际编译失败
  后静默重跑或把故障夹具当作真实构建。
- 真实环境只读验证：正式脚本在工作区 Python 路由后拒绝无效参数，退出 1 且未进入构建。
  版本目录与暂存根位于同一文件系统；Bash 语法、Python 语法及差异检查通过。
- 实际版本仍为 `0.4.0`，与开始时副本逐字节相同。没有执行真实 Nuitka 编译、生成正式发布包、
  修改当前版本号或移动现有产物。当前范围实现及故障路径验证完成，未提交。
- 证据目录：`__output__/archvisual/release_fix_ti9m74qi/`。
  `before/` 保存本次修改起点；`tests.log`、`tests-final.log`、`tests-verified.log`、
  `tests-complete.log` 保存各轮测试；`tests-complete/` 保存最终全部隔离夹具与执行输出，
  其中恢复失败用例按预期保留旧包备份和恢复目录，不代表生产环境出现恢复失败。
  `workspace-routing-check.json` / `.log` 保存真实路由预检；`session.patch`、`source-files.json`、
  `result.json` 保存最终增量、哈希和检查结果。

回归命令（先选择并持有 repo-root `.venv/bin/python` 的共享环境锁）：

```bash
.venv/bin/python -B -m unittest discover -s archvisual -p test_release_visual.py -v
bash -n archvisual/rel_visual.sh
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

## Heat 固定行高与横向滚轮缩放（2026-11-03）

- 用户要求固定 16px 单元格、移除 Cell size 配置，并支持横向单格宽度 1–16px 的缩放，纵向尺寸不变。已实施：默认 16×16 CSS px，固定 16px 行高；绘图区滚轮以鼠标所在 sample 为中心缩放横轴，Shift+滚轮横向平移，metric 标签区保留原生纵向滚轮。每个面板独立保存横向宽度，Line/Heat 往返保留该状态；Start/End 继续限定原始 sample 范围。
- 缩小时减少横轴文字标签、保留每个 sample 的刻度和单元格；小于 4px 时隐藏会遮盖填色的单元格边框。原始数据、原值 tooltip、完整序列的色标范围与逐 metric 归一化语义不变，不引入 sample 聚合或降采样。模板移除 Cell size，Heat JS 缓存版本更新为 `v=3`。
- 首轮真实滚轮检查失败，确认 ECharts HTML tooltip 把画布的 `position:sticky` 改成 `relative`，原生滚动后画布随内容移出视口。现于图表组件更新后恢复 sticky；回归逐次核对画布仍位于滚动视口原点。
- 第二轮末尾检查失败：2049 个 sample 的数据在 16px 宽度下最右侧只渲染到索引 2047。原因是可用视口不能整除单格宽度，原生最大滚动量取整后不能到达最终完整窗口。已修复水平和纵向末尾窗口选择；最终 sample 与最后一行 metric 均可访问。
- 当前大数据浏览器回归 13 项通过：通过实际 H5 加载/查询路径使用 60 个 metric × 2049 个 sample（含缺失值）的夹具，逐个核对可见 cell 的 raw 值、sample 标签、metric 顺序和完整性；验证默认尺寸、1px/16px 上下限、鼠标 sample 保持、纵向尺寸与滚动位置不变、1px 填色像素、横/纵平移、末尾访问、分屏隔离、归一化、模式往返及 Start/End 的 15 个独立 sample。原示例 H5 的同一回归最终 13 项通过（182 个 sample，选择前 60 个 metric），前端异常为 0。
- 当前布局稳定性回归 20 项通过，覆盖普通滚动条、单面板、左右/上下分屏、五组尺寸（含小数分屏）、滚动与 tooltip；无 ResizeObserver 尺寸反馈、空闲重绘或前端异常。4 项 JavaScript 数据测试、JavaScript 语法及差异检查通过。
- 本次仅修改 Heat JS、MetricViewer 模板、README、新增 `dataviewer/test_heat_scale.cjs`，并更新本线 spec/plan。没有修改后端或模型计算，没有重复运行后端、真实 replay、发布编译或 Metric/Trace 联动全量回归；不以历史 PASS 代替本次验收。当前已实施、已验证范围如上，未提交。
- 证据目录：`__output__/archvisual/heat_horizontal_scale_20261103/`。`before/` 保存修改起点；`large/` 和 `large-fixed/` 保留两次失败结果与截图；`large-final/` 保存最终大数据缩放结果、1px 及分屏截图；`example/` 保存示例 H5 的初轮结果；`example-final/` 为补充纵向滚轮后的最终结果；`stability/` 保存稳定性结果。最终 `result.json`、`source-files.json`、`session.patch` 记录实际验收状态、源码哈希与本次增量。

回归入口（实际 Django 服务使用已选择并持共享环境锁的工作区 Python；Node 使用已有 Playwright 与 Chrome）：

```bash
node archvisual/dataviewer/test_heat_scale.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_stability.cjs http://127.0.0.1:8097
node --test archvisual/dataviewer/test_metric_heat.cjs
node --check archvisual/dataviewer/static/js/metric_heat.js
node --check archvisual/dataviewer/test_heat_scale.cjs
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

## Heat 多次 Plot 纵向追加独立热力图（2026-11-03）

- 用户明确选择“按此方案实现”：每次 Plot 只使用本次选中的 metrics，在已有图下方创建新图；同面板横轴联动，Color/Min/Max 各图独立；Clear 清空当前面板全部图，Delete 只删除当前图的选中 metric；模式切换和模板保留 Plot 分组边界。
- 已实施：每图独立保存 group、raw 数组、色标和查询状态；每面板共享 sample 范围、横向单格宽度及平移位置。横向保留 1–16px/sample、纵向固定 16px。每图同名 metric 去重，跨图保留重复 metric；新图不改变已有图的颜色范围或指标选择。
- 布局：单图继续占满子面板；多图按 metric 行数安排高度，超过单图可视高度的指标仍虚拟滚动。图列表纵向滚动；离屏图延迟创建 ECharts 实例，重新进入视口时更新可见 sample。每图的标题、Color/Min/Max、状态和色标位于 Heat 子页面，背景继续透明并显示原页面 ArchToy 水印。Heat JS 缓存版本为 `v=4`。
- 查询与生命周期：快速 Plot 按点击顺序预留独立图，乱序响应不会覆盖其他 Plot；新增查询失败报告错误并移除失败的新图，保留已有图。Clear、移除图和重载 H5 会使旧响应失效。查询期间切换 Line 保持 Heat 并提示等待；查询结束自动清除等待提示。
- 模板沿用后端现有 group/Sig 结构，新增可选 `Heat: {color, min, max}` 元数据；已有接口会原样保留该字段，无后端或 H5 格式修改。没有该字段的旧模板使用默认原值色标。Line 按 group 展示多图选择，返回 Heat 后各图分组和颜色设置保留。
- 初轮单图缩放回归在 Start/End 检查读到上一动画帧：本轮把范围更新合并到 requestAnimationFrame，旧测试立即读取图表。已增加等待精确目标 sample 标签再核对的条件，保留全部 raw 值、15 个独立 sample 及宽高断言；未放宽或删除数据断言。
- 多图测试两次菜单步骤错误保留为测试脚本失败：首次没有打开 Templ 菜单即填写隐藏输入框；修正后误按 button 角色查找实际 div 菜单项。最终改为真实打开菜单、点击 Import/Export 项，并共同等待请求与点击结果。这两次失败不归因为产品模板异常，工具输出和初轮结果按实际情况记录。
- 实现与验收文件：`dataviewer/static/js/metric_heat.js`、`dataviewer/templates/metricviewer.html`、新增 `dataviewer/test_heat_multiple_plot.cjs`、更新 `dataviewer/test_heat_scale.cjs`、README，以及本线 spec/plan；原有 `test_heat_stability.cjs` 未改动。没有修改其他开发线或本会话先前的发布/Trace 修复。
- 当前大数据最终回归：29 项通过，真实加载/查询 60 个 metric × 2049 个 sample 的 H5，并通过实际 Plot 按钮分多次绘图。重载夹具包含同名指标的 137 个 sample，所有有效值加 500000；逐格核对新文件值、标签和顺序，确认新旧数据不混用。包括独立色标、联动缩放/平移、Start/End、重复 metric、模板 JSON、模式往返、受控乱序响应、等待状态、失败隔离、Clear/Delete、离屏图恢复、分屏隔离与九组多图布局稳定性检查。最终真实示例 H5 的同一多图回归 29 项通过；原有单图缩放 13 项、原有布局稳定性 20 项、4 项 JavaScript 数据测试均重新通过。前端异常、ResizeObserver 错误及空闲重绘均为 0，JavaScript 语法和差异检查通过。
- 本轮最终证据目录：`__output__/archvisual/heat_multiple_plot_20261103/`。`before/` 为起点；`scale-first/`、`multiple-first/` 保存上述初轮失败；`multiple-template-fixed/` 对应角色错误的运行未生成最终 JSON，不能记为 PASS；`multiple-menu-fixed/` 是 26 项初步通过；补充离屏/空图删除后两个 `multiple-*-final/` 是 28 项中间验收；`multiple-large-verified/` 是 29 项中间验收；`final-large/` 为最后控件/选中状态同步修正后的 29 项通过。`final-example/`、`final-scale/`、`final-stability/` 为同一最终源码的真实示例多图、单图缩放和原有稳定性结果；`result.json`、`source-files.json`、`session.patch` 保存最终状态、源码哈希及增量。
- 状态：批准范围实现完成，当前验收通过，无剩余阻塞，尚未提交。未运行新的 replay、模型计算或真实发布编译，不将历史后端 PASS 作为本轮验收。

回归入口（实际 Django 服务使用已选择并持共享环境锁的 repo-root `.venv/bin/python`）：

```bash
node archvisual/dataviewer/test_heat_multiple_plot.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_scale.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_stability.cjs http://127.0.0.1:8097
node --test archvisual/dataviewer/test_metric_heat.cjs
node --check archvisual/dataviewer/static/js/metric_heat.js
node --check archvisual/dataviewer/test_heat_multiple_plot.cjs
node --check archvisual/dataviewer/test_heat_scale.cjs
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

## Heat 每图右侧状态控制栏与底部说明（2026-11-03）

- 用户确认“按此布局实施”：每张 Heatmap 左侧显示图、坐标轴和色标；右侧显示图名、Color、Min/Max 与动态状态；静态 sample 含义、灰色说明和操作提示移至每图下方。
- 已实施：每图使用两列布局，右栏固定 210 CSS px。图名与控件纵向排列，动态状态支持换行和独立滚动；底部说明跨图的两列显示。正常状态仅显示 metric 数量、sample 数量和 px/sample，选中状态仅显示指标名，操作指南统一在底部。主页面顶部未新增控制或状态行。
- 图的最小总宽度为 490px（绘图区至少 280px、右栏 210px）；窄分屏保留左右结构，通过 Heat 子页面的原生水平滚动访问右栏。所有图使用相同列宽，横轴继续对齐。图高仅由底部说明高度、可视高度和 metric 行数决定，不依赖状态文本高度，避免错误信息或长指标名触发布局反馈。背景继续透明并显示原页面 ArchToy 水印，Heat JS 缓存版本为 `v=5`。
- 当前两组浏览器回归各 46 项通过：大数据夹具（60 个 metric × 2049 个 sample，重载为 137 个 sample 且有效值加 500000）与真实示例 H5 均通过实际加载、查询和 Plot 路径验收。除既有多图、颜色隔离、横轴联动、模式/模板、异常和生命周期检查外，本轮新增右栏与底部说明的几何位置、状态/指南分离、错误换行不改变绘图区尺寸、12 组单面板/左右/上下分屏尺寸，以及窄分屏横向滚动后真实点击 Min 控件。
- 原有单图缩放 13 项、布局稳定性 20 项和 JavaScript 数据测试 4 项重新通过；JavaScript 语法与差异检查通过。前端异常及 ResizeObserver 错误为 0，静置期间无 resize 或重绘。截图已查看：真实示例和重载夹具均为左图、右栏、底部说明布局，原页面水印位置正常。本轮未发生失败重试。
- 修改范围：`dataviewer/static/js/metric_heat.js`、`dataviewer/templates/metricviewer.html`、`dataviewer/test_heat_multiple_plot.cjs`、README 与本线 spec/plan；`test_heat_scale.cjs`、`test_heat_stability.cjs` 本轮未改动。没有修改后端、H5 格式、计算或先前的发布/Trace 修复，没有运行新的 replay 或发布编译。
- 证据目录：`__output__/archvisual/heat_right_sidebar_20261103/`。`before/` 保存起点；`layout-first/`、`layout-example/` 分别保存 46 项大数据/真实示例结果与布局截图；`scale/`、`stability/` 保存原有回归结果；`result.json`、`source-files.json`、`session.patch` 保存实际结果、源码哈希和本次增量。
- 状态：已实施、当前验收通过，无剩余阻塞，尚未提交。

验收入口（Django 服务使用已选择并持共享环境锁的 repo-root `.venv/bin/python`；Node 使用已有 Playwright 与 Chrome）：

```bash
node archvisual/dataviewer/test_heat_multiple_plot.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_scale.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_stability.cjs http://127.0.0.1:8097
node --test archvisual/dataviewer/test_metric_heat.cjs
node --check archvisual/dataviewer/static/js/metric_heat.js
node --check archvisual/dataviewer/test_heat_multiple_plot.cjs
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

## Heat 紧凑等宽控件、Ctrl 滚轮与侧栏联动调宽（2026-11-03）

- 用户确认“按方案实施，同面板侧栏联动调宽”。已实施：Color、Min、Max 控件均为 100 CSS px；Color 悬停可查看完整选项名。说明移入各自右栏，位于动态状态之后，不再占图下方空间。
- 绘图区 Ctrl+滚轮缩放横轴，继续限制 1–16px/sample，纵向固定 16px；普通滚轮不拦截，交回浏览器原生滚动。小图滚动图列表，大图可原生滚动可视 metric 行；Shift+滚轮保留横向平移。达到缩放边界时 Ctrl+滚轮仍阻止浏览器页面缩放。
- 侧栏默认 180px，拖动左边线在 160–400px 内调宽；同面板全部图共享宽度，两个分屏独立，新增 Plot、Clear、Line/Heat 往返和重载 H5 保留该面板宽度。边线使用左右调整光标和指针捕获，支持拖离边线与边界限制；窄分屏在调整图最小宽度时保持右边缘可见。移除正在拖动的图、取消或重载数据会释放捕获与光标。分隔线提供键盘方向键 10px 步进和 Home/End 边界及 ARIA 宽度。
- 说明与状态均在侧栏内换行/滚动，其高度不参与图高计算。图最小宽度改为 280px 绘图区加当前侧栏宽度；颜色、原值、sample 和硬件计数实例不合并。原页面 ArchToy 水印继续透过绘图区显示。HTML/Heat JS 缓存版本为 `v=6`。
- 当前浏览器验收：真实示例 H5 与大数据/重载夹具各 55 项通过，覆盖实际 Plot、原值逐格精确匹配、独立颜色、横轴联动、模式/模板往返、请求乱序、失败隔离及生命周期。新增真实鼠标/键盘验证普通滚轮滚动图列表、Ctrl 缩放、100px 等宽框、说明位置、联动拖拽、160/400px 限制、拖离边线、窄分屏拖拽、分屏隔离、拖动中 Clear、宽度继承与十二组布局稳定性。
- 单图缩放/滚动回归最终 14 项通过，包含数据区普通滚动、Ctrl 缩放上下限、鼠标 sample 保持及浏览器 DPR 不变。原有稳定性 20 项、JavaScript 数据测试 4 项、语法和差异检查通过。前端异常与 ResizeObserver 错误为 0，静置无 resize 或重绘。160px 和 400px 侧栏截图已查看。
- 本轮两次单图测试失败均留档，未改产品逻辑掩盖问题：`scale-first/` 在 Color 切换后立即读取，得到上一帧原值范围；已增加等待实际色标 `[0,1]` 的条件后继续精确核对。`scale-verified/` 在缩小 sample 范围后反算 CSS 格宽产生一个浮点 ULP 的差异（10.730000000000002 与 10.73）；该项仅对显示几何使用 <1e-9 CSS px 的误差界，raw 值、标签、行序和单元格/sample 数仍严格相等，没有容差、跨实例聚合或计数排除。
- 证据目录：`__output__/archvisual/heat_sidebar_resize_20261103/`。`before/` 保存起点；`resize-first/` 是 52 项中间验收；`final-large/` 是增加清理与窄分屏用例后的 55 项中间验收（当时尚未更新最终说明文字）；`final-example/`、`large-verified/` 保存最终说明文字后的真实示例/大数据各 55 项结果，含最窄/最宽截图；`scale-first/`、`scale-verified/` 保留上述两次 FAIL；`scale-final/` 为最终 14 项 PASS；`stability/` 保存 20 项稳定性 PASS。`result.json`、`source-files.json`、`session.patch` 保存实际结果、哈希及增量。
- 仅修改 Heat JS、MetricViewer 模板、多图/单图浏览器测试、README 与本线 spec/plan。原有稳定性测试本轮未改；后端、H5 格式、模型计数、先前 Trace/发布修复未改，也未执行新 replay 或发布编译。当前批准范围已实施且验收通过，无剩余阻塞，尚未提交。

验收入口（Django 服务使用已选择并持共享环境锁的 repo-root `.venv/bin/python`）：

```bash
node archvisual/dataviewer/test_heat_multiple_plot.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_scale.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_stability.cjs http://127.0.0.1:8097
node --test archvisual/dataviewer/test_metric_heat.cjs
node --check archvisual/dataviewer/static/js/metric_heat.js
node --check archvisual/dataviewer/test_heat_multiple_plot.cjs
node --check archvisual/dataviewer/test_heat_scale.cjs
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

## Heat 侧栏拖拽隐藏与重新展开（2026-11-03）

- 用户确认“按此方案实施”：宽度改为 0–400px 连续拖动，0px 隐藏侧栏并释放绘图区宽度，右缘覆盖式 8px 热区可重新拖出；同面板联动、分屏独立，现有等宽控件和 Ctrl 滚轮语义保持。
- 已实施最小宽度、独立定位的拖拽热区、0px 隐藏样式与焦点/ARIA 状态；1–10px 时按剩余宽度收缩内边距，避免边框和内边距撑破列宽。模板缓存版本更新为 v=7。
- 当前浏览器验收：真实示例 H5 和大数据/重载夹具各 64 项通过。覆盖归零隐藏、右缘真实鼠标重新拖出、1/3/10/64/180px 连续宽度、0/400px 边界、同面板多图联动、分屏独立、窄分屏横向滚动后隐藏与重新拖出；验证 0px 无内边距/边框、绘图区获得全部宽度、8px 热区留在图内及隐藏控件的不可见/不可交互状态。键盘 Home/End 与 10px 步进通过；Line/Heat、Plot、Clear 与 H5 重载保留隐藏状态。原始值、sample 标签、行序与单元格数量继续精确匹配，颜色设置保持独立。
- 原有横向缩放回归 14 项、布局稳定性 20 项、JavaScript 数据测试 4 项及语法/差异检查通过。隐藏与重新展开后静置均无 resize 或重绘，前端异常和 ResizeObserver 错误为 0；隐藏、重新展开与窄分屏截图已查看。本轮没有失败重试；`example-first/` 的 59 项是补充隐藏生命周期检查前的中间验收，`example-final/` 与 `large/` 是最终 64 项验收。
- 证据目录：`__output__/archvisual/heat_sidebar_collapse_20261103/`；`before/` 保存本次修改起点，`scale/`、`stability/` 保存原有回归，`result.json`、`source-files.json`、`session.patch` 保存结果、源码哈希和本次增量。Django 测试服务使用已选择并持共享环境锁的 repo-root `.venv/bin/python`，浏览器套件按序执行，普通滚动条保持可见。
- 修改范围：Heat JS、MetricViewer 模板、多图浏览器回归、README 与本线 spec/plan。后端、H5 格式、模型计算与原有缩放/稳定性测试未改。状态：已实施、当前验收通过，无剩余阻塞，尚未提交。

验收命令（浏览器套件使用已有 Playwright/Chrome，输出目录由 `HEAT_TEST_OUTPUT` 指定）：

```bash
node archvisual/dataviewer/test_heat_multiple_plot.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_scale.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_stability.cjs http://127.0.0.1:8097
node --test archvisual/dataviewer/test_metric_heat.cjs
node --check archvisual/dataviewer/static/js/metric_heat.js
node --check archvisual/dataviewer/test_heat_multiple_plot.cjs
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

## Heat 顶部 Sample 标题移除（2026-11-03）

- 用户明确要求去掉 Heat 顶部的 `Sample` 字符，属于直接文字删除。已将 Heat 横轴名称清空，并删除名称位置/间距配置；采样刻度和标签沿用原设置。
- 模板静态脚本缓存版本由 v=7 更新为 v=8。当前 JavaScript 语法与差异检查通过；本次为文字显示调整，未新增测试或重跑浏览器回归，未提交。证据保存在 `__output__/archvisual/heat_remove_sample_title_20261103/`。

## Heat 色标靠近可见热力图（2026-11-03）

- 用户确认“按此方案实施”：将原本固定在视口底部的色标，改为位于当前可见 Heatmap 底边约 8 CSS px 处，左侧保持对齐。
- 已实施按可见图高定位色标、移除色标额外内边距；采样数据、16px 行高和横向缩放逻辑保持。模板静态脚本缓存版本为 v=9。
- 多图、单图缩放与稳定性回归加入实际渲染色标几何检查：距可见 Heatmap 底边约 8px，且纵向不裁切。该几何误差界仅用于 CSS 显示；raw sample、采样标签、metric 顺序与单元格数量仍严格匹配。
- 当前验收：真实示例 64 项多图交互通过；60 metric × 2049 sample 夹具的 14 项缩放/纵向滚动检查通过，覆盖最后一个 metric/sample、原值/归一化颜色及独立分屏；20 项布局稳定性检查通过，覆盖三种布局、五组尺寸、滚动与悬停。无前端异常、ResizeObserver 错误或静置重绘；本轮无失败重试。已查看少量行和大量行分屏截图，色标紧随图底边。JavaScript 语法与差异检查通过，模板保留 CRLF。
- 修改范围：Heat JS、MetricViewer 模板、多图/缩放/稳定性浏览器检查、README 与本线 spec/plan。后端、数据格式、模型计算未改。证据目录 `__output__/archvisual/heat_colorbar_gap_20261103/`；`before/` 保存起点，`example/`、`scale-large/`、`stability/` 保存当前验收，`result.json`、`source-files.json`、`session.patch` 保存结果、哈希和增量。测试使用选定并持共享环境锁的 repo-root `.venv/bin/python` 启动独立 Django 服务，浏览器套件顺序执行。
- 状态：已实施、当前验收通过，无剩余阻塞，尚未提交。

## Heat 右侧 min/avg/max 统计列（2026-11-03）

- 用户确认“按此方案实施”：可见 Heatmap 右侧、控制侧栏左侧新增三列固定 16×16px 色块，顶部标题 min/avg/max，全文件有效样本统计，保留原始采样，沿用所属图色标。avg 包含零、跳过缺失，ratio 使用采样值算术均值。用户本次批准查询后计算并缓存，缩放、平移、Start/End 不重算。
- 已实施完整行统计缓存、缺失显示、独立统计坐标与同图色标、统计 tooltip；删除 metric 使用剩余行缓存，重载/查询生成新缓存。均值使用补偿求和，有限样本求和发生溢出时使用缩放求和。三列预留固定空间，标题沿用采样标签的倾斜样式；模板版本为 v=10。
- 当前验收：6 项数据单测、14 项独立统计浏览器检查、真实示例 64 项多图交互、60 metric × 2049 sample 夹具的 14 项缩放/滚动、20 项布局稳定性全部通过。统计 H5 夹具以 Python math.fsum 独立生成参考均值，逐项严格核对 min/avg/max 与原始采样值；覆盖零、缺失、常量、ratio 式样本、正负抵消、最后一个 sample/metric、Start/End 全文件范围、真实鼠标 tooltip、手动色标裁剪的实际像素和原值、归一化、H5 重载与分屏隔离、侧栏隐藏、Line/Heat 往返及点击统计格后 Delete。数据单测补充有限大数求和溢出；无计数容差或跨实例合并。原始 sample 序列和统计序列分别核验，原始格仍逐一匹配；CSS 几何误差界仅用于浮点布局。
- 三种布局及五组尺寸下统计列保持 16px 方格、8px 间距与相同行高且可见。无前端异常、ResizeObserver 错误或静置重绘；已查看多图、全文件 tooltip 和分屏截图。JavaScript 语法和差异检查通过，模板/README 保留 CRLF。没有失败重试；标题角度调整前的 example/、statistics-first/ 为中间验收，statistics-final/ 是新增缺失 tooltip 与像素检查后的中间验收；最终参考检查在 statistics-verified/。
- 证据目录 `__output__/archvisual/heat_summary_columns_20261103/`：before/ 保存起点，example-final/、statistics-verified/、scale-large/、stability/ 保存最终结果，result.json、source-files.json、session.patch 保存结果、哈希和本次增量。服务与夹具生成均选择并持共享环境锁使用 repo-root .venv/bin/python；浏览器套件顺序执行，普通滚动条保持可见。
- 修改范围：Heat JS、MetricViewer 模板、数据与统计/多图/缩放/稳定性验证、README 与本线 spec/plan。没有改动后端、H5 格式或 Profanalyz 计算。状态：已实施、当前验收通过，无剩余阻塞，尚未提交。

验收入口（Node 使用已有 Playwright/Chrome，HEAT_TEST_OUTPUT 指向仓库输出树）：

```bash
node archvisual/dataviewer/test_heat_statistics.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_multiple_plot.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_scale.cjs http://127.0.0.1:8097
node archvisual/dataviewer/test_heat_stability.cjs http://127.0.0.1:8097
node --test archvisual/dataviewer/test_metric_heat.cjs
node --check archvisual/dataviewer/static/js/metric_heat.js
git -C archvisual -c core.whitespace=cr-at-eol diff --check
```

## Heat 色标按可见采样区域居中（2026-11-03）

- 用户确认“按采样热力图区域居中”：渐变条与两端数值说明整体居中，基准为当前可见 sample 网格，不计入 min/avg/max 或控制侧栏，图底间距继续约 8px。窄视口优先保证色标可见。
- 已实施按实际渲染宽度计算位置并限制视口边界；过宽时先缩短色条，必要时缩小文字至至少 8px，保留完整数值文本。布局按视口宽度和端点文本缓存，普通平移复用尺寸；模板版本为 v=11。
- 当前验收：64 项多图交互、15 项独立统计/色标核对、14 项大数据缩放/滚动、20 项布局稳定性全部通过。四项浏览器检查均测量实际渲染色标边界：按可见 sample 网格计算目标中心，空间不足时按视口边界限制位置；完整色标在视口内且底部间距约 8px。统计检查新增长端点文本的 641×481 左右分屏，实际触发色标适配并通过；保留原始 sample 与独立 math.fsum 参考统计的严格匹配。CSS 几何误差界仅用于显示位置。
- 覆盖横向缩放、Start/End、小数尺寸分屏、侧栏调宽/隐藏、颜色模式与边界、重载、真实 tooltip 和静置；无前端异常、ResizeObserver 错误或空闲重绘。已查看多图居中与窄分屏长文本截图。JavaScript 语法、差异检查通过，模板/README 保留 CRLF；本轮无失败重试。
- 修改范围：Heat JS、MetricViewer 模板、上述四项浏览器验证、README 与本线 spec/plan；没有修改采样数据、均值计算、后端或 H5 格式。证据目录 `__output__/archvisual/heat_colorbar_center_20261103/`，before/ 保存起点，multiple-first/、statistics-first/、scale-large/、stability/ 保存最终结果，result.json、source-files.json、session.patch 保存结果、哈希和本次增量。服务和统计夹具使用选定并持共享环境锁的 repo-root .venv/bin/python，浏览器套件顺序执行。
- 状态：已实施、当前验收通过，无剩余阻塞，尚未提交。

## Heat 多图上下空间收紧（2026-11-03）

- 用户确认“按此方案实施”：多图按 metric 行数紧凑布局，高度下限由 241px 降为约 140px，顶部默认 68→52px、底部预留 76→40px、图间距 12→6px；行高 16px 与色标距图底 8px 保留，长刻度保留必要空间。
- 已实施按缓存顶部空间和行数计算图高，移除 CSS 的 160px 最小绘图高度限制，单图仍填充面板。长刻度在文件加载时一次性按实际字体和 50 度旋转测量，避免平移时高度变化。模板版本为 v=12。
- 当前验收：65 项多图交互、16 项统计/长刻度检查、14 项大数据缩放/滚动、20 项布局稳定性全部通过。两行 metric 的图实际为 140px 高、图间距为 6px；长刻度 H5 使用 16 位整数标签，实际预留顶部空间超过 52px，短图仍小于旧 241px。各回归检查真实渲染的采样刻度顶部边界、色标位置/间距/边界、统计列几何与原始 sample，保留与独立 math.fsum 参考统计的严格匹配。
- 普通滚轮测试将视口由 750px 改为 450px，使紧凑图列表仍产生真实溢出，保留实际鼠标滚轮与 scrollTop 增加的断言；没有减弱滚动验收。右侧等宽控件、侧栏独立滚动、拖拽/隐藏、分屏、Line/Heat、查询生命周期和最后一个 sample/metric 均通过。
- 三种布局、五组尺寸下无前端异常、ResizeObserver 错误或静置重绘；已查看紧凑多图与长标签截图。JavaScript 语法与差异检查通过，模板/README 保留 CRLF；本轮无失败重试。
- 修改范围：Heat JS、MetricViewer 模板、多图/缩放/统计/稳定性浏览器检查、README 与本线 spec/plan；后端、采样数组、统计计算与 H5 格式未改。证据目录 `__output__/archvisual/heat_vertical_spacing_20261103/`，before/ 保存起点，multiple-first/、statistics-first/、scale-large/、stability/ 保存当前结果，result.json、source-files.json、session.patch 保存实际结果、哈希和本次增量。服务与夹具均使用选定并持共享环境锁的 repo-root .venv/bin/python；浏览器套件顺序执行。
- 状态：已实施、当前验收通过，无剩余阻塞，尚未提交。

## 本会话本地提交与框架门禁豁免（2026-11-03）

- 用户已审查八个具体提交的说明和文件清单，并明确批准“豁免本次框架门禁，按清单提交”。历史各节的“尚未提交”描述保留当时状态；当前 ArchVisual 子模块的四项本地 main 提交已经完成：

- `f1f5eb7e0230f42559336f47c98a88c9d66de984`：[archvisual] fix: publish release archives atomically
- `92a7e638180a483207badb9638956c8ab780e9f6`：[archvisual] fix: restore the ASGI entry point
- `4a685aee39c1eca5deed9e5692c30556c59bfea2`：[archvisual] fix: synchronize keyboard pans with MetricViewer
- `be06c419dacde307db7c9ed799de55b632e9adc2`：[archvisual] feat: add metric heatmaps and full-file statistics

- 本节随显示规范一起提交到父仓库本地 main，并将 `archvisual` gitlink 更新为 `be06c419dacde307db7c9ed799de55b632e9adc2`。同清单中的 Microbench trace 开关、Profanalyz 稀疏计数与 PA_ 命名均已分别提交；最终提交哈希和实际文件清单见 `__output__/archvisual/commit_review_20261103/commit-execution.json`。
- 提交准备的 Django check、Django 11 项、发布故障注入 28 项、Profanalyz 10 项、trace 开关 9 项、JavaScript 数据 6 项及真实键盘联动 17 项检查通过。Heat 最近的 65/16/14/20 项浏览器验收源码哈希与此次提交内容一致；未以历史 PASS 代替当前检查。
- 完整框架门禁实际退出 1：`/home/liyijun04/.local/bin/cmake` 的 Python 包装入口导入报 `ModuleNotFoundError: No module named 'cmake'`，止于 thirdparty bootstrap；后续框架构建及回归没有执行。日志：`__output__/archvisual/commit_review_20261103/framework-gate.log`。已只读验证原生 CMake，但用户选择豁免本次门禁，因此没有重跑，没有修改环境配置或门禁脚本，门禁结果保持 FAIL/用户豁免，不标为 PASS。
- 此次只提交已审定的本会话文件与片段，保留其他开发线的修改及未归属本会话的 `dataviewer/static/data/sp.json`。没有执行真实 Nuitka 发布、版本提升或远端推送。

## ArchVisual 独立 Python 环境与仓库内输出（2026-11-04）

- 用户提出独立仓库要求，并明确回复“确认，按此方案实施”：内部维护环境入口、独立选择
  Python、默认仓库内输出、同步修改入口/测试/文档，并在无父仓库脚本的副本中验证。
- 已实施：本地环境辅助模块、准备/检查脚本，启动/构建/发布迁移，Django 静态与临时目录
  迁移，测试输出/统计夹具入口迁移，README/AGENTS/Claude 文档同步；原依赖版本不变。
- 当前定向检查：环境与发布共 43 项通过（环境 13 项、发布 30 项），Django check 通过，
  Django 后端 11 项通过。包括环境选择、检查只读、环境锁继承、安装前校验本地 venv 前缀、
  拒绝重定向解释器修改外部环境、发布失败恢复及不同输出根下的版本互斥。
- 初步独立副本不含 `.git` 或父仓库 scripts，从其他工作目录使用显式选择的已有解释器完成
  依赖检查、Django check、真实 collectstatic（150 个静态文件，落入副本内部输出目录）
  和构建模块导入。此阶段没有安装包或执行 Nuitka 应用编译，不依赖父仓库 Python 管理模块。
- 后续使用本仓库 `setup_python.sh --prepare --python <已有 Python 3.10.12>` 为隔离副本
  创建全新 `.venv`，实际从现有 pip 源安装原有固定版本依赖，缓存也显式位于本次输出目录。
  当前 `sys.prefix`、Django/pandas/PyTables 模块位置均严格位于副本 `.venv`，`sys.path`
  不含父仓库 `.venv` 的包目录。重复准备也通过，未修改共享环境或依赖版本。
- 从副本外部工作目录启动 `run_visual.sh`，不传 `ARCHVISUAL_PYTHON` 或 `VIRTUAL_ENV`，
  实际选中副本本地 `.venv`。真实 HTTP 加载 H5、查询、上传并重新查询均通过，原始
  sample 标签及全部选中计数值精确相等；上传临时 H5 落在副本内部 `__output__/tmp/`。
- 原先 Node 搜索路径缺少 Playwright；已定位现有安装，以显式 `NODE_PATH` 使用，没有
  npm 安装。当前副本浏览器回归：Heat 统计 16 项、布局稳定性 20 项、JavaScript 数据
  6 项全部通过。统计夹具使用副本自己的 Python 和本地环境共享锁，实际创建 H5 及独立
  math.fsum 参考值。副本服务已停止，没有中断其他运行中的服务。
- 当前证据目录：`__output__/archvisual/standalone_env_20261104/`。`before/`、`baseline.json`
  保留修改前源码与哈希；`unit-first.log`、`local-check.log`、`django-check.log`、
  `django-tests.log`、`unit-final.log`、`isolation.json`、`isolated-*.log` 保留实际命令结果。
  `isolated-prepare.log` 和 `isolated-prepare-final.log` 记录全新准备与重复准备；
  `fresh-local-identity.log` 记录解释器及模块位置，`isolated-result.json` 记录最终 HTTP/H5
  与浏览器验收；`source-files.json`、`archvisual.patch`、`root-docs.patch`、`result.json`
  保留最终源码哈希、增量和验收范围。检查输出中缺失环境及模拟编译失败是定向负例，
  对应测试通过，不是被忽略的应用构建失败。
- 状态：已实施、当前定向验收通过、范围审查完成，无剩余实现阻塞，未提交。
- 本次没有改动共享环境脚本、其他开发线、原始 H5/计数语义或 Heat 渲染算法；未提交，
  未推送。此前框架门禁豁免仅属于 2026-11-03 的八笔提交，不自动延伸至本轮。

## 独立环境修改本轮提交批准与门禁豁免（2026-11-04）

- 用户已审查两笔具体提交说明及精确文件范围，并明确批准“豁免本轮框架门禁，按两笔清单提交”。
- ArchVisual 独立环境实现、测试及必要说明已在子模块本地 main 提交为 `e9450f10b2cf45e5cf48af1d30730b103f6fd81d`；本节连同本线规范一起提交到父仓库，并将 gitlink 更新为该子模块提交。前文“未提交”保留为当时状态。
- 本轮完整框架门禁实际执行 `bash scripts/run_micro_regression.sh`，退出 1：CMake Python 包装入口 `/home/liyijun04/.local/bin/cmake` 导入报 `ModuleNotFoundError: No module named 'cmake'`，止于 thirdparty bootstrap；后续构建和回归未执行。用户豁免仅适用于本轮两笔限定提交，不将门禁记为 PASS，不修改共享环境或门禁脚本，也没有重跑门禁。
- 本轮日志及实际退出码位于 `__output__/archvisual/standalone_env_commit_20261104/framework-gate.log`、`framework-gate.json`。已核对 20 个文件与定向验收源码哈希一致；提交前 5 个 Python 文件 py_compile 及补丁/差异检查通过。43 项环境/发布、11 项 Django、36 项浏览器及 6 项 JavaScript 数据检查引用相同源码的已有实际验收，不描述为本轮重新执行。
- 提交严格排除未归属本会话的 `archvisual/version.txt`（0.4.0 → 0.4.1）、`archvisual/dataviewer/static/data/sp.json`、根目录 `archvisual.tar.bz2` 及其他开发线修改；没有执行真实 Nuitka 应用编译、正式发布、版本提升或远端推送。
- 两笔提交的实际哈希、范围及提交树保存在 `__output__/archvisual/standalone_env_commit_20261104/commit-execution.json`。

## Python 最低版本与分档依赖实现（2026-11-04）

- 历史记录：本节的版本准入和新版依赖方案已被后续“Python 3.10/3.11 准入收窄”取代；
  以下验收对应当时源码，不代表收窄后的当前验收。
- 用户要求允许更新的 Python，并确认实施：最低版本改为 >=3.10；3.10/3.11 沿用原固定
  依赖，>=3.12 使用独立兼容范围配置；以 3.10 与本机 3.13 做真实环境与应用验证。
- 已实施版本准入、按解释器选择依赖文件、新版范围/模块检查、准备阶段 venv 版本一致性
  校验，以及脚本提示、README/AGENTS/Claude 使用说明。原 `requirements.txt` 未改。
- 实际遇到 Python 3.13.14 环境创建失败：venv 默认复制 uv 启动链接对应的解释器，生成
  环境在 ensurepip 阶段找不到 encodings。原始失败保留于 `prepare-3.13.log`、
  `prepare-3.13.json`、`python313-*.log` 与隔离副本 `.venv.failed-ensurepip/`。
  `venv-stdlib-probe.log` 用标准 EnvBuilder 最小复现：复制方式退出 1，符号链接方式退出 0。
- 已按 POSIX 标准 venv 行为修复为解释器符号链接；失败副本移名保留，重新按正式准备入口
  创建全新环境，Python 3.13.14 与 3.10.12 均实际准备成功。未修改/重建父仓库环境。
- 当前证据目录：`__output__/archvisual/python_versions_20261104/`；`before/`、
  `baseline.json` 为起点，`projects.json` 标识两个独立副本，`prepare-*-final.log/json`
  记录正式准备结果。最初 3.10 的 47 项回归通过，但发生在 POSIX venv 修复之前，
  不作为最终验收；最终两套环境检查正在执行。
- 最终回归：Python 3.10.12 与 3.13.14 两套全新环境各自的 48 项环境/发布测试
  （环境 18、发布 30）及 11 项 Django 后端测试通过。新增的真实 venv 创建回归调用
  正式 EnvBuilder/ensurepip，执行真实标准库和 prefix 检查；只替换该单测的外部依赖下载，
  两套完整准备流程的真实依赖安装另有正式日志，不以 mock 代替兼容验证。
- 两套环境的正式重复准备均通过。以 3.13 请求准备已有 3.10 venv 时，在 pip 运行前
  明确拒绝，pyvenv.cfg 保持字节不变；见 `cross-version-protection.log/json`。
- 两套环境分别从副本外启动，解释器和业务模块都来自副本 `.venv`。真实 HTTP/H5
  服务加载、上传、查询保留全部选中计数实例的原始 sample 标签与值；每套 Heat 统计
  16 项、布局稳定性 20 项、JavaScript 数据 6 项通过。包含旧 example H5 读取和独立
  math.fsum 参考统计，不使用容差或删除 sample 掩盖差异；两套验收服务均已停止。
- 页面验收最初在 Chrome 启动阶段 SIGTRAP，尚未进入 UI。首次结果保存在
  `run-3.10-first-chrome-failure/`、`http-browser-3.10-first.log`；同参数探针表明
  75 字符临时根路径启动失败，37 字符路径成功，记录于 `chrome-long-probe.log` 和
  `chrome-short-probe.log`。仅将验收进程 TMPDIR 改为仓库输出树短路径后，两版本完整
  回归通过；未修改应用、Chrome 参数或验收断言。该修复不涉及产品环境脚本。
- 实测依赖：3.10 使用原固定文件（SHA256 与起点相同）；3.13 解析得到 Django 5.2.19、
  django-cors-headers 4.9.0、NumPy 2.5.4、pandas 2.3.3、numexpr 2.14.2、blosc2 3.12.2、
  PyTables 3.11.1、packaging 26.3、Nuitka 4.0.3。完整版本及解释器位置见
  `versions-3.10.json`、`versions-3.13.json`；范围内其他依赖组合不据此声明已通过。
- 最终证据：`tests-*-final.log`、`django-*-final.log`、`http-browser-*-final.log`、
  `run-3.10/isolated-result.json`、`run-3.13/isolated-result.json`、`syntax.json`；最终
  源码哈希、增量及总结果见 `source-files.json`、`archvisual.patch`、`root-docs.patch`、
  `result.json`。旧失败与最终成功分开保存，没有以之前的 PASS 代替当前源码验收。
- 状态：已实施、当前定向验收通过，无剩余实现阻塞，未提交。Python 3.11/3.12/3.14/3.15
  的应用运行、其他平台及 Nuitka 应用编译未实测，不记为通过。本轮没有运行完整微基准
  框架门禁，不沿用此前提交豁免；没有提交、推送或正式发布。其他会话修改保留。

## Python 3.10/3.11 准入收窄（2026-11-04）

- 历史记录：版本准入和精确依赖检查已由后续“独立环境的宽松版本检查”方案取代。
- 用户确认移除 Python 3.12 及更新版本支持：环境准备和检查仅接受 3.10/3.11，统一读取原
  `requirements.txt` 固定依赖，删除本线新增的新版依赖文件和分档检查逻辑；原有依赖固定版本不变。
- Python 3.10.12 定向验收：46 项环境/发布测试和 11 项 Django 测试通过，日志分别为
  `__output__/archvisual/python_310_311_tests_20261104.log` 和
  `__output__/archvisual/python_310_311_django_20261104.log`。发布测试的 Nuitka
  失败为故障注入，没有执行真实应用编译。
- 边界测试覆盖 3.10/3.11 准入、3.8/3.9/3.12/3.13/3.99/4.0 拒绝，并检查拒绝发生在
  venv 创建、依赖查询和安装之前。实际 Python 3.13.14 在隔离副本的准备、检查与服务器
  脚本入口均被拒绝且未创建 venv。Python 3.11 当前机器未找到，实机依赖安装与运行未验证。
- Bash/Python 语法检查及 CRLF 感知差异检查通过。提交前完整框架门禁退出 1：third-party
  bootstrap 的 CMake Python 包装入口缺少 `cmake` 模块，后续框架构建和回归未执行；日志为
  `__output__/archvisual/python_310_311_commit_20261104/framework-gate.log`。
  状态：已实施、定向验收通过、框架门禁未通过，未提交；未执行真实 Nuitka 应用编译。

## CSV 转换脚本合并与 Python 包索引（2026-11-04）

- 用户确认将 `utils/csv2hdf.py`、`utils/csv2json.py` 移入 `scripts/`；环境准备默认
  使用清华 PyPI 镜像，`-i INDEX_URL` 可为本次准备指定其他索引，并可与 `--python`
  组合。已同步更新脚本说明、README 和本仓库维护说明。
- Python 3.10.12 下环境、发布控制及真实 CSV 到 HDF5/JSON 转换共 51 项测试通过；
  参数回归覆盖默认和自定义索引、两种选项顺序、空值与缺值，日志见
  `__output__/archvisual/scripts_mirror_tests_20261104.log`。发布测试中的 Nuitka 失败
  为预期故障注入，未执行真实 Nuitka 应用编译。
- 清华 NumPy 索引 HTTP HEAD 返回 200；以 pip 从该镜像实际下载 Django 4.2.23 成功，
  日志见 `__output__/archvisual/scripts_mirror_20261104/mirror-download.log`。该探针
  仅验证单个软件包下载，不代表全量依赖的全新环境安装已完成。自定义索引的传递使用
  测试桩验证，没有对任意用户镜像站执行安装。
- 状态：已实施、定向验收通过，未提交。此前提交请求的框架门禁在修改前因 CMake Python
  包装入口缺少 `cmake` 模块失败；本次没有重跑完整框架门禁，也没有获得本轮豁免。

## 独立环境的宽松版本检查（2026-11-04）

- 历史记录：本节的独立宽松依赖文件已由后续“从参考清单提取包名”方案取代；
  本节测试对应当时源码与依赖清单，保留为历史证据。
- 用户确认取消 Python 3.12 及更新版本的上限，仅保留 3.10 下限；Python 版本与参考
  3.10 不同时警告，不因版本差异拒绝。原 `requirements.txt` 固定版本保留作为参考及
  父仓库工作区输入；ArchVisual 独立准备改用不带固定版本的 `requirements-flexible.txt`。
- 环境检查对与参考版本不同的已安装包发出 warning；必需包缺失或导入失败仍报错，
  Nuitka 仅构建检查需要。Python 主/次版本与已有本地 `.venv` 不一致时仍阻止准备；
  检查、运行不安装软件包。pip 可为依赖一致性调整已安装包，不保证所有组合兼容。
- Python 3.10.12 的原参考环境及全新 Python 3.13.14 环境各通过 55 项环境、发布控制
  与 CSV 转换测试；发布控制测试的 Nuitka 构建失败为故障注入，不是实际应用编译。
  日志为 `__output__/archvisual/flexible_python_20261104/full-existing-3.10.log`、
  `full-fresh-3.13.log`。差异 warning、缺包/导入失败、最低版本及 Nuitka 构建条件均有
  对应检查；两套已有环境的初步 21 项环境测试也分别通过。
- 全新 Python 3.10 与 3.13 环境均通过正式 `setup_python.sh --prepare` 和真实 pip
  安装。3.10 实际解析 Django 5.2.19、NumPy 2.2.6、pandas 2.3.3、blosc2 4.3.3、
  PyTables 3.10.1；3.13 为 Django 6.1.3、NumPy 2.5.4、pandas 3.1.0、blosc2 4.14.1、
  PyTables 3.11.1。两者 Nuitka 均为 4.3.4，均与参考版本不同，检查正确警告并通过。
  安装证据为 `__output__/archvisual/flexible_python_20261104/prepare-fresh-3.10.log`、
  `prepare-fresh-3.13.log`。重复准备 3.13 环境成功，前后 `pip freeze --all` 字节一致；
  两套新环境的 `python -m pip check` 均通过；不据此保证其他依赖组合或 pip 冲突处理
  不更改版本。
- 旧 3.10、旧 3.13、新 3.10、新 3.13 四组各通过 11 项 Django/H5 测试；两套新环境
  各通过 2 项 CSV 转换测试。四组均通过实际服务器启动及 MetricViewer 页面 HTTP 200
  检查，服务已停止；证据位于上述目录的 `django-*.log`、`conversion-*.log`、
  `server-probe.json`、`server-*.log`。没有以 HTML 请求成功替代 H5 测试。
- 原固定依赖文件字节未改。状态：已实施、定向验收通过，未提交；Python 3.11/3.12/
  3.14 等其他版本、其他平台与真实 Nuitka 应用编译未实测，未执行完整框架门禁。

## 从参考清单提取包名（2026-11-04）

- 用户确认删除独立宽松依赖文件。ArchVisual 准备流程从本仓库 `requirements.txt`
  提取包名，忽略参考版本后作为独立参数传给 pip；检查流程继续使用同一文件的参考版本
  生成 warning。父仓库使用该文件的固定版本合同不变，原文件字节未改。
- Python 3.10.12 与 3.13.14 的环境测试各 23 项通过，覆盖清单解析、pip 参数不带
  固定版本、版本差异警告和缺包/导入失败；3.13 环境/发布控制/转换回归 55 项通过。
  日志见 `__output__/archvisual/single_requirements_20261104/env-3.10.log`、
  `env-3.13.log` 和 `full-3.13.log`。发布测试的构建失败为故障注入，未执行真实
  Nuitka 应用编译。
- 不含第二份依赖清单的两套全新独立环境均通过正式准备及真实 pip 安装，分别的 Django/H5
  测试 11 项和 `pip check` 均通过。3.13 重复准备前后 `pip freeze --all` 字节一致，
  不保证其他依赖冲突下 pip 不调整版本。证据见同目录的 `prepare-fresh-*.log`、
  `django-*.log`、`prepare-repeat-3.13.log` 和前后 freeze 文件。
- 状态：已实施、定向验收通过，未提交；完整框架门禁与真实 Nuitka 应用编译未执行。

## 内部脚本归并与环境入口合并（2026-11-04）

- 用户已确认实施。环境与发布模块、原根目录三个测试已移入 `archvisual/scripts/`；
  `setup_python.sh` 合并环境函数并以执行保护区分 source/CLI，删除原本地 shared_env.sh。
  已更新 Django、Nuitka、发布脚本、Heat 验收入口与使用说明。
- Python 3.10.12/3.13.14 各 57 项环境、发布控制、CSV 转换测试通过，日志为本轮目录
  `tests-3.10.log`、`tests-3.13.log`；新增 source 保持 Shell 选项且不触发 CLI、迁移模块
  仍锚定仓库根目录的回归。发布测试中的编译错误属于预期故障注入。
- 两套独立副本均通过正式清华镜像准备、只读环境检查、`pip check`、Django check 和
  从副本外启动的 MetricViewer HTTP 200；各 11 项 Django/H5 测试通过，见
  `django-tests-3.10-final.log`、`django-tests-3.13-final.log`。验收服务均已停止。
- 保留验收问题及恢复证据：3.10 首次准备超过验收脚本 300 秒时限（退出 124），pip 子进程
  随后完成并退出；正式入口重新准备和检查通过，见 `prepare-3.10-recovery.log`。
  首次 Django 测试发现将隔离目录名 `isolated-3.10`/`isolated-3.13` 当成包名，未进入业务
  测试；改为明确的 `dataviewer.tests` 模块后两套均通过，未修改业务代码或测试断言。
- Python 3.10.12 / Nuitka 4.3.4 的正式 `build_visual.py` 独立构建退出 0，见
  `nuitka-build.log`。为允许正常编译完成，外层验收调度器暂停计时后恢复收集实际退出码；
  编译与构建进程始终继续运行，没有跳过构建步骤，过程见 `build-monitor.json`。
- 产物移至 `relocated-artifact/`，原构建源码副本在验证时暂时改名并于结束后恢复；清除
  PYTHONPATH，从外部目录运行。产物 Django check、环境模块 PROJECT_ROOT 精确指向
  产物根目录、11 项真实 H5 测试、MetricViewer HTTP 200 全部通过，见
  `artifact-result-final.json` 与 `artifact-*-final.log`，服务已停止。
- 首次产物路径探针使用 `shell -c`，被 Nuitka 自调用保护拒绝（退出 2），见
  `artifact-paths.log`；换用 Django 等价的 `shell --command` 后通过。未关闭保护、
  修改产品构建参数或放宽路径断言，原始与最终结果分别保存。
- 本轮证据：`__output__/archvisual/scripts_cleanup_20261104_vhmtdu_z/`，`before/` 保存
  本次修改前副本；`baseline.json` 保存受保护的版本文件、未知数据和此前 UI 修改哈希。
  不修改或清空共享 index，不将此前定向 PASS 当作本轮验收。
- 状态：实现与本轮定向验收完成，未提交、未发布。完整框架门禁未运行；Python 3.13 的
  Nuitka 应用编译、其他 Python 版本及其他平台不在本轮实测范围。

## Line 默认最大值与本地提交审查（2026-11-04）

- Line 默认最大值的用户批准已实施：`archvisual/dataviewer/templates/metricviewer.html`
  仅为 `max_value` 输入框增加 `value="-1"`。本轮逐 hunk 审查确认此唯一差异；没有为该
  单行默认值修改新增浏览器交互验收，不将后端测试当作浏览器验证。
- 用户请求提交本线代码，两个仓库均为 main 且 index 为空。本轮审查确认当前源码与
  `scripts_cleanup_20261104_vhmtdu_z/source-files-final.json` 哈希一致；Python 编译语法、
  Bash/JavaScript 语法及 CRLF 感知差异检查通过。可选 flake8/isort 未安装。
- 本轮实际执行 `bash scripts/run_micro_regression.sh`，退出 1。术语、CGA 工具链能力、
  runtime SDK、参数和模型图头文件检查通过；第三方准备调用
  `/home/liyijun04/.local/bin/cmake` 时出现 `ModuleNotFoundError: No module named 'cmake'`，
  后续后端构建和回归未执行。当前失败日志为
  `__output__/archvisual/commit_cleanup_20261104_R2AAO9/framework-gate.log`，不是旧门禁结果。
- 提交计划：Line 默认值、独立 Python 准备与脚本归并分别形成 ArchVisual 本地提交；
  根仓库随后仅同步 ArchVisual gitlink 和本线 spec/plan。完整清单与说明保存于同目录
  `commit-plan.txt`。未知 `version.txt`、`dataviewer/static/data/sp.json` 和其他线修改排除。
- 用户随后明确回复“豁免本轮门禁，按三笔清单提交”，授权仅限本轮清单；门禁仍记为失败，
  不记为 PASS，也不修订原验收证据。
- ArchVisual 本地 main 已提交：`2f5a3f48967055123512bacbc01460f0bcee1b5b`（Line 默认最大值）、
  `983f35e68ada90bf1fd4da8117a2982270d9ee1c`（独立 Python 准备与脚本归并）。
- 根仓库本笔提交同步上述 ArchVisual gitlink 与本线 spec/plan；本轮只作本地提交，
  未推送。完整提交回执见同一证据目录 `commit-result.json`。

## View/Split 分界线拖动调整比例（2026-11-04）

- 用户已确认方案：MetricViewer Line/Heat、TraceViewer、Metric vs. Trace 外层及嵌入分窗
  统一支持分界线拖动，按方向保留比例，双击均分，120px 最小面板及小视口退让。
- 已接入共用分窗脚本/样式；Line 改为观察图表实际尺寸；Trace 在主画布尺寸更新时保留
  时间范围；未改变 Heat 单格、sample 范围、数据计算和既有联动协议。
- 本轮证据目录：`__output__/archvisual/split_resize_20261104/`，`before/` 保留修改前文件，
  `excluded-sha256.txt` 保存未知 `version.txt`/`sp.json` 哈希。
- 最终源码验收：`final/result.json` 中 11 组浏览器检查通过，包含两个拖动方向、方向独立
  比例恢复、双击均分、120px 下限、小视口、刷新、方向键、活动面板保持、取消清理、
  每面板多张 Heat 图、嵌套 iframe 与 DPR 1/2 的 Trace 时间范围保持。浏览器错误为空。
- 原有回归：`heat_stability_final/stability-result.json` 的 20 项 Heat 稳定性检查通过，
  包含各布局五种视口、悬停和静止滚动通知；`trace_sync_final/result.json` 的 17 项真实
  键盘/Metric–Trace 联动检查通过。最终源码指纹见 `source-files-final.json`。
- Python 3.10.12 独立环境下 11 项 Django/H5 测试通过（`django-tests.log`）；JavaScript
  及模板内脚本语法、CRLF 感知差异检查通过。MetricViewer 原 CRLF 和排除文件哈希保留。
- 失败保留：`attempt1` 的第二面板 Plot 等待超时，原因为测试向第一个面板选择列表添加
  指标，已修正；`attempt2` 的 Line/Heat 与拖动检查通过，Trace 范围断言失败，经 HTTP
  内容核对发现 `--noreload` 服务仍缓存旧 Trace 模板，重启本轮服务后继续验证。
- `attempt3` 完整分窗通过后，旧 Heat 稳定性回归曾在上下布局的空闲区间多出两次 resize
  （`heat-stability.log`）；带尺寸记录的诊断复验未复现持续循环。新分窗固定像素基准会在
  视口变化后下一帧才校正，已改为 CSS 比例/clamp 同步布局，切换方向同步应用；保留原
  测试的等待时间和断言，最终分窗及 Heat 稳定性回归均通过，没有放宽门禁。
- 状态：实现及本轮定向验收完成，未提交、未发布；本轮未执行完整框架门禁，不沿用上一轮
  豁免。验收浏览器关闭，专用 18137 测试服务停止；原有其他服务和共享 index 未改动。

## 分窗分界线与鼠标操作区收窄到 2px（2026-11-04）

- 用户明确确认“改为 2px，按此实施”。共用分界线可见宽度、鼠标操作区、布局扣除宽度
  由 6px 改为 2px，拖动中心偏移由 3px 改为 1px；三个页面的共用静态资源版本更新至 v=2。
- 本轮运行 `dataviewer/test_split_resize.cjs`，11 组浏览器检查全部通过，前端错误为空；
  每次真实拖动前断言分界线实际宽度/高度为 2 CSS px，覆盖 Line/Heat、Trace、组合页及
  嵌套分窗、两个方向、比例恢复、均分、最小尺寸、取消清理与 DPR 1/2 时间范围保持。
- JavaScript 语法及 CRLF 感知差异检查通过。证据为
  `__output__/archvisual/split_2px_20261104/browser/result.json`；本轮 before/、增量差异、
  源码哈希和结果回执保存在同目录。未知版本文件及 sp.json 哈希未变。
- 状态：已实施、定向验收通过，未提交、未发布；本轮未重跑后端测试或完整框架门禁。
  验收浏览器已退出，专用 18137 测试服务停止。

## Sync/async 按钮替换勾选框（2026-11-04）

- 用户确认将 Sync 标签与勾选框替换为固定宽度按钮，默认 `sync`，每次点击循环切换为
  `async`/`sync`。实现采用原生 52px 按钮和 `aria-pressed` 状态；自动发送与接收共用
  状态读取函数。切回 sync 后由后续交互恢复联动，切换动作本身不改变视图时间范围。
- 更新真实联动回归入口 `dataviewer/test_trace_metric_sync.cjs`；DPR 1/2 下 23 项检查
  通过、前端错误为零，包含原有键盘平移、关闭两个同步方向、Enter 恢复后双向联动、
  Space 切换、重复真实鼠标点击、按钮文字/可访问状态及等宽验证。截图已查看。
- 本轮证据：`__output__/archvisual/sync_button_20261104/browser/result.json`，同目录保存
  before/、增量差异、源码哈希、日志和结果回执。JavaScript/模板内脚本语法、CRLF 感知
  差异检查通过；MetricViewer 的 CRLF、2px 分窗实现及未知版本文件、sp.json 保留。
- 状态：已实施、定向验收通过，未提交、未发布；未重跑后端测试或完整框架门禁。
  验收浏览器退出，专用 18137 服务停止；原手动同步快捷键和 Heat 联动语义未扩展。

## CSV samplePeriod 元数据与采样周期只读显示（2026-11-05）

- 用户批准 CSV `samplePeriod` 行写入 H5 `config.SamplePeriod`，并明确选择缺少时留空。
  已实施共用解析器 `archvisual/scripts/metric_csv.py`，接入上传、服务器加载和 csv2hdf；
  去除 CSV 路径写死的周期 100，metadata 不进入指标，保留 sample 标签和浮点数值，
  无表头时保留首条指标。没有基于时间标签推导周期，没有修改 Profanalyz 产物或计算。
- MetricViewer 改为每个文件独立保存、只读显示有效周期；加载、活动分窗切换和重载
  缺少 metadata 的文件时正确更新或清空。缺少周期时保留绘图，跳过自动/手动时间同步；
  有效周期继续使用既有 sample-index/Trace 时间单位，接收方向改为发送方向的逆运算。
  Trace 目标仍为主 Metric 分窗；源分窗和目标分窗分别使用所属文件周期。
- 首轮浏览器发现重复加载后一次缩放发出 9 条同步消息：旧 datazoom 回调累计并捕获
  旧采样轴。重载时替换该回调后，原断言保持不变，最终通过。首轮失败证据保存在
  `__output__/archvisual/sample_period_20261105/browser/result.json` 与 `browser.log`。
- 本轮实际验收：Python 3.10.12 独立环境下 Django 系统检查通过、16 项后端/API 检查
  通过（`django-tests-final.log`）；6 项转换/解析测试通过（`conversion-tests.log`）。
  CSV 转换以独立脚本从其他 cwd 实际执行，覆盖周期元数据、无周期、无表头、无效/重复
  声明、大小写/BOM/填充和采样值保留。Django 首轮新增测试误用不存在的 get_value，
  已改为实际 get_all 接口；原 3 处错误保留在 `django-tests.log`，不是产品加载失败。
- Chrome 浏览器 14 项采样周期集成检查通过（`browser-final/result.json`），包含真实
  CSV/H5 上传与服务器加载、转换后的 H5、只读与空值、Line/Heat、多分窗独立周期、
  period=250 双向同步、period=125 的第二分窗及缺少周期时阻止无效同步；截图已查看。
  原有 DPR 1/2 的 23 项真实 Metric/Trace 键盘/Sync 按钮回归通过
  （`trace-sync/result.json`）。两组浏览器错误均为空。
- 同目录保存本轮 before/、baseline.json、增量差异、源码哈希、Python 依赖版本警告与
  最终回执。Python/JavaScript 语法、CRLF 感知差异检查通过；未知 version.txt/sp.json
  和此前其他 UI 修改的受保护哈希未变。当前依赖版本区别于 requirements.txt 参考值，
  本轮使用现成独立环境，没有安装或更改依赖。
- 状态：实现及定向验收完成，未提交、未发布；完整框架门禁未运行，不沿用此前豁免。
  浏览器退出，本轮专用 18139 服务停止；共享 index 未改动。

## ArchVisual 本地提交审查与框架门禁（2026-11-05）

- 用户请求提交 ArchVisual 修改。已逐文件/hunk 核对范围：2px 分界线拖动、Sync/async
  按钮、CSV/H5 采样周期元数据分别组成三笔 ArchVisual 提交；根仓库随后仅提交
  ArchVisual 子模块指针及本线 spec/plan。两处 main 的暂存区起始均为空，尚未暂存。
- 当前源码与此前分窗、按钮、采样周期验收哈希对应。共用 metricviewer.html 的两个
  中间版本从保存的前后像重建，分别与 split_2px/sync_button 的已验证 SHA256 一致；
  不改写当前工作区来拆分提交。未知 version.txt、static/data/sp.json 及所有其他线修改
  明确排除，不推送。清单、具体消息和审查结果在
  `__output__/archvisual/commit_review_20261105/commit-plan.txt`、`commit-plan.json`、
  `review.md`；before/ 和 baseline.json 保存本轮前像与范围哈希。
- 本轮 Python py_compile、独立 JavaScript/模板脚本语法、CRLF 感知 diff 检查通过；
  可选 flake8/isort 未安装。未重复运行已通过且对应源码未变的 ArchVisual 定向测试。
- 实际运行 `bash scripts/run_micro_regression.sh`，退出 1。当前术语扫描（128100 文件）、
  CGA 工具链能力、runtime SDK 与参数/模型图生成检查通过；第三方 bootstrap 调用
  `/home/liyijun04/.local/bin/cmake` 时报 `ModuleNotFoundError: No module named 'cmake'`。
  后续构建及 func/cost/arch/replay 回归未执行。完整日志为同目录 `framework-gate.log`。
- 状态：提交审查已完成；按提交技能硬门禁停止，未提交、未推送、未修改共享 index。
  既往豁免不适用于本轮，等待用户明确处理本轮门禁失败或授予本轮四笔清单豁免。
- 用户随后明确回复“豁免本轮框架门禁，按四笔清单提交”。此批准仅覆盖本轮已审查的
  四笔本地提交；门禁继续记为失败，后续回归继续记为未执行，没有以豁免替换 PASS。
- ArchVisual 本地 main 已完成三笔提交，逐笔核对实际文件/hunk 范围：
  `425e27879a742cdc21496f7affe24af06f6f0c4a`（2px 分界线拖动与范围保持）、
  `b0cc64c868f36222599c0b7ddb6d5aa2e27eae54`（Sync/async 按钮）、
  `6f92ee28becc0a78c3ec50cad38d16632c9a0393`（CSV/H5 采样周期元数据与只读显示）。
  各笔仅包含所需实现及测试/说明，共用模板用已验证快照逐笔暂存，工作区最终内容未回退。
- 本笔根仓库提交仅更新上述 ArchVisual gitlink、本线 spec/plan。子模块剩余修改仅为
  原有未知 version.txt 与 static/data/sp.json，已按哈希核对并保留。其他开发线文件
  均不纳入；未推送。批准、各笔暂存差异及提交回执保存在同目录 `approval.json`、
  `staged-*.patch`、`commit-*-receipt.json`；完整结果见 `commit-result.json`。

## 简化 ArchVisual Python 入口为当前 PATH（2026-11-05）

- 用户明确批准删除独立环境准备/解释器选择机制，直接使用系统提供的环境。已将
  `run_visual.sh`、`rel_visual.sh`、采样周期及 Heat 浏览器验收入口改为调用 PATH 中的
  `python3`；构建子进程继续使用 `sys.executable`。没有搜索 `.venv` 或设置
  `ARCHVISUAL_PYTHON`，调用者主动激活的环境自然通过 PATH 生效。
- 删除 `scripts/setup_python.sh`、`scripts/archvisual_env.py` 和旧环境管理测试；
  纯输出路径逻辑迁为 `scripts/paths.py`，同步 Django、构建、支持测试和使用说明。
  删除 Python 环境锁、版本/包版本比较和 macOS 解释器来源拦截；保留源码路径保护、
  输出覆盖及旧别名、按源仓库串行的发布锁、平台标签、原子发布和回滚。父仓库所消费的
  `requirements.txt` 参考版本未改，运行/构建不读取它，不安装或修改 Python 依赖。
- 实际系统解释器为 `/usr/bin/python3` 3.10.12，Django 5.2.9、pandas 2.0.3、
  NumPy 1.24.4、PyTables 3.8.0、Nuitka 2.7.12；版本回执 `system-python.json`。
  缺少参考列表中的 django-cors-headers，但当前应用没有导入/启用 corsheaders，实际
  启动及功能检查通过。已纠正最初“缺少该包会阻止启动”的预判，并修正说明中的必需包。
- 当前源码下 44 项路径/入口/发布/转换测试通过，16 项 Django/API 测试通过，Django
  系统检查通过。`scripts/test_paths.py` 使用真实 Shell 入口验证 PATH 选择、独立目录、
  空格参数、退出码透传及本地/父目录虚拟环境不覆盖 PATH；输出路径和符号链接保护均
  有检查。发布测试为真实 Shell 事务加构建故障注入，其预期编译错误不记为产品失败。
- 使用系统 Python 启动专用 18139 服务，14 项采样周期浏览器检查和 16 项 Heat 统计
  检查通过，前端错误均为空，截图已查看；真实 CSV/H5 转换、加载、分窗周期和 Line/Heat
  切换工作正常。浏览器已退出，源码验收服务已停止。
- 本轮证据目录为 `__output__/archvisual/path_python_20261105/`，包含 before/、
  baseline.json、system-support-tests.log、system-django-check.log、
  system-django-tests.log、sample-period/result.json 与
  heat-statistics/statistics-result.json。旧环境管理源码引用扫描、Python/JavaScript/
  Shell 语法、CRLF 感知差异检查通过；未知 version.txt、sp.json、参考 requirements、
  发布事务模块和 MetricViewer 模板的受保护哈希未变。
- 真实独立构建通过：系统 Python 3.10.12 / Nuitka 2.7.12 执行正式 `build_visual.py`
  退出 0，日志为 `system-build.log`。Nuitka 的系统发行版包提示保留在日志中，未放宽
  检查或调整已安装依赖；本轮没有执行真实发布或版本更新。
- 将生成程序迁移至 `relocated-artifact/`，清除 PYTHONPATH/PYTHONHOME/虚拟环境及
  ArchVisual 输出覆盖，从独立 cwd 运行。Django check 通过；路径断言确认 PROJECT_ROOT、
  static 和 temp 均定位在产物目录；16 项 Django/API 测试实际执行并通过；MetricViewer
  返回 HTTP 200。回执为 `artifact-result.json`，对应日志为 `artifact-*.log`。
  产物服务已停止，未临时改名或遮蔽共享工作区源码；模块路径断言定位到迁移产物自身。
- 保留一次验收调度失败：Nuitka 已打印生成成功，但外层脚本尚未移动产物、退出时，
  过早启动产物验收，前置目录断言失败，没有进入业务检查或移动产物。证据保存为
  `artifact-result.json.premature` 和 `artifact-verification.log.premature`。
  等正式构建退出 0 后按原检查重跑通过；没有修改产品代码或放宽断言。
- 最终源码/受保护哈希、前后像、增量差异与验收汇总见本轮目录 `result.json`、
  `source-files-final.json`、`after/`、`incremental.patch`。
- 状态：实现、运行定向验收和独立构建/产物验收完成，未提交、未发布。其他 Python
  版本及平台未在本轮实测；未运行完整框架门禁，不沿用上一轮提交豁免；没有改动共享
  index 或其他开发线文件。

## Python 入口简化的本地提交审查（2026-11-05）

- 用户请求“提交代码”。拟分两笔语义完整的本地提交：ArchVisual 的 PATH Python
  入口简化（17 个实现、测试和说明文件一起提交）；根仓库随后仅更新 ArchVisual
  子模块指针、spec_archvisual.md 与 plan_archvisual.md。未把路径模块迁移与其
  消费者拆为不可运行的中间提交。
- 已逐文件/hunk 对应本会话前后像和实际验收 SHA256。19 个本线文件状态与
  `path_python_20261105/source-files-final.json` 一致；迁移的 6 个路径函数经 AST
  比较与原实现完全相同。未知 version.txt、static/data/sp.json、根目录
  archvisual.tar.bz2 和所有其他线修改明确排除，未更改 requirements.txt。
- 此次提交审查重新执行 Python py_compile、Shell/JavaScript 语法和 CRLF 感知差异
  检查，均通过；可选 flake8/isort 未安装。源码未变的 44 项支持、16 项 Django、
  30 项浏览器检查及真实独立构建和迁移产物 16 项 Django 检查复用上一阶段回执，
  不描述为此次重新运行。
- 实际执行 `bash scripts/run_micro_regression.sh`，退出 1。术语扫描、CGA 工具链
  能力、runtime SDK、参数头及模型图生成检查通过；第三方 bootstrap 调用
  `/home/liyijun04/.local/bin/cmake` 时报 `ModuleNotFoundError: No module named 'cmake'`。
  后续设备构建及 func/cost/arch/replay 回归未执行；未调整共享 Python 环境或削弱门禁。
- 证据目录为 `__output__/archvisual/path_python_commit_20261105/`：before/、
  baseline.json、style-checks.json、framework-gate.log/.exit、review.md 及
  commit-plan.txt/.json 保存前像、归属、检查结果、两笔具体提交消息和完整排除清单。
- 状态：提交审查完成，框架门禁未通过。按提交技能硬门禁停止，尚未暂存、提交或推送；
  两个仓库均在 main，暂存区为空。此前提交豁免不适用于本轮，等待用户决定修复门禁
  或明确豁免本轮两笔限定提交。
- 用户随后明确回复“豁免本轮门禁，按两笔清单提交”。本次授权仅覆盖上述两笔本地限定
  提交，不覆盖未知修改或其他开发线。门禁继续记录为失败，后续框架回归继续记录为
  未执行；豁免不替换实际检查结果，不扩展为后续提交的长期豁免。
- ArchVisual 本地 main 已完成 `5ed2616f46c90fb3f100684ab93253f34886fd09`
  （`[archvisual] refactor: use Python from the current PATH`），逐文件核对实际提交
  恰好包含清单中的 17 个文件，提交树与已审查暂存树一致，暂存区已清空。
- 本笔根仓库提交仅将 ArchVisual gitlink 更新至上述提交，并纳入本线 spec/plan；
  未夹带 version.txt、static/data/sp.json、根目录发布包及其他线修改，未推送。
  本轮批准、两笔消息、暂存差异和提交回执保存在同一证据目录的 approval.json、
  approved-commit-plan.json、staged-*.patch、commit-*-receipt.json；两笔完整结果
  见 commit-result.json。未知版本文件及数据文件继续按原哈希保留。

## MetricViewer 保留绘图的 Reload 实施与验收（2026-11-05）

- 用户批准“按此方案实施，本地文件允许重新选择”。已在 Load 下拉菜单首位增加
  `reload`；无来源或加载进行中禁用。每个分窗独立记录成功加载的服务器绝对路径或
  本地文件名；本地重选绑定打开选择器时的目标分窗，同名选择能够再次触发上传。
- Line 仅更新采样轴、序列数据和与采样周期关联的上限，保留绘图分组、样式、图例、
  缩放、滚动及固定快照。Heat 在原 map DOM 上更新数据及全文件统计，保留多个 Plot、
  颜色设置、横向单格宽度、滚动和侧栏宽度。缺失指标留空并提示，后续恢复及 Line/Heat
  往返切换均保留其位置；普通文件加载保留原初始化路径。
- upload/server_load 增加可选 `reloadQuery`，在替换后端当前数据前完成读取、已绘制
  指标校验和响应序列化。失败保留旧数据。Line 请求代次与 Heat 原有请求代次共同
  防止旧响应覆盖新数据；Reload 期间 Clear/Delete 已移除的 Heatmap 不会恢复。
- 实际使用 PATH `/usr/bin/python3` 3.10.12、Django 5.2.9、pandas 2.0.3、
  NumPy 1.24.4、PyTables 3.8.0，真实 Chrome/Playwright 在专用 18139 服务验收；
  未修改 Python 环境、依赖声明、版本号、共享 index 或其他开发线文件。
- 21 项 Django/API 测试与 Django `check` 通过。新增 14 组真实 CSV/H5 浏览器检查
  通过：菜单与禁用、服务器来源保持、Line 设置/快照、缩短范围、缺失恢复、失败保留、
  双分窗隔离、本地取消/同名重选/错误文件名、Heat 多 Plot/非默认单格宽度/侧栏/统计、
  缺失指标模式往返、旧响应抑制、Clear 期间 Reload、空 Plot 的两种模式重载。
- 既有 14 项 samplePeriod 浏览器检查通过；既有 16 项 Heat 统计检查通过，并在补齐
  缺失指标的模式往返处理后重跑通过。前端异常均为空；Python AST、JavaScript 语法、
  CRLF 保留及限定范围差异检查通过，已查看菜单和多 Heatmap 的截图。
- 初轮 Django 测试夹具因 fixed-format H5 不允许重复列而失败，改用支持重复列的
  table format 后通过；早期浏览器测试夹具的快照调用参数、遮挡菜单的位置及未创建
  快照列表访问也已修正。原始失败日志保留，没有将其记录为产品 PASS。
- 证据：`__output__/archvisual/reload_20261105/` 的 `before/`、`baseline.json`、
  `django-tests.log`、`django-tests-rerun.log`、`django-check.log`、`browser/result.json`、
  `browser-roundtrip.log`、`sample-period/`、`heat-statistics-final/`、`reload-menu.png`、
  `result.json`。测试入口新增 `archvisual/scripts/test_metric_reload.cjs`，支持
  `METRIC_RELOAD_TEST_OUTPUT` 指定证据目录，运行示例见测试首部与该目录实际回执。
- 状态：本次功能实现与定向验收完成，未提交、未推送。未运行完整框架门禁或重新构建
  Nuitka 发布包；历史提交豁免不适用于后续提交。

## MetricViewer Reload 本地提交审查（2026-11-05）

- 用户请求“提交修改”。已将 8 个本线文件逐一对应
  `reload_20261105/source-files-final.json`，哈希全部一致，前后像和 hunk 归属明确。
  21 项后端与 44 项浏览器检查复用刚完成的相同源码验收，不表述为本次重新执行。
- 拟两笔语义完整的限定提交：ArchVisual 的 Reload 实现、必要测试和 README 共 6 个
  文件；随后根仓库仅更新 ArchVisual 子模块指针及 spec_archvisual.md、plan_archvisual.md。
  version.txt、static/data/sp.json、根目录 archvisual.tar.bz2 及其他开发线修改排除。
- 本次实际执行 Python py_compile、JavaScript 语法、CRLF 保留与限定范围差异检查，
  均通过；可选 flake8/isort 未安装。未发现本次变更的阻断性审查问题。
- 实际运行 `bash scripts/run_micro_regression.sh`，退出 1。当前术语扫描、CGA 工具链
  cga1/cga2 能力、runtime SDK、参数头及模型图生成检查通过；第三方 bootstrap 调用
  `/home/liyijun04/.local/bin/cmake` 报 `ModuleNotFoundError: No module named 'cmake'`。
  后续设备构建和 func/cost/arch/replay 回归未执行，未修改共享 Python 环境。
- 证据目录：`__output__/archvisual/reload_commit_20261105/`，包含 baseline.json、
  before/、style-checks.json、framework-gate.log/.exit/.json、review.md、
  commit-plan.json 和两笔待提交消息。独立 ArchVisual 的进程全局数据模型、本地同名
  文件依赖用户选择、冻结快照的边界保持原批准方案。
- 状态：审查完成，框架门禁失败；依 commit 技能停止，尚未暂存、提交或推送。
  两个仓库均在 main，暂存区为空。需要用户单独决定本轮门禁豁免或处理门禁；
  此前豁免不延续到此次两笔提交。
- 用户随后明确批准“豁免本轮门禁，按两笔清单提交”。该豁免仅覆盖上述两笔限定
  本地提交；门禁仍记录为失败，后续框架回归仍记录为未执行，不覆盖后续开发或提交。
- ArchVisual 本地 main 已提交 `60120c1aadfff83ad950ec17987b8601e3d49b40`
  （`[archvisual] feat: reload metrics while preserving plots`）。已验证实际提交仅含清单
  中 6 个文件，提交树与审查的暂存树完全一致，ArchVisual 暂存区已清空。
- 根仓库期间新增 `10e0e4a64bf62ebca2dabb378153982cad6b620e`，仅涉及 microbench
  的 spec/plan，与本线无交叉。本笔根仓库提交仅更新 ArchVisual gitlink 至上述提交，
  并纳入本线 spec_archvisual.md、plan_archvisual.md；未知修改及其他开发线文件保留，
  不推送。实际提交范围、哈希与最终暂存区状态见同一证据目录的 commit-result.json。
- 本轮批准、两笔最终消息、暂存差异与提交回执分别保存为 approval.json、
  approved-commit-plan.json、commit-*-message.txt、staged-*.patch、commit-*-receipt.json。

## 二进制发布包 README（2026-11-05）

- 用户要求发布压缩包附带编译产物使用说明，并明确批准“按此方案实施”。新增
  `archvisual/scripts/README.release.md`，覆盖系统与依赖、解压、配置检查、前后台
  启停、访问地址、数据/输出路径和故障排查。文档使用可执行文件命令，不引入 Python
  环境管理，也不将未经验证的平台或发行版写为已支持。
- `rel_visual.sh` 在构建前检查说明源文件，构建后将其复制到产物 `README.md`；
  `scripts/release_tools.py` 要求归档中的 `archvisual/README.md` 为非空普通文件。
  `scripts/test_release_visual.py` 补充源文件缺失/空文件/目录、归档漏带说明及
  非法 README 类型的验证，并核对成功归档中的说明正文与源文件一致。
- 实际执行 `ARCHVISUAL_RELEASE_TEST_OUTPUT=/mnt/data/archexplor/__output__/archvisual/release_readme_20261105/tests python3 -B -m unittest scripts.test_release_visual -v`
  （工作目录 `archvisual/`）：33 项通过。测试使用隔离项目和模拟构建产物，覆盖本次
  README 打包及既有发布失败回滚；日志中的 Nuitka 退出 32 是测试主动注入的失败。
  Shell 语法、Python AST 与限定范围 `git diff --check` 通过。
- 使用此前实际编译的 Linux 产物
  `__output__/archvisual/path_python_20261105/relocated-artifact/archvisual`，在空 PATH、
  清除 Python/虚拟环境及动态库路径变量后验证 README 命令：`./archvisual check`
  退出 0，`runserver 127.0.0.1:33453 --noreload` 的首页返回 HTTP 200，随后停止服务。
  这仅验证已有产物的命令和独立启动，不代表本轮源码重新构建、后台启停或跨平台验收。
- 本轮仅修改说明、发布接入、必要测试及本线 spec/plan；开始时已有的
  `build_visual.py`、`version.txt`、`dataviewer/static/data/sp.json` 不属于本轮，保持原样。
  前后像、源码哈希、测试日志及运行回执保存于
  `__output__/archvisual/release_readme_20261105/`，总回执为 `result.json`。
- 状态：实现与定向验收完成，未生成正式发布包、未递增版本、未执行本轮 Nuitka 构建
  或完整框架门禁，未暂存、提交或推送。此前提交门禁豁免不延续到本次变更。

## 发布包 README 本地提交审查（2026-11-05）

- 用户请求“提交修改”。本线 6 个文件与 `release_readme_20261105/result.json` 中的
  验收源码哈希一致；33 项发布测试和已有 Linux 编译产物的命令检查复用该轮记录，
  不表述为本次重新执行。提交前实际执行 Python py_compile、Shell 语法及限定范围
  差异检查，均通过；可选 flake8/isort 未安装。逐文件审查未发现阻断性问题。
- 拟两笔本地 main 提交：独立 ArchVisual 的 `scripts/README.release.md`、
  `rel_visual.sh`、`scripts/release_tools.py`、`scripts/test_release_visual.py`；
  随后根仓库仅更新 ArchVisual 子模块指针及本线 spec/plan。已有 `build_visual.py`、
  `version.txt`、`dataviewer/static/data/sp.json` 和其他开发线修改全部排除。
- 审查时发现另一个 `rel_visual.sh` 发布构建正在运行，`build_visual.py` 进程
  PID 3842038、Nuitka 进程 PID 3842045，输出位于
  `archvisual/__output__/.release-staging/release.VnxgpI/`。本线未启动、停止或接管该
  构建，也不将其视为本次验收；按重型验收串行要求，完整框架门禁尚未执行。
- 证据目录：`__output__/archvisual/release_readme_commit_20261105/`，包含
  baseline.json、before/、style-checks.json、review.md、commit-plan.json 及待提交消息。
  两个仓库均在 main，审查时暂存区为空且无 index.lock；本线未暂存、提交或推送。
- 状态：提交审查完成，等待现有构建结束后执行框架门禁，或由用户明确豁免本轮门禁。
  先前提交豁免仅适用于已完成的历史提交，不自动覆盖本轮发布说明变更。
- 用户随后明确批准“豁免本轮门禁，按两笔清单提交”。本轮完整框架门禁记录为
  未执行，豁免仅覆盖上述两笔本地提交；33 项定向测试及已有产物命令检查继续引用
  相同源码的验收记录。提交前再次核对 6 个文件的审定哈希，全部一致。
- 复核时原发布编译进程已不在进程列表，`version.txt` 相比审查快照发生外部变化；
  本线保留其最新内容并继续排除，未将外部构建结果计为本轮验收。
  本轮批准、最终消息、暂存差异及提交回执保存于同一提交证据目录。
- ArchVisual 本地 main 已提交 `bc3af2adc96b25ba756bdd7f73fac4bf5b02d8d0`
  （`[archvisual] feat: include usage README in release archives`），实际范围恰为批准的
  4 个文件，提交树与审查的暂存树一致，暂存区已清空。本笔根仓库提交仅更新
  ArchVisual 指针至该提交并纳入本线 spec/plan；两笔实际提交范围和最终状态见
  `release_readme_commit_20261105/commit-result.json`。全程保留未知修改，不推送。

## 顶部工具栏统一 21px 实施与验收（2026-11-06）

- 用户明确批准“统一为21px，按此实施”。修改前真实 Chrome 测量：MetricViewer 按钮
  为 21px、输入框为 22px；Trace 的 View/Load/Save 为 21px，Flow events、Processes、
  View Options 为 20px。原始尺寸与截图见本轮证据目录的 before-dimensions.json。
- 新增 `archvisual/dataviewer/static/css/viewer_toolbar.css`，在 MetricViewer 模板及
  Catapult 静态 HTML 中标记顶部控件，清除冲突的内联高度，统一含边框高度为 21px；
  保留输入框和按钮外部宽度。TraceViewer 模板更新两个 iframe 的缓存标记。
  MetricViewer 保留 CRLF，未改动交互脚本、版本文件或未知 sp.json。
- Browser 插件没有可用浏览器连接；在本轮 `__output__` 下安装隔离的 Playwright
  测试依赖并使用本机 Chrome，未修改项目依赖声明或 Python 环境。独立测试服务使用
  当前 PATH 的 python3 和端口 18145，输出隔离至本轮 runtime/。
- 32 项最终浏览器检查通过，含 28 组实际尺寸记录：DPR 1/2 下 Line/Heat、Single、
  Hori/Vert、Trace 两个 iframe，以及 1600/1200px 组合页面全部顶部控件为 21px；
  单行对齐、原有外部宽度、sync 的 52px、菜单、输入、CSV 加载、采样周期、Plot、
  Heat 和 sync 切换通过。文件浏览框保留原有尺寸，Heat 侧栏未匹配顶部样式。
  浏览器 pageerror 为空，截图已查看。
- 首轮测量脚本因旧 WebComponents 的 NodeList 不支持迭代展开而失败，改为兼容读取；
  交互检查脚本误用局部变量 currentMetricNames，修正为 MetricNames 后通过。中间
  复测暴露 Catapult 内部盒模型覆盖及测试服务模板缓存，分别修正样式并重启本线服务。
  截图复核发现窄分窗多行居中会裁切首行，改为从顶部排列，并新增首行可见断言后
  重跑全部 32 项通过。原始失败与中间结果保留，不将其记录为最终 PASS。
- 证据：`__output__/archvisual/toolbar_height_20261106/` 中的 baseline.json、before/、
  before-dimensions.json、verify_toolbar.cjs、browser-result.json、browser-checks.log、
  页面截图及 result.json。临时测量与验证脚本仅在证据目录，不新增项目测试入口。
- 状态：本轮样式实现与定向浏览器验收完成，未提交、未推送；未运行完整框架门禁或
  构建发布包。历史提交豁免不适用于本轮变更。

## 顶部工具栏统一 21px 本地提交审查（2026-11-06）

- 用户请求“提交修改”。本轮 6 个文件与 `toolbar_height_20261106/result.json` 的
  验收源码哈希一致，复用 32 项浏览器检查、28 组尺寸场景；本次未重跑浏览器验收。
  逐文件审查未发现阻断性问题，限定范围差异检查通过，MetricViewer 保留 CRLF。
- 拟两笔本地 main 提交：ArchVisual 的共用 `viewer_toolbar.css`、MetricViewer 模板、
  Catapult 静态 HTML 和 TraceViewer 模板；随后根仓库仅更新 ArchVisual gitlink、
  `spec_archvisual.md` 和 `plan_archvisual.md`。未知 sp.json 和其他开发线修改排除。
- 根仓库原 gitlink 为 `bc3af2a`，ArchVisual 当前 HEAD 为用户已有提交 `5bf318f`
  （启动脚本改名为 run_visual.sh/.bat，版本 0.4.0 → 0.4.3）。新提交以该 HEAD 为
  父提交，根仓库指针更新会包含此既有祖先；本线不修改、重做或改写该提交。
- 取得重型验收协调锁后，实际执行 `bash scripts/run_micro_regression.sh`，退出 1。
  术语检查、CGA 编译器能力探测、SDK 启动合同及参数/模型头文件生成检查通过；
  第三方依赖初始化调用 `/home/liyijun04/.local/bin/cmake` 时出现
  `ModuleNotFoundError: No module named 'cmake'`，后续框架回归未执行。本轮不修复
  共享 Python/CMake 环境，不将已完成的界面验收表述为框架门禁通过。
- 提交检查脚本曾将 `git diff --no-index --check` 对新增文件的正常差异退出码 1
  误判为失败；其 stdout/stderr 均为空，修正收据脚本的退出码判断后检查通过，未改
  项目源码或放宽空白错误判断。原始命令结果与说明保留在 style-checks.json。
- 证据目录：`__output__/archvisual/toolbar_height_commit_20261106/`，含 baseline.json、
  before/、style-checks.json、review.md、framework-gate.log、framework-gate.exit、
  commit-plan.json 与两份待提交消息。审查开始时两个暂存区为空；曾观测根仓库
  index.lock 短暂存在，未删除或接管；尚未进入共享 index 的提交窗口。
- 状态：提交审查完成，未暂存、提交或推送；依据 commit 技能的 Exit 1 停止要求，
  等待用户明确选择修复门禁环境或豁免本轮门禁，并批准两笔提交清单与消息。

## TraceViewer 控制栏背景条统一 24px（2026-11-06）

- 用户要求 TraceViewer 灰色控制栏背景条遵照 MetricViewer 高度，并明确批准
  “按此方案实施”。修改前 Chrome 实测 MetricViewer 为 24px、TraceViewer 为 25px。
  Trace 主按钮行 21px 加上下各 1px 边距，共 23px；已隐藏脚本控制台的上下边框
  仍占 2px，使灰色背景总高为 25px。该结论来自实际 DOM 尺寸及样式，不仅是静态推测。
- 在 `dataviewer/static/catapult_trace_viewer.html` 中将主按钮行改为 border-box、
  24px 高度，上/下内边距 1px/2px、左右各 1px；脚本控制台隐藏状态去除上下边框占位。
  整个控制区仍按内容展开，控制台可见时恢复原有边框，提示信息不会被固定高度裁切。
  `dataviewer/templates/traceviewer.html` 的两个 iframe 同步更新缓存标记。
- 本轮没有改动 MetricViewer、共用 21px CSS、版本文件或未知 sp.json；它们与本轮
  baseline.json 中哈希一致。保留此前未提交的控件等高实现及其他开发线的工作区修改。
- 浏览器插件仍无连接，复用此前隔离安装的 Playwright 和本机 Chrome，不安装依赖。
  在端口 18145 启动本线独立服务，使用 PATH 中的 Python 3.10.12 和独立输出目录。
  修改模板后重启本线服务以刷新模板缓存，未操作用户已有的 5486 服务。
- 最终 34 项浏览器检查通过，包括 28 组尺寸场景：DPR 1/2，独立页面、Line/Heat、
  横向/纵向分窗、Trace 两个 iframe，以及 1600/1200px 组合页。两页背景条均为 24px，
  控件仍为 21px，单行控件上/下留白为 1px/2px，既有外部宽度及交互检查通过。
  新增控制台展开/收起和提示信息展开/清除检查，均恢复 24px，未裁切展开内容。
  两个 iframe 缓存标记检查通过，pageerror 为空，截图已复核；限定范围差异检查通过。
- 证据目录：`__output__/archvisual/trace_toolbar_background_20261106/`，包含 baseline.json、
  before/、before-dimensions.json、after-dimensions.json、measure.cjs、verify_toolbar.cjs、
  browser-result.json、browser-checks.log、截图及 result.json；验证脚本只保存在证据目录。
- 状态：实现与定向验收完成，本线测试服务已停止，未暂存、提交或推送，未运行发布构建。
  此前框架门禁的 CMake 环境失败仍未解决，本轮未重跑完整框架门禁、未取得豁免。
  此前待提交清单中的源码哈希已因这次批准的补充修改变化，后续提交前需刷新审查快照；
  原 32 项验收保留为历史证据，本轮最终源码以本节 34 项验收和 result.json 为准。

## 控件 21px / 背景条 24px 最终提交审查（2026-11-06）

- 用户再次请求“提交”。6 个文件与 `trace_toolbar_background_20261106/result.json`
  的验收哈希一致，复用相同源码的 34 项浏览器检查；限定范围差异检查和 CRLF 检查
  通过，审查未发现阻断性源码问题。本次没有重跑浏览器验收或发布编译。
- 在重型验收协调锁内重新执行 `bash scripts/run_micro_regression.sh`，实际退出 1：
  `/home/liyijun04/.local/bin/cmake` 仍报 `ModuleNotFoundError: No module named 'cmake'`，
  第三方依赖初始化失败，后续框架回归未执行。未修复共享环境、未取得本轮门禁豁免。
- 最终仍为两笔本地提交：ArchVisual 的共用 CSS、MetricViewer 模板、Catapult HTML、
  TraceViewer 模板；根仓库仅更新子模块指针及本线 spec/plan。保留 `5bf318f` 既有祖先，
  排除未知 sp.json 和全部其他开发线修改，不推送。
- 更新后的消息、精确清单、哈希、审查表和门禁日志位于
  `__output__/archvisual/toolbar_final_commit_20261106/`，分别为 commit-plan.json、
  commit-1-message.txt、commit-2-message.txt、review.md、framework-gate.log 与
  framework-gate.exit。此记录替代此前不含背景条修正的待提交快照。
- 状态：最终提交准备完成，两个暂存区为空；依据 commit 技能的 Exit 1 停止规则，
  尚未暂存或提交，等待用户选择修复门禁环境或明确豁免本轮门禁并批准两笔清单。
- 用户随后明确批准“豁免本轮门禁，按两笔清单提交”。本轮仅豁免上述两笔本地提交，
  框架门禁仍记录为实际退出 1；34 项浏览器验收复用相同源码证据，不重跑或改写结果。
  已再次核对 6 个审定文件哈希、两个 main 的 HEAD 及空暂存区；范围和消息批准记录
  保存为 approval.json，最终清单与消息保存为 approved-commit-plan.json。
- ArchVisual 本地 main 已提交 `b70fa293b98f515d75c910862666cefc94e08b29`
  （`[archvisual] fix: align viewer toolbar and control heights`），实际范围恰为批准的
  4 个界面文件；提交树与审查暂存树一致，暂存区为空，保护文件哈希未变。
  本笔根仓库仅更新 gitlink 至该提交并纳入本线 spec/plan；两笔实际范围、最终 HEAD
  和暂存区状态见同一目录的 commit-result.json。最终消息、暂存差异、协调锁重试及
  提交回执均保留在该目录；未推送，框架门禁失败和本轮豁免如实保留。

## MetricViewer / TraceViewer 背景条改为 23px（2026-11-06）

- 用户要求两页背景条改为 23px，并批准“按此方案实施”。当前 spec 已更新为最新
  裁决，保留此前 24px 的批准历史；控件仍为 21px，上下各留 1px。
- 修改 `metricviewer.html` 的背景条高度及独立/嵌入页面绘图区偏移：独立页面
  top 38→37px、height `100%-48px`→`100%-47px`；嵌入页面的 top 和扣减高度
  均为 24→23px。MetricViewer 保留 CRLF，绘图区底部位置不变。
- Catapult 主按钮行 24→23px，内边距统一为 1px；TraceViewer 两个 iframe 的
  缓存标记更新为 `20261106toolbar23`。共用 21px CSS、控制台展开规则、版本文件及
  未知 sp.json 均保持原样；本轮只修改 3 个界面文件及本线 spec/plan。
- 浏览器插件无连接，复用已有隔离 Playwright 和本机 Chrome；本线服务使用当前
  PATH 的 Python 3.10.12、端口 18145 和独立输出目录。修改模板后重启本线服务刷新
  缓存，验收完成后已停止，未操作用户已有的 5486 服务、未安装依赖。
- 本轮实际执行 34 项浏览器检查，全部通过；28 组尺寸场景覆盖 DPR 1/2、Line/Heat、
  独立页面、横向/纵向分窗和 1600/1200px 组合页。背景条均为 23px，控件为 21px，
  单行上下留白各 1px。绘图区紧接背景条、无空隙，MetricViewer 的原有底部位置保留。
  控制台/提示信息展开与收起、菜单/绘图等交互和两个 iframe 缓存标记检查通过，
  pageerror 为空，截图已复核；限定范围差异检查通过。
- 证据目录：`__output__/archvisual/toolbar_23px_20261106/`，含 baseline.json、before/、
  before-layout.json、after-layout.json、measure_layout.cjs、verify_toolbar.cjs、
  browser-result.json、browser-checks.log、截图及 result.json。临时验证脚本只在证据目录。
- 状态：实现与定向验收完成，未暂存、提交或推送，未运行发布构建或完整框架门禁。
  上轮门禁豁免仅覆盖已完成的两笔提交，不延续至本轮 23px 修改。

## 两页背景条 23px 本地提交审查（2026-11-06）

- 用户请求“提交”。5 个文件与 `toolbar_23px_20261106/result.json` 中验收哈希一致，
  复用相同源码的 34 项浏览器检查和 28 组尺寸场景；本次限定范围差异检查通过，
  MetricViewer 的 CRLF 保留。逐文件审查未发现阻断性源码问题。
- 取得重型验收协调锁后执行 `bash scripts/run_micro_regression.sh`，实际退出 1：
  术语检查扫描 128114 个文件，在 `plan_perfmodel.md:121–122` 发现两处
  `retired shared-storage identity`，于第三方依赖初始化和构建之前停止。
  该文件属于其他开发线，本线未修改；本次不得引用此前 CMake 错误作为当前失败原因，
  也不能将本次未执行的后续回归记录为通过。
- 拟两笔本地 main 提交：ArchVisual 的 MetricViewer 模板、Catapult HTML、TraceViewer
  模板；根仓库仅更新 ArchVisual 子模块指针及本线 spec/plan。未知 sp.json、共用 CSS、
  版本文件和其他开发线修改均不纳入，不推送。
- 本轮提交证据目录：`__output__/archvisual/toolbar_23px_commit_20261106/`，含 baseline.json、
  before/、style-checks.json、review.md、framework-gate.log、framework-gate.exit、
  commit-plan.json 和两份待提交消息。两个暂存区为空，尚未进入共享 index 提交窗口。
- 状态：提交准备完成，未暂存、提交或推送；依据 commit 技能的 Exit 1 停止要求，
  等待用户选择修复门禁问题或明确豁免本轮门禁，并批准两笔提交清单和消息。
- 用户随后明确批准“豁免本轮门禁，按两笔清单提交”。豁免仅覆盖本轮 23px 修改的
  两笔本地提交；术语门禁实际退出 1 及未执行的后续回归保持如实记录，不改其他线文件。
  提交前再次核对 5 个审定文件哈希、两个 main 的 HEAD 及空暂存区；批准与最终消息
  分别保存于 approval.json、approved-commit-plan.json 和 commit-*-message.txt。
- ArchVisual 本地 main 已提交 `90439f09383757556e39656bf452cff467cfd9c5`
  （`[archvisual] style: set viewer toolbar backgrounds to 23px`），实际范围恰为批准的
  3 个界面文件，提交树与审查暂存树一致，暂存区为空，保护文件哈希未变。
  本笔根仓库仅更新 gitlink 至该提交并纳入本线 spec/plan；两笔实际范围与最终状态
  见同一证据目录的 commit-result.json。暂存差异、协调锁重试和提交回执保留；未推送。

## Metric vs. Trace 独立网页图标（2026-11-06）

- 用户批准“按此方案实施”：深色圆角底、青色指标折线、橙色 Trace 事件条与白色
  时间游标。新增 `crossviewer.svg` 和 `crossviewer.ico`，仅修改 `crossviewer.html`
  的 favicon 引用，维护本线 spec/plan；主页模板和 `visualizer.ico` 保持原样。
- SVG 为矢量源文件，通过本机 Chrome 分别渲染 16/32/48/64px，并将相应 PNG 原始
  字节封装到 ICO；四帧逐像素与各自 SVG 渲染结果一致，未做二次缩放。浅/深背景的
  实际尺寸预览已检查。ICO 首次校验错误地要求每个尺寸的角像素 alpha 必须为 0；
  16px 角像素实际是 alpha 24 的抗锯齿边缘。修正为保留原始透明度的检查后通过，
  未修改图标来迎合断言。原始失败记录保存在 first-ico-check.json。
- Browser 插件无连接，复用已有隔离 Playwright 与本机 Chrome；未使用生成式位图
  工作流，未安装依赖。Python 3.10.12/Pillow 9.0.1 用于 ICO 封装和像素校验；本线
  独立服务使用端口 18145 和本轮输出目录，验收后已停止，未操作用户已有服务。
- 实际执行 8 项浏览器检查全部通过：主页 `/` 和 `/admin` 继续引用原图标，
  MetricViewer/TraceViewer 原图标保留；组合页引用独立 SVG/ICO，两个 iframe 来源不变；
  新资源均 HTTP 200、MIME 正确、服务字节与源码一致且浏览器可解码。pageerror 为空。
  SVG XML、ICO 四种尺寸与透明度、限定范围差异检查通过；保护文件哈希未变。
- 现有 build_visual.py 递归收集 dataviewer/static，可直接纳入新资源；本轮未运行
  发布编译或完整框架门禁，未新增永久测试入口，未暂存、提交或推送。
- 证据目录：`__output__/archvisual/crossviewer_icon_20261106/`，含 baseline.json、before/、
  render_icon.cjs、各尺寸 PNG、icon-preview.png、ico-checks.json、verify_icon.cjs、
  browser-result.json、browser-checks.log 和 result.json。此前提交豁免不延续到本轮。
- 提交前审查（用户“提交修改”）：本轮 5 个文件的哈希与实现验收一致，复用同一源码
  的 8 项浏览器检查；限定范围差异检查通过，8 个保护文件未变，两个仓库均在 main，
  暂存区为空。拟分两笔本地提交：ArchVisual 的模板和 SVG/ICO；根仓库的子模块指针
  与本线 spec/plan。未知归属的 sp.json 和其他开发线修改均排除。
- 本轮实际执行 `bash scripts/run_micro_regression.sh`，使用共享重型验收协调锁；
  门禁退出 1，当前内存术语检查扫描 128114 个文件，在 `plan_perfmodel.md:121–122`
  报告两处历史存储标识问题，后续构建与回归未运行。未修改其他开发线文档或放宽
  门禁；等待用户本轮豁免或修复裁决，尚未暂存、提交、推送。
- 提交审查证据：`__output__/archvisual/crossviewer_icon_commit_20261106/`，含 baseline.json、
  scoped-checks.json、framework-gate.log/.exit、review.md、commit-plan.json 和两笔消息草案。
- 用户明确批准“豁免本轮门禁，按两笔清单提交”：仅豁免本轮框架门禁失败，保留
  原始失败记录与后续回归未运行的事实。按已审查范围依次本地提交；主页与其他开发线
  修改不纳入，未授权推送。批准原文、提交前哈希及仓库状态见 approval.json。
- ArchVisual 本地提交已完成：`e94608b8fe36bafe8f97cb91ca174e41fca15231`，仅含已审查的
  crossviewer.html、crossviewer.svg、crossviewer.ico；实际提交树与审查暂存树一致，
  暂存区为空，保护文件哈希未变。本笔根仓库仅更新至该子模块提交并纳入本线
  spec/plan；两笔实际提交范围与最终状态见同目录 commit-result.json。未推送。

## Metric vs. Trace 图标透明背景（2026-11-06）

- 用户要求移除图标的背景方框和底色，并明确批准“按此方案实施”。从 SVG 中仅删除
  深色圆角背景矩形，保留折线、事件条和时间游标；重新渲染 16/32/48/64px ICO，
  crossviewer.html 的 SVG/ICO 缓存标记更新为 v=2，spec 已更新当前透明背景约束。
- 本机 Chrome 分别按目标尺寸渲染 SVG，再将 PNG 原始字节封装到 ICO。四帧逐像素
  匹配各自渲染结果，边缘和空白区域 alpha 为 0，图形可见；浅/深背景实际尺寸预览
  已检查。没有新增永久测试或安装依赖。
- 本轮实际执行 10 项浏览器检查全部通过：两种新资源加载和解码正常，浏览器画布
  验证透明背景；组合页引用 v=2，iframe 来源及其他页面图标保持原样，pageerror 为空。
  专用服务使用端口 18145 和独立输出目录，验收后已停止。Browser 插件无连接，复用
  已有 Playwright 1.65.0 和 Chrome 146.0.7680.80；Python 3.10.12/Pillow 9.0.1。
- 证据：`__output__/archvisual/crossviewer_icon_transparent_20261106/`，含修改前文件、
  各尺寸 PNG、icon-preview.png、ico-checks.json、browser-result.json 和 result.json。
  未运行发布编译或完整框架门禁；本轮尚未暂存、提交或推送。

## MetricViewer 面积图与热力网格融合图标（2026-11-06）

- 用户明确采用左下到右上（`/`，45°）对角融合并批准实施，取代上下切分提案。
  读取原 ICO 的 48px 帧及主色后，以 SVG 保留原有蓝绿面积图轮廓；热力色块位于
  对角线右下侧并裁剪到原外轮廓，保持透明背景。新增 metricviewer.svg、重新生成
  16/32/48/64px ICO；仅更新 metricviewer.html 的 favicon 引用和缓存标记，保留 CRLF。
- 已检查浅/深底下四种实际尺寸预览。ICO 四帧逐像素匹配各自 SVG 渲染，透明区域
  和可见图形检查通过。Python 3.10.12/Pillow 9.0.1 用于封装与校验，无二次缩放。
- 本轮实际执行 10 项浏览器检查全部通过：独立及嵌入 MetricViewer 正确引用新资源；
  SVG/ICO 均 HTTP 200、MIME 和字节正确、可解码且背景透明；主页、TraceViewer、
  Metric vs. Trace 图标及组合页 iframe 来源保留，pageerror 为空。Browser 插件无连接，
  复用已有 Playwright 1.65.0/Chrome 146.0.7680.80；专用 18145 服务验收后已停止。
- 证据：`__output__/archvisual/metricviewer_heat_icon_20261106/`，含原图、修改前文件、
  各尺寸 PNG、icon-preview.png、ico-checks.json、browser-result.json 和 result.json。
  前一轮 Metric vs. Trace 透明图标修改保留；未新增永久测试，未安装依赖，未运行
  发布编译或完整框架门禁。本轮尚未暂存、提交或推送。

## MetricViewer 图标对角间隙与细化热力网格（2026-11-07）

- 用户批准以 48px 画布为基准留约 2px 透明对角间隙，格子边长由约 15px 缩到约 10px。
  SVG 通过裁剪留出间隙，热力格子实际边长 10.5px、格间距 1px；保留蓝绿面积图、
  `/` 方向和透明背景。四尺寸 ICO 重新渲染，页面 SVG/ICO 缓存标记更新为 v=2。
- 浅/深底预览已检查，四帧均与各自 SVG 渲染逐像素一致；48px 的三个对角间隙
  采样点 alpha 为 0，32/64px 中点同为 0。16px 中点因亚像素抗锯齿为 alpha 125，
  低于修改前的 255，未将缩小后的间隙误记为所有像素完全透明。
- 本轮 10 项浏览器检查通过，pageerror 为空；独立/嵌入页引用、资源响应、解码与
  透明背景均验证。复用 Python 3.10.12、Pillow 9.0.1、Playwright 1.65.0 和
  Chrome 146.0.7680.80；Browser 插件无连接，使用本机浏览器，专用 18145 服务已停止。
- 证据：`__output__/archvisual/metricviewer_icon_gap_20261107/`，含修改前文件、实际尺寸
  预览、ico-checks.json、browser-result.json 和 result.json。保留既有 Metric vs. Trace
  透明图标修改；未安装依赖，未新增永久测试，未运行发布编译或完整框架门禁，
  尚未暂存、提交或推送。

## MetricViewer 图标面积图占比与热力配色调整（2026-11-07）

- 用户批准将间隙加粗到约 3px，中心线沿法向向右下平移约 3px（均以 48px 画布为准）。
  两侧裁剪边界及 Heat 裁剪同步偏移，扩大面积图区域；格子尺寸和位置保留。网格颜色
  选用 metric_heat.js 的浅蓝、深蓝、橘色、红色，未修改 Heat 模式运行代码。
- SVG 和 16/32/48/64px ICO 已更新，metricviewer.html 两种图标的缓存标记改为 v=3，
  保留 CRLF。浅/深底预览已检查；四帧逐像素匹配目标尺寸 SVG 渲染。48px 旧间隙中点
  已变为不透明面积图，偏移后的三个间隙采样点 alpha 为 0；四种网格颜色均与现有
  Heat 色阶一致，格子几何数据与修改前一致。
- 本轮 10 项浏览器检查通过，pageerror 为空。独立/嵌入页引用、资源响应、解码和
  透明背景均验证。Browser 插件无连接，复用 Playwright 1.65.0/Chrome 146.0.7680.80；
  Python 3.10.12/Pillow 9.0.1 用于封装和检查，专用 18145 服务已停止。
- 证据：`__output__/archvisual/metricviewer_icon_contrast_20261107/`，含修改前文件、预览、
  ico-checks.json、browser-result.json 和 result.json。既有其他图标修改保持原样；
  未安装依赖，未新增永久测试，未运行发布编译或完整框架门禁，尚未暂存、提交或推送。

## MetricViewer 图标对角间隙加粗至 5px（2026-11-07）

- 按用户明确要求，将 48px 画布上的透明间隙从 3px 加粗至 5px；仅调整两侧裁剪
  边界，中心线偏移、格子几何和配色均保留。SVG/四尺寸 ICO 同步更新，缓存标记 v=4。
- 四帧与 SVG 渲染逐像素一致，间隙扩大及透明度已检查；10 项浏览器检查通过，
  pageerror 为空，专用服务已停止。使用既有 Python/Pillow/Chrome/Playwright 环境。
- 证据：`__output__/archvisual/metricviewer_icon_gap5_20261107/`，含修改前文件、预览、
  ico-checks.json、browser-result.json、runtime-checks.json 和 result.json。未运行发布编译
  或完整框架门禁，未暂存、提交或推送。

## MetricViewer 图标居中竖直分界（2026-11-07）

- 用户批准左侧面积图、右侧热力网格，中央保留 5px 透明间隙。SVG 分界改为 x=24，
  裁剪边界为 x=21.5/26.5；取消对角方向和偏移，保留格子尺寸及蓝橘红配色，补齐
  右侧新显示区域的网格。SVG/四尺寸 ICO 已更新，页面缓存标记 v=5，保留 CRLF。
- 浅/深底预览已检查。四帧逐像素匹配各自 SVG 渲染；48px 中央全高透明区域、左侧
  面积图与右侧热力色块的像素检查通过。10 项浏览器检查通过，包含 SVG/ICO 中央
  竖直透明带检查，pageerror 为空；专用服务已停止。
- Browser 插件无连接，复用本机 Chrome 146.0.7680.80、Playwright 1.65.0，使用
  Python 3.10.12/Pillow 9.0.1 封装和校验，未安装依赖或新增永久测试。
- 证据：`__output__/archvisual/metricviewer_icon_vertical_20261107/`，含修改前文件、预览、
  ico-checks.json、browser-result.json 和 result.json。其他页面图标保持原样；未运行
  发布编译或完整框架门禁，尚未暂存、提交或推送。

## MetricViewer 图标右半部分铺满热力网格（2026-11-07）

- 用户批准右侧从上到下使用完整矩形热力网格。SVG 将面积图限定到左侧，右侧解除
  面积图斜边裁剪；原有八个格子的尺寸、位置和配色保留，中央仍为 5px 透明间隙。
  四尺寸 ICO 已同步生成，页面缓存标记 v=6，保留 CRLF。
- 初次校验要求左侧与旧 ICO 逐像素一致，因裁剪方式改变后的斜边抗锯齿差异失败。
  原始差异保存在 first-ico-check.json；左侧两条路径及样式确实未变，已改用图形定义
  和显示检查验证保留范围，不将旧左侧栅格宣称为逐像素一致，也未修改图标迎合断言。
  四帧均与当前 SVG 渲染逐像素一致，右侧八格、顶部填满及中央透明带检查通过。
- 10 项浏览器检查通过，pageerror 为空；包含 SVG/ICO 右侧顶部填充检查，专用服务
  已停止。Browser 插件无连接，复用现有 Python 3.10.12/Pillow 9.0.1、Chrome
  146.0.7680.80/Playwright 1.65.0，未安装依赖或新增永久测试。
- 证据：`__output__/archvisual/metricviewer_icon_full_heat_20261107/`，含修改前文件、预览、
  first-ico-check.json、ico-checks.json、browser-result.json 和 result.json。未运行发布编译
  或完整框架门禁，尚未暂存、提交或推送。

## Metric vs. Trace 复用原图上半部分拼接（2026-11-07）

- 用户批准上方使用最终版 MetricViewer 上半部分，下方使用 TraceViewer 上半部分，
  以 48px 画布保留 5px 水平透明间隙。已将两段等比例缩放为 43×21.5、水平居中，
  分别放在 y=0 和 y=26.5；原图透明区域保留。MetricViewer 复用现有 SVG 路径，
  TraceViewer 将原 ICO 的 48px 帧内嵌为 PNG，并裁剪至原图上半部分。
- crossviewer.svg、16/32/48/64px ICO 和 crossviewer.html 缓存标记 v=3 已更新。
  两个源图标、各自页面、主页图标及组合页 iframe 来源保持原样。浅/深底预览已检查。
- 资源校验初次发现临时检查脚本以标签后缀匹配，将 svg 错认为 g；随后两个过严的
  16px 栅格断言分别要求中心整行 alpha=0、下半部分存在 alpha=255 像素，实际因
  缩放抗锯齿不成立（中心行最大 alpha=1，下半部分最大 alpha=254）。三次失败分别
  保存在 first/second/third-ico-check.json；未调整图标迎合检查。修正后核对完整 XML
  标签、原始路径/裁剪/配色、内嵌 Trace 原图像素、各尺寸 ICO 与当前 SVG 渲染一致，
  并检查完全落入间隙内的像素行透明、两段图形可见；16px 间隙内没有完整像素行。
- 资源检查及 10 项浏览器检查通过，pageerror 为空，专用验证服务已停止。Browser
  插件无连接，复用本机 Chrome 146.0.7680.80/Playwright 1.65.0、Python 3.10.12、
  Pillow 9.0.1 和 Django 5.2.9，未安装依赖或新增永久测试。
- 证据：`__output__/archvisual/crossviewer_combined_icon_20261107/`，含修改前文件、
  预览、失败记录、ico-checks.json、browser-result.json 和 result.json。未运行发布编译
  或完整框架门禁，尚未暂存、提交或推送。

## MetricViewer 与 Metric vs. Trace 图标提交范围收口（2026-11-08）

- 按本轮协调授权，仅准备已批准图标变更的提交候选。资源/模板归属与历史证据由
  两个只读子 Agent 并行复核，主 Agent 审阅本线 pair 并整合；未实施新图标设计。
- 六个图标/模板当前字节均匹配 11/7 各自最终 result.json。收口前 spec/plan 也与
  组合图标最终结果一致，无未知漂移。本轮只追加本节状态，spec 当前设计无需修改。
  模板改动仅含 favicon；MetricViewer 保留 CRLF，组合页保留 LF。未知 sp.json 排除。
- 提交候选依次为：ArchVisual 的 MetricViewer SVG/ICO/模板三文件；ArchVisual 的
  Metric vs. Trace SVG/ICO/模板三文件；根仓库的 archvisual gitlink 与本线 spec/plan。
  第二笔使用第一笔的最终图形定义，第三笔必须引用第二笔实际生成的提交，不能预填
  不存在的提交号。每笔图标源、生成资源和页面引用完整纳入，不按文件数机械拆分。
- 11/7 MetricViewer 浏览器报告中的 crossviewer v2 检查已经被 v3 取代，仅复用仍
  匹配当前 MetricViewer 字节的验收部分；后续组合图标的 10 项历史检查覆盖当前 v3，
  同时核对 MetricViewer v6 等引用。原始失败与抗锯齿限制保留，本轮未重跑这些检查，
  不把历史验收表述为 11/8 新 PASS，也不推广为其他浏览器或依赖版本已验证。
- READY：精确范围、逐 hunk 归属、历史证据适用范围、三笔消息草案及依赖顺序。
  BLOCKED（实际提交）：本轮无 index/commit 窗口，且新一轮框架门禁未执行、无本轮
  豁免。当前 Energy 为唯一重型执行 owner；仅登记未来 canonical 命令
  `bash scripts/run_micro_regression.sh` 的协调窗口申请，不启动它。提交前需重新核对
  当时 HEAD、index、候选哈希及门禁状态，不能沿用 11/6 的失败结果或一次性豁免。
- 自有输出：`__output__/archvisual/icon_commit_candidates_20261108/`，包含 baseline、
  逐 hunk 清单、精确候选/消息、证据适用范围、门禁命令/预算/输入及最终复核回执。
  本轮未启动服务、浏览器、发布构建、框架回归或其他原生构建，未安装依赖，未触碰
  release 锁、共享产物或其他线文件，未暂存、提交、推送；Profanalyz 无新增任务。

## Metric Name 搜索结果框拖动调整尺寸（2026-11-09）

- 用户明确批准“按此方案实施”。新增 metric_search_resize.js，模板将稳定外框与
  可滚动结果列表分开；右边界/下边界/右下角分别调整宽、高或两者，默认 800×300，
  通常最小 240×120，最大限制在页面/iframe 可见区域。当前页面保留用户尺寸，
  关闭重开、列表重建、加载、分屏及 Line/Heat 切换均保留，刷新恢复默认。
- 拖动使用指针捕获与临时遮罩；取消、丢失捕获、隐藏、失焦和页面离开时清理。
  首轮 8 组交互检查通过后，复审将释放后的点击拦截限定到鼠标，避免取消拖动后
  阻挡键盘激活；新增 Escape 后键盘勾选断言，最终 8 组检查全部通过，pageerror 为空。
- 新增 dataviewer/test_metric_search_resize.cjs，使用真实 examples/metricview.h5 和
  production load/query/Plot 通路。覆盖三方向真实鼠标拖动、锚点/选择保持、SelectAll、
  点击外部关闭、重开/重新加载、最小/视口最大值、滚动、拖动中取消与隐藏、两种分屏、
  实际 Line/Heat Plot、窄视口、刷新恢复及 Metric vs. Trace iframe。截图已检查。
- JavaScript 语法及限定 diff 检查通过，模板 CRLF 保留。Browser 插件无连接，复用
  现有本机 Chrome/Playwright；ArchVisual 使用 PATH python3，未安装依赖或 source
  父仓库环境脚本。专用 18145 验证服务已停止，本轮无测试失败，无原生/发布构建或
  框架门禁执行，未暂存、提交或推送。
- 自有证据：`__output__/archvisual/metric_search_resize_20261109/`，包含前像、首轮与
  最终浏览器回执/截图、增量 patch、文件哈希、环境信息及 result.json。
- 11/8 图标候选是历史快照：本轮新增了同一 metricviewer.html 的搜索框 hunk 及
  pair 章节。后续提交必须重新核对并隔离图标与搜索框范围，不能整文件沿用旧候选
  哈希或将本功能夹带进图标提交。四个图标资源及组合页模板原样保留，未知 sp.json 排除。

## 图标与搜索结果框修改提交审查（2026-11-09）

- 用户请求“提交archvisual修改”。当前 8 个子模块文件及本线 pair 均匹配各自最终
  实现回执，复用相同源码的图标资源/浏览器验收及搜索框 8 组最终交互验收，不重跑。
- 拟分四笔：MetricViewer 图标三文件（模板仅 favicon hunk）；组合图标三文件；
  搜索框模板其余 hunk、独立 JS 和回归脚本；根仓库 gitlink 与本线 spec/plan。
  图标模板中间态来自搜索框实现前像，与 11/7 图标回执哈希一致，已通过 index 只读
  apply --check；工作树未回退、index 未写入。最后一笔必须引用第三笔实际提交。
- 新发现 version.txt 有本会话未产生的 0.4.3→0.4.4 修改，连同未知 sp.json 明确排除，
  不回滚或夹带。其他线所有修改亦排除。两个 main 的暂存区为空；协调锁仅作瞬时
  可用性探测，已释放，不把锁空闲视作重型执行授权或预占未来提交窗口。
- 本轮框架门禁未运行：此前协调限制未取得解除依据，且没有本轮明确豁免。项目提交
  skill 要求提交前运行门禁或获得用户本轮裁决；不得复用 11/6 豁免或把旧失败当新结果。
  四笔清单及消息待批准，尚未暂存、提交、推送。
- 提交审查证据：`__output__/archvisual/viewer_changes_commit_20261109/`，含 baseline、
  精确 hunk patch、排除清单、四笔消息、review.md、commit-plan.json 与 result.json。

## 图标与搜索结果框四笔提交执行（2026-11-09）

- 用户明确授权“豁免本轮门禁，按四笔清单提交”。本轮框架门禁依授权豁免，
  实际未运行；未将历史 PASS 或历史豁免作为本轮验收。发布构建仍未执行。
- 依次提交 MetricViewer 图标、Metric vs. Trace 组合图标、搜索结果框边界拖动，
  最后提交根仓库 gitlink 与本线 spec/plan。模板按已审定 hunk 拆分，保留工作树字节。
- version.txt、sp.json 和其他线修改全部排除；共享提交窗口串行持锁，不推送。
- 三笔 ArchVisual 本地提交已完成，实际提交范围与批准清单一致：
  - `2f5008d91d44a32c46aa9c3cfc845b3f1aae4101`：[archvisual] feat: add heatmap to the metric viewer favicon
  - `c75564a22b8033a9e895f7e9ce4b1d9c7136290e`：[archvisual] feat: compose metric and trace favicon halves
  - `a8a0fb548b3a386d4ca92a6b022ce1fcfafd0364`：[archvisual] feat: resize metric search results from the edges
- 根仓库本笔 gitlink 指向上述第三笔实际提交；提交回执、staged patch、树哈希、
  排除项保护检查和根仓库最终提交号保存于本轮提交审查证据目录。

## 同版本重新发布（2026-11-09）

- 用户批准“按此方案实施”：允许省略 `rel_visual.sh` 的版本递增参数，使用当前版本
  重新构建与打包；同名包验证后原子替换，失败保护与递增版本逻辑保留。
- 已修改发布入口及 README；版本候选、包名、发布锁和发布事务复用原实现，未修改
  `scripts/release_tools.py`。无参数日志明确标注当前版本保持不变。
- 已补充无参数真实 Shell 调用的隔离回归：同名包替换、包不存在时创建、同版本发布锁，
  并将构建失败、tar 失败、损坏包、非法版本、外部版本冲突及版本提交失败覆盖到两种模式。
- 验证完成：PATH Python 3.10.12 下执行 `python3 -B -m unittest scripts.test_release_visual -v`，
  36 项测试全部通过；`bash -n rel_visual.sh` 与本线限定 diff 检查通过，README 保留 CRLF。
  测试在根输出目录的隔离副本中注入构建及打包故障，不代表真实 Nuitka 编译或发布通过。
- 证据位于 `__output__/archvisual/release_same_version_20261109/`，包含前像、源码哈希、
  逐项测试日志及隔离夹具。未执行真实构建、正式发布或框架门禁，未暂存、提交、推送。
  `version.txt`、`sp.json`、发布事务实现、构建脚本与其他线修改保持原样。

## 同版本重新发布提交审查（2026-11-09）

- 用户请求“提交代码”。逐文件/hunk 核对完成，三份子模块文件及本线 pair 均匹配
  实施验收回执；复用相同源码的 36 项发布测试，并完成 Python 编译语法及限定 diff 检查。
- 拟按两笔提交：ArchVisual 的 rel_visual.sh、scripts/test_release_visual.py、README.md；
  根仓库 archvisual gitlink 与 spec_archvisual.md、plan_archvisual.md。第二笔指向第一笔
  实际提交；version.txt、sp.json 及其他线修改全部排除。两个 main 暂存区为空。
- 本轮框架门禁未运行；上一轮四笔图标/搜索框提交的豁免不覆盖本轮。此前重型执行
  限制未取得解除依据，待用户明确本轮门禁处理及两笔提交清单；尚未暂存、提交、推送。
- 审查及完整消息：`__output__/archvisual/release_same_version_commit_20261109/`。

## 同版本重新发布两笔提交执行（2026-11-09）

- 用户明确授权“豁免本轮门禁，按两笔清单提交”。本轮框架门禁依此次授权豁免，
  实际未运行；复用相同源码的 36 项隔离发布测试及本轮提交审查，不声明真实构建通过。
- 按已审定范围先提交发布入口、测试与 README，再提交根仓库 gitlink 及本线 pair；
  串行持有共享提交锁，逐笔核对 staged diff、实际树与文件清单，不推送。
- version.txt、sp.json 以及全部其他线修改排除；逐笔提交号与保护检查回执位于
  `__output__/archvisual/release_same_version_commit_20261109/`。
- ArchVisual 本地提交已完成：`37b05124dde0d5000bc3858b6e1c2910ad0fa16c`，仅包含 rel_visual.sh、
  scripts/test_release_visual.py 与 README.md；根仓库本笔 gitlink 指向该实际提交。
  最终根提交号、staged patch、保护文件检查和暂存区回执保存于上述证据目录。

## MetricViewer 万指标万采样基线实施（2026-11-09）

- 用户批准“按更新方案生成数据并测量基线”。新增 scripts/generate_metric_benchmark.py、
  scripts/benchmark_metric_load.py 与 scripts/benchmark_metric_load.cjs，生产加载行为不改。
- 已核实原始 56,997×15 数据格式；小规模 20×31 夹具经真实转换器逐值比较通过。
  独立服务和 Chrome 的 H5 服务端加载、CSV 本地上传预检通过，覆盖重复加载、
  Line 8 指标、两张各 8 指标 Heatmap 及两模式 Reload；预检不替代完整规模基线。
- 实际 PATH Python 为 3.10.12、Django 5.2.9、pandas 2.0.3、PyTables 3.8.0、
  NumPy 1.24.4。PyTables 与 requirements 中 3.10.1 参考声明不同，如实记录，
  不安装依赖、不改共享 Python 状态。复用已有 Playwright/Chrome，通过 /proc 采样 RSS。
- 一亿数值 CSV/H5 已生成并全部精确比较通过：CSV 739.54 MiB、H5 296.61 MiB，
  float64、fixed、Blosc level 4、SamplePeriod=100。现有 csv2hdf 转换退出 0，
  耗时约 61.9 秒，转换进程最大 RSS 4,993,180 KiB；原始参考文件保持不变。
- 完成原始/合成、CSV/H5、服务端路径/本地上传 8 组、56 个真实 Chrome 操作，
  无 pageerror 或错误对话框；两模式 Reload 保留绘图数量，原始 CSV 缺少 period
  时显示为空，其他输入显示 100。每组专用服务和浏览器均已停止，测试上传副本
  清理后保留大小记录；两个 Heatmap 的截图已检查。
- 合成 H5 服务端首次/重复加载约 1.04/1.35 秒、本地约 1.71/2.25 秒；合成 CSV
  服务端约 87.12/75.12 秒、本地约 79.00/89.40 秒。CSV 解析占主导；原始约 5.7 万
  指标的首次列表构建约 0.65 秒；合成 H5 下 Line 8 指标绘图约 5.68 秒而查询后端
  约 25ms，后续须分别分析加载、列表与图表渲染，不改数值或擅自加入抽样聚合。
- 合成 H5 全组峰值 RSS 约 2.37 GiB、CSV 约 5.62 GiB。共享主机、未清空 OS
  页缓存、本地回环、每场景单轮；不能当冷盘或远程网络结果，也不代表并发用户吞吐。
  固定选取的 16 个合成绘图指标恰好均为稀疏模式，绘图时间仅适用于该子集；存储矩阵
  含五类模式。服务端 RSS 为采样峰值，浏览器进程树 RSS 包含共享页，heap 为结束时刻。
- Python/JS 语法、Django check、小规模预检及全部基线通过。测量后仅加固基准脚本的
  服务 PID 核验、显式临时目录、取消关闭浏览器及不足 16 指标时的报错，最终小规模
  CSV 上传全流程复验通过；计时与生产调用路径未变，完整测量脚本另存 measured-harness/。
  未运行原生/发布构建、全框架或全仓回归，未把历史 PASS 或豁免用于本轮。
- 自有输出：__output__/archvisual/metric_load_baseline_20261109/；before.json 保存
  原始数据和生产源码 SHA、解释器版本及两个仓库 HEAD。version.txt、sp.json、
  其他线修改及两个 Git index 不在本轮修改范围，未提交或推送。
- 汇总见 REPORT.md、measurements.csv、summary.json；逐请求原始证据在 suite/。
  生产优化保持待评审，当前只完成性能数据生成与基线测量。

## MetricViewer 搜索列表与 Heat 初始化优化（2026-11-09）

- 用户批准“先优化搜索列表与 Heat 初始化”。已新增 metric_search.js，模板接入
  虚拟列表；metric_heat.js 延后标签空间测量并按完整时间轴缓存。生产后端不改。
- 新增 scripts/test_metric_search_virtual.cjs：真实 56,997 指标搜索、跨可见范围
  勾选/取消、Select All、Tab/Shift+Tab/Space、正则与空格匹配、无结果、Plot、
  双面板/Reload，以及 Heat 首次计算、复用和同长度时间轴变化等 6 组检查通过。
  默认尺寸下搜索 DOM 少于 60 行，Line 加载/Reload 的 Heat 标签测量次数为零。
- 首轮 Heat 计数断言失败的原因是测试尝试替换 ECharts 冻结的 format 成员，探针
  未接入；图表正常且无 pageerror。保留 virtual-first 失败记录，改为替换可写的
  format 导出绑定后通过；随后宽度复审修正为按文本固有宽度缓存，完整 6 组复验通过。
- 原搜索框边界拖动回归仅调整“全部 DOM 存在”的旧断言为全量选择及窗口内 DOM
  上限断言，其余真实鼠标/分屏/iframe/Line/Heat 检查保留，8 组全部通过。
  既有 Reload 14 项通过，包含失败保护、异步旧响应、选中指标缺失和统计更新。
- 模板原有 CRLF 保留；默认 diff --check 将 CR 报为空白，按 cr-at-eol 复查通过。
  Heat 布局稳定性 20 项通过，无尺寸循环或空闲重绘。同数据和计时脚本的原始
  H5/CSV、大 H5 共 6 组、42 个操作通过；大 CSV 解析路径未改，本轮未重复该基准。
- 原始 H5 服务端首次 ProcessH5 728.6→75.2ms，列表重建 650.6→0.3ms；大 H5
  服务端首次 ProcessH5 206.5→40.9ms。首次加载无指标复选框 DOM，完整选择语义保留。
  本轮原始 H5 服务端首次总耗时 1.756→0.319s，大 H5 服务端 1.037→0.690s。
  大 H5 本地首次/重复总耗时反而为 1.712→1.911s / 2.254→3.250s：服务端上传接收、
  读取时间增加，前端处理仍减少。未修改后端，单轮共享主机结果不能进一步归因，
  不宣称各场景总耗时稳定改善；原始前后结果完整保留。
  当前无原生/发布/框架构建，未提交或推送，专用服务和浏览器均已停止。
- 自有输出：__output__/archvisual/metric_frontend_load_20261109/，before/ 和
  before.json 保留实施前字节；既有基线目录保持不变。version.txt、sp.json、
  requirements、CSV/H5 生产后端和其他线修改排除，不写两个 Git index。
- REPORT.md 和 comparison.csv/json 保存实际结果及边界；suite/ 保留逐请求时序、
  内存、截图和结束回执。既有完整数据及基线目录未改，本轮仅优化前端加载阶段。

## MetricViewer H5 上传减少重复复制（2026-11-09）

- 用户批准“先减少 H5 上传复制”。dataviewer/views.py 已直接借用 Django 磁盘上传
  路径；没有临时路径时仅创建短期 H5 副本并在读取/异常后清理。CSV 转换与服务端
  加载实现不改，Reload 仍在响应校验成功后替换指定面板的 DataFrame。
- dataviewer/tests.py 新增 6 项回归，实际使用内存/磁盘两种 Django 上传处理器，
  检查借用路径不执行 chunks/应用临时目录创建、请求负责关闭、成功后数值可查询、
  双面板隔离、损坏/缺 data 的 H5、非法 Reload、复制中断、缺 config 和重复上传。
  本轮 dataviewer 全部 27 项测试及独立 Django check 通过，无测试失败。
- 同一前端、数据和基准脚本的修改前/后各 2 场景、14 个真实 Chrome 操作通过：
  原始小 H5 与 10,000×10,000 大 H5 的本地上传、重复加载、Line/Heat 绘图及 Reload。
  既有 Reload 浏览器回归另 14 项通过，无 pageerror；本轮服务与浏览器已停止。
- 大 H5 每次省去 311,017,746 bytes（296.61 MiB）的逻辑复制；前测四次上传留下
  1,244,070,984 bytes（约 1.16 GiB）应用副本，由基准在服务停止后清理。后测应用
  临时目录及 Django multipart 目录均空；小 H5 的短期副本也没有残留。
- 大 H5 首次/重复 ajaxSend 到响应处理后两次 RAF 约 4.9435→4.5674s /
  4.8787→3.2320s；Line Reload 12.5673→7.5764s，Heat Reload 4.7434→4.2449s。
  小 H5 重复加载等部分计时反而增加；前后 HDF5 读取及上传接收时间明显波动，
  不将总差值全部归因于复制消除、不声称稳定加速比。共享主机单轮、未清页缓存、
  本地回环；没有冷盘、远程网络、并发用户或其他平台验收。
- 使用 PATH Python 3.10.12、Django 5.2.9、pandas 2.0.3、PyTables 3.8.0、
  NumPy 1.24.4；依赖不安装不修改，requirements 的 3.10.1 参考声明保持原样。
  未运行原生/发布构建或框架门禁，未修改 Git index、提交或推送。
- 证据：__output__/archvisual/h5_upload_copy_20261109/，含 before/、前后浏览器
  suite、tests.log、reload/、comparison.csv/json、REPORT.md 与 after.json。
  本轮只新增 views.py/tests.py 的实现及回归 hunk、本线 pair 章节；先前前端优化和
  性能基准保持原字节，未知 version.txt/sp.json 及其他线修改均排除。

## H5 读取与内存复制分析完成（2026-11-09）

- 用户批准“继续分析 H5 读取与内存复制”。本轮没有修改生产源码、依赖或基准
  数据；诊断脚本和结果仅写入 __output__/archvisual/h5_read_memory_analysis_20261109/，
  本线 spec/plan 追加实际发现及明确未获实施批准的快速读取提案。
- 已审阅当前安装的 pandas/PyTables 读取实现与两份 H5 的节点布局。真实生产
  server_load view 在独立诊断进程中执行，记录数值数组地址/共享关系、cProfile、
  阶段 RSS 和 5ms RSS 采样；完整读取后校验全部数值字节、采样轴、指标名、dtype、
  config 和序列化 API 响应。首次/Reload 后旧 DataFrame 均已释放，没有误判为泄漏。
- 原始 pandas 单块 concat 确实分配另一个 800MB 数值矩阵，并改变内存排列。
  一次详细剖析中底层读盘/解压/填数组合计约 2.28s、整块复制重排约 2.92s；
  底层阶段不能当作独立的纯解压时间。详细探针含 cProfile 开销，不作为用户端延迟。
- 完成 5 个详细诊断进程及 9 个低开销进程：原始大小 H5、单块无额外复制、
  512 行分块预分配对照，共 28 次成功加载/Reload。低开销部分按三轮轮换顺序
  串行执行，每轮每方案用新进程；另测 8/16 指标查询，每次各重复五次。
  所有对照的全量数值/元数据/响应哈希一致；原始失败记录不计入成功数。
- 大 H5 三轮中位数（直接调用生产 view，不含上传网络和浏览器）：现有首次/Reload
  4.590/3.318s、峰值 1.623/2.381GiB；无额外复制诊断 1.516/2.690s、0.879/1.638GiB；
  分块诊断 3.404/4.120s、0.930/1.682GiB。无额外复制的 Reload 单轮范围 1.329–3.404s，
  不承诺稳定加速比，也不将这些值与上一轮端到端上传时序直接比较。
- 首次加载后的查询中位数（每进程五次，再取三进程中位数）：8 指标现有/无复制
  112.6/116.4ms，16 指标 214.1/238.8ms。排列变化可能影响查询，且共享主机波动明显，
  当前结果不证明所有查询必然变慢或变快；后续实现需真实浏览器回归验证。
- 保留两次诊断脚本失败：normal-big.log 为相对路径被 API 默认目录解析，没有读取
  数据；light-1-normal.log 为禁用 cProfile 后仍导出空统计，读取已成功但该轮不计入
  结果。分别修正绝对路径和导出条件，保留原日志，最终流程全部完成。
- READY：复制来源、峰值解释、三轮对照、完整数据等价性及受限读取提案。
  待用户批准：新增正式读取 helper 和接入生产；本轮未实施该提案。全部诊断进程
  已退出；未启动监听服务或浏览器，未安装、原生/发布构建、全框架回归、写 index、
  提交或推送。先前待提交修改与未知 version.txt/sp.json 均原样保留。
- 当前环境仍为 PATH Python 3.10.12、pandas 2.0.3、PyTables 3.8.0、Django 5.2.9。
  仅测固定格式的两份真实输入，共享主机、三轮、暖页缓存；没有验证多块/混合 dtype、
  table 格式、其他依赖版本/平台、并发用户、远程或冷盘条件。正式实现必须补回退与
  异常检查，不能把诊断等价性当完整生产验收。summary.json/measurements.csv 保存
  中位数及范围，equivalence.json 保存逐次等价检查，REPORT.md 汇总证据和局限。

## 受限 H5 快速读取实施与验证完成（2026-11-09）

- 用户批准“按受限快速读取方案实施”。新增 scripts/metric_hdf.py，views.py 的
  本地 H5 上传与服务端 H5 加载复用；单块 float64 fixed 已知布局直接共享读取数组，
  不识别格式回退 pandas。CSV 路径、前端、数据文件、依赖声明和其他线文件未改。
- dataviewer/tests.py 新增 14 项，当前全部 41 项通过，独立 Django check 通过。
  检查压缩/不压缩、UTF-8/轴名/顺序、重复采样轴、整数/字符串轴、NaN/Inf/负零位、
  数组共享及关文件/删文件后可查询、缺 config、Copy-on-Write 开关、多块/类型/table/
  特殊轴/编码/元数据/方向回退、损坏输入、I/O 不重试、双面板和 Reload 失败保护。
- 修改前后同一数据、同一基准脚本各 4 场景、28 个 Chrome 操作通过：原始小 H5 和
  10,000×10,000 大 H5，本地/服务端路径、Line/Heat 绘图及 Reload。既有 Reload
  浏览器回归另 14 项通过，无 pageerror；所有本轮专用服务与浏览器均已停止。
- 大 H5 本轮服务端首次/重复加载 ajaxSend 到响应处理后两次 RAF 为
  3.350/3.082→0.857/1.218s，本地上传为 3.804/3.233→2.060/2.515s。
  服务端首次/重复峰值 RSS 1.616/2.370→0.875/1.616GiB，本地为
  1.618/2.366→0.877/1.623GiB；底层少一次 800,000,000 bytes 数值矩阵复制。
  原有阶段探针位于 pandas __getitem__，快速通路没有 hdf_read_data 事件；
  不能将该字段缺失解释为读取耗时为零。端到端与后端总计时均保持同一计时边界。
- 正式生产 reader 的首次/Reload 全量校验与原 pandas 冻结结果一致：大文件全部
  1 亿数值字节、采样轴、指标名、dtype、config 和 API 响应哈希完全相同，原始小
  H5 亦相同；旧 DataFrame 已释放。完整散列在加载计时之外，记录于 equivalence.json。
  actual-big/reference 复用诊断工具的 mode=normal 表示当前生产通路，不能误称旧
  pandas 基线，也没有启用此前 no_copy/chunked 实验替换。
- 部分时序增加：大 H5 服务端 Line Plot 3.943→6.548s、首次 Heat Plot
  226→309ms；小 H5 服务端部分操作也变慢。补充同进程两个真实 reader 结果的
  查询对照，六次交替测量、覆盖五种合成数值模式，结果相同：8/16 指标 Line 提取
  中位数 6.83/14.10→12.89/26.45ms，Heat 93.69/185.37→98.50/197.40ms。
  数组按列读取确有代价；浏览器绘图秒级波动不能全部归因于该十余毫秒差异。
  没有新增聚合、降精度、查询缓存、按需 H5 或提前删除旧数据的行为。
- 准备阶段曾从子仓库 cwd 使用父仓库相对路径，前像及 suite 配置缺失而失败；
  生产文件尚未修改。已改为绝对路径，保留 preparation-first.txt/suite-before.log，
  后续实际基线在 baseline/。全部生产功能检查通过，没有用失败准备冒充基线。
- 本轮环境：PATH Python 3.10.12、pandas 2.0.3、PyTables 3.8.0、NumPy 1.24.4、
  Django 5.2.9、Chrome 146.0.7680.80；requirements 的 tables 3.10.1 参考不变。
  共享主机单轮浏览器前后测、暖页缓存、本地回环，不承诺稳定加速比；没有其他
  平台/依赖版本、冷盘、远程网络、并发用户、原生/发布构建或全框架回归验收。
- READY：已批准的受限读取实现、兼容回退、数据等价与局部回归证据齐备。
  尚未提交：全框架提交门禁未运行，当前没有重型执行/提交窗口，不复用历史豁免。
  未写 Git index、提交或推送；未知 version.txt/sp.json 和此前待提交修改保留。
- 自有输出：__output__/archvisual/h5_fast_read_20261109/，REPORT.md、comparison.csv/json、
  equivalence.json、paired-queries.json、before/after.json、incremental.patch；
  baseline/optimized/ 保留本轮前后浏览器证据，tests-first.log、django-check.log、
  reload/、actual-big/、actual-reference/ 保存实际验证，未覆盖范围见报告。
- 最终回执首次导出因 NumPy int64 维度无法 JSON 序列化而失败，之前的来源/输入/
  布局检查均已通过。仅把回执维度转为普通 int 后重新导出；receipt-first.txt 保留
  失败原因。生产代码及测试结果未改，没有将该输出脚本失败记为生产测试失败。

## MetricViewer 性能优化五笔本地提交（2026-11-10）

- 用户明确授权“豁免本轮框架门禁，按五笔清单提交”。本轮全框架门禁依此豁免，
  实际未运行；不把 11/9 局部测试或旧豁免记为本轮全框架 PASS。
- 提交前核对当前字节与各项验证冻结来源一致，Python/JavaScript 语法及 diff 检查通过；
  未重复运行未变化的功能回归、浏览器基准、原生或发布构建。
- 已按目的完成四笔 ArchVisual 本地提交；上传复用与快速读取的 views/tests
  使用已验证前后像拆分，工作树保持最终字节，未覆盖中间版本：
  - `d69db686bfe01e3314d884cd4c445fa9ad448b86`：性能数据与加载基准。
  - `e420214621ab729a20f1ced4439c46d058a88072`：搜索列表与 Heat 初始化优化。
  - `2cd8bd534a68832dde6de48bd18a459fe92587cf`：H5 上传复用临时文件。
  - `5a78dd7d5b054ef23cd132f610d27d6ca58ae9e0`：受限 H5 快速读取。
- 根仓库本笔只提交 archvisual gitlink、spec_archvisual.md、plan_archvisual.md；
  gitlink 指向上述快速读取提交，也包含子仓库原有 macOS 发布与 PyTables 回退两笔历史，
  本轮不重写这些历史，不新增对 macOS 发布构建的验收声明。
- version.txt、static/data/sp.json、依赖声明、生成数据和其他线修改排除；
  共享提交窗口串行持锁，不推送。根提交号及逐笔树/范围核对在回执中记录。
- 第一笔提交成功后的根 index.lock 短暂占用使检查停止；没有删除锁或重复提交。
  释放后核对实际提交树、全部文件字节与已审查 staged patch 一致，再继续后四笔；
  保留 execution-failure.json 和第一笔恢复回执。
- 回执：__output__/archvisual/metric_performance_commit_20261110/，包含
  approved-plan.json、commit-*-receipt.json、staged-*.patch、FINAL.json 和 RESULT.md。

## Line 绘图瓶颈分析完成，优化方案待批准（2026-11-10）

- 用户最新指令“先分析 Line 绘图瓶颈并提出方案”。此前顺序修复尚未开始编辑；
  本轮只做生产来源读取和输出目录内诊断，没有修改 Line/Heat/缓存生产实现。
- 复用既有 10,000 metric × 10,000 sample H5，真实页面查询 8/16 条曲线。
  9 个串行 case、17 个首次绘图/追加/Reload 操作完成；V8 profile、Chrome trace、
  生产后端计时、截图、完整已查询数组等价检查均保存在自有输出。
- 混合五种数值模式：Canvas 首次/追加到 16 条/Reload 为 5.008/9.943/12.772s，
  页面内临时 SVG 为 1.672/4.243/3.789s。series 值与配置哈希一致；Reload 包含
  文件重读。稀疏模式 tracing 对照为 4.879→1.065s；不承诺稳定加速比。
- 原 Canvas tracing 的同步 append_metrics 约 530ms，其中 setOption 378ms、
  resize 149ms、getOption 合计 2.7ms；图层更新事件累计约 2785ms。事件嵌套，
  不相加为总时间，也不将尚未归因时间冒充具体 Skia 函数或物理 GPU 执行。
- 发现确定的多余 resize：CSS 高度变化而实际宽高仍为 1496×799；现有
  ResizeObserver 已按实际尺寸去重。临时跳过后数据/配置不变，但绘图仍耗时数秒。
  对照中的 Reload 更慢已保留，不用其余单次差值宣称稳定收益。
- 关闭动画/面积/平滑曲线没有与 SVG 相当的改善，不作为首选生产修改。
  SVG 实验仅验证绘图和数据配置，未通过完整交互验收；主面板临时重建不能
  替代生产初始化事件链的回归，也不能据此认定双视图联动已通过。
- 关键限制：共享主机、每 case 单轮、有 CPU/trace 探针；计时到两次 RAF，
  不是 GPU 显示完成。Chrome 能力检查为 Canvas/合成软件渲染，ANGLE 为
  SwiftShader；未验证用户桌面 GPU、其他平台、更多曲线、远程/冷盘或并发用户。
- READY：分析与方案。建议先批准实际尺寸 resize 去重；SVG 保持主要候选，
  补正常事件注册的功能回归与实际桌面浏览器对照后再决定默认 renderer。
  未运行全框架/原生/发布构建，不复用旧豁免，不提交或写 index。
- 全部诊断服务/浏览器已停止，18156 无监听；生产文件、依赖、未知 version.txt/
  sp.json 与分析前 SHA 一致，仅追加本线 pair 的实际分析和待批准提案记录。
- 自有输出：__output__/archvisual/line_plot_analysis_20261110/；REPORT.md、summary.json、
  before.json、source-check-before-documentation.json、browser-info.json 以及各 case 的
  receipt/profile/trace/backend/screenshot；原始异常/更慢结果没有剔除。

## Line 尺寸去重实施及 SVG 候选验证完成（2026-11-10）

- 用户批准“按此方案推进”。生产仅修改 metricviewer.html 的实际宽高判断，
  新增 scripts/test_metric_line.cjs；默认 Canvas、样本、曲线配置、Heat/后端不变。
  原文件 CRLF 保留；未知 version.txt/sp.json、依赖和其他线内容原样保留。
- 新回归在原版上按预期失败：两次 Plot 均调用等尺寸 1496×799 resize。
  实施后 Canvas/SVG 各 14 项 Line 定向检查通过，覆盖两个面板、真正增高/缩短、
  隐藏后恢复、无 resize 循环、全部值、stack、真实鼠标悬停/双击 pin/marker、
  缩放/范围更新、Reload、Line/Heat 切换和末尾组删除/Clear。
- 两种 renderer 分别通过既有分窗 11 项、Reload 14 项、Metric–Trace 同步 23 项；
  连同新增检查合计 124 项通过，无 pageerror。Django check、Node 语法和适配
  既有 CRLF 的 diff 检查通过；不宣称中间组删除或整个工作区通过。
- 正常初始化之前诊断切换 SVG，两个 Line 面板完整注册原有事件；Heat 不受影响。
  10,000×10,000 H5 选绘 8→32 条曲线，三轮交替 Canvas/SVG、SVG/Canvas、
  Canvas/SVG。首次/追加到 32 条/Reload 中位数：Canvas 2.936/10.543/15.949s，
  SVG 0.729/2.330/5.711s。两列均已含尺寸去重，不把差值算作去重自身收益。
- 原始 perfmodel 15-sample H5 另各一轮：首次/追加/Reload 为 Canvas
  83.8/116.1/214.6ms、SVG 93.2/110.9/217.8ms，小样本未见明显 SVG 优势。
  总计 8 个性能 case、24 个操作，完整已查询数组和 series 配置哈希一致，
  这些操作均无 resize；未减少样本或关闭平滑/面积/平均线。
- 本轮关闭 CPU/trace profiler；仍为 ajaxSend 到两次 RAF 的测量机会，非 GPU
  显示完成，Reload 含文件重读，小样本不代表动画结束。共享主机、暖页缓存、
  headless Chrome 的 Canvas/合成为软件渲染，SwiftShader；没有桌面 GPU 或
  更多平台、并发用户、同屏 10,000 曲线验收。默认 renderer 继续保留 Canvas。
- 额外发现旧版中间组删除缺陷：canvas-line-first 在删除 Grow 0 时出现 ECharts
  undefined.get 异常；delete-old-local 恢复旧 resize 后同样复现，倒序删除末尾
  十组成功。先前 delete-old 的 route.fetch 超时无有效结果，已保留；后续使用
  预先读取的真实渲染页面完成对照。脚本运行完成的 PASS 不等于缺陷通过。
- 尺寸回归明确采用从末尾删除来验证高度缩短；中间组删除的独立失败记录保留，
  未计入 124 项通过。已异步询问是否纳入本轮修复，尚待用户答复；未改删除逻辑。
- READY：去重实现、局部回归与 SVG 当前环境候选证据。待决/未验：中间组删除
  修复范围、实际桌面 GPU 下 SVG 对照和默认选择。全框架/原生/发布构建未运行，
  无本轮门禁豁免，暂不满足自主提交条件；未写 index、提交或推送。
- 自有输出：__output__/archvisual/line_resize_svg_20261110/，REPORT.md、summary.json、
  before.json、FINAL.json、逐 case receipt/模板/测试脚本/日志/截图。专用服务与
  浏览器均已停止，无构建或 index 占用。建议子仓库去重/回归独立一笔，父 gitlink
  与本线 pair 后续一笔；标题候选 `[archvisual] fix: skip redundant Line chart resizing`。

## Line 中间绘图组删除修复与回归完成（2026-11-10）

- 用户明确要求“一并修复中间组删除问题”。此前等待裁决的删除修复已获批准，
  不再阻塞本项实施；SVG 默认选择仍受实际桌面 GPU 验证边界约束。
- 根因已由实际 ECharts 模型确认：删除 A/B/C 中的 B 后，replaceMerge 仍保留
  C 的组件索引 2，而旧实现把 C 的 grid/series 引用改为 1，触发 undefined.get。
  axis-model-before 保存旧实现的实际索引与异常，诊断脚本完成不等于功能通过。
- metricviewer.html 改为保留完整当前配置并压紧剩余组件索引，先延迟清除坐标组件，
  再同步安装紧凑配置；保持图表实例、全局模型、toolbox 和 dataZoom。新增共用
  高度更新函数，继续使用此前实际尺寸 resize 去重；默认 Canvas 不变。
- 新增 scripts/test_metric_line_delete.cjs，Canvas/SVG 各 18 项通过：首/中/末/最后
  一组、连续删除、重复删除无操作、重新 Plot、同名重加、追加到保留堆叠组、Reload、
  真实鼠标 hover/pin/框选缩放及缩放回退、Delete 键、Line/Heat 切换和 Clear。
  保留全部样本与有效样式、轴配置/标记回调、缩放/图例/标记/pin 状态，另一面板不变；
  删除过程中没有空配置渲染事件或多余 Trace 范围广播。
- scripts/test_metric_line.cjs 的增高/缩短检查改成从中间逐组删除，不再回避旧缺陷。
  当前最终生产来源上，两种 renderer 各通过 Line 14、分窗 11、Reload 14、
  Metric–Trace 联动 23 项；连同删除专项，共 10 个浏览器 case、160 项通过，
  无 pageerror。Node 语法、Django check 和适配 CRLF 的 diff 检查亦通过。
- 初版 notMerge 重建虽修正索引，但使鼠标框选缩放关闭；失败回归促使改为保留
  全局模型的两阶段 replaceMerge，最终实测缩放回退历史保留。旧失败日志未删除。
  新测试曾对初始未定义 pin 列表、已有重复 dataZoom 轴条目和 ECharts 自动补入的
  emphasis.label.show 作过严苛的结构断言；分别改为规范化空列表、比较有效轴集合、
  按本地 ECharts 初始化规则补齐标记默认值，仍逐项检查全部显式样式/数据。
  相应失败与默认值源码片段保留，没有为通过测试改生产标记样式或缩减行为检查。
- READY：删除修复与本轮局部回归。浏览器为 Chrome 146 无界面软件渲染环境；
  没有新增实际桌面 GPU、其他平台/依赖版本、全框架、原生或发布构建验收。
  未重跑此前 1 亿数值性能基准，也不据本轮功能回归提出新的性能收益结论。
- 尚未提交：全框架提交门禁未运行，本轮无新的门禁豁免，不复用历史豁免；没有
  index/commit/push 或构建占用。未知 version.txt/sp.json、参考依赖与后端字节保留。
  删除修复候选标题 `[archvisual] fix: preserve Line state when deleting metric groups`；
  可接在此前尺寸去重提交之后，子仓库先提交、父 gitlink 与本线 pair 后提交。
- 自有输出：__output__/archvisual/line_group_delete_20261110/，REPORT.md、FINAL.json、
  before.json、static-checks.json、environment.json、逐 case 的模板/脚本快照、
  receipt/browser/result/server 日志；本轮专用服务与浏览器均已退出。

## README 记录 renderer 候选；准备 Heat 查询转换优化（2026-11-10）

- 已按用户要求在 archvisual/README.md 增加后续 renderer 评估说明，保留 CRLF。
  写明 Line SVG 是候选、少量样本没有稳定赢家、Heat Canvas 是未做直接对照的
  当前倾向，以及可见格子数、桌面 GPU、曲线数量和交互/内存的待验事项。
  引用 11/10 既有 Line 测量及其软件渲染条件，没有重跑性能测试或切换默认。
- 只读检查确认 get_query_data 的 Heat 分支对每个值调用 pd.notna、np.isfinite
  与 float。11/9 已有同进程配对测量中，快速 reader 结果的 8/16 指标 Heat 转换
  中位数为 98.50/197.40ms，Line 为 12.89/26.45ms；每个指标均有 10,000 sample。
  这些仅是既有数据提取/转换时间，不含 JSON 序列化与浏览器，不能当新的验收。
- 待确认方案：普通 NumPy float64 列批量有限值检查/列表转换，其余 dtype 回退；
  范围为 views.py、必要的 dataviewer/tests.py 和既有基准，覆盖数值逐项等价、
  缺失/非有限值、空列、负零、错误保护、主副面板、模板导入及 Reload。
  先冻结基线，实施后比较查询耗时及真实 Heat/Reload；不新增缓存或更改 API。
- 本轮完成 README 文字与 CRLF/diff 检查；生产代码、依赖、此前待提交修改及未知
  version.txt/sp.json 保留。未启动服务/浏览器/构建，未写 index、提交或推送。

## Heat 批量输出保留整数/浮点实现与验证完成（2026-11-10）

- 用户在确认整数可直接绘图后批准更新方案。新增 views.py::_heat_sample_values，
  NumPy 整数和常规浮点走批量输出；NaN/Inf 保持 null，可空/稀疏保留兼容通路，
  布尔值继续表示为数值 0/1。Heat 查询、模板导入、共用 Reload 接入，前端不改。
- dataviewer/tests.py 新增 8 项，当前 49 项全部通过；实施前 29 项 HeatQueryTests
  中出现预期的 16 个子测试失败，复现强制 float 导致整数类型改变及大整数舍入。
  修复后覆盖有符号/无符号整数边界、浮点位值/负零、NaN/Inf、字节序、可空/稀疏/
  布尔、空列、只读跨步视图不被修改、主副面板、上传/路径 Reload 和模板导入。
- Node Heat 计算 6 项、真实 Chrome Heat 统计/交互 16 项、Reload 14 项通过，
  无 pageerror；Django check、Python AST 语法和相关 diff 检查通过。
- 使用既有 10,000×10,000 float64 H5，通过真实 reader 读入一次。冻结旧查询函数，
  与新实现同进程、同一数据预热后六次交替测量；8/16 指标提取转换中位数
  121.44/271.53→4.42/8.67ms，JSON 序列化另计约 23/48ms，浮点响应字节完全相同。
  整数及含非有限值浮点夹具另测，所有查询数值相等；整数 JSON 字面量按批准改变，
  不把整数响应字节差异隐藏为“逐字节一致”。跨步读取的源数组未被改动。
- 真实生产页面、同一大 H5 前后各 7 个 Load/Line/Heat/Reload 操作通过。单轮 Heat
  首次 Plot 268.6→239.2ms、追加 Plot 211.8→143.7ms、16 指标 Reload
  2529.2→2063.1ms。Line 首次 Plot 3102.9→3103.6ms；首次 H5 Load
  2219.7→2379.5ms，更慢结果亦保留。共享主机、暖缓存、软件渲染、到两次 RAF；
  不把后端转换倍数当端到端加速，也不承诺单轮浏览器差值是稳定收益。
- 基线首次启动误用 --manifest，工具参数实际为 --suite，解析阶段退出 2，未启动
  服务或修改生产。修正后完成有效基线；preparation-failure.txt 保留此准备失败。
- READY：本项实现及局部验证。未测试其他平台/依赖版本、桌面 GPU、远程/冷盘、
  并发用户或任意大整数浏览器精度；全框架、原生、发布构建未运行。无本轮门禁豁免，
  不满足自主提交条件；未写 index、提交或 push，全部专用进程已退出。
- 自有生产范围仅 views.py/tests.py 及本线 pair；此前 README/Line 待提交内容、未知
  version.txt/sp.json、依赖及输入文件保留。候选标题：
  `[archvisual] perf: batch Heat query values without coercing integers`。
- 自有输出：__output__/archvisual/heat_query_types_20261110/；REPORT.md、FINAL.json、
  before/after 来源、tests-before/after.log、paired-queries.json、browser-comparison.json、
  baseline-browser/optimized-browser、heat-statistics/、reload/ 和各实际检查日志。

## Heat 模板导入消除重复查询完成（2026-11-10）

- 用户确认“同意先执行1”，本轮仅实施后续优化清单中的模板导入数据复用。
  `metric_heat.js::append` 直接校验并消费模板接口已返回的数值数组，不再按图查询；
  沿用样本/数值校验、同名后缀、颜色与统计、逐组失败处理和 Promise 结果。
  既有 `metricEpoch` 负责过期模板响应保护，模板页与后端本轮均未改动。
- 新增 `scripts/test_heat_template_import.cjs`：真实 CSV→H5、模板 API 与 Chrome
  页面验证。相同测试在旧实现上预期失败，记录两组导入发出 import 1 次、query 2 次；
  修改后仅 import 1 次。保留 baseline 失败原件，未以它代表功能通过。
- 新专项 12 项通过：普通 Plot 查询、两组导入、同名重复追加、每个原始样本及
  min/avg/max、颜色设置、全 null 行、Line/Heat 往返、Reload、主副面板隔离、
  空组和非法长度/文本/Infinity、只读响应数组、Clear/Load/Reload 后的旧响应丢弃。
  现有多图绘制 65 项、Reload 14 项和 Node Heat 计算 6 项通过；浏览器无 pageerror。
  Node 两文件语法与 diff 检查通过。所有夹具、模板和运行输出均在自有输出目录。
- READY：此项实现与局部验证。此轮以实际请求数和数据/交互正确性为证据，未重跑
  10,000×10,000 大文件耗时基准，不把少两次请求换算成端到端加速倍数。
  Linux、PATH Python 3.10.12、Django 5.2.9、NumPy 1.24.4、pandas 2.0.3、tables
  3.8.0、Chrome 146 无界面软件渲染；未验其他平台/依赖、桌面 GPU、远程或并发用户。
- 自有新增范围：子仓库 metric_heat.js、test_heat_template_import.cjs 与根本线 pair。
  此前 README/Line/Heat 后端待提交改动、未知 version.txt/sp.json 及依赖文件
  均逐字节保留。根与子 HEAD 未变、index 均空，专用服务与浏览器已退出。
  无构建、提交或 push；全框架门禁未运行且无本轮新豁免，不复用旧豁免自主提交。
  子仓库候选标题 `[archvisual] perf: reuse Heat template import samples`；满足提交
  条件后，子仓库先提交，父 gitlink 与本线 pair 后提交。
- 自有输出：__output__/archvisual/heat_template_reuse_20261110/；REPORT.md、FINAL.json、
  before/after 来源、baseline/、optimized/、multiple-plot/、reload/、static-checks.json、
  protected-files.json；各 case 包含实际命令、服务/浏览器日志与来源快照。

## Line/Heat 重复 Plot 指标复用完成（2026-11-10）

- 用户确认“先做重复指标复用的优化”。新增 metric_samples.js 共用拆分/合并，
  Line/Heat 仅查询未出现在本面板已完成绘图中的指标，完全命中时不查询；保留指标
  顺序与组设置。Line 留存当前指标数组引用并在删除/清空/换数据时清理；Heat 引用
  当前版本的已有行。没有预取、跨面板共享或未完成请求合并，后端 API 不变。
- Load/Reload 成功后替换旧记录；失败 Reload 保持原数据。排除缺失指标的占位行，
  实际全 null 指标可复用。捕获的旧数组不能越过原 epoch/token 检查混入刷新结果。
  Line 会延长当前已绘指标原始响应数组的生命周期；本轮未测总内存峰值下降。
- 两个旧实现基线均在预期位置失败：第一次画 p1/p0，第二次画 p0/p2/p1 仍查询三个；
  修改后第二次只查询 p2，72 个 sample 值变为 24 个，完全重复 Plot 不发查询。
  同一小夹具中，Line 第二次响应 613→271 字节、Heat 621→279 字节；只说明此夹具
  的载荷变化，不换算为大型文件端到端加速。基线失败与请求记录保留。
- 新 scripts/test_metric_sample_reuse.cjs 的 Line 16、Heat 17 项通过；覆盖完整数值、
  顺序、单组/最后所有者删除、同路径同样本数 Load/Reload、失败恢复、双面板隔离、
  缺失与全 null、混合请求失败/重试、旧响应、Clear、模式切换和模板导入后的复用。
  新 helper 单测 5 项与既有 Heat 数值 6 项通过；现有多图绘制 65、Reload 14、
  Line 删除 18、模板导入 12 项通过，合计当前最终专项/兼容浏览器 142 项，无 pageerror。
- Reload 回归原先用已绘制 port3 等待网络延迟，复用后不再有该请求。夹具增加未绘制
  port30，延迟查询与新数据统计的断言同步更新，保留实际请求/Reload 交错验证。
  旧脚本已进入串行测试时，以精确 PID 停止本轮拥有的过时测试（exit 130），再按
  更新脚本运行通过；原记录与 reload-fixture-interruption.json 保留，不算 PASS。
- 新 Heat 测试最初误把可见格子当完整行；改为滚动采集后发现独立的旧末端布局问题。
  1500px 双分窗的失败和冻结旧 Heat 模块对照保留。最终数据复用专项在 2400px 双分窗
  中逐项比较所有 24 sample，不缩减数值断言；窄分窗末端问题不计为验证通过，见下节。
- Node 语法、模板内联 JS 语法、CRLF 保留与相关 diff 检查通过。Linux、PATH Python
  3.10.12、Django 5.2.9、NumPy 1.24.4、pandas 2.0.3、tables 3.8.0、Chrome 146
  无界面软件渲染；未验桌面 GPU、其他平台/依赖、大矩阵吞吐/内存或并发用户。
- READY：重复指标复用实现和上述局部验证。新增/修改范围是 metric_samples.js、
  metric_heat.js、metricviewer.html、两项新测试、test_metric_reload.cjs 与本线 pair。
  现有 Line/模板导入修改按 before/after 增量保留；后端、README、其他既有测试、
  未知 version.txt/sp.json 与依赖文件原字节保留。未运行全框架/原生/发布构建，
  无本轮新门禁豁免，不满足自主提交条件；无 index/commit/push，两个 HEAD 未变。
- 自有输出：__output__/archvisual/metric_sample_reuse_20261110/；REPORT.md、FINAL.json、
  before/after、各增量 patch、baseline-line/heat、final-line/heat、multiple-plot、
  reload-updated、line-delete、template-import、node-tests.log、inline-syntax.json。
  候选标题 `[archvisual] perf: reuse displayed metric samples on repeated Plot`；满足
  提交条件后先提交子仓库本项精确增量，再提交父 gitlink 与本线 pair。

## 待决：窄分窗 Heat 横向滚动末端显示（2026-11-10）

- 在当前 Chrome 146 环境，1500px 页面左右双分窗、单个 Heat 图、24 个 sample 时，
  右侧 viewport 的 clientWidth=528、offsetWidth=543、scrollWidth=644。
  实际滚动上限为 101，按 scrollWidth-clientWidth 得到的上限为 116；当前末端识别
  未触发，最终可见 sample 索引 6..21，末尾 22/23 没有出现在该滚动窗口。
- 同一诊断用冻结实施前的 metric_heat.js 与当前文件分别运行，几何和 sample 序列
  完全相同。显示滚动条仍可复现，不能归因于隐藏滚动条开关或本次数据复用。
  数据数组未缺失，宽视图已核对所有 sample；已确认的影响是该条件下末端可见性。
- 输出 scroll-before/、scroll-current/、scroll-comparison.json 保存实际条件和结果；
  诊断进程正常退出不代表该布局问题通过。本轮只记录，不改布局；后续修复范围需
  单独确认，应统一滚动上限和末端定位所采用的 viewport 几何口径，再验证不同分窗、
  滚动条、缩放与统计列条件，不能靠丢弃末尾 sample 或放宽数值比较规避。

## Heat 缩小至采样区宽度后停止完成（2026-11-10）

- 用户在只读确认后批准实施。metric_heat.js 为同一面板计算共享下限
  min(16,max(1,实际采样区宽度/当前范围 sample 数))；Ctrl+滚轮到下限时钳制。
  完整容纳时横向偏移归零，显式显示全部 sample，避免小数像素舍入漏掉末尾格子。
  测量与绘图共用几何，覆盖窗口、分窗、侧栏、范围、Load/Reload 变化及离屏新图。
  保留较大的已有格宽，短数据维持 16px，大数据最低 1px 并保留水平滚动。
- 纵向格高和 min/avg/max 三列仍为 16px，不改任何 sample 值、统计语义、数据接口
  或 renderer。状态文本显示两位小数，布局继续使用完整精度；小幅滚轮取整不会
  反转缩放方向。metricviewer.html 仅将 Heat 脚本引用 v15→v16，CRLF 原样保留。
- 新 scripts/test_heat_zoom_fit.cjs 在旧实现上按预期失败：855px 采样区、400 sample
  实际缩至 1px/格，所需下限是 2.1375px/格。修改后实际停在 2.1375px，完整显示
  索引 0..399，两个图一致；基线原件保留。新专项最终 18 项通过，包括连续/反向/
  微量滚轮、首末 raw 值、侧栏拖动隐藏恢复、窗口/两种分窗与分界线拖动、范围变化、
  主副隔离、离屏新图、普通滚轮、1/12/400/2000 sample、Reload/模式往返及空图。
  稳定状态监测 400ms，没有额外 setOption 循环；不据此声称所有时序均无抖动。
- 现有多图 65、统计列 16、Reload 14、模板导入 12、Heat 重复指标复用 17 项通过；
  合计最终浏览器 142 项，无 pageerror。Node 数值统计 6 项、指标复用 helper 5 项
  通过；JS 语法、按原 CRLF 格式的 diff 检查、HTML 精确字节增量检查通过。
- 首轮新专项误将分界线拖动后的另一面板可用宽度也要求不变，已有缩放/数据正常；
  修正为确认宽度随布局变化、格宽/数据保持原值，失败原件 optimized/ 保留。
  默认 git diff --check 将 CRLF 视为尾随空白，改用显式 cr-at-eol 检查；新文件
  --no-index 的正常差异退出 1 曾被检查驱动误判，已修正。两项记录独立保留，未改
  产品文件行尾或以忽略普通尾随空白方式规避。
- READY：上述实现和定向验证。Linux、PATH Python 3.10.12、Django 5.2.9、NumPy
  1.24.4、pandas 2.0.3、tables 3.8.0、Chrome 146 无界面软件渲染。未验其他平台/
  浏览器/依赖、桌面 GPU 或大型矩阵性能。此前窄分窗溢出状态的滚动末端问题仍待决，
  本次未修改该末端定位公式，不将全范围 fit 验证当作该问题完整修复。
- 本轮精确增量：metric_heat.js、metricviewer.html、新 test_heat_zoom_fit.cjs 和
  根本线 spec/plan；此前 Line/Heat/后端/README/测试改动、未知 version.txt/sp.json
  与依赖文件保留。无原生/发布构建、index/commit/push；全框架门禁未运行且无本轮
  新豁免，不满足自主提交的既有门禁条件。候选标题为
  `[archvisual] fix: stop Heat zoom-out at viewport fit`，满足提交条件后子仓库增量
  先提交，父 gitlink 与本线 pair 后提交。
- 自有输出：__output__/archvisual/heat_zoom_fit_20261110/。REPORT.md、FINAL.json、
  before/after 与增量 patch、baseline/、optimized/、optimized-corrected/、final/、
  五项 compatibility 目录、static-checks.json、protected-files.json；实际命令与
  生产来源快照均随各 case 保存，专用服务与浏览器已退出。

## Line/Heat 优化八笔本地提交授权与回执（2026-11-10）

- 用户明确授权“豁免本轮框架门禁，按八笔清单提交”。本轮完整框架门禁依此豁免，实际未运行；
  不沿用旧豁免，不将局部验证或源码匹配记录为全框架 PASS。
- 七笔 ArchVisual 本地提交按已审定前后像顺序创建；公共模板/Heat JS 的历史
  增量只写入 index，工作树始终保留最终版本，没有覆盖未知修改：
  - `3ace5ad9ad732522a71187737acd12a570c939d7`：[archvisual] fix: skip redundant Line chart resizing。
  - `2d3c7e70216d82a57720ead658885bd98431a0a8`：[archvisual] fix: preserve Line state when deleting metric groups。
  - `a56161b3f50d38c45348deafc912cc553adad0ad`：[archvisual] docs: record renderer evaluation and follow-up limits。
  - `62fd07759f8dc437dbcf5f8ba080c171c855f2ee`：[archvisual] perf: batch Heat values while preserving integer types。
  - `25abddb0f6974dd4afa773ef239d52b74d2a96e6`：[archvisual] perf: reuse samples returned by Heat template import。
  - `8f55bbea988797e288f310e0ab40da26c0ddbdcb`：[archvisual] perf: reuse samples on repeated Line and Heat Plot。
  - `99bb4c9f10c957ebcd23b4b0f954f0c84052778f`：[archvisual] fix: stop Heat zoom-out at viewport fit。
- 提交前 19 项阶段源码/测试与既有验收前后像匹配；当前 Python/JS/模板语法和
  CRLF 差异检查通过。复用各阶段实际验证，不重跑未变化的浏览器/后端测试。
- 本次根提交仅包含最终 archvisual gitlink 与本线 spec_archvisual.md、
  plan_archvisual.md。version.txt、sp.json、其他开发线与全部其余 dirty 均排除。
- 默认 Canvas 和既有数据接口保持原设计。窄分窗溢出情况下的滚动末端定位
  仍是独立待决项，不将本次缩小到 fit 的通过证据扩展为其修复。
- 无原生、发布或环境安装；没有 push。各 commit、精确 staged diff、来源 SHA
  和提交后核对结果保存在 __output__/archvisual/line_commit_review_20261110/，
  以 commit-*-receipt.json、FINAL.json 与 RESULT.md 为最终回执。

## Heat 横向滚动末端显示修复完成（2026-11-10）

- 用户批准“同意进行heat 末端显示修复，再做统计结果复用”；按此顺序实施。
  此节关闭此前“待决：窄分窗 Heat 横向滚动末端显示”，保留原失败证据。
- metric_heat.js 将共享逻辑偏移映射到各图实际可达的原生滚动范围，并补足溢出
  spacer 的 stable gutter；几何变化时才重新测量。保留 fit/缩放与纵向几何。
  HTML 引用 v16→v17，CRLF 保留；重复指标测试的 Heat 视口由 2400 恢复为 1500。
- 新 test_heat_scroll_end.cjs 在旧源码上真实失败：24 sample 的末端只到索引21；
  修复后13项通过，覆盖最后23、全样本原值、小于 gutter 的溢出、有/无纵向滚动条
  多图联动、原生滚动/Shift+滚轮、范围/缩放/侧栏/窗口/分窗变化、Reload 与空闲稳定。
  兼容检查：zoom-fit18、多图65、统计列16、Reload14、窄分窗数据复用17，合计
  143项浏览器断言通过，无 pageerror。相关 JS 语法、HTML 精确字节增量检查通过。
- READY：上述范围已实现并定向验证。Linux、PATH Python3.10.12、Django5.2.9、
  NumPy1.24.4、pandas2.0.3、tables3.8.0、Chrome146 无界面软件渲染；未验其他
  平台/浏览器/依赖、桌面GPU或大矩阵性能。无原生/发布构建、环境安装或提交操作。
  完整框架门禁未运行，本轮无新豁免；上一轮八笔提交的豁免不延用。
- 自有输出：__output__/archvisual/heat_scroll_end_20261110/，baseline/、repaired/、
  compatibility.json 与各案例 receipt/result、before/after、REPORT.md 保存实际证据。
  候选标题 `[archvisual] fix: reach final Heat samples in narrow viewports`。
  下一项为同面板、同数据版本的 Heat 统计结果复用；尚未在本项引入。

## Heat 重复 Plot 的统计结果复用完成（2026-11-10）

- 按用户批准顺序，在末端修复143项验证通过、冻结 before/after 后实施。
  rowsFromGroups 接受当前查询的已有行表；相同指标名、相同只读数组引用、相同
  sample 数时复制统计元数据，其他情况保持全量校验和计算。复用来源仍受同面板、
  dataEpoch、loaded/busy、缺失占位过滤限制；没有增加长期缓存或改变统计含义。
  HTML Heat 引用 v17→v18，CRLF 保留。新增测试断言覆盖数组实际读次数与统计结果。
- 真实浏览器基线按预期失败：第二个部分重叠 Plot 使两个已有24 sample指标的扫描
  次数各从2增至4、读取次数各从48增至96。修改后新增断言确认每次 Plot 不再扫描
  已有数组，只校验并扫描新查询指标；全部 min/avg/max 和原始 sample 均精确比较。
  同路径 Load/Reload、失败 Reload、指标缺失/恢复、双面板、延迟响应、Clear、
  删除最后所有者、混合请求失败/重试、全 null、模式往返和模板导入后复用均通过。
- 最终浏览器：统计复用18、统计列16、多图65、模板12、Reload14、末端13、fit18，
  合计156项通过，无 pageerror，专用服务与浏览器退出。Node 数值/复用12项及
  查询拆分5项共17项通过，包含新数组重新校验、元数据独立、负零、消减与溢出。
  JS语法、CRLF与精确引用字节、相关diff检查通过。
- Node22生产helper微基准：100个metric×10000 sample，15轮交替对照，完全复用
  rowsFromGroups中位15.750442ms→0.033410ms；不包含I/O、JSON、ECharts或布局，
  不等于整页Plot加速比例。首次/半数命中原始测量也保留，但有JIT/调度波动，
  不据其差异声称首次计算更快；确定收益是已命中的sample不再被遍历。
- READY：实现与上述定向验证。Linux、PATH Python3.10.12、Django5.2.9、NumPy1.24.4、
  pandas2.0.3、tables3.8.0、Chrome146无界面Canvas软件渲染；未验其他平台/浏览器/
  依赖、桌面GPU、1亿sample整页吞吐或内存峰值。全框架门禁未运行，无本轮新豁免，
  无原生/发布构建、环境安装、index/commit/push。两项改动尚未提交。
- 自有输出：__output__/archvisual/heat_statistics_reuse_20261110/；baseline/、optimized/、
  六项compatibility、node-tests.log、benchmark-statistics.json及复现脚本、environment.json、
  before/after、REPORT.md和FINAL.json保存真实来源与边界。精确增量为metric_heat.js、
  metricviewer.html、test_metric_heat.cjs、test_metric_sample_reuse.cjs与本线pair。
  末端修复的独立前后像保留在heat_scroll_end_20261110/；未知version.txt/sp.json不纳入。
  候选标题 `[archvisual] perf: reuse statistics of displayed Heat samples`，依赖末端修复
  子提交；满足提交条件后两个子增量先行，父gitlink及本线pair随后。

## Heat 交互性能分析完成，Canvas 格子原型待批准（2026-11-10）

- 用户批准“先分析 Heat 交互性能（推荐）”。生产源码、既有待提交实现与测试、
  依赖和未知version.txt/sp.json原字节保持不变；仅在自有输出目录测量，追加本线pair。
  复用已核实SHA的10000metric×10000sample H5，每图实际选8或64个指标，完整查询
  其10000sample；没有同屏绘制1亿格子，也没有重生成或改动输入文件。
- 9个无内部探针的正式计时case：单图64行、8图各64行、8图各8行，各3轮串行、
  场景顺序轮换。另6个预演/分项/CPU与分配采样/精简option/普通滚轮对照，共15个
  case完成，850条输入或原生滚动记录（含无变化事件）。记录数不是功能测试项数。
- 三轮中位数再取中位：16px水平平移，单图/8高图/8矮图37.35/39.25/43.60ms；
  1px时343.60/368.05/267.60ms。对应每次更新采样格子2438/2438/1696和
  39330/39330/27360；高图场景只有1图与视口相交，矮图4图相交，边缘图包含局部遮挡。
  高图密集原生纵滚约332.15/328.35ms；矮图页面平移未触发格子重绘时约16.65ms。
- 分项预演中，单图1px平移的render中位311.45ms，其中setOption309.40ms、内部
  Canvas painter125.60ms、格子数组构建1.25ms；浏览器布局约0.36ms，颜色范围扫描
  低于计时分辨率。setOption与painter为嵌套耗时，不相加。8高图/8矮图的分项同样
  由setOption主导。精简重复配置的临时页面密集平移343.40ms，未见明显改善，
  单轮对照不构成稳定等价性/收益结论，不推荐作为主要优化。
- V8采样与当前ECharts源码相互印证：cartesian heatmap更新逐格new矩形并加入绘图组。
  6次密集平移累计分配采样估算约642MiB，约94.5%来自ECharts代码；这是含已回收
  对象的累计分配估算，不是常驻内存、RSS峰值或泄漏证据。CPU采样也包含GC与原生fill。
- 所有已查询完整数组前后SHA一致，每阶段核对当前相交图的sample原值、时间标签、
  完整统计列和格子数量；交互未增加后端query。没有pageerror/dialog，专用服务和
  浏览器均退出。普通滚轮快速混合手势的两次RAF探针未覆盖后续默认滚动，不纳入
  重绘耗时表；静止500ms后的独立对照确认scrollTop64→128→64，保留两类原始记录。
- 首次准备快照误列不存在的metric_heat.css，读取前置失败，未启动测量或修改源码；
  样式实际在模板中，修正清单后继续，preparation-failure.json保留，不算验收失败或PASS。
- READY：分析与候选方案。建议先批准输出目录内的直接Canvas格子绘制原型与对照，
  保留坐标轴/颜色条并检查颜色/取值一致性，再评审正式接入；当前仍是待批准提案。
  不再把低占比布局/颜色范围缓存列作主要收益方向，不承诺原型的未测速度。
- 测量限制：共享主机、Linux/PATH Python3.10.12、Django5.2.9、NumPy1.24.4、
  pandas2.0.3、tables3.8.0、Node22.22.1、Chrome146软件Canvas，1500×900视口。
  时延为输入/原生scroll事件至两次RAF机会，非物理显示完成；缩放序列包含边界钳制。
  无桌面GPU、其他平台/浏览器、同屏万指标、所有颜色配置或长时间内存泄漏验收。
  部分轮次受调度/JIT/GC影响明显，更慢记录完整保留。无安装、原生/发布构建、
  全框架门禁、index/commit/push；本轮分析不授予生产改造或沿用旧门禁豁免。
- 自有输出：__output__/archvisual/heat_interaction_analysis_20261110/；REPORT.md、
  summary.json、profile-summary.json、before.json、source-check-before-documentation.json、
  case-audit.json、FINAL.json及各case的冻结脚本、生产源码、receipt、截图、CPU/heap/trace。

## Heat Canvas 格子绘制原型完成（2026-11-10）

- 用户批准“同意先做 Canvas 格子绘制原型（推荐）”；只在
  __output__/archvisual/heat_canvas_prototype_20261110/实现原型、探针和测试适配。
  canvas-prototype.js直接绘制采样格子，shadow-metric_heat.js保留生产布局与ECharts
  坐标轴/颜色条/统计列；通过浏览器route替换响应。正式源码没有renderer变更。
- 复用10000指标×10000样本H5，输入前后SHA不变；实际每图选择64或8指标，全部
  10000原样本保留。三轮、三种场景、基线/原型交替，共18个独立串行计时case。
  1px密集横向平移三轮中位：单图349.80→88.20ms；8张高图347.60→84.50ms；
  8张矮图263.80→96.75ms，耗时比分别3.97/4.11/2.73。均为输入事件到两次RAF
  机会，不是物理呈现完成；软件渲染，仍不满足16.7ms帧预算。慢轮次全部保留。
- 单图39,330个采样格子保持不变，ECharts绘图对象40,399→1,069。两个独立CPU/
  heap采样case各6次密集平移，累计JS分配估计641.12→77.76MiB，含已回收对象，
  不是RSS/常驻内存或泄漏结论；不包含额外Canvas像素缓冲区及合成内存。
- 最终原型61项具名验证通过：像素/hover/采样选择删除16、统计DPR1和DPR2各16、
  末端滚动13。覆盖全局/手动/逐指标色阶、零/负数/常量/null、原值与统计、缩放/
  范围/末端、多图/分窗、侧栏、Reload、模式往返、统计选择删除、无空闲更新循环。
  性能和采样case另外逐阶段核对可见数值/标签/统计/数量；20case共1204条事件记录，
  记录不等于测试项数。原数组前后SHA一致，无新增交互query、pageerror/dialog。
- 12个区域内部共2,841,260像素对照。16px的DPR1/2三种色阶读取区域完全一致；DPR2本次
  小数/1px亦一致。DPR1小数格宽3420通道、1px中段102通道/末端137通道不同，最大
  3/255；差异如实保留。未验1.25/1.5或跨屏DPR变化、所有边界hit与hover高亮联动。
- 两次测试失败保留：pixels-attempt1使用null指标名被CSV解析为空；改普通名称。
  pixels-attempt2缩放锚点未回零导致指定sample hover超时；修复测试定位。初稿
  fillRect较快但边缘差异更大，最终使用路径rect/fill/stroke；不混用62ms初稿数值。
  pixels-path、18次正式计时、2次分配采样及3次兼容case均使用最终路径版本。
- READY仅指原型及上述验收；生产接入待用户批准。建议正式接入时补齐主格子hover
  高亮、颜色条联动、tooltip外观、生命周期/DPR、少量亚像素边缘一致性及长期释放
  检查，再适配正式测试。当前不增加默认开关，不改变现有数据或统计语义。
- Linux PATH Python3.10.12、Django5.2.9、NumPy1.24.4、pandas2.0.3、tables3.8.0、
  Node22.22.1、Chrome146软件Canvas。未验桌面GPU、其他浏览器/平台、全框架、
  原生或发布构建；本轮无门禁豁免、环境安装、index/commit/push。所有专用进程已停，
  18166端口释放。前期末端修复/统计复用、version.txt/sp.json及其他线原字节保留。
- 证据：上述输出目录README.md记录复现；REPORT.md给出完整结论/边界；summary.json
  为数值汇总；各case保存脚本、日志、截图、profile/trace及退出回执；
  source-check-before-documentation.json和FINAL.json记录来源字节、HEAD/index核对。


## Heat 采样格子直接 Canvas 正式接入完成（2026-11-10）

- 用户批准“按此完整方案实施”。新增metric_heat_canvas.js负责可见格子绘制、CSS坐标
  命中、局部悬停与清理；metric_heat.js继续持有原样本、统计、查询复用、滚动与分组。
  模板新增独立ECharts轴/统计层与透明采样/临时高亮Canvas；不新增renderer菜单、
  后端接口或依赖，不转换/聚合/量化样本。README及本线spec同步最终合同。
- 图形使用ECharts实际轴中心/band/DPR。小图悬停保存小块原像素；密集图保留原
  ECharts hover-layer混色，图例高亮复用真实范围，统计列沿用相同高亮层判定。
  样本pointer光标及样本→统计指示器交接均与旧版对照。DPR变化重建实例；Clear、
  删除末行、模式切换及数据替换失效frame、回调、监听和位图。
- 最终字节通过14项Node测试、Django check、200项具名浏览器检查；另明确列出
  116组像素比较（四种DPR、正常/缺失/小数及1px格子、首末端、悬停恢复、
  双向图例及统计列高亮），896,907,364个RGBA通道比较为零差异，不用容差接受差异。
  生命周期包含DPR1→1.25→1.5→2→1、Line/Heat、10轮Plot/Clear、末行Delete。
  既有多图/分窗/侧栏/模板/查询复用/统计复用/Load/成功与失败Reload/旧响应保护通过。
- 最终三轮三场景×基线/生产共18个独立计时case，144阶段、1548条事件记录；
  普通wheel默认滚动不纳入重绘耗时结论。1px平移三轮中位：
  单图64指标（可见1图） 349.85→88.95ms（3.93×）；
  8图各64指标（可见1图） 384.65→90.90ms（4.23×）；
  8图各8指标（可见4图） 267.55→99.90ms（2.68×）；
  三场景均超过2×目标；16px平移、采样悬停和侧栏拖动未见可复现退化，完整轮次保留。
  实际每图8/64指标×10000原样本，不是同屏绘制10000×10000格子。
- 两个独立CPU/heap/trace case各6次密集平移，累计JS分配采样约635.47→80.55MiB。
  这不是RSS、常驻堆或泄漏结论。DPR1密集平移新增采样位图：单图约
  2.42MiB，8高图当前合计2.42MiB，8矮图合计
  1.73MiB；图例悬停另可分配一张当前可见网格大小的临时位图，
  单格悬停仅小块。DPR升高按像素面积增加，不含浏览器合成副本及缓存。
- 问题均保留原证据：小数DPR移开后1通道舍入差异→保存原像素；旧缩放测试与已批准
  fit下限不一致/把活动indicator计入静态图例→修正夹具及断言；Reload旧series读取→
  观测真实frame；侧栏计时等待mousemove→改pointermove并加10秒超时；悬停光标/统计
  指示器交接→明确事件归属；密集hover混色→独立高亮层。早期measure-*与profile-final-*
  只作修复前证据，最终结论仅使用accepted-*及profile-accepted-*，不复用旧字节PASS。
- READY：实现及上述定向验收。提交条件未满足：未运行本轮全框架门禁，没有新豁免；
  不启动原生/发布构建、依赖安装或其他线重型验收，不写index、不commit/push。
  后续候选依赖顺序为此前末端滚动修复→此前统计复用→本次Canvas完整实现与测试/
  README→父仓库gitlink与本线pair；未知version.txt/sp.json及其他线修改必须排除。
- Linux/PATH Python3.10.12、Django5.2.9、NumPy1.24.4、pandas2.0.3、tables3.8.0、
  Node22.22.1、Chrome146软件Canvas；计时是事件到两次RAF机会，非物理显示完成。
  不声称桌面GPU、其他浏览器/平台、60fps、长时间内存泄漏或全工作区通过。
- 自有证据：__output__/archvisual/heat_canvas_integration_20261110/；README.md给复现入口，
  REPORT.md/summary.json给结论，accepted-source.json/FINAL.json核对来源和保护文件；
  pixels-complete及accepted-*保存真实资源、脚本、日志、截图和进程退出回执。

## Heat 优化四笔本地提交授权与回执（2026-11-10）

- 用户明确授权“豁免本轮框架门禁，按四笔清单提交”。本轮完整框架门禁依授权豁免，实际未运行；
  不沿用旧豁免，不将定向验证或源码匹配记为全框架 PASS。
- 三笔 ArchVisual 子仓库提交按已审阅独立前后像顺序创建：
  - `f9841030a98a2e59b5b0219fff012f8919c34bc7`：[archvisual] fix: reach final Heat samples in narrow viewports。
  - `719006e6016bc196f62834409e888202538793a6`：[archvisual] perf: reuse statistics of displayed Heat samples。
  - `0a3273bb362e846051f87ce2725ca094c857fd28`：[archvisual] perf: draw visible Heat samples directly on Canvas。
- 共享 Heat JS、模板和测试按各阶段精确字节写入 index，工作树始终保留最终实现。
  每笔实现及其必要测试共同提交，不覆盖未知修改。
- 提交审阅核对21份阶段JS/CJS语法、独立阶段前后像及31份最终验收来源；
  复用字节一致的末端143项、统计复用156项浏览器/17项Node及正式Canvas
  200项浏览器/14项Node/Django check与116组像素对照证据，不重复执行无漂移测试。
- 根提交仅更新archvisual gitlink及本线spec_archvisual.md、plan_archvisual.md。
  未知version.txt、sp.json及其他开发线修改保持原样；没有push。
- 本轮只提交已批准实现及真实状态，不实施平移位图复用等后续优化；无服务、浏览器、
  原生/发布构建或环境安装。此前平台、桌面GPU及全框架未验边界仍然有效。
- 精确消息、staged patch、各笔commit和提交后核对见
  __output__/archvisual/heat_canvas_commit_review_20261110_nz_dqv0n/，
  以commit-*-receipt.json、FINAL.json及RESULT.md为最终回执。

## Nuitka 打包前后性能对照完成（2026-11-10）

- 用户批准“按此方案执行，先核对构建窗口”。先确认无其他原生构建，再独占根重型验收
  锁与子仓库 release 锁，以子仓库 `0a3273bb362e846051f87ce2725ca094c857fd28` 的提交
  快照进行一次独立 standalone 构建。未知 version.txt/sp.json 未纳入；不修改生产代码。
- 实际 PATH Python3.10.12、Nuitka2.7.12、Django5.2.9、NumPy1.24.4、pandas2.0.3、
  tables3.8.0、Chrome146。保留原构建优化，限制2个GCC任务并生成编译报告；
  不自动下载或安装依赖。实际 `-O2 -fno-lto`，独立空缓存构建50.78分钟、退出0；
  分发目录332.83MiB、1052文件，可执行文件157.86MiB，报告共2515模块。
- 既有10000×10000 H5，源/产物均 `runserver --noreload`。两个成功预演后五轮交替
  串行、每次独立服务/浏览器，共10正式case、170个加载/绘图操作、20个交互场景、
  1720条输入事件记录全部通过。完整名称/时间轴/采样周期、选中96指标的全样本与
  min/avg/max、重复查询复用、部分重叠仅查询新指标、Reload保图和真实前端字节均核对。
- 当前配置没有整体提速。五轮中位：64指标Line查询API 334.6→744.2ms，
  Heat查询API 279.1→701.5ms；Heat首次Plot 408.0→833.2ms，保留三个Heat图的服务端
  Reload页面2427.5→4236.5ms。单图1px平移93.50→95.25ms、多矮图105.45→107.40ms，
  前端交互基本相近。Line64首次/重复/部分重叠绘图仍约20/37/56秒，不能靠后端编译
  消除浏览器绘图成本。所有数值与范围见完整报告，不按少量波动宣称收益。
- 首次服务端Load页面中位1576.3→1016.4ms，但两组范围明显重叠且共享后台负载存在；
  重复Load1749.2→1858.7ms、本地上传2399.9→2383.2ms，不认定稳定H5加载加速。
  服务端峰值RSS中位1739.56→1951.71MiB，启动PSS70.45→162.57MiB。
- 确认一个退化原因：Nuitka本机anti-bloat规则排除CPython `_json` 扩展，产物运行时
  `json.encoder.c_make_encoder` 为None、`_json`不可用，源码环境正常。正式计时结束后
  通过真实Django shell/stdin独立诊断同64×10000样本JSON编码：源码C路径283.14ms、
  源码进程临时Python回退486.61ms、产物默认回退627.18ms（各五次中位）。三个输出
  字节数及SHA一致；临时替换在诊断进程中恢复。没有修改产物或重建，不承诺修复后
  可恢复全部差值。下一步候选先显式保留 `_json` 并验证产物，再审查可选依赖与构建缓存；
  这些修复/裁剪尚未批准实施。
- 失败预演保留：误认为普通Heat Load清图导致上传阶段额外3次query；改为测量前显式
  Clear后重新预演通过。初版浏览器RSS按进程组统计遗漏Chrome独立进程组，改为追踪
  子进程树并排除Node驱动；失败预演和无效内存未纳入正式汇总。全部正式脚本哈希一致。
- 本轮仅Linux软件Chrome、暖文件缓存、回环网络、每图8/64指标；不是一亿格子同屏。
  未验冷缓存、默认自动重载、桌面GPU、其他平台/浏览器/Nuitka版本、全框架门禁。
  RSS采样可能重复计算共享页、两次RAF非物理显示完成；不把诊断或旧PASS当全仓验收。
- READY：比较与诊断完成。无新框架豁免、环境安装、发布、index/commit/push；任务进程
  已退出、18168空闲、两锁释放。源快照/生产文件/输入H5/未知修改保持原字节，HEAD及
  两仓index未变；仅追加本线plan。详细解释和下一步建议见自有输出RESULT.md。
- 证据：`__output__/archvisual/nuitka_comparison_20261110T091549Z/`，包含manifest、
  build-receipt/compilation-report、pilot与formal-suite、逐case日志/截图/内存/计时、
  REPORT.md/summary.json、json-runtime-probe、measurement-review与前后核对回执。
## Nuitka 保留 `_json` 与同机复测完成（2026-11-11）

- 用户批准“保留_json 并重新对比”。生产改动仅 `build_visual.py` 显式包含 `_json` 及
  原因注释；应用代码、前端资源、依赖声明、version.txt 和未知 sp.json 均未修改。
  快照为子仓库 `0a3273bb362e846051f87ce2725ca094c857fd28` 加本轮构建参数，
  相比上一轮源码快照仅 build_visual.py 不同；保护文件与输入 SHA 均保持一致。
- 先核对窗口并独占根重型验收锁与子仓库 release 锁，一次真实 Linux standalone
  构建成功，用时43.03分钟、2个GCC任务、原优化参数；没有安装或下载依赖。
  分发目录332.88MiB/1053文件，报告2516模块，明确含 `_json` 原生扩展。
  两项既有构建失败传播/standalone布局测试通过；其中macOS分支为模拟控制流，
  不冒充真实macOS构建。构建与性能测试均串行，服务/浏览器不与编译重叠。
- 真实源码、旧包、新包的Django shell/stdin诊断通过。新包C JSON编码器、ASCII
  字符串编码器和扫描器均存在，旧包均缺失。Unicode、大整数、null、浮点及负零
  往返通过；64×10000样本五种编码路径输出均为5,219,920字节、相同SHA。
  独立五次编码中位：源码C367.05ms、旧包回退871.26ms、新包C294.94ms；
  源码/新包进程临时回退分别516.85/592.59ms。诊断时序非轮换且存在负载波动，
  仅辅助解释，不把它当真实接口或稳定的源码加速比。
- 新增同机源码/旧包/新包五轮顺序轮换HTTP对照，共15个全新服务、90个计时操作
  全部通过。完整响应读取计时，解析/校验在计时外，每种query先预热；每种操作
  的响应字节SHA跨三种运行方式和各轮完全一致。旧包字节与上一轮产物匹配。
  三组中位（源码/旧包/新包）：Line64查询265.36/687.28/292.84ms，Heat64查询
  190.47/620.93/226.47ms，保留三个Heat选择的Reload2290.08/3719.40/2399.75ms。
  旧包→新包分别减少57.4%/63.5%/35.5%；H5 Load波动较大，不认定稳定提速。
- 源码/新包两次成功浏览器预演后，五轮交替、每次重启服务/浏览器，10正式case、
  170个加载/绘图/Reload操作、20个Heat交互场景、1720条输入事件记录全部通过。
  完整10000名称/时间轴/采样周期、选中96指标所有样本与min/avg/max、重复查询
  复用、部分重叠仅查新指标、两种Reload保图和真实JS资源字节均核对。
- 浏览器源码→新包中位：Line64查询349.30→363.90ms，Heat64查询292.30→289.50ms，
  Heat64首次Plot436.10→416.40ms，服务端保图Reload页面1436.80→1691.30ms。
  Line64首次/重复/部分重叠页面约18.6/37.3/58.3秒与19.0/37.5/58.9秒；单图1px
  平移98.70→97.50ms，多矮图105.00→104.45ms。没有整体提速；完整范围保留，
  包括新包一次1008.4ms查询及交互慢轮次，不删除异常值或混用直连HTTP与浏览器口径。
- 服务端峰值RSS中位1744.86→1828.16MiB，启动PSS70.38→162.39MiB；启动594.35→
  720.59ms。旧包本轮只重测JSON/直连HTTP，未重测其完整浏览器与内存；上一轮旧包
  内存是历史证据，不能据此宣称本轮控制实验测得旧包→新包的内存降幅。
- 第一次浏览器预演在启动前因直连测试留下的TCP TIME_WAIT而被裸bind检查拒绝，
  已保存失败回执与无监听进程证据。仅修正输出目录探针的SO_REUSEADDR，保留bind
  排他与服务端socket归属检查，然后重新预演通过；生产服务未改，失败无计时结果。
  两个最初控制测试夹具误用子仓库默认输出目录，已仅移动自有夹具到根输出目录，
  并在显式输出路径重跑两项测试通过。所有正式计时脚本哈希一致。
- 实际PATH Python3.10.12、Nuitka2.7.12、Django5.2.9、NumPy1.24.4、pandas2.0.3、
  tables3.8.0、Chrome146软件渲染。暖文件缓存、回环网络、runserver --noreload，
  每图8/64指标，不是一亿格子同屏；未验冷缓存、其他平台/浏览器/Nuitka、桌面GPU、
  默认autoreload或全框架门禁。两次RAF非物理呈现；RSS采样可重复计算共享页。
- READY：最小修复、真实构建与上述复测完成。没有本轮框架门禁豁免，故尚不满足
  既有提交条件；未写index、commit/push或正式发布。任务进程退出、18168空闲、
  两锁释放；最终来源、保护文件和Git状态见FINAL.json，不将局部PASS当全工作区PASS。
- 自有输出：`__output__/archvisual/nuitka_json_retained_20261110T230521Z/`。
  README.md为复现入口，RESULT.md为结论，REPORT.md/summary.json为完整浏览器数值，
  http-three-way/result.json、json-runtime-probe/result.json为独立对照，
  build-receipt/compilation-report、measurement-review与各case为原始证据。


## Nuitka JSON 加速修复两笔提交收口（2026-11-11）

- 用户明确批准“豁免本轮框架门禁，按两笔清单提交”；本轮框架门禁按该次授权
  豁免、没有运行，不将既有构建/浏览器证据或 Python 准入检查记作框架 PASS。
- 提交前逐 hunk 复审：build_visual.py 的3行修改及本线 spec/plan 与真实复测记录的
  SHA256 完全一致；Python 语法、两仓 scoped diff 检查、官方 workspace Python
  只读准入检查通过。没有重新构建、安装依赖、启动服务或重复运行性能测试。
- 子仓库提交：3e28b4bff8e6af0d739bcb54c56a35cd890eddf2，仅 build_visual.py 保留 _json。
  根提交范围限定为该子模块指针、spec_archvisual.md、plan_archvisual.md；
  version.txt、sp.json、requirements.txt 和其他开发线修改全部排除。
- 两仓在 main，提交窗口串行持有两仓既有提交锁，逐笔核对 staged diff、实际提交树、
  文件集合与父提交；不 push。实际两笔提交号、最终暂存区和锁释放核对见
  __output__/archvisual/nuitka_json_commit_review_20261111_2rERew/ 中的
  commit-1-receipt.json、commit-2-receipt.json、FINAL.json 和 RESULT.md。


## 构建与发布入口 -j 参数完成（2026-11-11）

- 用户批准“同意入口增加-j 参数”。build_visual.py 新增 argparse 入口，接受正整数
  -j N / --jobs N（含 -j4、--jobs=4）；显式值传给 Nuitka --jobs=N，省略时不注入参数，
  保留 Nuitka 默认并发及既有 build_executable() 调用。
- rel_visual.sh 在路径初始化和发布锁之前解析、校验参数，允许版本位与 -j 前后组合，
  通过非空命令数组将参数交给当前 PATH 的 python3。省略版本位仍同版本发布；缺值、
  非法值、未知参数或多个版本位在输出创建前退出。两个入口的 --help 均不触发构建。
- README 增补构建/同版本发布/递增发布示例，保留原 CRLF；本线 spec 记录接口边界。
  未修改环境脚本、依赖、版本号、服务或 _json 保留策略。
- 实际验证：PATH /usr/bin/python3 3.10.12、Linux x86_64、Bash5.1.16；
  python3 -B -m unittest scripts.test_paths scripts.test_release_visual -v：
  52项测试通过，44.599秒。全部测试输出显式放在本任务根 __output__ 目录。
  覆盖参数透传、默认不注入、别名/紧凑写法、非法输入不清理已有产物、版本位前后顺序、
  同版本与 maj/mid/min 发布、发布锁、构建失败传播及版本发布失败回滚。
- bash -n rel_visual.sh、两处 Python 语法编译、定向 git diff --check 通过；
  README 的 CRLF 按 core.whitespace=cr-at-eol 检查。逐 hunk 复审未发现本轮阻断问题。
- 本轮只执行轻量控制流测试；Nuitka 调用为模拟，macOS 分支也仅模拟布局。
  未进行真实并行编译、2/4并发耗时比较、macOS/Bash3.2或Windows实机验证、全框架门禁。
  上一次“两笔清单提交”的门禁豁免已用于上一任务，本轮未复用，不自动提交或推送。
- READY：功能及定向验证完成；子仓库 scope 为 build_visual.py、rel_visual.sh、
  scripts/test_release_visual.py、README.md，根仓库仅本线 spec_archvisual.md / plan_archvisual.md。
  version.txt、sp.json、requirements.txt 及其他开发线修改保持独立。
- 自有输出：__output__/archvisual/build_jobs_20261111_YaX3nD/；tests.log、environment.json、
  before.json、FINAL.json 和 RESULT.md 记录实际范围、验证与保护文件核对。


## 构建与发布 -j 参数两笔提交收口（2026-11-11）

- 用户明确批准“豁免本轮框架门禁，按两笔清单提交”；本轮框架门禁按该次授权
  豁免、未运行，不将52项定向控制流测试记作完整框架验收。
- 提交前六个候选文件 SHA256 与本轮验收记录一致；Python 语法、bash -n 和
  scoped diff 检查通过。本轮没有重复跑同来源测试或启动任何构建、发布、服务。
- 子仓库提交：469463c13cfc25394010c2340ed2352539264e7f，仅 build_visual.py、rel_visual.sh、
  scripts/test_release_visual.py、README.md。根提交仅该 gitlink 和本线 spec/plan。
  version.txt、sp.json、依赖声明及其他开发线修改排除。
- 审查时观察到另一个 -j 6 发布构建；该进程、发布锁及产物不属于本轮验收，
  未停止、修改或接管。提交仅使用两仓共享提交锁，不获取发布或重型验收锁。
- 两仓在 main 串行提交，逐笔核对暂存补丁、实际提交树、父提交及文件清单，不 push。
  两笔提交号、暂存区和锁释放状态以
  __output__/archvisual/build_jobs_commit_review_20261111_ade69423/ 中的
  commit-1-receipt.json、commit-2-receipt.json、FINAL.json 和 RESULT.md 为最终回执。


## Metric Name 纯键盘回车搜索修复（2026-11-11）

- 用户在只读复现后确认“按此方案实施”。原问题是键盘进入输入框后 Enter 已更新
  匹配及选择，但结果框仍隐藏；点击输入框才展开。原复现证据：
  __output__/archvisual/metric_search_enter_check_20261111_xPfc0b/result.json。
- metricviewer.html 的 MetricSearchFunc 在非输入法组合状态的 Enter 中先展开结果框，
  再执行现有搜索；保留键盘焦点、正则和自动勾选。兼容 key / keyCode，并阻止已处理
  Enter 的默认动作；isComposing / keyCode 229 不触发搜索。模板 CRLF 保留。
- scripts/test_metric_search_virtual.cjs 新增 --keyboard-only URL OUTPUT 入口：仅使用
  当前真实页面和页面内指标，拦截非 GET/HEAD 请求。完整入口也先运行键盘检查，
  reload 后再进入原 H5 回归；本轮只执行键盘入口，不宣称完整入口已重新通过。
- 实际 Chrome 146.0.7680.80 / Node v22.22.1，12组检查通过，errors/dialogs 均为0：
  Tab进入、键盘输入和Enter、关闭后重开、鼠标移开、大小写及空格正则、自动勾选、
  焦点保持；Line/Heat、单视图及水平/垂直分屏两面板；合成输入法事件、key-only及
  legacy Enter、空结果/空表达式、其他输入框Enter和鼠标展开兼容。
- 首次测试在 Heat 中点击禁用的 Group 输入框超时，是测试定位错误。已改用两种模式
  均可用的只读 Sample period 输入框，完整重跑12组通过；原失败日志和截图保留在
  browser/、browser.log，最终结果为 browser-final/result.json。生产修复没有因此扩大。
- 模板内联 JavaScript 与测试脚本语法、定向 diff 检查通过；真实服务返回的搜索处理
  函数与当前文件一致。独立只读复审针对生产顺序、焦点、选择隔离及测试边界。
- 未安装依赖、启动或重启服务、运行构建/发布、加载共享 H5 或发起 Plot。没有真实
  操作系统输入法、其他浏览器/平台、嵌入页面专项或全框架验收；不复用历史门禁豁免。
- READY：实现与定向验证完成；本轮尚未满足框架提交门禁，不写 index、不提交或推送。
  精确范围为子仓库 metricviewer.html、scripts/test_metric_search_virtual.cjs 及根
  spec_archvisual.md / plan_archvisual.md；sp.json、version.txt、依赖声明及其他线修改排除。
- 自有输出：__output__/archvisual/metric_search_keyboard_20261111_KI8Mul/，包括修改前像、
  before.json、浏览器失败/成功记录、FINAL.json 与 RESULT.md。


## Metric Name 回车搜索两笔本地提交（2026-11-11）

- 用户明确批准“豁免本轮框架门禁，按两笔清单提交”；本轮框架门禁豁免、未运行，
  不将12组浏览器定向检查记作框架 PASS，不复用上次任务的豁免。
- 提交前候选文件字节与实际验收记录一致；JavaScript语法和定向diff检查通过。
  本轮未重复运行浏览器、H5/Plot、系统输入法或构建/发布，保留原测试失败与修正记录。
- 子仓库提交：a0119c699a375220399c3b84f6fda918491666a3，仅 metricviewer.html 和
  scripts/test_metric_search_virtual.cjs。根提交仅子模块指针与本线 spec/plan。
- 根指针同时包含已有 cf5cce596a2d532993e0617fd2b9ba7193e6725a 版本更新
  （0.4.3→0.5.0）；该依赖已在提交清单披露。本轮没有重做或改写版本提交。
  sp.json、依赖声明、生成文件及其他开发线修改全部排除。
- 两仓 main 的共享提交锁串行持有，按明确路径暂存；核对暂存补丁、实际commit文件、
  父提交、文件字节和根gitlink。未 push。最终两笔提交号、index及锁释放状态以
  __output__/archvisual/metric_search_commit_review_20261111_12n5A0/ 中的
  commit-1-receipt.json、commit-2-receipt.json、FINAL.json、RESULT.md 为准。

## Line / Heat 指标与绘图组删除完成（2026-11-11）

- 用户先要求只读审查，在方案后明确批准“按此方案实施”。新增共用组操作菜单，
  两种模式均提供 Remove metric… / Remove group；Delete 删除具体指标，
  Shift+Delete 删除选中组，未选具体指标时普通 Delete 只提示，最后一条自动删空组。
  Heat 侧栏宽度为0仍可操作；长指标列表只挂载可见行，支持滚轮及方向键/Enter。
- Line 保留当前图表实例，单指标删除使用延迟清除 series 槽位再同步装回完整 option；
  整组删除复用已有坐标整理。启用曲线事件并按 seriesIndex 识别指标；删除前清除
  轴指针/tooltip，对已删除 series 的迟到 downplay 做有效性检查。
- Heat 更新组映射并复用原 sample 数组，释放被删除图的菜单与绘制资源，清理等待状态。
  两模式共用按面板/组/指标区分的删除版本，过滤请求之后的删除；真实延迟响应覆盖
  Line→Heat期间删除，不取消其他组查询、不复活已删除项，后续显式Plot仍可重加。
- README、spec与快捷键说明已同步；模板和README保留CRLF。子agent分别独占Heat
  与专项测试，主agent整合共用菜单/Line及文档，另做独立只读终审，未发现阻断问题。
- 实际验证为专用127.0.0.1:18174服务上的真实CSV/H5/API，Chrome146、Node22.22.1；
  PATH /usr/bin/python3 3.10.12、Django5.2.9、pandas2.0.3、tables3.8.0。
  专项20项、既有Line删除18项、Line复用16项、Heat复用18项、Heat生命周期6项、
  Metric vs. Trace嵌入菜单2项，共80项浏览器检查通过，pageerror为0；另7项Node测试通过。
  覆盖精确sample值/统计、样式/坐标/缩放/标记/快照保留、同名指标隔离、真实鼠标键盘、
  Reload/模式往返、待查询删除、DPR、Clear及资源释放。256×200夹具的尾项删除后，
  255行全部采样值及min/avg/max精确核对，菜单DOM最多16行。
- 真实失败已保留：browser-1为ECharts replaceMerge残留null series；browser-2前的
  编辑命令工作目录错误未写入源码，browser-2/3仍读到缓存旧模板，不能用作修复验收。
  browser-4及click-diagnostic确定原曲线不派发series事件；browser-5及诊断2点击在
  曲线绘制动画完成前，测试改为等待真实动画结束，不修改数据或命中坐标。
  browser-6/7全部20项行为断言通过但捕获旧tooltip索引异常，修复后browser-8无异常。
  最后将Heat菜单向下移20px，避开窄嵌入页已有折行工具栏；只改CSS位置后重新通过
  browser-final的20项及embedded-menu的2项，其余58项对应相同最终业务JS。
- JavaScript/模板语法、服务实际静态资源字节、CRLF与限定diff检查通过；已目视核对
  嵌入Line/Heat菜单截图。未进行完整框架、真实Nuitka打包、其他浏览器/平台或本轮
  SVG候选渲染验证，不复用旧框架豁免。用户原5486服务未重启、未加载测试数据。
- READY：实现及定向验证完成；未写index、未提交或push。子仓库精确范围7文件：
  README.md、dataviewer/templates/metricviewer.html、dataviewer/static/js/metric_heat.js、
  新增dataviewer/static/js/metric_group_actions.js与dataviewer/static/css/metric_group_actions.css、
  scripts/test_metric_group_actions.cjs和scripts/test_metric_line_delete.cjs；根仅本线spec/plan。
  version.txt、未知sp.json、依赖声明及其他开发线修改排除。提交候选为一笔完整子仓库
  功能与测试 `[archvisual] feat: support metric and group removal in both plot modes`，
  随后一笔父仓库gitlink与本线pair；提交仍需满足本轮门禁要求，不沿用已消费豁免。
- 自有输出：__output__/archvisual/metric_group_actions_20261111_VUe1Ul/；before.json、
  browser-final/result.json、各兼容回归result.json、embedded-menu.json、两张菜单截图、
  node-tests.log、syntax-and-resource-check.json、FINAL.json、RESULT.md。


## Line / Heat 指标与绘图组删除两笔本地提交（2026-11-11）

- 用户明确授权“豁免本轮门禁，按两笔清单提交”。本轮完整框架门禁豁免、未运行，
  不将80项浏览器检查、7项Node测试或只读前置检查记作框架PASS。
- 提交前9个候选文件SHA256与验收记录一致，JavaScript及模板语法、限定diff检查通过；
  两仓main、HEAD与审查时一致，进入共享提交窗口前index为空、无冲突。未重跑浏览器、
  原生构建、服务或发布；workspace Python只读准入与独立术语前置检查已通过。
- 子仓库提交：84a7f069737786b1c3a0ba6e42a87ea47112bf49，仅清单中的7个实现、测试和README文件；
  父仓库仅该gitlink及spec_archvisual.md / plan_archvisual.md，不纳入version.txt、
  未知sp.json、requirements声明或其他开发线修改。
- 使用两仓既有共享提交锁串行执行，明确路径暂存；核对实际提交文件、父提交、
  暂存/提交字节及根gitlink。未push。两个提交号、index和锁释放状态以
  __output__/archvisual/metric_group_actions_commit_review_20261111_WgdvGL/ 中的
  commit-1-receipt.json、commit-2-receipt.json、FINAL.json、RESULT.md为最终回执。


## Heat 8px 单元格、横向上限及源码服务部署（2026-11-11）

- 用户批准“按此方案实施，上限也改为8px”，随后要求“部署并提交修改”。
- 已将默认采样格、固定行高、min/avg/max 统计格统一为 8×8 CSS px，横向上限 8px、
  绝对下限 1px，保留视口适配缩小下限。统计总宽 24px；首轮实图发现原斜排标题重叠，
  改为 8px 字号竖排后，真实文字边界逐列居中且不重叠。未改采样值、统计、Canvas
  数值转换或后端；模板资源版本更新为 v21，README及spec当前合同同步，历史证据保留。
- 主agent独占实现、README和根pair；测试子agent独占三份既有Heat脚本并交回。
  测试按8px契约更新固定断言及格内鼠标位置；滚动夹具改48sample、160metric以保留
  真实横纵溢出，保留不足一个滚动条宽度的末端覆盖，未放宽原有像素相等或原值断言。
- 实际验证：专用127.0.0.1:18175服务、真实CSV/H5/API；缩放18项、末端滚动13项、
  Canvas 4项，共35项浏览器检查通过，页面异常0。DPR 1/1.25/1.5/2 的148组像素
  对照逐通道零差异；覆盖8px放大上限、1px及小数列宽、视口适配、分屏/侧栏/窗口、
  全部7种数据行悬停、末行p159命中、最后sample、标题边界及Reload/模式往返。
  7项Node测试、JavaScript/实际模板语法、当前HTTP静态资源逐字节核对及限定diff检查通过。
- 环境：PATH /usr/bin/python3 3.10.12、Django5.2.9、pandas2.0.3、tables3.8.0、
  Node22.22.1、Chrome146.0.7680.80；README与模板CRLF保持。测试服务已停止。
- 部署核对：用户现有5486源码服务已返回metric_heat.js?v=21，HTTP资源SHA256
  c6294c5555358f038c2a36fb453291f8f141c830b9953070b7d82580ab1f7c42与上述验收源码相同。
  仅GET页面/资源，无需重启，未对该服务加载夹具或替换当前数据。未做Nuitka发布构建。
- READY：实现、定向验证和现有源码服务生效；提交待本轮完整框架门禁或用户新豁免。
  官方workspace Python只读准入通过，不等同框架PASS；重型/提交锁探测时空闲，未占用
  或启动原生验收，未写index、commit或push。没有借用上一轮门禁豁免。
- 两笔候选：子仓库README.md、metricviewer.html、metric_heat.js及test_heat_zoom_fit.cjs、
  test_heat_scroll_end.cjs、test_heat_canvas_browser.cjs六文件；随后根gitlink及本线spec/plan。
  version.txt、未知sp.json/busy.json、requirements声明及其他线修改排除，保护文件SHA未变。
- 未验范围：完整框架、Nuitka包、其他浏览器/平台及SVG候选渲染；不将本次定向结果
  外推为全仓验收。自有证据：__output__/archvisual/heat_cells_8px_20261111_yPqqpz/，
  含before.json、zoom-fit/、scroll-end/、canvas-pixels/、node-tests.log、前后实图、
  syntax-resource-environment.json、deployment.json、lock-probe.json及FINAL.json/RESULT.md。


## Heat 8px 单元格两笔本地提交（2026-11-11）

- 用户明确授权“豁免本轮框架门禁，按两笔清单提交”。本轮完整框架门禁豁免、未运行，
  不将35项浏览器检查、148组像素比较或7项Node测试记作框架PASS。
- 提交前8个候选文件SHA256与实际验收/审查记录一致；两仓main、HEAD未变、index为空，
  无未合并项；本次不重复运行已验收浏览器、服务、原生构建或发布。
- 精确范围：子仓库六个实现、测试和README文件；父仓库仅其gitlink及本线spec/plan。
  version.txt、未知sp.json/busy.json、requirements声明及其他开发线修改排除。
- 提交窗口使用两仓既有共享提交锁串行执行，明确路径暂存并核对staged diff、实际
  提交文件、父提交与字节；不push。提交及锁释放的实际回执见
  __output__/archvisual/heat_cells_8px_commit_20261111_Tt6CP7/ 中的
  commit-1-receipt.json、commit-2-receipt.json、FINAL.json及RESULT.md。


## Heat 默认 16px 与同面板尺寸切换（2026-11-11）

- 用户批准“按此方案实施，同面板尺寸联动”。默认恢复16×16；每张图右侧新增
  Cell size，提供16×16与8×8。同面板所有图联动，新图继承；两个分屏独立。
  选择同步改变固定行高、统计格尺寸和采样列宽，横向缩放上限随选择变化，保留
  1px绝对下限与视口适配下限。16px显示全部可见行名，8px自动间隔显示标签，
  完整指标与sample保留。Clear/Reload/换文件/Line与Heat往返保留选择，刷新恢复16。
- 尺寸属于面板显示状态；切换不发起新查询、不复制原始sample数组、不重算统计。
  尽可能保持首个可见sample及各图首个可见metric；离屏图先更新布局及滚动位置，
  进入视口后按新尺寸绘制。独立复审发现尺寸切换后立即重建绘图组可能残留待应用
  的纵向位置，已在replaceGroups清空pendingScrollTop后再执行最终回归。
- 主agent独占实现、README与根pair；测试子agent独占四份Heat测试脚本后交回，
  另一子agent只读复核生产逻辑。模板资源更新v22，保留模板/README的CRLF格式。
  README记录使用方法及新增尺寸专项命令；spec更新当前合同并保留历史8px证据。
- 实际验证：独立127.0.0.1:18176服务，使用真实CSV/H5与生产API；最终尺寸专项8项、
  缩放18项、末端滚动13项、Canvas尺寸与DPR组合8项，共47项浏览器检查通过，
  页面异常0。16px/8px分别覆盖DPR 1/1.25/1.5/2，296组逐通道像素对照零差异。
  7项Node测试、生产JS/四份测试/实际模板内联脚本语法、HTTP资源与本地字节一致
  检查通过。默认diff空白检查将保留的CRLF报为行尾空白，已保存原结果；按
  core.whitespace=cr-at-eol限定检查通过，未修改Git配置或改变原文件换行格式。
- 环境：独立PATH /usr/bin/python3 3.10.12、Django5.2.9、pandas2.0.3、tables3.8.0、
  Node22.22.1、Chrome146.0.7680.80。测试服务已停止；未重启用户5486服务或向其
  加载测试数据。未安装依赖、运行Nuitka发布或完整框架；其他浏览器/平台及SVG未验。
- READY：实现与本轮定向验证完成；未写index、提交或push。子仓库精确范围7文件：
  README.md、dataviewer/static/js/metric_heat.js、dataviewer/templates/metricviewer.html、
  scripts/test_heat_cell_size.cjs、scripts/test_heat_zoom_fit.cjs、scripts/test_heat_scroll_end.cjs、
  scripts/test_heat_canvas_browser.cjs；根仅本线spec/plan，未来提交子仓库后再更新gitlink。
  version.txt、未知sp.json/busy.json、requirements声明及其他开发线修改排除。
  提交候选为`[archvisual] feat: add linked Heat cell size control per panel`，随后父仓库
  gitlink与pair；尚未满足本轮完整框架提交门禁，不复用上一轮已消费豁免。
- 证据：__output__/archvisual/heat_cell_size_20261111_05OoAV/；最终验收使用
  cell-size-final/、zoom-fit-final/、scroll-end/、canvas-pixels/及node-tests-final.log。
  preview.json与两张预览图记录较早阶段的首行/首列保持和快速切换；最终代码在
  pendingScrollTop修复后重新执行上述四套浏览器及Node测试。源字节、保护文件、
  HEAD/index与服务释放状态见FINAL.json、RESULT.md；未将局部结果外推为全仓PASS。


## Heat 同面板尺寸选择两笔本地提交（2026-11-11）

- 用户本轮明确授权“豁免本轮框架门禁，按两笔清单提交”。本轮完整框架门禁豁免、
  未运行；47项浏览器检查、296组像素对照及7项Node测试只代表已记录的定向验收。
- 提交前9个候选文件与验收SHA256一致；两仓main、HEAD未变、index为空、无未合并项。
  本轮语法及限定CRLF空白检查通过；不重复运行源码未变的浏览器测试或启动构建。
- 精确范围：子仓库七个实现、README及测试文件；父仓库仅其gitlink、本线spec/plan。
  version.txt、未知sp.json/busy.json、requirements声明与其他线修改保留。
- 使用两仓既有共享提交锁串行执行，明确路径暂存并核对staged diff、实际提交路径、
  父提交与字节；不push。实际提交号、暂存区及锁释放状态以
  __output__/archvisual/heat_cell_size_commit_20261111_0vl_9ovd/ 中的
  commit-1-receipt.json、commit-2-receipt.json、FINAL.json及RELEASE.json为准。


## Line SVG 当前源码兼容与性能验证完成（2026-11-11）

- 用户批准“先验证 line svg”。独立输出目录提供初始化renderer覆盖、测试副本和测量，
  生产源码未修改、默认Canvas未切换；根pair仅记录本次验证。主agent执行串行服务/
  浏览器和整合，line_svg_review子agent只读复审测试适配、对照公平性和计时/内存边界。
- 真实生产API及事件路径中Canvas/SVG各108项，共216项检查通过，页面异常0：Line14、
  组删除18、统一指标/组操作20、Reload14、Heat16/8尺寸8、Metric–Trace23、分窗11。
  分窗和同步含DPR1/2。旧测试两处Heat实例查找适配为.heat-axes，静止检查同时观察
  采样Canvas；只改输出目录副本，完整差异保留。准备脚本曾因路径变量覆盖失败，
  已修复并保存记录；失败发生在服务/浏览器执行前，不是产品回归。
- 两个冻结H5各3轮，Canvas/SVG、SVG/Canvas、Canvas/SVG顺序，12例72次动作全部通过。
  大集10,000×10,000；真实replay56,997×15。选绘8→32→64条、64条Reload及缩放/平移，
  64条分3组。逐例完整metric ID、每条sample数、当前/已有组全部值均精确匹配；
  所核对series样式与轴/grid/legend/dataZoom/timeline摘要跨renderer、三轮全部一致。
- 每条10,000sample、已加载数据后的动作至两次RAF中位数（Canvas→SVG）：首次8条
  2.940→0.767s，追加32条8.942→2.259s，追加64条18.218→4.987s，Reload64条
  29.914→8.485s，单次缩放8.583→3.342s，单次平移8.175→5.610s。计时含自动化
  调度，Reload含H5重读；RAF/动画完成检查不代表物理呈现，不声称持续交互帧率。
- 15sample数据没有同等级收益：首次8条0.094→0.097s，两者动画完成检查均约1.27s；
  原始数据另记action_to_settled_ms。SVG的内存观测更高：追加64条后JS heap中位数
  49.7→165.9MiB，Reload后51.4→304.8MiB；Node/Chrome树采样RSS峰值中位数
  1236.7→1491.0MiB。Heap含诊断与既往核验分配，不是峰值；RSS含共享页重复计数、
  核验和截图，不是独占物理内存。截图人工复核未见明显布局/曲线形态差异，未断言
  Canvas/SVG逐像素相同。
- 环境：独立PATH/usr/bin/python3 3.10.12、Django5.2.9、NumPy1.24.4、pandas2.0.3、
  tables3.8.0、Node22.22.1、Chrome146.0.7680.80。连接浏览器列表为空，本机实际GPU
  状态为SwiftShader、Canvas/合成/光栅化软件模式。独立18177服务逐例核对PID并停止；
  未重启或向用户5486服务加载数据，未安装依赖、发布/Nuitka或执行原生/完整框架。
- READY：当前源码的软件渲染兼容/性能候选证据。未验：真实桌面GPU、其他平台/
  浏览器、64独立图组、更多曲线、长时间泄漏与连续拖动帧率、打包和全框架。建议先
  在用户日常桌面环境复测再决定生产默认。旧框架豁免不复用，本轮结果记录尚未提交，
  未写两仓index或push；保护version.txt、requirements和未知sp.json/busy.json字节。
- 自有证据：__output__/archvisual/line_svg_validation_20261111_l0k56xp9/，含before.json、
  harness-adaptations.json、method-review.txt、14套功能用例、12套性能用例、summary.json、
  RESULT.md及FINAL.json。各用例保留真实命令、环境、painter、后端计时和退出回执；
  不以本轮局部结果替代桌面GPU或全工作区验收。


## Line SVG 桌面浏览器复测已批准，等待浏览器连接（2026-11-11）

- 用户选择“进行桌面浏览器复测（推荐）”；桌面验证执行已批准，生产默认选择仍未改变。
- 本轮浏览器连接返回`Browser is not available: extension`，可连接列表为空；当前服务器
  DISPLAY、WAYLAND_DISPLAY、XDG_SESSION_TYPE均为空。缺少实际桌面环境，未启动新
  服务或复跑软件渲染测试，未将上一轮结果当作桌面GPU验收。
- 生产源码与两份H5夹具SHA均与上一轮冻结记录一致。等待用户连接桌面浏览器并提供
  OS/浏览器；也可由用户选择手动桌面测试入口。没有安装/修改浏览器环境、生产代码、
  两仓index或提交；本轮连接证据：__output__/archvisual/line_svg_desktop_20261111_iikhzmyz/PREFLIGHT.json及RESULT.md。

- 用户随后提出使用`gene@192.168.31.239`。已只读核实SSH严格主机校验通过，远端为
  macOS26.6.2/arm64，gene桌面会话、Apple M4 GPU与在线显示器，已装Chrome157.0.8103.50。
  Chrome实际GPU加速尚未测。远端Node因缺libsimdjson.33.dylib启动失败，未修复/安装；
  候选方案让现有Linux运行后端和测试控制，Mac仅运行可见Chrome，经SSH隧道连接，
  使用独立临时测试配置。尚未启动窗口/隧道/性能测试，等待远端执行方案确认。
  具体证据见同目录REMOTE_MAC_PREFLIGHT.json；该可用性核查不代表桌面性能PASS。


## Line SVG Mac 桌面复测完成，保留分窗尺寸缺陷（2026-11-11）

- 用户批准“按此方案在 Mac 上开始复测”。gene@192.168.31.239的macOS26.6.2/arm64、
  Apple M4、可见Chrome157.0.8103.50已逐例确认Metal GPU加速；原生DPR2，性能页面
  1500×850 CSS px、DPR1/2。Linux独立PATH Python3.10.12后端与Node22.22.1/
  Playwright1.65.0控制，经18178/19227 SSH隧道执行。未修远端Homebrew Node、安装依赖。
- 大数据10,000×10,000、真实replay56,997×15；大数据DPR1/2、短序列DPR1，各3轮，
  Canvas/SVG、SVG/Canvas、Canvas/SVG顺序，共18例108动作通过。逐例全部绘制metric
  ID、sample数、完整原值及系列样式、坐标/布局/时间轴摘要一致；性能动作均保持可见/
  focused，无期间失焦。计时在页面内部，排除后续SSH轮询，仍包含后端/网络/JSON。
- 大数据DPR1动作至两RAF中位数Canvas→SVG：首次8条210→197ms，追加32条529→520ms，
  追加64条796→807ms，Reload2623→2814ms，缩放379→445ms，平移310→360ms。
  Retina DPR2依次194→258、515→598、756→842、2717→2922、381→432、312→357ms。
  动画完成差距更小：DPR2追加64条1820→1880ms、缩放826→828ms；不是物理呈现或FPS。
  初次H5加载在计时之前，Reload包含重读；缩放/平移为生产dispatchAction单次范围更新。
- 短序列首次8条约51/50ms，SVG无稳定综合收益。短序列Reload473/260ms混入明显
  后端/传输波动（Canvas请求185/635/420ms，SVG194/183/401ms），不能归为renderer收益。
  大数据DPR2追加64条JS heap中位数67.5/108.8MiB、Reload109.7/312.0MiB；整例Mac
  Chrome树RSS采样峰值中位数2059.7/2248.6MiB。Heap含诊断及既往核验分配，RSS含
  共享页重复计数、核验与截图，排除Linux Node/后端；不是独占物理内存或泄漏证明。
- 最终14份功能/交互子集结果合计202项通过：每renderer组删除18、组操作20、Reload14、
  Heat尺寸8、Metric–Trace23、分窗11、Line独立鼠标交互7。未把原完整Line测试算PASS。
  原组操作Home+Tab与ArrowUp+Tab在Mac未产生Line change；事件诊断确认原生字母l
  选项搜索有效，输出副本改为l+Enter+Tab且保留行为断言，两renderer各20项通过。
- 已确认生产问题：两份原完整Line测试均在副面板“Plot无需resize”失败；副面板实际
  宽724.5px、clientWidth/root宽725px，0.5px横溢出触发15px水平滚动条；隐藏root后
  clientHeight786→801，恢复786，但resize前后chart.height仍801。Canvas/SVG相同，
  主面板也有722.5→723px问题。修复未批准/实施，候选需统一初始化、Plot高度更新、
  Line/Heat切回及SplitView observer的测量、比较与resize口径，不能只改一次resize参数。
- 偶发未定位：Canvas分窗Heat最小边界曾测得422.125px而非120px；原脚本未改复跑11项
  通过，SVG首轮11项通过。保留失败，不宣称已修复。独立Line交互专项明确排除失败的
  尺寸断言，不以子集PASS覆盖原失败。DPR1/2截图人工复核未见renderer明显布局差异，
  不断言逐像素一致，既有密集统计标签重叠仍在。
- 初轮另13例因输出目录监督器bind误判TIME_WAIT未启动浏览器；SO_REUSEADDR及异常
  清理仅修测试工具，失败记录保留，不算产品失败。主agent唯一执行服务/浏览器并维护
  pair；line_svg_review并行只读复审、独占新增两个输出诊断/交互脚本，未改生产源码。
- READY：本Mac的比较证据、通过子集及缺陷定位；完整功能PASS仍被尺寸问题阻断。
  建议保留Canvas默认，下一步先审查分窗尺寸修复。其他平台、更多曲线/64独立组、
  持续拖动FPS、长时泄漏、项目完整Mac后端、打包/全框架均未验，旧豁免不复用。
- 专用Chrome/caffeinate/SSH/后端已退出；远端profile清空、两端测试端口无监听。
  生产/受保护文件和两份H5 SHA未变，补充53项源码/测试SHA匹配；两仓HEAD未变、index空。
  未动用户5486服务、生产默认、version.txt/requirements/未知sp.json与busy.json，未提交/push。
- 自有证据：__output__/archvisual/line_svg_mac_20261111_9h3ihmql/，含RESULT.md、summary.json、
  before.json、FINAL.json、harness-review.txt、18套性能结果、原失败、分窗诊断、键盘事件
  诊断及最终功能子集。每例包含真实命令、脚本副本、GPU/焦点/DPR、内存与退出回执。


## Heat 平移位图复用原型验证完成，生产集成条件未满足（2026-11-11）

- 用户选择“Heat：设计并验证位图复用原型”。仅输出候选及测试，生产代码未修改。
  主agent执行Mac串行浏览器/服务、维护pair；line_svg_review独占实现候选并只读复核
  正式测量；metric_delete_tests独占新增失效测试，交接后主agent修正测试工具问题。
- 原型缓存干净采样视口，严格数据/几何/DPR/整数设备像素位移检查，复制共同内部并
  原双pass补画边缘；hover/legend独立，空帧/suspend/dispose释放。像素标准未放宽。
- DPR1/1.25/1.5/2×16/8px，168次整幅采样像素比较中27帧不同，最大通道差2，FAIL。
  DPR1/8px末端诊断确认旧完整绘制与缓存复制为蓝通道228、新完整绘制为227，强制完整
  绘制相等；差异在复制内部。当前绘制结果不严格平移不变，具体GPU/舍入机制未定位。
- 补测21帧，真实同path H5内部值改变而shape/min/max不变、只改sample标签+50、
  多组/双面板缓存隔离、pending hover生命周期、删除整组/重新Plot及实例释放完成。
  1px列宽/8px行高实际横/纵/斜/反向复用4帧有差异，最大2，两种hoverLayer均覆盖。
- 自动DPR2→1.25副面板未自动刷新，原版/候选同现；显式保持DPR的resize后可刷新并
  继续生命周期检查，原自动失败保留，两整例FAIL。原版补测21帧像素全相等。早期
  字符串时间标签断言、Playwright resize恢复原DPR两项工具失败留档，后续已纠正；
  未将这些工具失败误称产品回归，未用恢复后的子项覆盖原失败。
- Mac M4/Metal、可见Chrome157.0.8103.50/macOS26.6.2，1500×850 CSS px，DPR1/2。
  独立PATH Linux Python3.10.12后端、Node22.22.1/Playwright1.65.0；未安装依赖或构建。
  冻结10,000×10,000 H5选128条，每条完整10,000sample；3轮原版/候选交替，6例36配置
  1296离散动作全部实际范围/方向一致，每次1render；完整名称/数值/统计/时间轴SHA相同。
- DPR2横向三轮中位采样调用原版→候选：16px 1.30→0.60ms，8px 4.10→0.65ms，
  1px列宽/8px行高27.90→0.80ms；整页RAF动作观测分别50.00→49.90、50.00→50.00、
  66.10→50.00ms。它们是同步调用/RAF观测，不是GPU完成或实际FPS。性能各例最终
  帧通过，不能覆盖其他实际复用帧严格FAIL；早期探索轮不纳入正式结果。
- 候选216次横向全部复用，216纵向+216斜向全部y-nonuniform-device-shift回退；DPR2
  纵向采样分别1.30→1.50、4.40→5.40、27.50→28.30ms。额外每图位图约9.00/9.25/
  9.32MiB（DPR2名义容量）。整例Chrome树RSS中位1729.98→1791.02MiB，区间重叠，
  含共享页重复计数及计时外核验，不能把差额当缓存显存或泄漏。
- 连续逐RAF写scroll的36配置均未到达最后横向请求，不计算等工作量加速/FPS。
  原版/候选各独立诊断等待60RAF仍稳定在(1648,480)，最后请求(2128,480)；未纠正
  输入掩盖现象。可能为render写回与输入时序，原因尚未定位，不扩大范围修复。
- READY：设计、输出原型和限定Mac证据已完成；未满足：生产集成的严格像素条件。
  建议暂缓接入，后续先审查稳定设备像素坐标/抗锯齿相位与复用准入；当前原型不能
  作为通用提速提交。其他平台/GPU、长时泄漏、完整Mac后端、发布/Nuitka/全框架未验。
  两仓index未写、未提交/push、旧豁免不复用；保护已有未知dirty及参考requirements。
- 自有输出：__output__/archvisual/heat_bitmap_prototype_20261111_4b6s4ht8/，含DESIGN.md、
  RESULT.md、before/FINAL.json、summary.json、像素失败、失效原版对照、6例正式性能、
  连续输入诊断及逐例冻结harness/GPU/命令/清理回执。生产/夹具最终SHA与端口核对见FINAL。


## Heat 设备像素几何原型修复及 Mac 验证完成（2026-11-11）

- 用户批准“按此方案修复并验证原型（推荐）”，允许最近设备像素对齐/边线锐化，
  最大边移动0.5device px；仍只输出原型，不批准生产接入。主agent独占浏览器/服务/
  harness整合及根pair；line_svg_review独占候选并复审，metric_delete_tests独占独立
  几何测试并复审。两者已交接，生产源码未改。
- 原型共享nominal/fill/stroke整数设备边，整数矩形填充/描边、clip/copy/hover修补；
  hit按snapped边/DPR半开命中。严格比较共同格所有边的平移，phase不一致full回退。
  bitmapReuse:false无额外干净缓存，cache构建/维护计入render；空帧/suspend/dispose释放。
- 旧原型诊断再次复现蓝通道228/227：实际颜色和四分之一像素矩形边完全整数平移，
  输出仍不同；具体GPU舍入机制未定位。旧candidate/证据保留，未以epsilon放宽标准。
- 独立Node600配置、60,600边、93,990命中通过，最大边移0.5device px，冻结输入无变化。
  Mac真实页面DPR1/1.25/1.5/2×16/8px，168次整幅采样比较+16次hover/legend严格RGBA
  一致；末端、反向、zoom/颜色/范围、删除、Reload/resize、mode/Clear均覆盖。
- 直接frame补测140配置、2,100次严格像素一致，覆盖1/1.2/3.99/4/4.01/8/16px列、
  8/16px行、两种hoverLayer及DPR约1.3；一格不兼容phase回退/两格复用，以及一行
  回退/五行复用成立。Chrome将1.3返回为binary32 1.2999999523162842，原脚本精确1.3
  条件未进入的准入断言由phase-dpr-audit.json对既有实际结果严格补验；无像素容差。
- 生命周期21帧像素全等：同path H5内部值改动且shape/min/max不变、标签+50、组/
  面板独立、pending hover、删除/新Plot/释放；dense横/纵/斜/反向确实reuse。整例
  仍FAIL：自动DPR2→1.25副面板仍为2（此前原版/候选共同问题）；显式resize后可继续
  不覆盖原失败，本轮未修应用DPR失效逻辑。
- 真实15sample replay补测初次FAIL：缩小已达下限，hover未被render清掉，而参照刚
  完整重绘。原版同一步也FAIL；工具改为离开鼠标后比较clean状态，render/full/reuse
  次数均不增加，后续21base+2hover/legend通过。保留两份原失败，不误称产品回归。
- 旧版视觉另测10组8/16px普通态：所有格心颜色相等，边界相对旧几何移动≤0.5device
  px（另有约1e-13表达残差）；边线锐化导致11.91%～43.69%画布像素改变、最大通道差
  242，不声称旧版逐像素不变。左右对比图及DPR2带统计列整页人工核对未见明显行错位；
  legacy密集/强调态、host亚像素CSS最终合成不扩大为同等视觉验收。
- Mac M4/Metal、可见Chrome157.0.8103.50/macOS26.6.2，1500×850 CSS px、DPR1/2；
  Linux PATH Python3.10.12、Django5.2.9、NumPy1.24.4、pandas2.0.3、tables3.8.0，
  Node22.22.1/Playwright1.65.0。9例按三模式轮换，54配置、1,944离散动作全部通过。
  每动作1render/1sample，完整old/current范围及格数一致；128×10000全部名称/原值/
  统计/时间/normal/scale SHA一致。前两轮另由agent独立核验，主agent汇总全部三轮。
- DPR2横向三轮中位sample调用“原版/新full/新reuse”：16px 1.70/1.45/0.60ms，
  8px 4.30/4.65/0.90ms，1px列×8px行28.15/19.45/0.50ms。dense纵向28.10/18.60/
  2.70ms、斜向28.25/18.75/2.45ms。横/纵/斜各216次candidate全reuse，full全重绘且
  cacheBytes=0。新full的8px无稳定收益，主要收益来自复用。
- 整页RAF动作观测：普通格仍约50ms；DPR2 dense横66.65→50.00ms、纵66.35→49.90ms、
  斜66.60→49.95ms。sample是同步调用而非GPU完成，RAF不等于物理呈现。54配置连续
  输入都未到最后请求，保留既有时序问题，不报告吞吐/FPS；首次Plot均为默认16px且
  无后续焦点监听，未作为各尺寸初始化收益。每轮原数/区间保留于summary.json。
- 本视口每图额外RGBA缓存DPR1约2.25/2.31/2.33MiB，DPR2约9.00/9.25/9.32MiB；
  不含JS几何、hover/GPU副本。Chrome进程树RSS峰值中位原版/full/reuse为1734.08/
  1624.44/1622.56MiB，含共享页重复计数与计时外核验，不是缓存显存或泄漏证据。
- READY：本次输出原型修复、限定正确性/视觉/性能证据；生产接入仍待审查。未验其他
  平台/GPU、DPR<1、全部布局、长时泄漏、完整Mac后端、发布/Nuitka/原生/全框架；
  自动DPR和连续输入旧问题单列保留，不宣称整体应用PASS，旧门禁豁免不复用。
- 自有输出：__output__/archvisual/heat_pixel_alignment_20261111_ujowlw9l/，含候选、
  DESIGN.md、REVIEW.md、RESULT.md、geometry-contract-result、correctness-summary、
  phase-dpr-audit、summary和FINAL.json，各例真实命令/冻结脚本/GPU/清理回执。专用
  18180/19229服务与Mac Chrome/caffeinate/profile/SSH已清理；两仓index未写、未提交/
  push，保护version/requirements/未知sp.json/busy.json，源码/夹具SHA最终核对见FINAL。


## Heat 位图复用生产接入与 DPR 修复：主体完成，低 DPR 待裁决（2026-11-11～12）

- 用户批准“按完整方案实施，包含 DPR 修复（推荐）”。主agent负责应用JS、模板、
  生命周期/最终整合、串行Mac服务浏览器和pair；line_svg_review独占采样renderer并
  复审精确点击，metric_delete_tests独占三测试文件阶段交接后由主agent整合，
  metric_search_keyboard_review独立只读复审DPR与资源生命周期。子任务均已交接。
- 默认接入严格设备像素位图复用、同几何full对照、可恢复缓存错误回退；新增
  releaseCache保留显示/数据，离屏与隐藏面板释放附加缓存，重入完整绘制。
  README、两资源版本、9个子仓库文件与本线pair为本轮scope，精确SHA见scope.json。
- Mac事件诊断确认DPR2→1.25期间MQL没有及时派发，显式resize才送达；应用与独立
  listener一致，不称监听被提前移除。另静态确认唯一组替换误停watcher。新事件+
  250ms只读DPR兜底通知双面板，最终集合统一维护watcher；独立复审未见阻断。
- 生产新增DPR约1.3测试发现mousemove/click截断342.5为342，导致device对齐首列
  无法命中；pointermove/up仍精确。已改为指针悬停、匹配trusted pointerup补充
  click坐标，保留click时机，清理新/取消手势、leave、render/hide/suspend/dispose。
  原失败、实际事件及修复后native hover/click证据保留；触摸/笔未验。
- Node600组几何/命中与真实ECharts颜色通过，数据/统计12项通过，缓存故障/精确
  点击控制流10项通过。Mac DPR1/1.25/约1.3/1.5/2×16/8，共10配置360次采样完整
  RGBA零差异，dense实际复用、hover/legend/颜色/范围/末端/native点击覆盖。
  随后仅补trusted与手势清理守卫，最终源码补验DPR约1.3全采样/交互及Node10项。
- 最终源码真实H5内部值/标签更新、多组/面板、queued hover、删除、新Plot、dense
  各向/末端8组检查PASS；双面板空闲自动DPR、隐藏cache释放且数据/帧保留、恢复
  当前DPR、唯一组替换、Line/Heat、10次Plot/Clear、最后行删除9组PASS。
- **完整像素套件FAIL保留**：独立ECharts统计列50次严格比较非零；首个DPR1/16px
  在冻结旧应用/renderer中同现1760通道/max36，形状/样式/强调状态相同，具体raster
  原因未定位。其余统计配置未逐项旧版对照，不称全部是旧问题；未放宽原断言。
  首轮离屏旧测试要求stats不变与新释放合同冲突，保留失败后改为精确检查cache=0，
  renderer/frame/pixels不变。SSH断连失败已按唯一profile恢复停止并取得清理回执。
- Mac可见Chrome157.0.8103.50、M4/Metal；Linux独立PATH Python3.10.12、Django5.2.9、
  NumPy1.24.4、pandas2.0.3、tables3.8.0，未装依赖。性能9例三模式轮换54配置、
  1944离散动作PASS，每动作1render/采样，完整范围/格数/128×10000原值与时间SHA
  相同，HTTP renderer与冻结生产源一致。default横/纵/斜各216次实际reuse，full
  cacheBytes=0。DPR2横向旧/full/default同步调用中位：16px 4.95/5.90/1.75ms，
  8px 19.05/23.95/2.85ms，dense1px×8px 154.60/95.60/2.60ms；dense纵向
  153.45/101.15/9.95ms、斜向152.25/96.15/10.60ms。不直接比较旧原型轮次绝对耗时。
- DPR2 dense横向RAF动作215.80/149.05/56.60ms，不是GPU完成或FPS。54配置持续
  输入都未到最后请求，保留独立旧问题。本视口每图额外干净缓存DPR1约2.25–2.33MiB，
  DPR2约9.00–9.32MiB，不含JS/hover/GPU副本；RSS只作整进程树观测，不当泄漏结论。
- 待用户裁决：DPR<1且列宽×DPR<1时，保留旧浮点绘制/命中并关闭该条件复用（建议），
  或提高最小列宽；原批准没有选择这种显示语义，已async询问，未自行采用。当前该
  分支不能作为接入完成。源码整体未提交/部署，不用旧豁免；框架/原生/Nuitka/发布、
  其他GPU浏览器、DPR<1及长时泄漏未验，严格统计像素门禁仍失败。
- 输出：__output__/archvisual/heat_bitmap_production_20261111_7qf4yxkb/，RESULT/REVIEW、
  before/FINAL、correctness-summary、summary、scope、cache-unit-final、每例冻结源/
  实际命令/GPU/内存/退出回执、原失败与恢复。未知version/sp.json/busy.json及参考
  requirements字节保留，未写两仓index、未commit/push；最终资源与HEAD核对见FINAL。

## Heat 每列至少一个设备像素：已实现并完成定向验证（2026-11-12）

- 用户先选择保留旧浮点绘制/命中、关闭条件复用，随后明确改选“提高最小列宽，确保
  每列至少一个物理像素”。前一个分支尚未实施，本次以最新选择为准。
- 主agent独占应用JS、模板、README与本线pair，负责串行Mac浏览器执行；
  metric_delete_tests独占几何测试与新增device-floor浏览器测试，line_svg_review只读
  复审所有缩放入口与DPR变化，未授权他人启动服务、SSH、原生或写index。
- 当前实现DPR≥1时最小CSS列宽1，DPR<1时(ceil(100/DPR)+1)/100，
  与既有窗口适配下限取大值；同面板Cell size
  切换使用实际列宽换算pending滚动。极低DPR物理下限优先于8/16px横向上限，行高
  保持不变。DPR回升保留当前列宽直至用户缩小。DPR下降抬高列宽仍沿用既有fit路径
  的CSS scrollLeft处理，首个可见sample可能前移；不在本次扩大为指针锚点改造。
- 修改前11个既有本线文件与上轮FINAL字节完全相同，两仓HEAD/index未变；新增独立
  输出__output__/archvisual/heat_device_floor_20261112_2ibtyemk/，此前生产证据保持冻结。
- 独立审阅发现直接1/DPR及仅向上百分位仍可能合并设备边：例如DPR0.7/left145/1列，
  DPR0.75/left142/100列，DPR0.625/left140/43列。未放宽像素/hit断言，最终增加一个
  百分位余量。数值审阅167种DPR、772041帧、253464417对边通过；9个旧策略反例
  保留且已验证修复。有限数值矩阵不等于所有可能DPR的证明；证据precision-review/。
- 最终Node几何/命中972组及真实ECharts颜色、数据/统计共14项PASS；未改采样renderer，
  缓存控制10项PASS。Mac现为Chrome157.0.8103.52（前轮.50），M4/Metal可见GPU逐例
  核验；device-floor 12项PASS，DPR0.5/0.75/约0.8/1/2×16/8px共10配置均触发真实
  reuse，321次完整采样画面、36969568通道严格零差异，每对nominal边严格≥1。
- 双面板空闲DPR2→0.5→2自动重建/释放旧cache、回升后保持宽度直到显式缩小通过；
  极低DPR约0.1时横向10.01px优先于8px名义上限、行高8px/统计宽24px保持；首末
  native hover/click、值/数组身份、无需重查询、末端可达与尺寸联动均验证。
- 最终源码再跑窗口fit/分窗/尺寸/普通滚动/末端/Reload 18项PASS，原中间版本回执
  normal-zoom-fit保留，最终为normal-zoom-fit-final。三例均source未漂移、清理回执
  无错误；实际命令/生产源/HTTP renderer/GPU/退出回执在各例目录。没有复测上轮
  3模式性能；其数字仅归属此前冻结来源，不能改称本次测量。
- 既有独立统计像素失败、连续scroll末请求问题继续保留。未运行全框架/原生/Nuitka/
  发布，无门禁豁免；未写index、未commit/push，未部署常驻服务。

## Heat 统计像素独立 Mac 专项：部分闭环，hover 仍阻塞（2026-11-12）

- 中央授权先只读核资源，无冲突后单次最多15分钟（含准备/清退）。主agent唯一执行，
  line_svg_review只读独立审阅最小测试修正；未安装、未运行Ubuntu原生/框架、未写index。
- Mac键鼠空闲约10小时，用户Chrome PID63598保留；测试端口18180/19229空闲，使用
  独立临时profile。后台Codex/Node进程保留，不接管用户浏览器。共享盘初始6.2GiB，
  新输出预算100MiB，实际约27.3MiB。监督器监测用户输入及窗口期限，并保留清退余量。
- 输出 `__output__/archvisual/heat_statistics_mac_20261112_4ULSgw/`。保守从首次资源
  检查计时745.34秒（12分25秒），8次调用清退无错误；WINDOW_END.json确认本线
  Chrome/SSH/caffeinate/后代/profile无残留、端口释放、用户Chrome PID未变。
- DPR1/16px初始normal，旧参考场景2305通道/max36；实际与参考均一个Canvas，排除
  仅以图层数量解释。统计参考保留完整场景后同例0差异，独立审阅确认只修测试oracle。
  canonical `scripts/test_heat_canvas_browser.cjs` 将采样重建/隐藏组件/覆盖hover阈值
  限于采样参考分支；原样保留独立原始统计计算和RGBA零容差断言。
- 完整套件首配置normal通过，但hover113/max26；图层诊断为9/max1，确认实际元素
  在hover层、参考在base层。独立审阅发现getOption不包含生产运行时emphasis.hoverLayer，
  测试补独立元素计数/阈值断言及参考状态后仍hover82/max12。最后动画诊断双方均
  finished且统计animator为空，仍82/max12，排除此例动画解释；未加入等待或容差放宽。
- 两次完整像素套件尝试均在首配置hover断言终止，未完成10配置，不称完整专项PASS。
  每次失败、原始RGBA/图层/元素/裁剪及实际源快照保留。当前源码失效8项、生命周期
  9项分别PASS；seams三输入及examples/metricview.h5本轮前后SHA一致，新增colors
  CSV/H5各例身份在WINDOW_END.json，不能追认旧回执缺失的历史整文件身份。
- 生产app/renderer/template未变；本轮只改上述测试及本线pair。统计hover原因仍待
  定位，完整框架仍缺，未取得新豁免或提交时隙；不提交/push。下一次诊断应比对补全
  后双方hover层自身RGBA及合成顺序，不重跑normal或用动画等待掩盖已排除的原因。

## Heat avg 悬停剩余差异：离线定位准备与独立审阅（2026-11-12）

- 按中央“先静态及已有截图/trace、不重跑已过项”要求，只读源码及旧数组；未连接Mac、
  启动服务/浏览器、访问私有失败profile、运行normal/性能9例/已过17项或操作index。
- **纠正上节证据概括**：最终82/max12仅有汇总，无该次逐层/合成原始RGBA。已有逐层
  数据属于中间参考版本的9/max1，不能替代当前82。现有截图属于normal，也不补足
  当前hover。原记录、所有失败保留，不把缺证写成已定位。
- 两路独立只读复审完成：既有旧normal-first2305/max36、中间normal0、hover9/max1
  数组重算与原件一致；旧avg差异8像素9通道精确表、main/hover对应RGBA、裁剪/层顺序
  及来源SHA已保存。同Canvas两次已有读取出现R213/212的反例单列，原因未定，不能
  外推为当前82原因；最初重复读取相同的错误假设及失败回执保留。
- 静态确认实际统计mouseover更新visualMap指示器，参考highlight未走等价事件链。
  这是候选原因，尚未证实。最小候选仅参考事件路径，需新层证据支持、输出副本试验及
  独立复审，不改生产统计/颜色/描边/零容差；本轮没有修改生产源码或canonical测试。
- 准备输出专用collector：原合成及严格差异先保存，再采源层、有效hover样式/path/clip、
  指示器、动画及重复readback；私有字段错误保留原件并独立报错。仅Node语法检查，
  浏览器执行兼容性未验。READY仅指离线准备；hover及完整framework仍阻塞提交。
- 新单例请求：首配置DPR1/16px、1px采样宽、row归一化、ramp avg49.995，只采首次
  hover。建议新独立5分钟窗口含清退、结构化输出≤10MiB；必要原前序含normal读回，
  不能删除后冒称同场景，不另跑normal专项。待中央安排，未自动续期或争用备份资源。
- 输出 `__output__/archvisual/heat_hover_static_20261112_XtW4JC/`，RESULT、DIAGNOSTIC_PLAN、
  before/FINAL、rgba-review与source-review包含来源、严格反例、独立复审和未验边界。
  本轮仅新增输出材料及本段进度；spec合同不变，不提交/push，不借旧豁免。

## Heat avg 五分钟单例窗口：资源检查后未启动（2026-11-12）

- 中央确认Heat私有失败现场备份已清退，授权300秒含准备/清退的唯一首avg采集。
  按要求先两次只读刷新Mac活动/会话/端口/内存，无浏览器或服务试启动。
- 用户键鼠空闲约11.47小时，用户Chrome PID63598保留，18180/19229初检空闲；
  memory_pressure报告46%，不将内存列作阻塞。另发现不同任务computarchlib备份
  parent PID79172、rsync79175/79186运行，接收进程状态U，目标/Volumes/Micro/computarchlib/。
  该活跃I/O共用条件未协调，按不干扰约束停报；不据此声称GPU/测试profile被占用。
- 状态NOT_STARTED_RESOURCE_OCCUPANCY：本例运行0次、无新RGBA；没有自动重试。
  无测试profile、Chrome、常驻监督器、Node控制器、服务或转发需要清退；两次只读SSH
  已返回，未触碰中央备份或停止他人进程。旧82/max12 FAIL及全部旧证据保持。
- 输出 `__output__/archvisual/heat_avg_capture_20261112_sTU5yS/` 的RESULT、WINDOW_START/
  WINDOW_END与资源原件记录实际时间、来源SHA、占用、HEAD/index及未执行边界。
  生产与canonical测试字节未变，无暂存/commit/push。待中央协调该备份资源后重新
  安排同一最小单例窗口，不自动启动normal/17项/性能9例/完整10配置。

## Heat hover：输出清理后收口与最小测试源码准备（2026-11-12）

- 用户确认其他输出本人删除，归因调查结束。本轮未重建四个缺失输出目录，也未连接
  Mac、启动服务/浏览器、安装依赖、运行已过17项/性能9例或写Git index。
- 原300秒窗口实际只做资源检查，历史回复记录80.63秒、单例0次，未启动Chrome/
  profile/服务，无新RGBA。停止原因是当时另一个computarchlib备份I/O共用条件未核实；
  不外推为现在仍占用。WINDOW_START/END和资源原件已经删除，80.63秒现在只能引用
  会话记录，不能宣称重新核验原回执。旧82/max12也仅保留历史FAIL陈述。
- 已删除的normal/hover截图、旧9通道逐层数组、原始H5及各轮Mac证据、诊断collector/
  独立审阅报告、提交候选清单不再是当前可复核副本。旧段落中“证据保留/见输出”的
  描述仅属当时时点；本节为最新可用性说明，不据历史PASS放行当前提交。
- 当前生产app、renderer、模板、ECharts和观察helper仍在；实际SHA分别为
  `14246c99b0278108abe739e643bd5a855d15e02c0cdf76724dab627b7f539a84`、
  `6b953e34eaaec1e1e5c55083072ff7c61855b399b34ad7c5b9f0286125af7261`、
  `b08b6b9960284b118ec6d2564ea943378157e3f4c52cd5880c4f5e288a205775`、
  `42f8329d989b6f6539dd2b15bbdf0d82025762ac112fbb60dc57b27d7bcf3946`、
  `9cccdcb9ac2d451673f5da0d4d751436c9c0477d7996b0ba1d58fba2689f1d1e`，
  与删除前会话中记录相同。
  Git HEAD `764379987ede5f3a26a9fdd22d9e667df96d8d7e` 中受跟踪文件的旧版本可读取，
  但不等于当前未提交候选快照。bitmap_cache/device_floor两测试仍为工作树未跟踪文件，
  HEAD没有其副本。根spec/plan仍在；Mac备份具体位置及内容本轮未核实。
- 两名独立agent只读复审当前源码：真实统计mouseover还会更新visualMap指示器，
  参考highlight不走同一路径。主层读取style、hover层读取__hoverStyle；这证明输入
  路径不同，尚不证明历史82的因果，也不证明有效style一定不同。无需提出生产hover
  语义变更；最小候选仅是测试参考事件路径。
- 主agent只修改 `archvisual/scripts/test_heat_canvas_browser.cjs` 及本线pair；默认
  highlight不变。显式第三参数 `statistic-hover-baseline` 或
  `statistic-hover-pointer` 限定DPR1/16px首avg，保留到原失败点的操作/读回前序；
  pointer从参考自身CSS坐标和findHover命中开始，保留两次RAF，不混用highlight。
- 诊断固定原合成RGBA/逐通道坐标后再读main/hover层、path/clip/有效style、指示器、
  图层顺序、重复读回及观察后变化；原件不被后续结果替换，私有字段错误单列。
  原始文件与层文件在严格像素断言前写出，任何非零仍FAIL。目标唯一性/三统计格/
  原值/归一化值/强调/指示器和坐标时间均检查或随失败记录；候选0差异只叫
  CANDIDATE_ZERO_DIFFERENCE，不写完整PASS。退出、缺值格和其他DPR仍未验。
- 新测试源码修改前SHA为 `f8330f562924b9922e5c9c6e7cd06df4f1f1412c9352e68aa14dcde151752b21`，
  当前SHA为 `717997f5d62ffd25d6d9c483c98c7f3123b62c4d556a49c2be0fd7cc54157415`。
  `node --check archvisual/scripts/test_heat_canvas_browser.cjs` 与该文件
  `git diff --check` 通过；两名独立agent最终静审无新增阻断。没有执行浏览器/API兼容性
  或像素验证，不用语法/静审结果替代专项。
- 最小新窗口先只运行 `statistic-hover-baseline`：仍为最多300秒含资源核查/清退、正文
  ≤90秒、预留≥60秒清退，仅首ramp/avg原事件基线与逐层RGBA，失败不自动重跑。
  输入CSV/H5需由现有生成代码重新生成并记录新身份，不称恢复旧H5；新输出位置须
  单独指定，不自动重建旧目录。新JSON证据预算≤10MiB、临时profile≤100MiB。
- 执行前尚缺环境前置：旧Playwright node_modules和Mac监督器/转发适配输出已删除，
  当前Node require.resolve('playwright')失败。需先提供已有可用运行入口和可审阅的
  独立profile监督器；不得在5分钟内临时安装或无监督接管用户Chrome。当前仅报告
  所需窗口，未启动。基线取证后再决定是否安排pointer候选，完整framework仍另有门禁。

## Heat 原始 avg hover：现有 Mac 入口核查及新基线封装（2026-11-12）

- 按中央最新授权只读核环境/占用并准备新封装。找到本机已有Node v22.22.1及
  `/home/liyijun04/computgeneral.com/cgi.computgeneral.com/node_modules` 中Playwright/
  playwright-core 1.61.1，实际import及connectOverCDP接口检查通过，未launch/connect。
  Mac原监督器仍在临时目录并已读取精确副本；此前“入口缺失”阻塞已由新核查解除。
- Mac Homebrew Node 26.8.2缺少`libsimdjson.33.dylib`，原只读探测报dyld失败；不修环境。
  新封装沿用本机Node/Playwright控制Mac现有Chrome，Mac仅用现有Python标准库；无需
  安装或复制依赖。ArchVisual继续使用PATH Python3.10.12和实际已装包，不接父环境脚本。
- 12:25:09北京时间最终只读探测：HID空闲46765.65秒，用户Chrome PID63598原状，
  18180/19229无监听，无已识别独立测试profile/debug进程或监督器。新监督器首次probe
  误把30个普通Electron进程的profile参数视为浏览器竞争；旧原件保留，分类修正并
  独审后新probe返回available=true。仅报告普通桌面应用，不停止；ps对改名/特殊包装
  的识别局限明确保留。资源快照不等于执行租约，正式窗口再次检查。
- 新目录`__output__/heat_hover_baseline_prepare_20261112_xtAjDJ/`，未重建四个已删除目录。
  准备run_baseline.py、remote_cdp.cjs、remote_supervisor.py；manifest及sources冻结28个
  当前源码/资源（1,483,045字节），不是旧图像/RGBA恢复。原监督器副本SHA为
  `f9ba0e03335bedaccbd708317c13b4ddf654d853498942e2d68d31cdeac4bf84`。
- 新封装保持单次statistic-hover-baseline、DPR1/16px首ramp avg及原highlight路径，
  原合成RGBA先于逐层观察写出；原始字节再次复算、目标/源码/输入身份核对。零容差，
  失败不重跑，不代替完整十配置/旧17项/性能/framework。总300秒含准备清退，正文
  ≤90秒、清退预留≥75秒；到期退出124明确是清退/回执未确认的FAIL，绝不放行。
- 两路独立静审已修正清退异常、PID复用、解释器入口混淆、远端原因/身份、结果裁决、
  硬截止及Electron误分类。最终runner/CDP/supervisor SHA及实际语法检查见manifest、
  PREPARATION_CHECKS.json、INDEPENDENT_REVIEW.md。Python AST、Node语法、无执行开关
  模式和28份来源/已装包声明检查通过；Mac正式运行/API/像素/清退仍未验证。
- READY仅指新的基线封装可交中央安排，详细命令/资源预算/限制见该目录README.md和
  RESULT.md。本轮单例0次，未启动服务/浏览器或写远端文件；无测试进程/profile需要
  清退。只新增本轮输出和本段plan，无生产修改、安装、index/commit/push。旧失败摘要
  不冒充原件，当前没有新的RGBA或像素PASS；不自动启动后续窗口。

## Heat 原始 ramp/avg：中央授权单次基线完成，82通道差异保留（2026-11-12）

- 中央明确批准已独审封装单次≤300秒窗口，执行一次statistic-hover-baseline；未运行
  pointer或全套，未改语义/容差。输出`__output__/heat_hover_baseline_run_20261112_01/`。
- 启动前28份源码/3份封装/依赖声明匹配，Mac用户HID空闲47348.71秒、无独立测试
  浏览器/监督器、18180/19229空闲。仅上传本次小监督器，新私有profile，保留用户Chrome。
- 12:34:51–12:35:08北京时间，总17.2448秒，正文12.7702秒，attempts=1。Chrome版本
  157.0.8103.52，现有Playwright1.61.1。严格原始合成RGBA差异82通道/max12/24128通道，
  状态CAPTURED_FAIL、Node退出1；采集完整，所有目标/统计/状态断言成立，页面错误为空。
  失败不重跑，没有原始事件/参考语义变更。
- 原始RGBA先于层观察冻结，观察返回后写入原件再执行原断言；本次hover层首次读取0差异，main首次读取83/max12，双方
  main各有1通道重复读差异，观察前后合成均不变且仍82。仅记录限定观察，不据此改
  oracle、替代合成裁决或宣称根因已定。新原件SHA及CSV/H5身份见该目录RESULT.md。
- WINDOW_END完整保存：source_unchanged/local_processes_stopped/capture_complete均true，
  cleanup_errors为空。Mac监督器browser_exited正常退出，自有Chrome87920/caffeinate87923
  及已观察后代均停止；profile及原件保留`/private/tmp/archvisual-hover-baseline.G4cOjI/baseline/`。
- 12:36:18额外只读复核全部已记录Mac PID含监督器均消失，本机/Mac两端口空闲，用户
  Chrome63598出生身份未变，私有profile保留。距窗口开始约87秒，窗口清退完成并释放。
  未修改生产或index/提交，没有安装依赖或后续浏览器执行；本次失败不是framework PASS。
  旧原件仍缺失；与历史摘要相同的82/max12现在有本次新原件可核验，不称旧证据恢复。

## Heat 普通层差异：并行离线定位与参考鼠标路径候选（2026-11-12）

- 中央已收82/max12及清退，明确要求不再跑浏览器；本轮只并行读取本次新RGBA与当前
  源码。逐像素、事件/绘制链、候选独审各自独占输出，主agent整合并维护本线plan。
  新目录`__output__/heat_hover_offline_review_20261112_lEdiMk/`，不恢复已删除旧证据目录。
- 原始合成82/max12保留。35个差异像素的hover双方全透明，对应80个差异通道，字节
  与各自main一致；严格反例mixed行min左边缘(1247,134)为RGBA[229,234,239,195]与
  [228,234,239,207]。余下(1263,70)共同半透明hover使main3通道差异变为合成2通道，
  与83→82实测计数一致；数学合成仅核对相容性，不代替真实Canvas证据。
- actual原生mouseover更新visualMap指示器并请求普通层refresh，reference外部highlight
  未走该链；已采状态对应外部highlight位0/1、指示器可见0.4999/隐藏空文字。目标仍在
  普通层按普通style绘制，21个统计格相对顺序相同，hover层完全相同。事件路径不等价
  已证实，但缺少paint调用时间线/事件前dirty现场，不能判定它直接造成main差异。
- 当前`test_heat_canvas_browser.cjs` SHA717997f5d62ffd25d6d9c483c98c7f3123b62c4d556a49c2be0fd7cc54157415
  已含显式opt-in `statistic-hover-pointer`，足以准备最小观测候选，无新增等价源码补丁。
  使用reference自己的局部CSS坐标、命中核对及ZRender mousemove，保留baseline/原裁剪/
  原零容差/首avg前序及单例停止边界。不是可信OS事件，不改变生产hover/统计语义。
- 首avg候选尚未执行；即使未来0diff，也不能替代原FAIL或证明完整根因/生产修复。
  A→B、离开重入、valid↔missing、重建中悬停及指示器裁剪外状态仍是未验反例；现有
  独审要求审阅label可见性、动画/图层顺序、observerEffect和重复读取字段。详见新目录
  CANDIDATE.md、RESULT.md与独立review；READY仅指离线材料和最小候选，执行待中央新窗口。
- 最终两份主报告已完成独立离线审阅，无阻断问题；回执为新目录candidate-review/REVIEW.md，
  不代表候选已执行或完整门禁通过。原件/源码/冻结交集最终核对见CHECKS.json。
- 校正前段“先于层观察落盘”的表述：实际先冻结原RGBA，随后观察，返回后写JSON并
  执行断言；不改既有原件。六份当前源码与本次采集SHA匹配，原FAIL原件保持不变。
  requirements保持7039aec202e73c393b23bfc98706bba2c66e7759196d4df91c4cb5008dfd9469，
  本线及委派不写Perfmodel251冻结输入/成员，不宣称其他writer受控。无浏览器/SSH/
  服务/native/安装/index/commit/push，无新生产或测试源码修改，不把离线核对写成门禁PASS。

## Heat 首 ramp/avg pointer：独立单次监督封装准备完成（2026-11-12）

- 中央先正式RELEASE此前Perfmodel251输入/成员及参数生成共享文件冻结，随后明确授权
  仅准备新的pointer监督封装。此次释放不是Perfmodel PASS，也不授权native重跑；本包
  不碰共享canonical/requirements/index，仅新输出与本线plan。
- 新目录`__output__/heat_hover_pointer_prepare_20261112_lR4PPT/`，独立`run_pointer.py`
  固定statistic-hover-pointer，新输出命名/HEAT_POINTER环境标记/Mac私有profile；旧baseline
  包不修改。当前28份来源及副本冻结，精确6份诊断来源仍与baseline原件一致；现有候选
  源码717997f5…保持原字节，不推广通用reference或改变生产语义。
- 绑定旧run_20261112_01的8份原件及独立副本，运行前后检查原始82/max12/24128、
  CAPTURED_FAIL/exit1/attempts1。新CSV须匹配原CSV，新H5保留本次实际哈希，不假定HDF
  元数据字节可重现。原合成仍在逐层观察前冻结，观察返回后落盘，原零容差不变。
- 总≤300秒、正文含启动≤90秒、清退独立≤75秒；正式执行前重新核用户HID/竞争profile/
  监督器/18180与19229端口、资源读取与磁盘余量。未赋值但已登记的直属Popen也清退；
  pidfd失败保留直属进程兜底，后代仍要求token/出生身份/pidfd，不按进程名批量终止。
  通用Mac监督器保持旧审计字节，独立新profile≤100MiB且保留，失败不重跑。
- 结果读取精确核六源、三份事件/输入身份、七个目标标志与实际frame/main/hover载荷。
  0diff仅可称CANDIDATE_ZERO_DIFFERENCE_NOT_FULL_GATE；标签位置/可见性、图层次序、
  observerEffect及重复读仍须审阅。现有baseline失败不能因此转PASS，也不能证明唯一因果。
- 25项本地准备检查通过，范围为AST/Node语法、无执行开关入口、已装依赖import、身份
  与synthetic结果解析反例；并非新浏览器像素证据。资源/清退和观测判据两路独审完成，
  初始问题及修正保留于各自REVIEW。runner最终SHA
  `ddc26c0dfa3bc35cec6b2ce428874797b7bccfbb1271afbcc3713d3046e488cd`，manifest SHA
  `aa116029c683cd92dd39082f844f09792cd2ea939ccd45a17c264b00da2cf716`。
- READY仅准备完成，真实浏览器仍待中央新窗口。会话既有原话“保持原失败，不再跑浏览器”
  已列README/RESULT，没有发现另行禁止后续任何浏览器的更广原话。本轮SSH/浏览器/
  服务/native均0，无进程待清退，无生产/测试源码改动、安装或index/提交。未来执行须
  最新身份与现场资源，不沿用旧空闲或旧PASS；交接见新目录RESULT/README/独审及最终身份回执。

## Heat 首 ramp/avg pointer：单次零差异，监督清退失败保留（2026-11-12）

- 中央另授单次≤300秒pointer窗口，13:37:59–13:38:14 CST执行一次，总14.7733秒、
  正文11.0260秒；输出`__output__/heat_hover_pointer_run_20261112_01/`。预检HID空闲
  51137秒、无竞争占用，28源与旧baseline绑定匹配，独立profile，未修改生产语义。
- 原始24128个RGBA通道0差异，Node退出0，仅首DPR1/16px ramp avg候选NOT_FULL_GATE。
  跨运行actual原RGBA相同，reference改变82/max12，支持限定事件路径观测，未证明唯一
  绘制因果或通用reference。双方普通层各保留同一R通道213→212读回变化；observerEffect
  只有采集计数，缺少观察后合成RGBA，不能从原件独立复算。旧baseline FAIL82/max12不变。
- WINDOW_END最终FAIL/监督退出1：`Backend: PermissionError(13, 'Permission denied')`。
  后台服务此前正常返回HTTP200，此错误属于stop_local清退，具体系统调用尚未确定。
  13:39:17独立只读后检确认登记的3个本机及19个Mac自有PID均不存在，两端口无监听，
  用户Chrome身份未变、私有profile保留，资源早于13:43释放。后检不撤销窗口FAIL。
- 原始回执、RGBA、后检、两份独审及最终哈希位于该run目录；没有重跑、native、安装、
  configure冻结输入写入、index或提交。随后中央源码RELEASE不代表native许可或本项PASS。

## Heat 本地清退失败证据：新副本离线修订与mock验证（2026-11-12）

- 用户明确授权仅新监督副本增强结构化失败证据与安全错误处理，不再跑真实浏览器。
  新包`__output__/heat_hover_cleanup_prepare_20261112_ju2LCV/`，原包及原pointer FAIL保留。
- 提取LocalCleanup，逐操作保存阶段/PID/路径/出生身份/pidfd/errno/traceback；不记录环境
  内容/token。PermissionError/EACCES/EPERM始终拒绝，只有缺失/ESRCH结合注册Popen退出
  或完全鉴权pidfd终止证据才确认退出；未知消失、出生变化及证据缺口不放行。
- 独审发现token读取后的birth复核必须先成功才能信任pidfd退出证明，已修正；最终poll
  与pidfd.close补上下文并在最终裁决前处理关闭失败。直属Popen兜底范围不扩大，原
  300/90/75秒、零容差、失败不重跑和硬截止124含义保持。Mac/CDP及生产源码均未改。
- PATH Python3.10.12下首轮15项/87场景、最终16项/102场景mock全部通过，原件保留在
  fixtures/run-01.json与run-02.json。全部进程/系统边界mock，非真实清退验收；AST、无执行
  开关入口、28源及161份旧文件身份核对通过。独审与精确hash见新包RESULT/STATIC_CHECKS。
- 实际PermissionError仍未重现、根因未定；无稳定身份的/proc消失会增加拒绝率，不借此
  降低门槛。本轮未请求或使用新权限，未执行SSH/服务/浏览器/native/framework/安装，
  未写index或提交。后续真实验证仍须中央新窗口，旧失败及完整门禁缺口继续保留。

## Heat 结构化清退：用户直接授权单次验证，精确定位直属后端environ拒绝（2026-11-12）

- 用户随后直接要求不等中央窗口立即验证，据此执行一次新封装；并非复用旧grant。
  输出`__output__/heat_hover_cleanup_run_20261112_01/`。17:59:25–17:59:40 CST，总
  15.0007秒、正文11.2592秒、清退0.6319秒，attempts=1；预检Mac HID空闲66822秒、
  无竞争profile/监督器，28源码/4封装与历史绑定一致，独立profile，失败不重跑。
- 原RGBA24128通道0差异、Node退出0、采集完整，仅首ramp avg候选NOT_FULL_GATE。
  监督最终FAIL/exit1，唯一DENY为Backend/SIGTERM/environ.token-match：登记直属PID
  3081415的`/proc/3081415/environ`打开返回EACCES13，完整traceback已保存。
- 已证实该操作发生于直属Popen发送TERM之后的进程组扫描/重复token核验。最终该Popen
  返回-15、组探测ESRCH具有退出证据；先前权限拒绝仍保持FAIL。没有错误时刻进程状态，
  不能仅据TERM后的顺序或后来退出断定zombie竞态/权限策略根因，不修改sudo/hidepid。
- Mac监督器STOPPED/browser_exited/exit0，无清退错误。18:00:58只读后检3个本机及17个
  Mac自有PID均不存在，18180/19229无监听，用户Chrome身份未变，私有profile保留。
  后检不撤销原FAIL；保存原件、离线RGBA复算和来源hash于新run，旧失败/旧包不变。
- 下一最小候选为注册直属Popen与后代分别按已有权属处理，避免TERM后重复读取直属
  environ；后代继续完整鉴权。该行为修订尚未实施，不能简单跳过数字PID或吞权限异常。
  本轮无第二次浏览器执行、native、环境变更、生产修改、index或提交；完整门禁仍未通过。

## Heat 直属后端清退：新副本最小修复、拒绝mock与独审（2026-11-12）

- 用户随后明确授权新的监督副本离线修复与独审，禁止重跑浏览器。交接目录为
  `__output__/heat_backend_cleanup_prepare_20261112_nmYBVk/`；原15秒FAIL和更早两次
  失败的原件/结论不变，新manifest分别绑定8/6/9件历史原件及其核对副本。
- 仅真实Backend创建点登记同一Popen对象、当前owner、PID/PPID/PGID/startticks及持有
  pidfd；创建前后stat一致，正常信号及组扫描继续复核。确认直属身份后不再重复读其
  environ/token；后代鉴权片段字节不变，不按label/相同数字PID放行。
- 独审发现初稿重复stat可能阻断自有对象兜底、部分登记异常可能留下已关闭fd记录，
  已修正：已登记直属对象的旧有限回收权限定为同owner/同对象/同PID/持有pidfd，失败
  仍保留DENY；fd与runner共享单一最终关闭责任，失败登记不发布资格。wait仍在旧预算
  内，TERM超时仅升级，KILL/final超时拒绝。详见SAFETY_ARGUMENT及review。
- PATH Python3.10.12下，新25项/74场景、旧16项/102场景mock各执行一次，全部通过；
  系统/进程边界均mock，未执行真实清退。13项静态检查通过，含旧判据/后代链不变、
  无执行开关不启动、28源码及248旧文件身份相符。最终独审无新增阻断，仅支持离线准备。
- 冻结helper SHA `0eb4b5abbb162bcc779a1e8f8ff271076c22ae145ff632d0fe0317b3df32b958`；
  runner `8e392aab7858afddb5e6f2dbce439454a176da9a8009187b42faaac519e5087b`；manifest
  `932f668044da403d3766c635c97773797286311ba630566d94d8316a41d7850b`。精确输入、差异、
  mock原件、独审与最终hash在新目录RESULT/FINAL_AUDIT中；不以新mock追认旧FAIL。
- 当前READY仅离线候选准备充分。真实权限错误时内核状态仍未证明，新真实清退及完整
  门禁未验；未启动SSH/服务/浏览器/native，未安装/提权、改生产源码/spec、写index或
  commit。后续实际专项仍需新的明确授权与现场资源/身份核验，本轮不自动重跑。

## Heat 新清退单例：下一次限时窗口计划与最新输入（2026-11-12）

- 用户仅授权准备下一次≤5分钟单例，明确本条不是grant；新准备目录为
  `__output__/heat_backend_cleanup_window_prepare_20261112_nbi25u49/`。复用上一已独审
  清退封装，不改其源码/manifest，不重复25项/74场景或16项/102场景fixture。
- RUN_PLAN明确首ramp/avg、DPR1、16px、statistic-hover-pointer一次；总≤300秒含内部
  准入/启动/清退，正文≤90秒、清退≤75秒，零容差，失败不重跑。拟输出为
  `__output__/heat_backend_cleanup_run_20261112_01`，目前未创建，不自动覆盖或改名。
- 最新RUN_INPUTS于19:33:19 CST采集28源码、4封装、71件冻结候选文件、8/6/9件历史
  失败关键原件/副本及实际PATH工具/已装依赖身份，均匹配对应绑定；SHA为
  `f3e5a6a1a5911dfadd9cb2fd63ab35b3e93f9f26566f60b7dd2be1f91e30deb7`。只记录身份，
  不声明完整系统库闭包、HEAD/index预留或源码冻结；所有原FAIL仍原样保留。
- 独审确认计划准确区分自动检查与中央/执行负责人检查：HID≥120秒及竞争profile/
  监督器/端口准入，独立profile与CDP精确身份，持续HID检查非硬实时；本地全部任务、
  CPU/内存压力/租约需中央当时确认。Mac df检查远端cwd，不自动证明profile文件系统
  空间；中央须核明。用户Chrome前后身份/端口后检在总300秒剩余预算内，缺证UNVERIFIED。
- 新计划静审无准备交付阻断，原件见review/PLAN_REVIEW与PREPARATION_RECEIPT。本轮
  未执行现场本地/Mac占用检查、SSH、服务/浏览器、真实清退、fixture、native、安装、
  index或commit。当前等待中央失败域合法收口回执及另发新grant；不得把本准备当执行许可。

## Heat 新清退单例：中央失败已收口，现场资源只读刷新（2026-11-12）

- 中央最新授权仅准备新窗口；已核ADOPTION固定SHA、close-1446与postcheck-1447原件。
  旧configure-only-WNthMi0F为FAILED_BEFORE_ACTIVE_CLOSED，raw1/startup缺证保留；
  postcheck记录blocking=[]、ELIGIBLE_FOR_FRESH_PREREGISTRATION_ONLY。本线不再报告
  旧中央DENY仍阻塞；HEAD1为中央域日志摘要，不是Git HEAD，仍需新两层check与精确grant。
- 新交接`__output__/heat_backend_cleanup_admission_refresh_20261112_4zdts923/`，143项
  哈希核对无漂移，含28运行源、冻结清退封装、71件候选及三次原FAIL关键原件；PATH工具/
  已装包元数据未变。原计划/manifest保留，不重跑fixture；拟run目录仍未创建。
- 单次只读SSH于22:50:54 CST观察MacHome HID空闲1.245631083秒，未满足120秒，
  available=false；竞争profile/监督器0、18180/19229空闲、用户Chrome存在。用户活跃
  因而本次现场不准入，不再探测等待变空闲；未创建远端文件/profile、启动浏览器或服务。
  直接核/private/tmp空间且与cwd同设备，补足前次文件系统观察缺口，不作为未来预留。
- 资源独审确认：Linux本线Backend/Node/SSH未限CPU，UBUNTU2204允许CPU0–7；可见
  Perfmodel包使用CPU0却未绑定另一主机，jobs=1也不等于单OS进程，因此并行隔离尚未
  证明。28源与其251输入直接交集0，共享声明不写；同机内存/卷及/proc清退拒绝风险仍在。
  建议中央保持现有封装，串行新窗口；不自行改亲和性、门槛或清退合同。
- 4个官方锁按dev/inode采样未见/proc/locks匹配；根index.lock存在且owner未核实，
  子仓库index.lock不存在，本线未获取/删除锁或改index。快照不构成租约、全局空闲或grant。
- 当前为PREPARED_WAIT_FRESH_CENTRAL_GRANT_AND_RESOURCE_ADMISSION；原82/max12
  FAIL、两次清退FAIL及完整门禁缺口均保留。本轮仅只读身份/资源核对与自有交接输出，
  未启动浏览器/后端/测试/native，无安装、生产修改或提交；详见新目录RESULT及独审。

## Heat 单例专项：B16编码窗口期间纯准备刷新（2026-11-13）

- 用户明确仅准备刷新，不是执行grant。新包为
  `__output__/heat_backend_window_refresh_20261113_PiG0Pi/`；旧包/清退封装不改。
  131项旧绑定哈希核对无漂移，独审复算一致；原28源补列scripts/visualizer包入口和
  dataviewer的apps/models/admin共5项，形成33项当前工程输入、4封装及相关成员清单。
  RUN_INPUTS SHA为`8f37964e2c7f438f2c56832fd2947ff6789c4793037d5f6aabefe50ad483739e`。
- 旧runner仍自动核28项；新增5项/成员需中央新稳定输入与执行前后核，不声称整个OS/
  已装库实现闭包。原fixture仅引用，不重跑；原82/max12及两次清退FAIL原件保留。
- 新RUN_PLAN绑定首ramp/avg、DPR1/16px、pointer单例，零容差、300/90/75秒、专属
  profile/CDP身份与退出后检。拟输出`__output__/heat_backend_cleanup_run_20261113_01`
  未创建。用户02:54空闲快照不作为准入；本轮没有SSH或实时Mac探测，不声称当前可用。
- 静审明确首次probe在backend前，第二次复核在backend后/Chrome前；不得写成两次均
  backend前。新grant须明确时序；若要求两次都先于backend，还需同一外部300秒预算
  内的额外完整准入与剩余预算监督，现有封装不自动保证，本轮不改合同或自行开跑。
- 03:00:21 CST本地快照见Python环境锁4 READ、framework锁1 WRITE，18180/19229
  无监听、两仓index.lock不存在；只读观察未归因owner、不获取或干预锁。33工程输入/
  本轮写入与B16修订builder编码包精确来源交集0，仍共享CPU/RAM/卷，不能据此放行并发。
- 当前PREPARED_NOT_GRANTED，待中央新check/grant、完整输入稳定和双次现场准入；
  不在B16计划03:00–03:20运行，也不在到时自动开跑。不沿用旧冻结/授权；没有运行
  浏览器/backend/native/测试、安装、信号或提交。计划/清单/资源交集/独审见新包。


## Heat min/max 维护入口：独立 PATH 离线准备完成（2026-11-13）

- 用户批准维护源码、启动前GNU timeout与资源适用性核对，随后明确独立PATH/no父Python
  租约；中央主机/专项浏览器排他与子仓发布锁原语义保留。本轮没有真实执行grant。
- 新增`scripts/heat_minmax_diagnostic/`共26文件；9个清退/初始化/采样模块与9mdj11jp
  原件字节一致，其余为代码/证据路径分离、统一启动预算、真实timeout父身份核验、中央
  资源声明校验、可复用封包工具及必要离线fixture。本轮未改生产JS/模板、共享环境/index。
- 新交接目录：`__output__/arch_heat_maintained_entry_oj5qk8lf/`（父工作区显式输出）。
  最终`preparation-03/BUNDLE.json` SHA
  `02d437c3266727b6ec20657fdb0543b32bd6603fb5fa6f52e23098cff02f729c`；inputs SHA
  `e766c483b9ba9d2cc7580aa1c69f1100dfb4a3411673d9c6db1a2842e85e87a6`。
  旧9mdj11jp及中间preparation-01/02原样保留，不作执行入口。
- 新增入口Python34例、Node模块迁移5项、12项语法检查均raw0；500项当前文件hash匹配，
  33工程源与3个目录集合维持，新增维护源码单列。独审确认准备无剩余迁移阻断；没有
  重跑旧资源27或采样44+5矩阵。精确原件和独审转录见交接RESULT/FINAL_STATIC_CHECK。
- 实际PATH=/usr/bin/python3；Django5.2.9、numpy1.24.4、pandas2.0.3、PyTables3.8.0。
  相较旧父venv的Django4.2.23/PyTables3.10.1变化已记录，未安装/改变环境，未验证
  此组合的实际后端/浏览器兼容性；旧父环境元数据只作历史来源，不作为当前准入。
- 全子仓diff --check观察到既有README.md/metricviewer.html的CRLF尾空白告警；本轮
  未动这些文件，不将该检查称为PASS，也不夹带清理。新目录及本轮追加文档独立检查。
- 状态READY_FOR_FRESH_CENTRAL_ADMISSION，非browser/fullgate PASS。中央须填新grant、
  两层check原件、具名资源排他声明及输入稳定回执，现场按原顺序两次Mac安全准入。
  输出仍须新建heat_minmax_run_<window_id>；没有SSH、服务、浏览器、native、安装、
  提交或push，本轮无这些进程/租约占用，实际窗口等待中央另行调度。

## Heat min/max 新299秒窗口：联合维护释放后准备复核（2026-11-13）

- 中央仅授权准备；本轮没有运行SSH/Mac probe、backend、浏览器、native或测试矩阵。
  主owner复核当前子仓AGENTS和独立PATH环境，非实施者完整审查26维护文件的接线。
  14:23:11 UTC核500文件（465实验输入+35封包）及6目录集合全部一致，无需修改源码或
  重封包；继续使用`arch_heat_maintained_entry_oj5qk8lf/preparation-03`及原BUNDLE SHA
  `02d437c3266727b6ec20657fdb0543b32bd6603fb5fa6f52e23098cff02f729c`。
- 新回执`__output__/arch_heat_ready_refresh_6yQjKR85/`包含当前逐项身份、环境导入、唯一
  执行命令、中央需填字段、资源/清退边界、复用证据和26文件提交候选。旧包/FAIL保留。
  独立Python3.10.12及Django5.2.9/numpy1.24.4/pandas2.0.3/tables3.8.0可导入；Node
  22.22.1/Playwright1.61.1可加载，均未启动生产服务。没有环境安装、父仓环境脚本或租约。
- 本次明确pins为26维护源码、33生产来源、5工具、10包元数据、391外部输入；不夸称
  全site-packages/ELF内容闭包。Mac Chrome版本、HID空闲和现场资源仍须新窗核验。
- 场景及299/90/75/20秒、128MiB/24MiB预算不变；GNU timeout覆盖Python启动和前后核，
  原两次Mac准入分别在backend前、Chrome前。中央需全新grant及四份绑定原件；本回执
  不是授权，到某一时点也不自动开跑。独审通过仅指静态准备，非像素或清退PASS。
- 完整接线独审发现提交顺序依赖：26文件诊断入口调用未提交heat_test_support的
  heatTestFullReference/heatTestRecord及renderer的bitmapStats/bitmapReuse:false，
  这些API在子仓HEAD不存在，因此不能独立先提交。当前工作树封包已绑定这些来源，
  299准备不受影响；先收口并提交完整必要前置，或先明确审定含依赖的候选，不自动夹带。
  真实独立环境执行/清退、当前适用框架门禁及串行index窗口仍缺；诊断像素失败须如实
  记录，不得追认或隐藏。生产位图复用/DPR下限的完整统计像素配置缺口继续保留。
  Micro构造边界/Func普通构建的限定PASS不代替这些门禁。未修改index、commit或push。

## 中央只读 check 退出采集：正规源码与离线验证（2026-11-14）

- 用户明确仅准备；02:05 Arch299候选和维护预约已取消，未追溯激活，不再申请带时间READY。
  本轮不执行中央真实check、SSH/Mac探测、backend/browser/native，不安装或提交。
- 父工作区新增`scripts/central_resource_check_capture.py`、
  `scripts/tests/test_central_resource_check_capture.py`及
  `scripts/README_central_resource_check_capture.md`；原checker和Arch consumer不改。
  精确复用来源为既有capture_once.v2协议和Func OwnedProcesses的直属pidfd/waitid方法，
  没有导入父Python lease或通用native监督器。仅实际进程退出与后检可生成release_verified。
- 独立`/usr/bin/python3 -I -S -B`（3.10.12）执行新增离线mock夹具，最终34例raw0；
  全部Popen/信号/计时器被替换，未运行真实checker。覆盖固定命令、PID复用/亲子身份、
  PermissionError、WAIT先存后回收、清退失败/超时、stdout哈希与漂移、临界信号以及
  180总界限/20清退/10终态预留。未重跑旧44+5/51/14及浏览器矩阵。
- 非实施者独审三文件及现有window_support FINAL消费合同，无阻断项；独审先核32基础
  加2增量实际日志，其后主owner在最终源码上补齐34例整次记录。原件/来源pins/精确diff/
  四原件预定生成路径在父`__output__/arch_central_capture_prepare_BsdMcCsY/`。
  其中synthetic fixture证据不可用于准入；真实CHECK_ONCE/stdout.raw、FINAL以及中央
  ADMISSION/INPUT_STABILITY均尚未生成。旧准备/失败证据不覆盖。
- 状态READY_FOR_NEW_CENTRAL_CHECK_AUTHORIZATION，仅源码/离线准备通过；实际check及
  进程清退仍未验，需中央另行授权。原Heat真实专项、完整适用框架门禁、必要未提交API
  前置和串行index窗口仍缺，不将本轮离线PASS替代生产绘图或提交门禁；未commit/push。
