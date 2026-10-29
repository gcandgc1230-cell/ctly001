# dsh-plugin-organizer

升级 DeepSeek Harness「插件」页面中的**已安装插件**区域：自定义分类、拖拽排序、搜索筛选、常用插件与长期布局保存。它替换了该页面的已安装列表视图（`main` 插槽的 `plugins` 键，插槽体系本身支持按已占用键替换），插件系统的启用/停用、安装、卸载、更新与配置全部沿用现有 Host 接口，不做任何改动。

## 功能

- **分类管理**：创建 / 重命名 / 删除 / 排序分类；固定的「未分类」分组；分类折叠与数量统计；删除分类时插件转入「未分类」（不卸载、不改运行状态）；名称校验（非空、不重名、保留名）。
- **自由排序**：同一分类内拖拽、跨分类拖拽、拖拽分类标题；拖拽手柄 + 行内菜单（上移/下移/置顶/置底/移至分类）+ 键盘（方向键 / Home / End）；排序模式：自定义（默认）/ 按名称 / 按启用状态；搜索或筛选时禁用拖拽。
- **搜索与筛选**：按名称、描述、包名、组件搜索；按分类、启用状态、常用筛选；只影响展示，不改动原始数据。
- **常用插件**：星标收藏、顶部「常用插件」组与快捷筛选视图（引用同一份插件数据，不创建副本）。
- **安全与恢复**：删除分类 / 移动插件 / 批量归类后 10 秒内可撤销；分类管理内可导出、导入、重置布局；布局保存失败时页面顶部常驻提示并可重试。
- **搜索增强**：`/` 或 `Ctrl+K` 聚焦搜索，`Esc` 清空；结果名称和描述命中片段高亮。
- **窄窗口适配**：工具栏自动换行、搜索框独占一行、行内元信息在窄宽度隐藏；拖拽到页面边缘时自动滚动。
- **智能分类建议**：安装新插件后按轻量关键词规则推荐分类（不调用外部服务）；不确定时放「未分类」；用户可接受、另选或保持未分类；不自动创建分类。
- **兼容原有页面**：保留「添加插件」主按钮，并新增下拉入口渲染 `plugins.add.actions`（如「让 Agent 创建插件」），避免替换面板后丢失其他插件贡献的添加方式；`plugins.tab`、`plugins.item`、详情页各扩展槽与配置页继续透传。
- **覆盖内置回退页**：内置回退页占用 `main[plugins]` 的 priority 0；本页面以 priority -1 注册（最低者渲染），从而覆盖回退页且不与它冲突。`plugins.tab` 等子插槽仍由回退页声明，因此这里不重复声明。
- **首次使用**：可一键创建 7 个推荐分类模板并自动归类现有插件，也可以保持现状；未命中的插件进入固定「未分类」。
- **持久化**：布局（分类、顺序、收藏、折叠、排序模式）通过 DSH settings 服务写入 profile 补丁（命名空间 `plugin-organizer`），带乐观修订号防并发覆盖；重启、重开页面后自动恢复。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半部：声明 `volatile` 的 `organizer` 配置字段，使布局可经 `ctx.remote.settings` 实时读写并持久化。 |
| `client.js` | 浏览器半部：整页 UI、分类/拖拽/搜索逻辑与持久化控制器。 |
| `cordis.patch.yml` | 插入 `plugin-organizer` 行。 |
| `logic.test.mjs` | 纯逻辑单元测试（`node logic.test.mjs`）。 |
| `vendor-smoke.test.mjs` | 验证 vendored schemastery 的 volatile 投影/序列化行为（`node vendor-smoke.test.mjs`）。 |
| `vendor/schemastery`、`vendor/cosmokit` | MIT 许可的 vendored 运行时副本（@deepseek-ai/schemastery 3.18.5 与 @deepseek-ai/cosmokit 1.8.6）。profile 外链安装的 bundle 无法从 profile 外解析裸 `@deepseek-ai/*` 导入，而导入失败会导致整个 Host 启动失败，因此改为相对路径引入。 |
| `locale/en.json`、`locale/zh.json` | 组合包卡片显示元数据。 |
| `icon.svg` | 组合包图标。 |

## 数据格式

存储在 settings 命名空间 `plugin-organizer` 的 `organizer` 字段（JSON）：

```json
{
  "version": 1,
  "initialized": true,
  "sort": "custom",
  "categories": [{ "id": "dev-tools", "name": "开发与编程" }],
  "placement": { "dsh-plugin-x": "dev-tools" },
  "order": { "dev-tools": ["dsh-plugin-x"], "": ["dsh-plugin-y"] },
  "favorites": ["dsh-plugin-x"],
  "collapsed": ["dev-tools"]
}
```

与插件安装/运行状态完全无关：卸载插件只清理引用；新装插件追加到所属分组末尾；启用/停用不触碰布局。

## 测试

`node logic.test.mjs` 覆盖：分类名校验、卸载后的引用清理、删除分类转入未分类、同/跨分类移动、快速连续排序的一致性、三种排序模式、搜索匹配、分类建议、坏数据修复与 schema 迁移（23 项）。

`node vendor-smoke.test.mjs` 验证 vendored schemastery 的 volatile 投影与序列化；`node --check client.js index.js` 做语法检查。

### 安装与生效

安装到任意 profile：

```bash
# Release 安装包（推荐，不需要 Git）
dsh plugin --profile desktop add "https://github.com/gcandgc1230-cell/ctly001/releases/download/v0.1.0/dsh-plugin-organizer-0.1.0.tgz"

# GitHub 源码（需要本机安装 Git）
dsh plugin --profile desktop add "github:gcandgc1230-cell/ctly001"

# 本地 tarball
dsh plugin --profile desktop add "D:/path/dsh-plugin-organizer-0.1.0.tgz"
```

安装后在「插件」页启用本插件并重启。发布到 GitHub / npm 的完整步骤见
[PUBLISHING.md](PUBLISHING.md)。

本 bundle 替换整个 Plugins 面板，因此 bundle patch 在启用期间禁用内置的
`@deepseek-ai/dsh-client-ui-plugin-manager` 客户端行。该行在 shell 的
`main[plugins]` 回退页占用 priority 0 时无法激活，会让桌面端把 web boot 判为
失败；本插件以 priority -1 覆盖同一个键，并自行注册侧边栏入口与
`pluginNavigation`。禁用或卸载本插件时，这条 override 随 bundle 层一起失效，
内置插件页会自动恢复。

浏览器半部是随 profile 启用的 bundle。首次安装或更新 `client.js` 后，需要让页面重新加载客户端模块图：

1. 完全退出并重新打开 DeepSeek Harness（推荐；Host 会按新 bundle 重新组合客户端模块）；
2. 或使用开发者工具执行 `location.reload()`。

仅刷新插件列表不会重新加载已启用的客户端模块。重启后打开侧边栏「插件」即可看到新页面；若客户端入口激活失败，原版页面会保留，应用日志目录下的 `crash-*-web-boot.log` 会指出失败的包名。

### 需要人工确认

自动化测试只覆盖纯逻辑与模块装载，以下交互需要在真实页面上确认：

- 分类创建 / 重命名 / 删除后插件落入「未分类」；
- 同分类与跨分类拖拽、分类标题拖拽、键盘排序；
- 搜索 / 筛选 / 常用视图与清除后的恢复；
- 启用 / 停用开关、安装 / 卸载 / 更新流程；
- 重启后布局恢复，以及「插件市场」等 `plugins.tab` 贡献页仍可打开。
