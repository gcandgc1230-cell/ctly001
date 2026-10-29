# 发布与分享指南

这个包不是一个独立应用，而是 **DSH 的 profile bundle**：别人需要把它安装到自己的
`$DSH_HOME/profiles/<profile>` 里，然后在「插件」页启用。源码本身可以直接通过
GitHub 分发，也可以发布到 npm 让安装变成一条命令。

## 1. 发布前需要改的地方

### 1.1 包名

当前包名是 `dsh-plugin-organizer`。npm 上的名字可能已被占用，建议改成带作用域的：
`@你的名字/dsh-plugin-organizer`。

改名时必须同时改三处，否则客户端模块加载不到：

1. `package.json` 的 `name`
2. `cordis.patch.yml` 里的 `name:`
3. `client.js` 里 `window.__ModuleLoader__.load({ id: ... })` 的 `id`

三处必须完全一致。

### 1.2 作者与仓库信息

在 `package.json` 里补上：

```json
"author": "你的名字",
"repository": {
  "type": "git",
  "url": "git+https://github.com/你的名字/dsh-plugin-organizer.git"
},
"homepage": "https://github.com/你的名字/dsh-plugin-organizer",
"bugs": { "url": "https://github.com/你的名字/dsh-plugin-organizer/issues" }
```

### 1.3 版本与兼容性

- 首次发布用 `0.1.0` 没问题；
- 已在 DSH `0.2.1-rc.3` 上验证，`package.json` 的 `engines.dsh` 写的是
  `">=0.2.1-rc.3 <0.3.0"`；
- DSH 升级后先跑一遍安装、启停、卸载、市场标签、详情页再改兼容范围。

### 1.4 必须保留的文件

- `vendor/`：schemastery 和 cosmokit 的相对路径副本，不能删；
- `cordis.patch.yml`：里面包含“启用本插件时禁用内置插件页”的条件性 override；
- `LICENSE`、`THIRD_PARTY_NOTICES.md`：再分发 vendor 代码需要保留；
- `locale/*.json`、`icon.svg`：插件市场/插件列表的显示信息。

`files` 已经把运行所需文件列全；`client.js.bak-*`、`_probe/`、测试产物不会进包。

## 2. 用 GitHub 分发

```bash
cd dsh-plugin-organizer
git init
git add .
git commit -m "feat: plugin organizer 0.1.0"
git branch -M main
git remote add origin https://github.com/你的名字/dsh-plugin-organizer.git
git push -u origin main
```

别人安装：

```bash
dsh plugin --profile desktop add "github:你的名字/dsh-plugin-organizer"
```

或在 DSH「插件 → 添加插件」里填 GitHub 地址。安装后在插件页启用
`dsh-plugin-organizer`，重启。

也可以打 release tarball：

```bash
npm pack
# 生成 dsh-plugin-organizer-0.1.0.tgz
```

别人安装：

```bash
dsh plugin --profile desktop add "D:/path/dsh-plugin-organizer-0.1.0.tgz"
```

## 3. 发布到 npm（可选，但安装体验最好）

```bash
npm login
npm publish --access public
```

如果是作用域包：

```bash
npm publish --access public
```

别人安装：

```bash
dsh plugin --profile desktop add @你的名字/dsh-plugin-organizer
```

npm 包带 `dsh.bundle.patch`、`dsh.client` 和兼容性声明后，支持 npm 源的 DSH
插件市场可以直接索引到它；具体是否出现在市场列表取决于对应市场的索引规则。

## 4. 安装后会发生什么

本插件会替换整个 Plugins 面板，因此 bundle patch 里包含：

```yaml
- id: ui-plugin-manager
  name: "@deepseek-ai/dsh-client-ui-plugin-manager"
  disabled: true
```

这条禁用只在本 bundle 启用时生效；停用或卸载本插件后，内置插件页自动恢复。
README 里已经写明这一点，避免用户卸载后找不到插件页。

## 5. 发布检查清单

- [ ] `package.json` 的 `name` 与 `cordis.patch.yml`、`client.js` 的模块 id 一致
- [ ] `private` 已移除
- [ ] `license`、`LICENSE`、`THIRD_PARTY_NOTICES.md` 齐全
- [ ] `files` 包含 `vendor/**`、`client.js`、`index.js`、`cordis.patch.yml`、locale、icon
- [ ] `npm pack --dry-run` 里没有 `.bak`、测试缓存、个人路径
- [ ] 在干净的 DSH profile 上从 tarball/git 安装、启用、重启、卸载各跑一遍
- [ ] README 写清：替换插件页、停用后恢复内置页、兼容的 DSH 版本
- [ ] 打 tag：`git tag v0.1.0 && git push --tags`
