/**
 * Browser half of dsh-plugin-organizer.
 *
 * Replaces the stock Installed-plugins view of the sidebar Plugins page
 * (the `main` slot key `plugins` — the slot catalog documents that
 * registering an occupied key replaces that occupant) with an enhanced view:
 *
 *   - user-defined categories with create / rename / delete / reorder,
 *     expand & collapse, per-category counts, and a fixed "uncategorized" group;
 *   - drag & drop for plugins (within and across categories) and category
 *     headers, plus keyboard moves and a per-row action menu
 *     (up / down / top / bottom / move to category);
 *   - sort modes: custom (default), by name, by enabled state;
 *   - search over title / description / package name / components, category
 *     and status filters, and a favorites quick view;
 *   - rule-based category suggestions for newly installed plugins;
 *   - durable persistence of the whole layout through the DSH settings
 *     service (`ctx.remote.settings`, namespace `plugin-organizer`), which
 *     stores into the profile patch with optimistic revisions.
 *
 * Every management action (enable/disable, install, uninstall, update,
 * per-component switches, contributed configuration pages) goes through the
 * existing `remote.pluginManager` / `remote.pluginInventory` APIs and the
 * page's contributed slots; nothing about the plugin system itself changes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-organizer',
  factory: (require) => {
    'use strict';
    const React = require('react');
    const { createElement: h, Fragment } = React;
    const { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } = React;

    /* ================================================================ */
    /* Constants                                                         */
    /* ================================================================ */

    const NS = 'pluginOrganizer';
    const PANEL_ID = 'plugins';
    const SETTINGS_NS = 'plugin-organizer';
    const INSTALLED_TAB = 'installed';
    const UNCATEGORIZED_ID = '';
    const UNCATEGORIZED_LABEL_KEY = 'uncategorized';
    const ORGANIZER_VERSION = 1;
    const HIGHLIGHT_MS = 2400;
    const PERSIST_DEBOUNCE_MS = 350;
    const REFRESH_SPINNER_MIN_MS = 400;

    /** Built-in profile bundles stay out of this page even when the profile declares them as dependencies. */
    const BUILTIN_PROFILE_BUNDLES = new Set([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-headless',
      '@deepseek-ai/dsh-sdk-app',
      '@deepseek-ai/dsh-acp-app',
      '@deepseek-ai/dsh-sdk-minimal',
    ]);

    /** The optional bundles the main list always holds, in this order; new bundles join the main list. */
    const EXTENSION_BUNDLES = [
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-voice-input-bundle',
      '@deepseek-ai/dsh-experimental-auto-review',
      '@deepseek-ai/dsh-experimental-inspector-profile',
    ];

    /** The optional bundles the main list holds back until the profile picks them; the More list shows them from the start. */
    const MORE_BUNDLES = [
      '@deepseek-ai/dsh-experimental-tool-worktree',
      '@deepseek-ai/dsh-experimental-cot-translation-bundle',
      '@deepseek-ai/dsh-experimental-terminal-bundle',
      '@deepseek-ai/dsh-experimental-session-search',
      '@deepseek-ai/dsh-experimental-session-titles-bundle',
      '@deepseek-ai/dsh-experimental-badge-skill-bundle',
      '@deepseek-ai/dsh-experimental-ralph-bundle',
      '@deepseek-ai/dsh-experimental-plugin-market-bundle',
      '@deepseek-ai/dsh-subagent-codex',
      '@deepseek-ai/dsh-subagent-claude-code',
    ];

    /** Template categories suggested on first use; ids are stable and names are localized at creation time. */
    const TEMPLATE_CATEGORIES = [
      { id: 'ai-model', name: { zh: 'AI 模型与模型增强', en: 'AI models & enhancements' } },
      { id: 'web-search', name: { zh: '网络搜索与浏览器', en: 'Web search & browser' } },
      { id: 'memory-context', name: { zh: '记忆与上下文', en: 'Memory & context' } },
      { id: 'dev-tools', name: { zh: '开发与编程', en: 'Development & coding' } },
      { id: 'automation', name: { zh: '自动化与效率', en: 'Automation & productivity' } },
      { id: 'image-vision', name: { zh: '图片与视觉工具', en: 'Image & vision tools' } },
      { id: 'ui-system', name: { zh: '界面与系统工具', en: 'UI & system tools' } },
    ];

    /** Known packages whose best category is clearer than keyword scoring. */
    const PACKAGE_CATEGORY = {
      '@anysearch/anysearch-dsh': 'web-search',
      '@wxg-prc-cpg/browser-skill-dsh-plugin': 'web-search',
      '@deepseek-harness-tui/dsh-tui': 'dev-tools',
      '@tt-a1i/archify-dsh': 'dev-tools',
      '@liustack/modlens': 'image-vision',
      '@openviking/dsh-memory-plugin': 'memory-context',
      'dsh-context': 'memory-context',
      'dsh-hindsight': 'memory-context',
      'dshmarket': 'ui-system',
      'dsh-startup-screen': 'ui-system',
      'dsh-plugin-organizer': 'ui-system',
      '@linxin666/dsh-web-all': 'ui-system',
      'dsh-session-delete': 'automation',
    };

    /** Lightweight keyword rules for the category suggestion; no external service involved. */
    const SUGGESTION_RULES = [
      { id: 'ai-model', keywords: ['model', 'llm', 'gpt', 'claude', 'gemini', 'deepseek', 'prompt', '模型', '智能体'] },
      { id: 'web-search', keywords: ['search', 'browser', 'browsing', 'web ', 'fetch', 'crawl', '搜索', '浏览器', '网页', '抓取'] },
      { id: 'memory-context', keywords: ['memory', 'context', 'session', 'compact', 'remember', '记忆', '上下文', '会话', '压缩'] },
      { id: 'dev-tools', keywords: ['code', 'coding', 'developer', 'git', 'terminal', 'editor', 'worktree', 'lint', 'shell', '开发', '编程', '代码', '终端', '编辑器'] },
      { id: 'automation', keywords: ['automation', 'todo', 'task', 'schedule', 'reminder', 'workflow', '自动化', '任务', '日程', '提醒', '效率', '工作流'] },
      { id: 'image-vision', keywords: ['image', 'photo', 'vision', 'ocr', 'screenshot', '图片', '图像', '视觉', '截图'] },
      { id: 'ui-system', keywords: ['theme', 'layout', 'panel', 'skin', 'ui ', 'widget', '主题', '界面', '布局', '皮肤'] },
    ];

    /** The key a row's configuration registers under. */
    const rowConfigKey = (bundle, rowId) => `${bundle}#${rowId}`;

    const SLOT_SOURCES = ['plugins.item', 'plugins.bundle.config', 'plugins.row.config'];

    /* ================================================================ */
    /* Copy                                                             */
    /* ================================================================ */

    const ZH = {
      panel: '插件',
      title: '插件',
      intro: '安装、启用和配置插件',
      infoLabel: '插件说明',
      infoDescription: '在这里配置官方插件，安装和管理其他插件。内置插件列表及运行状态可在「设置 → 内置插件」中查看',
      loading: '正在读取插件…',
      error: '无法读取全部插件，可能由于网络问题',
      unavailable: '本部署没有可管理的 profile，无法安装或启停插件。',
      retry: '重试',
      refresh: '刷新',
      refreshError: '刷新失败，请重试',
      empty: '还没有安装任何插件。',
      addPlugin: '添加插件',
      addPluginMenu: '更多添加方式',
      installBySpec: '安装第三方插件',
      installBySpecDescription: '按包名、Git 地址或本地目录安装',
      bundlesTitle: '已安装插件',
      basicTitle: '内置插件配置',
      extensionsTitle: '实验性插件',
      moreTitle: '实验性插件',
      moreAction: '更多',
      tabsLabel: '插件视图',
      installedTab: '已安装',
      statusProblem: '异常',
      statusBeta: '实验性',
      reasonLabel: '原因',
      metadataError: '包元信息错误：{error}',
      versionTag: 'v{version}',
      partsLabel: '包含的组件',
      sourceTitle: '来源信息',
      sourceSpec: '代码来源',
      sourceBuiltIn: '内置',
      sourceVersion: '当前版本',
      partsEmpty: '这个插件包不包含任何组件。',
      partsCountTotal: '共 {count} 个',
      partsCountRunning: '{count} 运行中',
      partsCountOff: '{count} 已停用',
      partOff: '已关闭',
      partsCountFailed: '{count} 异常',
      partsFilter: '筛选组件',
      partsFilterEmpty: '没有匹配的组件。',
      searchEmpty: '没有匹配的插件。',
      partToggle: '启用组件 {name}',
      rowPhasePending: '等待依赖',
      rowPhaseLoading: '加载中',
      rowPhaseActive: '运行中',
      rowPhaseFailed: '异常',
      rowPhaseUnloading: '卸载中',
      enableToggle: '启用 {name}',
      openDetail: '查看 {name}',
      backToList: '返回插件',
      crumbRoot: '插件',
      backToPackage: '返回 {name}',
      configureRow: '配置 {name}',
      rowStateIdle: '未运行',
      uninstall: '卸载',
      uninstallLabel: '卸载 {name}',
      update: '更新',
      updateLabel: '更新 {name}',
      statusNotInstalled: '未安装',
      statusMissingFiles: '包不可用',
      statusUpdateAvailable: '可更新',
      close: '关闭',
      cancel: '取消',
      confirmUninstallTitle: '卸载「{name}」？',
      confirmUninstallDescription: '卸载后它提供的功能会消失。',
      confirmUninstall: '卸载',
      failedEnable: '启用失败：{reason}',
      failedDisable: '停用失败：{reason}',
      failedUninstall: '卸载失败：{reason}',
      failedRowEnable: '组件启用失败：{reason}',
      failedRowDisable: '组件停用失败：{reason}',
      restartNotice: '请重启 DSH 使更改生效。{reason}',
      restartReasonNoHmr: '这个 profile 只在启动时应用更改。',
      restartReasonPackageMoved: '已安装的插件包解析到了另一个目录，或者更改替换了 DSH 安装自带的包。从其他位置安装前请先卸载。',
      restartReasonHostModule: '更改涉及 DSH 自身已加载的模块。',
      restartReasonUnmanagedPlugin: '更改涉及一个不受插件列表管理的插件。',
      restartReasonModuleComparison: 'DSH 无法将已加载的插件与磁盘上的文件进行比较。',
      overriddenNotice: '{name} 已保存，但被更高优先级的配置覆盖，当前未生效',
      reasonManagementRequired: '插件管理所需，不能停用或卸载',
      reasonUnaddressable: '当前 profile 的 patch 无法唯一定位这一项',
      reasonUnknownPlugin: '找不到该插件',
      reasonNotRemovable: '这个包不属于当前 profile，或者是插件管理所需的组件',
      reasonStopProfile: '这个 profile 没有启用 HMR，正在使用的包要停止后用 dsh plugin 卸载',
      reasonBundleInUse: '其他配置仍在使用这个组合包的组件，请先停用它们',
      reasonOperationError: 'Host 报告了一个错误',
      // organizer
      searchPlaceholder: '搜索名称、描述或包名…',
      searchResultsTitle: '搜索结果',
      searchAria: '搜索已安装插件',
      clearSearch: '清除搜索',
      filterCategory: '分类',
      filterAllCategories: '全部分类',
      filterStatus: '状态',
      filterAllStatus: '全部状态',
      filterEnabled: '已启用',
      filterDisabled: '已停用',
      favoritesFilter: '常用插件',
      favoritesTitle: '常用插件',
      favorite: '标为常用',
      unfavorite: '取消常用',
      favoriteAria: '{action} {name}',
      sortLabel: '排序',
      sortCustom: '自定义排序',
      sortName: '按名称排序',
      sortStatus: '按状态排序',
      sortSwitchedToast: '已切换为自定义排序',
      dndDisabledHint: '搜索或筛选状态下不能拖拽排序',
      manageCategories: '分类管理',
      categorizeUncategorized: '按推荐整理未分类',
      nothingToCategorize: '没有可按规则归类的未分类插件',
      undo: '撤销',
      undoDeletedCategory: '已删除分类「{name}」',
      undoMovedPlugin: '已调整插件位置',
      undoCategoryOrder: '已调整分类顺序',
      undoAppliedTemplate: '已应用推荐分类',
      undoCategorized: '已按推荐归类 {count} 个插件',
      undoResetLayout: '已重置插件布局',
      exportLayout: '导出布局',
      importLayout: '导入布局',
      resetLayout: '重置布局',
      resetLayoutConfirm: '清空所有分类和排序？插件不会被卸载。',
      importFailed: '导入失败：{reason}',
      importDone: '布局已导入',
      exportDone: '布局已导出',
      persistErrorBanner: '布局保存失败：{reason}',
      expandAll: '展开全部',
      collapseAll: '折叠全部',
      categoryCount: '{count} 个插件',
      categoryEmpty: '此分类还没有插件',
      uncategorized: '未分类',
      createCategory: '新建分类',
      newCategoryPlaceholder: '新分类名称…',
      renameCategory: '重命名分类',
      rename: '重命名',
      delete: '删除',
      nameEmpty: '分类名称不能为空',
      nameDuplicate: '已存在同名分类',
      nameReserved: '「未分类」是保留名称，不能使用',
      deleteCategoryConfirmTitle: '删除分类「{name}」？',
      deleteCategoryConfirmBody: '其中的 {count} 个插件将移动到「未分类」。插件不会被卸载，运行状态和配置也不会改变。',
      moveUp: '上移',
      moveDown: '下移',
      moveTop: '移至顶部',
      moveBottom: '移至底部',
      moveToCategory: '移至分类…',
      moveToCategoryTitle: '移动「{name}」到分类',
      dragHandlePlugin: '拖拽排序 {name}；方向键上移或下移',
      dragHandleCategory: '拖拽排序分类「{name}」；方向键调整顺序',
      jumpToPlugin: '定位到 {name}',
      templateOfferTitle: '使用推荐分类？',
      templateOfferBody: '可以一键创建推荐分类并自动归类现有插件（运行状态不受影响），也可以完全自定义或保持现状。',
      templateApply: '创建推荐分类',
      templateDismiss: '保持未分类',
      templateAppliedToast: '已创建推荐分类',
      suggestionTitle: '新插件分类建议',
      suggestionBody: '「{name}」建议放入「{category}」。',
      suggestionUncertain: '无法可靠判断「{name}」的分类，将放入「未分类」。',
      suggestionAccept: '接受建议',
      suggestionChoose: '选择其他分类…',
      suggestionKeepUncategorized: '放入未分类',
      chooseCategoryTitle: '选择分类',
      persistFailed: '保存分类设置失败：{reason}',
      settingsReadonly: '当前配置不可写，分类与排序不会被保存。',
      settingsLoadFailed: '无法读取已保存的分类设置：{reason}',
      // install
      installTitle: '添加插件',
      installDescription: '输入插件的包名、GitHub 仓库地址或本地目录路径。',
      installSpecLabel: '包名或地址',
      installSpecPlaceholder: '例如 dsh-plugin-whale-pet',
      installSafety: '请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 DeepSeek Harness，或读取和泄露你的数据。',
      registryToggle: '安装源',
      registryDefault: '默认安装源',
      registryOfficial: 'npm 官方源',
      registryCustom: '自定义地址',
      registryCustomPlaceholder: 'https://npm.example.com/',
      installRun: '安装',
      installChecking: '正在检查…',
      installingTitle: '插件安装中…',
      installApplying: '正在应用配置，请稍候…',
      installCancelling: '正在停止安装…',
      installedTitle: '已安装',
      installFailedTitle: '插件安装失败',
      installUnknownTitle: '未能获取安装结果',
      installUnknownDescription: '后端当前没有此安装任务。请检查插件列表后再尝试安装。',
      installCancel: '取消安装',
      installClose: '完成',
      installRetry: '重试',
      installEnableNow: '立即启用',
      installViewTask: '查看安装任务',
      installReconcile: '核对安装状态',
      installDetailsShow: '查看安装详情',
      installDetailsHide: '收起安装详情',
      installCancelled: '已取消安装，插件未启用，下载的文件可能保留',
      installDoneRestart: '已安装，请重启 DSH 加载它。',
      installApprovalTitle: '需要允许安装脚本',
      installApprovalDescription: '以下包声明了安装脚本，pnpm 默认不运行。',
      installApprovalConsequence: '允许后，脚本会以你的权限在本机运行，授权保存在当前 profile，之后不再询问。',
      installApprovalCaution: '只在信任这些包时允许。',
      installApproveAndRetry: '允许这些脚本并重试',
      installProblemInvalid: '无法识别这个包名或地址：{reason}',
      installProblemInstalled: '该插件已安装。如需升级，请卸载后重新安装',
      installProblemShipped: '该插件随 DSH 提供，升级 DSH 即可获得新版本',
      installProblemNotFound: '未找到相关插件',
      installProblemNotPackage: '该路径不存在或不是有效的插件包',
      installProblemNotBundle: '这个包没有声明组合包，无法作为插件安装：{reason}',
      installProblemNetwork: '无法连接插件源，请检查网络后重试',
      installProblemUnknown: '无法获取插件信息：{reason}',
      installFailurePnpmMissing: '没有找到 pnpm，无法安装',
      installFailureTimeout: '安装超时',
      installFailureNotFound: '未找到相关插件',
      installFailureNoMatchingVersion: '没有匹配的版本',
      installFailureNetwork: '网络连接失败',
      installFailureDiskFull: '磁盘空间不足，安装已停止',
      installFailurePermission: '没有写入权限，无法安装',
      installFailureBuildBlocked: '有依赖的安装脚本需要你允许后才能继续',
      installFailureIntegrity: '下载的安装包校验失败',
      installFailureGeneric: '安装过程中出错，原因见安装详情',
      terminalCommandLine: '命令第 {n} 行',
      terminalRunning: '运行中',
      terminalFailed: '失败',
      terminalDone: '已完成',
      terminalCopy: '复制',
      terminalCopied: '复制成功',
      terminalNoOutput: '无输出',
      terminalCollapseAria: '收起输出',
      terminalCollapse: '收起',
      terminalExpandAria: '展开其余 {n} 行输出',
      terminalExpand: '展开输出',
      terminalExitCode: '退出码 {code}',
      terminalNoExitCode: '未正常退出',
      installLocation: '安装位置：{dir}',
      installBackgroundDone: '插件安装已完成，可查看安装结果。',
      installBackgroundFailed: '插件安装失败，可查看安装详情。',
      installBackgroundUnconfirmed: '安装状态暂未确认，请查看安装任务了解详情。',
      installBackgroundApplying: '安装已进入收尾阶段，无法取消，可查看安装进度。',
      installBackgroundUnknown: '未能获取安装结果，请检查插件列表。',
    };

    const EN = {
      panel: 'Plugins',
      title: 'Plugins',
      intro: 'Install, enable, and configure plugins',
      infoLabel: 'About plugins',
      infoDescription: 'Configure official plugins and install or manage other plugins here. View the built-in plugin list and runtime status in Settings → Built-in plugins.',
      loading: 'Reading plugins…',
      error: 'Could not read all plugins, possibly due to a network problem',
      unavailable: 'This deployment runs without a manageable profile, so plugins cannot be installed or switched here.',
      retry: 'Retry',
      refresh: 'Refresh',
      refreshError: 'Refresh failed. Please try again.',
      empty: 'No plugins are installed yet.',
      addPlugin: 'Add plugin',
      addPluginMenu: 'More ways to add',
      installBySpec: 'Install a third-party plugin',
      installBySpecDescription: 'By package name, Git address, or local directory',
      bundlesTitle: 'Installed plugins',
      basicTitle: 'Built-in plugin settings',
      extensionsTitle: 'Experimental plugins',
      moreTitle: 'Experimental plugins',
      moreAction: 'More',
      tabsLabel: 'Plugin views',
      installedTab: 'Installed',
      statusProblem: 'Problem',
      statusBeta: 'Experimental',
      reasonLabel: 'Reason',
      metadataError: 'Package metadata error: {error}',
      versionTag: 'v{version}',
      partsLabel: 'Components',
      sourceTitle: 'Source',
      sourceSpec: 'Code source',
      sourceBuiltIn: 'Built in',
      sourceVersion: 'Current version',
      partsEmpty: 'This plugin pack contains no components.',
      partsCountTotal: '{count} total',
      partsCountRunning: '{count} running',
      partsCountOff: '{count} off',
      partOff: 'Off',
      partsCountFailed: '{count} failed',
      partsFilter: 'Filter components',
      partsFilterEmpty: 'No component matches.',
      searchEmpty: 'No plugin matches.',
      partToggle: 'Enable component {name}',
      rowPhasePending: 'Waiting for dependencies',
      rowPhaseLoading: 'Loading',
      rowPhaseActive: 'Running',
      rowPhaseFailed: 'Problem',
      rowPhaseUnloading: 'Unloading',
      enableToggle: 'Enable {name}',
      openDetail: 'View {name}',
      backToList: 'Back to plugins',
      crumbRoot: 'Plugins',
      backToPackage: 'Back to {name}',
      configureRow: 'Configure {name}',
      rowStateIdle: 'Not running',
      uninstall: 'Uninstall',
      uninstallLabel: 'Uninstall {name}',
      update: 'Update',
      updateLabel: 'Update {name}',
      statusNotInstalled: 'Not installed',
      statusMissingFiles: 'Package unavailable',
      statusUpdateAvailable: 'Update available',
      close: 'Close',
      cancel: 'Cancel',
      confirmUninstallTitle: 'Uninstall "{name}"?',
      confirmUninstallDescription: 'What it provides goes away once it is uninstalled.',
      confirmUninstall: 'Uninstall',
      failedEnable: 'Could not enable: {reason}',
      failedDisable: 'Could not disable: {reason}',
      failedUninstall: 'Could not uninstall: {reason}',
      failedRowEnable: 'Could not enable the component: {reason}',
      failedRowDisable: 'Could not disable the component: {reason}',
      restartNotice: 'Restart DSH to apply the change. {reason}',
      restartReasonNoHmr: 'This profile applies changes only at startup.',
      restartReasonPackageMoved: 'An installed package now resolves to another directory, or the change replaces a package the DSH installation provides. Uninstall a package before installing it from another location.',
      restartReasonHostModule: 'The change reaches modules DSH itself loaded.',
      restartReasonUnmanagedPlugin: 'The change reaches a plugin running outside the plugin list.',
      restartReasonModuleComparison: 'DSH could not compare the loaded plugins with their files.',
      overriddenNotice: '{name} was saved, but a higher-priority configuration overrides it, so it is not in effect',
      reasonManagementRequired: 'Plugin management needs it; it cannot be switched off or uninstalled.',
      reasonUnaddressable: 'The profile patch cannot address this one uniquely.',
      reasonUnknownPlugin: 'No such plugin.',
      reasonNotRemovable: 'This package is not owned by the profile, or plugin management needs it.',
      reasonStopProfile: 'This profile runs without HMR; stop it and uninstall the package with dsh plugin.',
      reasonBundleInUse: 'Other configuration still uses this bundle\'s components; switch them off first.',
      reasonOperationError: 'The Host reported an error.',
      searchPlaceholder: 'Search name, description, or package…',
      searchResultsTitle: 'Search results',
      searchAria: 'Search installed plugins',
      clearSearch: 'Clear search',
      filterCategory: 'Category',
      filterAllCategories: 'All categories',
      filterStatus: 'Status',
      filterAllStatus: 'Any status',
      filterEnabled: 'Enabled',
      filterDisabled: 'Disabled',
      favoritesFilter: 'Favorites',
      favoritesTitle: 'Favorites',
      favorite: 'Mark as favorite',
      unfavorite: 'Remove favorite',
      favoriteAria: '{action} {name}',
      sortLabel: 'Sort',
      sortCustom: 'Custom order',
      sortName: 'By name',
      sortStatus: 'By enabled state',
      sortSwitchedToast: 'Switched to custom order',
      dndDisabledHint: 'Drag sorting is disabled while searching or filtering',
      manageCategories: 'Categories',
      categorizeUncategorized: 'Sort uncategorized',
      nothingToCategorize: 'No uncategorized plugin matches the rules',
      undo: 'Undo',
      undoDeletedCategory: 'Deleted category "{name}"',
      undoMovedPlugin: 'Moved a plugin',
      undoCategoryOrder: 'Reordered categories',
      undoAppliedTemplate: 'Applied the suggested categories',
      undoCategorized: 'Sorted {count} plugin(s)',
      undoResetLayout: 'Reset the plugin layout',
      exportLayout: 'Export layout',
      importLayout: 'Import layout',
      resetLayout: 'Reset layout',
      resetLayoutConfirm: 'Clear every category and custom order? Plugins are not uninstalled.',
      importFailed: 'Import failed: {reason}',
      importDone: 'Layout imported',
      exportDone: 'Layout exported',
      persistErrorBanner: 'Could not save the layout: {reason}',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      categoryCount: '{count} plugins',
      categoryEmpty: 'No plugins in this category yet',
      uncategorized: 'Uncategorized',
      createCategory: 'New category',
      newCategoryPlaceholder: 'New category name…',
      renameCategory: 'Rename category',
      rename: 'Rename',
      delete: 'Delete',
      nameEmpty: 'Category name cannot be empty',
      nameDuplicate: 'A category with this name already exists',
      nameReserved: '"Uncategorized" is reserved',
      deleteCategoryConfirmTitle: 'Delete category "{name}"?',
      deleteCategoryConfirmBody: 'Its {count} plugins move to "Uncategorized". Nothing is uninstalled and no runtime state changes.',
      moveUp: 'Move up',
      moveDown: 'Move down',
      moveTop: 'Move to top',
      moveBottom: 'Move to bottom',
      moveToCategory: 'Move to category…',
      moveToCategoryTitle: 'Move "{name}" to a category',
      dragHandlePlugin: 'Drag {name} to reorder; arrow keys move it',
      dragHandleCategory: 'Drag category "{name}" to reorder; arrow keys move it',
      jumpToPlugin: 'Locate {name}',
      templateOfferTitle: 'Use suggested categories?',
      templateOfferBody: 'Create the suggested categories and sort existing plugins into them automatically (runtime state is untouched), or stay with a single uncategorized list.',
      templateApply: 'Create suggested categories',
      templateDismiss: 'Keep uncategorized',
      templateAppliedToast: 'Suggested categories created',
      suggestionTitle: 'Category suggestion',
      suggestionBody: '"{name}" fits "{category}".',
      suggestionUncertain: 'No reliable category for "{name}"; it goes to "Uncategorized".',
      suggestionAccept: 'Accept suggestion',
      suggestionChoose: 'Choose another category…',
      suggestionKeepUncategorized: 'Keep uncategorized',
      chooseCategoryTitle: 'Choose a category',
      persistFailed: 'Could not save the layout: {reason}',
      settingsReadonly: 'The current configuration is not writable; categories and order will not be saved.',
      settingsLoadFailed: 'Could not read the saved layout: {reason}',
      installTitle: 'Add plugin',
      installDescription: 'Enter the plugin\'s package name, GitHub repository address, or local directory path.',
      installSpecLabel: 'Package name or address',
      installSpecPlaceholder: 'e.g. dsh-plugin-whale-pet',
      installSafety: 'Install only plugins you trust: they run with your permissions and can damage DeepSeek Harness or leak your data.',
      registryToggle: 'Registry',
      registryDefault: 'Default registry',
      registryOfficial: 'Official npm registry',
      registryCustom: 'Custom address',
      registryCustomPlaceholder: 'https://npm.example.com/',
      installRun: 'Install',
      installChecking: 'Checking…',
      installingTitle: 'Installing the plugin…',
      installApplying: 'Applying configuration, please wait…',
      installCancelling: 'Stopping installation…',
      installedTitle: 'Installed',
      installFailedTitle: 'The plugin could not be installed',
      installUnknownTitle: 'Installation result unavailable',
      installUnknownDescription: 'The Host has no active installation with this request id. Check the plugin list before trying again.',
      installCancel: 'Cancel install',
      installClose: 'Done',
      installRetry: 'Retry',
      installEnableNow: 'Enable now',
      installViewTask: 'View installation',
      installReconcile: 'Check installation status',
      installDetailsShow: 'Show install details',
      installDetailsHide: 'Hide install details',
      installCancelled: 'Installation cancelled; the plugin is not enabled, and downloaded files may remain',
      installDoneRestart: 'Installed; restart DSH to load it.',
      installApprovalTitle: 'Install scripts need permission',
      installApprovalDescription: 'These packages have install scripts that pnpm did not run.',
      installApprovalConsequence: 'Once allowed, the scripts run here with your permissions, and the permission is saved in this profile.',
      installApprovalCaution: 'Allow only packages you trust.',
      installApproveAndRetry: 'Allow these scripts and retry',
      installProblemInvalid: 'This is not a package name or address that can be installed: {reason}',
      installProblemInstalled: 'This plugin is already installed. To upgrade it, uninstall it and install it again',
      installProblemShipped: 'This plugin ships with DSH; upgrading DSH updates it',
      installProblemNotFound: 'No such plugin was found',
      installProblemNotPackage: 'The path does not exist or is not a valid plugin package',
      installProblemNotBundle: 'This package declares no bundle, so it cannot be installed as a plugin: {reason}',
      installProblemNetwork: 'The plugin registry could not be reached; check the network and try again',
      installProblemUnknown: 'The plugin could not be looked up: {reason}',
      installFailurePnpmMissing: 'pnpm was not found, so nothing can be installed',
      installFailureTimeout: 'The install timed out',
      installFailureNotFound: 'No such plugin was found',
      installFailureNoMatchingVersion: 'No version matches the request',
      installFailureNetwork: 'The network connection failed',
      installFailureDiskFull: 'The disk is full; the install stopped',
      installFailurePermission: 'No write permission; the plugin cannot be installed',
      installFailureBuildBlocked: 'A dependency\'s install scripts need your permission before the install can continue',
      installFailureIntegrity: 'The downloaded package failed its integrity check',
      installFailureGeneric: 'Something went wrong during the install; the details say what',
      terminalCommandLine: 'Command line {n}',
      terminalRunning: 'Running',
      terminalFailed: 'Failed',
      terminalDone: 'Done',
      terminalCopy: 'Copy',
      terminalCopied: 'Copied',
      terminalNoOutput: 'No output',
      terminalCollapseAria: 'Collapse output',
      terminalCollapse: 'Collapse',
      terminalExpandAria: 'Expand the remaining {n} output lines',
      terminalExpand: 'Expand output',
      terminalExitCode: 'exit code {code}',
      terminalNoExitCode: 'no exit code',
      installLocation: 'Installs into {dir}',
      installBackgroundDone: 'Installation finished. View installation details.',
      installBackgroundFailed: 'Installation failed. View installation details.',
      installBackgroundUnconfirmed: 'Installation status is unconfirmed. View the installation for details.',
      installBackgroundApplying: 'Installation is being applied and cannot be cancelled. View installation progress.',
      installBackgroundUnknown: 'Installation result unavailable. Check the plugin list.',
    };

    /* ================================================================ */
    /* Pure helpers (unit-tested through the __pure export)             */
    /* ================================================================ */

    const randomUUID = () => {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      const hex = Array.from(bytes, (byte, index) =>
        (index === 6 ? (byte & 15) | 64 : index === 8 ? (byte & 63) | 128 : byte).toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };

    const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

    const compact = (value) => value.trim().replace(/\s+/g, ' ');

    const shortName = (name) => (name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name).replace(/^dsh-(?:host-|client-)?/, '');

    const freshOrganizer = () => ({
      version: ORGANIZER_VERSION,
      initialized: false,
      sort: 'custom',
      categories: [],
      placement: {},
      order: { '': [] },
      favorites: [],
      collapsed: [],
    });

    const fixedUncategorized = (t) => ({ id: UNCATEGORIZED_ID, name: t(UNCATEGORIZED_LABEL_KEY), fixed: true });

    /**
     * Migrate a stored layout to the current schema version. This is the one
     * place a future field rename or move is added; unknown/newer data is kept
     * and normalized rather than discarded.
     */
    function migrateOrganizer(input) {
      const version = Number.isInteger(input.version) ? input.version : 0;
      if (version < ORGANIZER_VERSION) {
        return { ...input, version: ORGANIZER_VERSION };
      }
      return input;
    }

    /**
     * Normalize a stored organizer document into the current shape; unknown
     * fields survive, unknown categories/entries are dropped by mergeOrganizer.
     */
    function normalizeOrganizer(input) {
      if (!isPlainObject(input)) return freshOrganizer();
      const raw = migrateOrganizer(input);
      const categories = Array.isArray(raw.categories)
        ? raw.categories
            .filter((c) => isPlainObject(c) && typeof c.id === 'string' && c.id !== '' && typeof c.name === 'string' && c.name.trim() !== '')
            .map((c) => ({ id: c.id, name: c.name }))
        : [];
      const seen = new Set();
      const deduped = categories.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
      const ids = new Set(deduped.map((c) => c.id));
      const placement = {};
      if (isPlainObject(raw.placement)) {
        for (const [pkg, cat] of Object.entries(raw.placement)) {
          if (cat === null || ids.has(cat)) placement[pkg] = cat;
        }
      }
      const order = {};
      if (isPlainObject(raw.order)) {
        const orderIds = new Set([...ids, '']);
        for (const [cat, list] of Object.entries(raw.order)) {
          if (orderIds.has(cat) && Array.isArray(list)) order[cat] = list.filter((n) => typeof n === 'string');
        }
      }
      return {
        version: ORGANIZER_VERSION,
        initialized: raw.initialized === true,
        sort: raw.sort === 'name' || raw.sort === 'status' ? raw.sort : 'custom',
        categories: deduped,
        placement,
        order,
        favorites: Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter((n) => typeof n === 'string'))] : [],
        collapsed: Array.isArray(raw.collapsed) ? [...new Set(raw.collapsed.filter((n) => typeof n === 'string' && ids.has(n)))] : [],
      };
    }

    /**
     * Reconcile the organizer with the currently installed package names:
     * drop stale references, keep every package exactly once in its category
     * order, and append newly installed packages at the end of their group.
     */
    function mergeOrganizer(org, packageNames) {
      const names = new Set(packageNames);
      const catIds = new Set(org.categories.map((c) => c.id));
      const placement = {};
      for (const [pkg, cat] of Object.entries(org.placement)) {
        if (!names.has(pkg)) continue;
        if (cat === null || catIds.has(cat)) placement[pkg] = cat;
      }
      // base order: every installed package in the category placement assigns it to
      const base = {};
      for (const name of packageNames) {
        const cat = placement[name] ?? null;
        if (placement[name] === undefined) placement[name] = null;
        const key = cat ?? '';
        (base[key] ||= []).push(name);
      }
      // reorder within each category according to the saved custom order
      const order = {};
      for (const key of [...org.categories.map((c) => c.id), '']) {
        const owned = base[key] || [];
        const saved = org.order?.[key] || [];
        const rank = new Map(saved.map((n, i) => [n, i]));
        order[key] = [...owned].sort((a, b) => {
          const ra = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
          const rb = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
          return ra - rb;
        });
      }
      const favorites = (org.favorites || []).filter((n) => names.has(n));
      const collapsed = (org.collapsed || []).filter((c) => catIds.has(c));
      return { ...org, placement, order, favorites, collapsed };
    }

    /** The names a category owns, in display order (custom mode). */
    const categoryMembers = (org, catId) => {
      const key = catId ?? '';
      return org.order?.[key] || [];
    };

    /** Move a plugin to a position inside one category; position is 'before'|'after' a reference, 'start', or 'end'. */
    function movePlugin(org, name, targetCat, position, refName) {
      const catIds = new Set(org.categories.map((c) => c.id));
      const key = targetCat === null || targetCat === undefined ? '' : targetCat;
      if (key !== '' && !catIds.has(key)) return org;
      const next = { ...org, order: {}, placement: { ...org.placement } };
      next.placement[name] = key === '' ? null : key;
      const lists = {};
      for (const [cat, list] of Object.entries(org.order)) {
        lists[cat] = (list || []).filter((n) => n !== name);
      }
      const target = [...(lists[key] || [])];
      if (position === 'start') target.unshift(name);
      else if (position === 'before' && refName !== undefined) {
        const at = target.indexOf(refName);
        target.splice(at < 0 ? target.length : at, 0, name);
      } else if (position === 'after' && refName !== undefined) {
        const at = target.indexOf(refName);
        target.splice(at < 0 ? target.length : at + 1, 0, name);
      } else target.push(name);
      lists[key] = target;
      for (const cat of new Set([...Object.keys(lists), key])) next.order[cat] = lists[cat] || [];
      return next;
    }

    /** Reorder a category by one step; negative moves it up. */
    function moveCategory(org, catId, delta) {
      const index = org.categories.findIndex((c) => c.id === catId);
      if (index < 0) return org;
      const target = index + delta;
      if (target < 0 || target >= org.categories.length) return org;
      const categories = [...org.categories];
      const [item] = categories.splice(index, 1);
      categories.splice(target, 0, item);
      return { ...org, categories };
    }

    /** Validate a category name; returns null when valid, or an error key. */
    function validateCategoryName(raw, categories, t) {
      const name = compact(raw);
      if (name === '') return 'nameEmpty';
      if (name === t(UNCATEGORIZED_LABEL_KEY)) return 'nameReserved';
      const lower = name.toLowerCase();
      if (categories.some((c) => c.name.toLowerCase() === lower)) return 'nameDuplicate';
      return null;
    }

    /** Pick a category id for a plugin from its localized text; null means uncategorized. */
    function suggestCategory(pkg, categoriesById, textOf) {
      const explicit = PACKAGE_CATEGORY[pkg.name];
      if (explicit !== undefined && categoriesById.has(explicit)) return explicit;
      const title = textOf(pkg) || '';
      const haystack = `${pkg.name} ${title} ${pkg.description || ''} ${(pkg.rows || []).map((r) => r.moduleName || '').join(' ')}`.toLowerCase();
      let best = null;
      let bestScore = 0;
      for (const rule of SUGGESTION_RULES) {
        if (!categoriesById.has(rule.id)) continue;
        let score = 0;
        for (const keyword of rule.keywords) {
          const at = haystack.indexOf(keyword);
          if (at >= 0) score += 1 + (keyword.trim().length >= 3 ? 1 : 0);
        }
        if (score > bestScore) {
          bestScore = score;
          best = rule.id;
        }
      }
      return bestScore >= 2 ? best : null;
    }

    /** Build the template categories with localized names for the active language. */
    function buildTemplateCategories(pick) {
      return TEMPLATE_CATEGORIES.map((tpl) => ({ id: tpl.id, name: pick(tpl.name) }));
    }

    /** Sort the members of one category according to the active sort mode. */
    function sortMembers(org, catId, items, resolveTitle, lang) {
      const key = catId ?? '';
      const list = org.order?.[key] || [];
      const indexOf = new Map(list.map((n, i) => [n, i]));
      const collator = new Intl.Collator(lang || 'en');
      const compareName = (a, b) => collator.compare(resolveTitle(a) || a.name, resolveTitle(b) || b.name);
      const sorted = [...items];
      if (org.sort === 'name') sorted.sort(compareName);
      else if (org.sort === 'status') {
        sorted.sort((a, b) => {
          if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
          return compareName(a, b);
        });
      } else {
        sorted.sort((a, b) => {
          const ia = indexOf.has(a.name) ? indexOf.get(a.name) : Number.MAX_SAFE_INTEGER;
          const ib = indexOf.has(b.name) ? indexOf.get(b.name) : Number.MAX_SAFE_INTEGER;
          return ia - ib;
        });
      }
      return sorted;
    }

    /** Whether a package matches the search text. */
    function matchesSearch(pkg, query, resolveTitle, resolveText) {
      if (query === '') return true;
      const title = resolveTitle(pkg);
      const desc = resolveText?.(pkg.meta?.description) ?? pkg.description ?? '';
      const author = typeof pkg.meta?.author === 'string' ? pkg.meta.author : '';
      const haystack = [title, desc, pkg.name, author, ...(pkg.rows || []).flatMap((r) => [r.rowId, r.moduleName])]
        .filter((v) => typeof v === 'string')
        .join('\n')
        .toLowerCase();
      for (const part of query.split(/\s+/)) {
        if (part !== '' && !haystack.includes(part)) return false;
      }
      return true;
    }

    /** Ordered category ids for rendering: user categories first, uncategorized fixed last. */
    const orderedCategoryIds = (org) => [...org.categories.map((c) => c.id), ''];

    /* ================================================================ */
    /* Styles                                                            */
    /* ================================================================ */

    const CSS = `
.dpo-page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:26px;padding:0 clamp(24px,4vw,48px) 48px;display:flex;overflow:auto}
.dpo-page > *{width:100%;max-width:100%;min-width:0}
.dpo-page>*{width:100%;max-width:960px}
.dpo-pageHead{box-sizing:border-box;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;padding-top:28px;display:flex}
.dpo-pageHeading{min-width:0;max-width:100%}
.dpo-pageTitle{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dpo-pageIntro{color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;margin:4px 0 0;font-size:13px;line-height:20px;display:flex}
.dpo-toolbar{white-space:nowrap;flex:none;justify-content:flex-end;align-items:center;gap:10px;display:flex}
.dpo-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1;padding:7px 11px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.dpo-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dpo-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dpo-btn:disabled{opacity:.45;cursor:default}
.dpo-btn-primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent);color:var(--dsw-alias-label-primary)}
.dpo-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,var(--dsw-alias-bg-layer-1))}
.dpo-btn-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:#fff}
.dpo-btn-danger:hover:not(:disabled){filter:brightness(1.07)}
.dpo-btn-quiet{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.dpo-btn-quiet:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dpo-icon{flex:none;width:16px;height:16px}
.dpo-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);padding:0 2px}
.dpo-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;padding:10px 12px;cursor:pointer}
.dpo-tab:hover{color:var(--dsw-alias-label-primary)}
.dpo-tab.is-active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.dpo-toolbar2{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dpo-installedHead{display:flex;align-items:baseline;gap:8px;margin:2px 0 0}
.dpo-installedTitle{margin:0;font-size:15px;font-weight:600;line-height:24px}
.dpo-installedCount{color:var(--dsw-alias-label-secondary);font-size:12px}
.dpo-addGroup{display:flex;align-items:center}
.dpo-addGroup .dpo-btn-primary:first-child{border-top-right-radius:0;border-bottom-right-radius:0}
.dpo-addToggle{padding-left:5px;padding-right:5px;border-top-left-radius:0;border-bottom-left-radius:0;border-left:1px solid rgba(255,255,255,.28)}
.dpo-addMenuRow{align-items:flex-start;white-space:normal;width:100%}
.dpo-addMenuText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dpo-addMenuDesc{font-size:11px;line-height:1.35;color:var(--dsw-alias-label-secondary)}
.dpo-search{flex:1 1 260px;min-width:180px;position:relative;display:flex;align-items:center}
.dpo-search input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1;border-radius:8px;padding:9px 30px 9px 12px}
.dpo-search input::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));opacity:.8}
.dpo-search input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dpo-search-clear{position:absolute;right:4px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px;border-radius:6px;display:flex}
.dpo-search-clear:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dpo-mark{background:transparent;color:inherit;font-weight:600;text-decoration:underline;text-decoration-color:var(--dsw-alias-brand-primary);text-underline-offset:2px}
.dpo-menu{position:fixed;z-index:70;min-width:168px;max-width:320px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 16px 44px rgba(0,0,0,.34);padding:5px;display:flex;flex-direction:column}
.dpo-menu-item{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.4;text-align:left;padding:7px 10px;border-radius:7px;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap}
.dpo-menu-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dpo-menu-item.is-active{color:var(--dsw-alias-brand-primary)}
.dpo-menu-item:disabled{opacity:.45;cursor:default}
.dpo-menu-item.is-danger{color:var(--dsw-alias-state-error-primary)}
.dpo-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1)}
.dpo-group{flex-direction:column;display:flex}
.dpo-groupHead{display:flex;align-items:center;gap:8px;margin:0 0 2px}
.dpo-groupTitle{flex:1;margin:0;font-size:14px;font-weight:500;line-height:22px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpo-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.dpo-card{border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column}
.dpo-card:first-child{border-top:0}
.dpo-cardBody{display:flex;align-items:center;gap:12px;padding:11px 14px;min-width:0}
.dpo-cardIcon{flex:none;width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.dpo-cardIcon img{width:36px;height:36px;border-radius:9px;object-fit:contain}
.dpo-cardMain{flex:1;min-width:0}
.dpo-cardTitleRow{display:flex;align-items:center;gap:8px;min-width:0}
.dpo-cardTitle{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;line-height:20px;padding:0;cursor:pointer;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.dpo-cardTitle:hover{text-decoration:underline}
.dpo-cardDesc{margin-top:1px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
.dpo-cardEnd{flex:none;display:flex;align-items:center;gap:6px}
.dpo-tag{font-size:11px;line-height:1;padding:3px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dpo-tag.is-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 44%,transparent)}
.dpo-tag.is-info{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent)}
.dpo-installed{display:flex;flex-direction:column;gap:14px}
.dpo-banner{border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dpo-banner-text{flex:1;min-width:220px;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.dpo-banner-actions{display:flex;gap:8px;flex-wrap:wrap}
.dpo-banner-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.dpo-undo{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:6px 10px;font-size:12.5px}
.dpo-undo-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpo-layoutTools{display:flex;flex-wrap:wrap;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.dpo-cat{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:visible;display:flex;flex-direction:column}
.dpo-catHead{display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:12px}
.dpo-catHead.is-dragging{opacity:.5}
.dpo-catHead.dpo-drop-target{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-2px}
.dpo-grip{flex:none;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:grab;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;opacity:.7}
.dpo-grip:hover,.dpo-grip:focus-visible{opacity:1;background:var(--dsw-alias-bg-layer-2);outline:none}
.dpo-grip:active{cursor:grabbing}
.dpo-grip.is-dim{opacity:.4}
.dpo-catToggle{flex:none;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px;border-radius:6px;display:flex}
.dpo-catToggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dpo-catName{margin:0;font-size:13.5px;font-weight:550;line-height:20px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpo-catCount{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px}
.dpo-catSpacer{flex:1}
.dpo-catMenu{flex:none;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px 5px;border-radius:6px;display:flex}
.dpo-catMenu:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dpo-catBody{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.dpo-catBody.dpo-drop-target{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-4px;border-radius:0 0 12px 12px}
.dpo-catEmpty{margin:0;padding:10px 14px 14px 40px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:12px}
.dpo-row{position:relative;border-top:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:8px;padding:7px 10px 7px 6px;min-width:0}
.dpo-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dpo-row.is-dragging{opacity:.45}
.dpo-row.dpo-drop-before::before{content:'';position:absolute;left:6px;right:6px;top:-1px;height:2px;background:var(--dsw-alias-brand-primary);border-radius:1px}
.dpo-row.dpo-drop-after::after{content:'';position:absolute;left:6px;right:6px;bottom:-1px;height:2px;background:var(--dsw-alias-brand-primary);border-radius:1px}
.dpo-rowMain{flex:1;min-width:0;display:flex;align-items:center;gap:10px}
.dpo-rowInfo{flex:1;min-width:0}
.dpo-rowName{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;line-height:18px}
.dpo-rowNameText{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:0;cursor:pointer;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.dpo-rowNameText:hover{text-decoration:underline}
.dpo-rowDesc{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:16px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
.dpo-rowMeta{flex:none;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11.5px;white-space:nowrap}
.dpo-star{flex:none;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;padding:4px;border-radius:6px;display:flex}
.dpo-star:hover{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-2)}
.dpo-star.is-on{color:var(--dsw-alias-state-warn-primary)}
.dpo-rowMore{flex:none;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px 5px;border-radius:6px;display:flex}
.dpo-rowMore:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dpo-switch{appearance:none;border:0;background:var(--dsw-alias-state-idle-primary);width:32px;height:18px;border-radius:999px;cursor:pointer;padding:0;position:relative;flex:none;transition:background .14s ease}
.dpo-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:999px;background:#fff;transition:left .14s ease;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.dpo-switch.is-on{background:var(--dsw-alias-brand-primary)}
.dpo-switch.is-on::after{left:16px}
.dpo-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dpo-switch:disabled{opacity:.45;cursor:default}
.dpo-empty{border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;padding:28px 18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7}
.dpo-empty strong{display:block;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:550;margin-bottom:4px}
.dpo-status{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:0;font-size:13px;line-height:20px;display:flex;align-items:center;gap:8px}
.dpo-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex;font-size:13px}
.dpo-dot{width:8px;height:8px;border-radius:999px;flex:none;display:inline-block}
.dpo-dot.idle{background:var(--dsw-alias-state-idle-primary)}
.dpo-dot.ongoing{background:var(--dsw-alias-state-warn-primary)}
.dpo-dot.done{background:var(--dsw-alias-state-success-primary)}
.dpo-dot.error{background:var(--dsw-alias-state-error-primary)}
.dpo-scrim{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px}
.dpo-dialog{width:min(560px,100%);max-height:min(640px,88vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.38);overflow:hidden}
.dpo-dialog.wide{width:min(680px,100%)}
.dpo-dialogHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 0}
.dpo-dialogTitle{margin:0;font-size:15px;font-weight:600;line-height:1.4;min-width:0}
.dpo-dialogClose{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px;border-radius:6px;display:flex;flex:none}
.dpo-dialogClose:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dpo-dialogBody{padding:12px 18px;display:flex;flex-direction:column;gap:12px;overflow:auto;font-size:12.5px;line-height:1.6}
.dpo-dialogFoot{display:flex;justify-content:flex-end;gap:8px;padding:0 18px 16px;flex-wrap:wrap}
.dpo-field{display:flex;flex-direction:column;gap:5px}
.dpo-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dpo-field input[type=text],.dpo-field input[type=search]{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;border-radius:8px;padding:8px 10px}
.dpo-field input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dpo-fieldError{color:var(--dsw-alias-state-error-primary);font-size:11.5px;margin:0}
.dpo-hint{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11.5px;line-height:1.5;margin:0}
.dpo-select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;border-radius:8px;padding:7px 8px}
.dpo-terminal{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow:auto;margin:0}
.dpo-terminalHead{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.dpo-catRow{display:flex;align-items:center;gap:8px;padding:8px 6px;border-radius:8px}
.dpo-catRow:hover{background:var(--dsw-alias-bg-layer-2)}
.dpo-catRow.is-dragging{opacity:.45}
.dpo-catRow.dpo-drop-target{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-2px}
.dpo-catRowName{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpo-catRowInput{flex:1;min-width:0}
.dpo-catRowInput input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;border-radius:7px;padding:5px 8px}
.dpo-catList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.dpo-catList>li{border-top:1px solid var(--dsw-alias-border-l1)}
.dpo-catList>li:first-child{border-top:0}
.dpo-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:100;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 16px 44px rgba(0,0,0,.34);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.5;padding:9px 14px;max-width:min(560px,calc(100vw - 48px));display:flex;align-items:center;gap:8px}
.dpo-toast.is-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,transparent)}
.dpo-detail{display:flex;flex-direction:column;gap:16px}
.dpo-crumbRow{display:flex;align-items:center;gap:8px}
.dpo-crumb{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:4px 6px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px}
.dpo-crumb:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dpo-detailHead{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dpo-detailMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dpo-detailTitle{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;font-size:16px;font-weight:600;line-height:24px;min-width:0}
.dpo-detailName{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpo-detailName code{font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:11.5px}
.dpo-detailDesc{margin:2px 0 0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dpo-detailActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
.dpo-section{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.dpo-sectionHead{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
.dpo-sectionTitle{margin:0;font-size:13px;font-weight:550}
.dpo-sectionCount{color:var(--dsw-alias-label-secondary);font-size:12px}
.dpo-facts{display:flex;flex-direction:column;gap:6px;margin:0}
.dpo-facts>div{display:flex;gap:12px;align-items:baseline}
.dpo-facts dt{flex:none;width:86px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dpo-facts dd{margin:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis}
.dpo-facts code{font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:11.5px}
.dpo-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.dpo-rows>li{display:flex;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--dsw-alias-border-l1)}
.dpo-rows>li:first-child{border-top:0}
.dpo-rowCfg{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:4px;max-width:100%}
.dpo-rowCfg:hover{color:var(--dsw-alias-brand-primary)}
.dpo-rowSub{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.dpo-reason{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0;line-height:1.6}
.dpo-skeleton{display:flex;flex-direction:column;gap:10px;padding:6px 2px}
.dpo-fatal{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px;overflow:auto;max-height:60vh}
.dpo-skeleton-bar{height:12px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);animation:dpo-pulse 1.2s ease-in-out infinite}
@keyframes dpo-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (max-width:820px){
  .dpo-toolbar2{width:100%;max-width:100%}
  .dpo-search{flex:1 1 100%;min-width:0}
  .dpo-installedHead{flex-wrap:wrap}
  .dpo-toolbar2 .dpo-btn{flex:0 0 auto}
}
@media (max-width:720px){
  .dpo-toolbar2{gap:6px}
  .dpo-rowMeta{display:none}
  .dpo-cardBody{flex-wrap:wrap}
  .dpo-page{padding-left:16px;padding-right:16px;gap:20px}
}
`;

    /* ================================================================ */
    /* Tiny UI atoms                                                     */
    /* ================================================================ */

    const ICONS = {
      refresh: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })),
      plus: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' })),
      search: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: '7', cy: '7', r: '4.2', stroke: 'currentColor', strokeWidth: '1.5' }),
        h('path', { d: 'm10.2 10.2 3.3 3.3', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' })),
      close: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'm4 4 8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' })),
      chevronDown: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })),
      chevronRight: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'm6 4 4 4-4 4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })),
      chevronLeft: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M10 4 6 8l4 4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })),
      more: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
        h('circle', { cx: '3', cy: '8', r: '1.3' }), h('circle', { cx: '8', cy: '8', r: '1.3' }), h('circle', { cx: '13', cy: '8', r: '1.3' })),
      grip: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
        h('circle', { cx: '5.4', cy: '4', r: '1.15' }), h('circle', { cx: '10.6', cy: '4', r: '1.15' }),
        h('circle', { cx: '5.4', cy: '8', r: '1.15' }), h('circle', { cx: '10.6', cy: '8', r: '1.15' }),
        h('circle', { cx: '5.4', cy: '12', r: '1.15' }), h('circle', { cx: '10.6', cy: '12', r: '1.15' })),
      trash: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3.5 5h9M6.5 3h3M5 5l.6 7.5a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 5', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' })),
      star: (filled) => h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: filled ? 'currentColor' : 'none', 'aria-hidden': 'true' },
        h('path', { d: 'm8 2.5 1.8 3.7 4.1.6-3 2.9.7 4.1L8 12l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 2.5Z', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' })),
      edit: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'm4.2 12.2-1 .4.4-1 6.6-6.6.6.6-6.6 6.6ZM10.4 3.5l.5-.5a1.2 1.2 0 0 1 1.7 0l.4.4a1.2 1.2 0 0 1 0 1.7l-.5.5-2.1-2.1Z', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' })),
      folder: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M2.5 4.5A1.5 1.5 0 0 1 4 3h2.2l1.4 1.5H12A1.5 1.5 0 0 1 13.5 6v5A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11v-6.5Z', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' })),
      puzzle: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M5 2.5h6a1 1 0 0 1 1 1v2.4a1.6 1.6 0 0 0 0 4.2V12.5a1 1 0 0 1-1 1H8.6a1.6 1.6 0 0 0-4.2 0H3.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1.6a1.6 1.6 0 0 0 4.2 0Z', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' })),
      warn: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 2.5 14.5 13H1.5L8 2.5Z', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }),
        h('path', { d: 'M8 6.5v3.2', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
        h('circle', { cx: '8', cy: '11.6', r: '.6', fill: 'currentColor' })),
      info: h('svg', { className: 'dpo-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: '8', cy: '8', r: '6', stroke: 'currentColor', strokeWidth: '1.3' }),
        h('path', { d: 'M8 7.2v3.6', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
        h('circle', { cx: '8', cy: '5.4', r: '.6', fill: 'currentColor' })),
    };

    function Switch({ checked, label, disabled, title, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        className: `dpo-switch${checked ? ' is-on' : ''}`,
        disabled,
        title: title ?? label,
        onClick: (event) => {
          event.stopPropagation();
          if (!disabled && typeof onChange === 'function') onChange(!checked);
        },
      });
    }

    /** A small popover menu anchored to a button. */
    function useMenu() {
      const [open, setOpen] = useState(null);
      const close = useCallback(() => setOpen(null), []);
      useEffect(() => {
        if (open === null) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') close();
        };
        const onDown = (event) => {
          // Capture-phase listener: a click on a menu item is inside the
          // popover, so ignore it and let the item's onClick run.
          const target = event.target;
          if (target !== null && typeof target.closest === 'function' && target.closest('.dpo-menu') !== null) return;
          close();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown, true);
        return () => {
          document.removeEventListener('keydown', onKey);
          document.removeEventListener('mousedown', onDown, true);
        };
      }, [open, close]);
      const anchor = useCallback((button, makeState) => (event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = button.getBoundingClientRect();
        const menuWidth = 220;
        let x = Math.min(rect.left, window.innerWidth - menuWidth - 12);
        x = Math.max(8, x);
        let y = rect.bottom + 4;
        if (y + 300 > window.innerHeight) y = Math.max(8, rect.top - 6);
        setOpen({ x, y, ...makeState() });
      }, []);
      const MenuView = () => {
        if (open === null) return null;
        return h('div', {
          className: 'dpo-menu',
          role: 'menu',
          style: { left: open.x, top: open.y },
          onMouseDown: (event) => event.stopPropagation(),
        },
          typeof open.content === 'function' ? open.content() : (open.items || []).map((item, index) => {
            if (item === 'sep') return h('div', { className: 'dpo-menu-sep', key: 'sep-' + index });
            return h('button', {
              type: 'button',
              role: 'menuitem',
              className: `dpo-menu-item${item.active ? ' is-active' : ''}${item.danger ? ' is-danger' : ''}`,
              disabled: item.disabled,
              key: item.id,
              onClick: (event) => {
                event.stopPropagation();
                close();
                open.onSelect(item.id, item);
              },
            }, item.icon ?? null, item.label);
          }));
      };
      return { MenuView, anchor, close };
    }

    function Modal({ title, onClose, closeLabel, children, footer, wide }) {
      const closeRef = useRef(null);
      useEffect(() => {
        const node = closeRef.current;
        if (node && node.focus) node.focus();
        if (typeof onClose !== 'function') return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h('div', {
        className: 'dpo-scrim',
        role: 'presentation',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && typeof onClose === 'function') onClose();
        },
      },
        h('div', { className: `dpo-dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'dpo-dialogHead' },
            h('h2', { className: 'dpo-dialogTitle' }, title),
            typeof onClose === 'function'
              ? h('button', { type: 'button', className: 'dpo-dialogClose', ref: closeRef, 'aria-label': closeLabel ?? 'Close', onClick: onClose }, ICONS.close)
              : null),
          h('div', { className: 'dpo-dialogBody' }, children),
          footer ? h('div', { className: 'dpo-dialogFoot' }, footer) : null));
    }

    /* ================================================================ */
    /* Store                                                             */
    /* ================================================================ */

    const IDLE_INSTALL = {
      open: false,
      spec: '',
      registries: null,
      registry: { kind: 'offered', registry: null },
      phase: 'idle',
      inputError: null,
      subject: null,
      runs: [],
      detailsOpen: false,
      installed: null,
      installedVersion: null,
      restartRequired: false,
      restartReason: undefined,
      failure: null,
      pendingBuilds: [],
      requestId: undefined,
      enabling: false,
    };

    function createStore(initial) {
      let current = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => current,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        set: (next) => {
          current = next;
          for (const fn of [...listeners]) fn();
        },
        mutate: (fn) => {
          const next = fn(current);
          if (next !== current) {
            current = next;
            for (const fn of [...listeners]) fn();
          }
        },
      };
    }

    const appStore = createStore({
      status: 'idle',
      refreshStatus: 'idle',
      packages: [],
      busy: [],
      notice: null,
      undo: null,
      persistError: null,
      highlight: null,
      install: IDLE_INSTALL,
      confirm: null,
      suggestion: null,
      activation: null,
      view: { kind: 'list' },
      tab: INSTALLED_TAB,
      organizer: freshOrganizer(),
      organizerStatus: 'idle',
      organizerRevision: null,
      writable: true,
      hasCachedInventory: false,
      search: '',
      categoryFilter: 'all',
      statusFilter: 'all',
    });

    const getSnapshot = () => appStore.getSnapshot();

    const patch = (partial) => appStore.mutate((s) => ({ ...s, ...partial }));

    const useApp = () => useSyncExternalStore(appStore.subscribe, appStore.getSnapshot);

    /* ================================================================ */
    /* Controller                                                        */
    /* ================================================================ */

    let currentCtx = null;
    let inFlight = undefined;
    let rerun = false;
    let generation = 0;
    let disposed = false;
    let persistTimer = null;
    let persistRetry = 0;
    let persisting = false;
    let persistPending = false;
    let lastPersistedOrganizer = null;
    let noticeSeq = 0;
    let undoTimer = null;
    let autoCategorizeTried = false;
    let installAbort = null;
    let installRequest = null;
    let preInstallNames = new Set();
    /** Re-registers the main panel; set inside the main slot injection. */
    let reassertMain = null;
    /** One re-assert per page life, anchored to the first connection reset. */
    let reasserted = false;

    /**
     * Timer seat: prefer the injected timer service (sanctioned for client
     * modules; returns a disposer), fall back to the browser globals.
     */
    const safeTimeout = (callback, ms) => {
      try {
        if (currentCtx && typeof currentCtx.timeout === 'function') return currentCtx.timeout(callback, ms);
      } catch (ignored) { /* fall through */ }
      const handle = setTimeout(callback, ms);
      return () => clearTimeout(handle);
    };

    const safeDelay = async (ms) => {
      try {
        if (currentCtx && typeof currentCtx.timeout === 'function') {
          await currentCtx.timeout(ms);
          return;
        }
      } catch (ignored) { /* fall through */ }
      await new Promise((resolve) => setTimeout(resolve, ms));
    };

    const remoteOf = () => (currentCtx ? currentCtx.remote : null);

    /** Bound a Remote call so a disconnected browser peer surfaces as an error, not a blank page. */
    const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('remote timeout')), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });

    const t = (key, params) => {
      const locale = currentCtx?.locale;
      try {
        if (locale && typeof locale.bind === 'function') return locale.bind(NS)(key, params);
      } catch (ignored) { /* fall through */ }
      const dict = (currentCtx?.locale?.getSnapshot?.()?.active ?? 'zh').startsWith('en') ? EN : ZH;
      return dict[key] ?? ZH[key] ?? key;
    };

    const reasonOf = (error) => (error instanceof Error ? error.message : String(error));

    const CODE_KEYS = {
      'management-required': 'reasonManagementRequired',
      unaddressable: 'reasonUnaddressable',
      'unknown-plugin': 'reasonUnknownPlugin',
      'not-removable': 'reasonNotRemovable',
      'stop-profile': 'reasonStopProfile',
      'bundle-in-use': 'reasonBundleInUse',
    };

    function managementText(error) {
      if (error && error.code === 'operation-error') return error.diagnostic || t('reasonOperationError');
      const key = CODE_KEYS[error?.code];
      return key === undefined ? (error?.diagnostic || error?.reason || t('reasonOperationError')) : t(key);
    }

    const FAILED_KEYS = {
      enable: 'failedEnable',
      disable: 'failedDisable',
      uninstall: 'failedUninstall',
      rowEnable: 'failedRowEnable',
      rowDisable: 'failedRowDisable',
    };

    const RESTART_REASON_KEYS = {
      'no-hmr': 'restartReasonNoHmr',
      'package-moved': 'restartReasonPackageMoved',
      'host-module': 'restartReasonHostModule',
      'unmanaged-plugin': 'restartReasonUnmanagedPlugin',
      'module-comparison': 'restartReasonModuleComparison',
    };

    function restartText(reason) {
      return t('restartNotice', { reason: reason === undefined ? '' : t(RESTART_REASON_KEYS[reason] ?? 'restartReasonNoHmr') }).trimEnd();
    }

    function noticeLine(notice) {
      switch (notice.kind) {
        case 'restart': return restartText(notice.reason);
        case 'overridden': return t('overriddenNotice', { name: notice.name });
        case 'cancelled': return t('installCancelled');
        case 'refresh-failed': return t('refreshError');
        case 'persist-failed': return t('persistFailed', { reason: notice.reason });
        case 'settings-load-failed': return t('settingsLoadFailed', { reason: notice.reason });
        case 'settings-readonly': return t('settingsReadonly');
        case 'sort-switched': return t('sortSwitchedToast');
        case 'template-applied': return t('templateAppliedToast');
        case 'install': return t({
          done: 'installBackgroundDone',
          failed: 'installBackgroundFailed',
          unconfirmed: 'installBackgroundUnconfirmed',
          applying: 'installBackgroundApplying',
          unknown: 'installBackgroundUnknown',
        }[notice.outcome]);
        case 'failed': {
          const reason = notice.code === undefined ? notice.reason : managementText({ code: notice.code, diagnostic: notice.reason });
          return t(FAILED_KEYS[notice.action], { reason: reason === '' ? t('reasonOperationError') : reason });
        }
        default: return notice.reason ?? '';
      }
    }

    function toastHoldMs(text) {
      return Math.min(8000, Math.max(3000, (text || '').length * 80));
    }

    function packageText(pkg, resolveText) {
      const text = (value) => (value === undefined ? undefined : resolveText(value) || undefined);
      return {
        title: pkg.meta?.title === undefined ? pkg.name : text(pkg.meta.title) ?? pkg.name,
        description: pkg.meta?.description === undefined ? undefined : text(pkg.meta.description),
        beta: pkg.name.startsWith('@deepseek-ai/dsh-experimental-'),
      };
    }

    /** Split text around case-insensitive occurrences of the search query for <mark>. */
    function highlightText(text, query) {
      const source = String(text ?? '');
      const needle = String(query ?? '').trim();
      if (needle === '') return source;
      const lower = source.toLowerCase();
      const target = needle.toLowerCase();
      const parts = [];
      let cursor = 0;
      let found = lower.indexOf(target, cursor);
      while (found >= 0) {
        if (found > cursor) parts.push(source.slice(cursor, found));
        parts.push(h('mark', { className: 'dpo-mark', key: `m-${found}` }, source.slice(found, found + target.length)));
        cursor = found + target.length;
        found = lower.indexOf(target, cursor);
      }
      if (cursor < source.length) parts.push(source.slice(cursor));
      return parts;
    }

    function rowText(row, resolveText) {
      const text = (value) => (value === undefined ? undefined : resolveText(value) || undefined);
      return {
        title: row.meta?.title === undefined ? row.moduleName : text(row.meta.title) ?? row.moduleName,
        description: row.meta?.description === undefined ? undefined : text(row.meta.description),
      };
    }

    function packageView(bundle, plugins) {
      const rows = bundle.rows.map((row) => {
        const live = row.entryId === undefined ? undefined : plugins.find((plugin) => plugin.entryId === row.entryId);
        return {
          rowId: row.rowId,
          moduleName: row.moduleName,
          enabled: live?.enabled ?? false,
          phase: live?.fiberPhase ?? null,
          ...(row.meta === undefined ? {} : { meta: row.meta }),
          ...(row.entryId === undefined ? {} : { entryId: row.entryId }),
          ...(live?.readOnlyReason === undefined ? {} : { readOnlyReason: live.readOnlyReason }),
        };
      });
      return {
        name: bundle.name,
        official: bundle.official,
        availability: bundle.availability,
        ...(bundle.installTarget === undefined ? {} : { installTarget: bundle.installTarget }),
        installed: bundle.installed,
        optional: bundle.optional,
        removable: bundle.removable,
        enabled: bundle.enabled,
        rows,
        ...(bundle.version === undefined ? {} : { version: bundle.version }),
        ...(bundle.source === undefined ? {} : { source: bundle.source }),
        ...(bundle.description === undefined ? {} : { description: bundle.description }),
        ...(bundle.meta === undefined ? {} : { meta: bundle.meta }),
        ...(bundle.readOnlyReason === undefined ? {} : { readOnlyReason: bundle.readOnlyReason }),
        ...(bundle.error === undefined ? {} : { error: bundle.error }),
      };
    }

    const sortPackages = (packages) => [...packages].sort((a, b) => shortName(a.name).localeCompare(shortName(b.name)));

    function pinnedToMainList(pkg) {
      return !MORE_BUNDLES.includes(pkg.name) || pkg.enabled;
    }

    function optionalBundleRank(name) {
      const alwaysHeld = EXTENSION_BUNDLES.indexOf(name);
      if (alwaysHeld >= 0) return alwaysHeld;
      const heldBack = MORE_BUNDLES.indexOf(name);
      return heldBack < 0 ? EXTENSION_BUNDLES.length : EXTENSION_BUNDLES.length + 1 + heldBack;
    }

    const orderOptionalBundles = (packages) => [...packages].sort((a, b) => optionalBundleRank(a.name) - optionalBundleRank(b.name));

    function updateAvailable(pkg) {
      const target = pkg.installTarget;
      if (!pkg.installed || !pkg.removable || pkg.availability === 'installation' || target === undefined) return false;
      return pkg.version !== target.version || ((target.spec.startsWith('link:') || pkg.source?.startsWith('link:') === true) && pkg.source !== target.spec);
    }

    const rowKey = (entryId) => `row:${entryId}`;

    const isInstallPending = (phase) =>
      phase === 'starting' || phase === 'running' || phase === 'cancelling' || phase === 'applying' || phase === 'unconfirmed';

    function registryHost(url) {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    }

    /* ---- organizer persistence -------------------------------------- */

    function currentMineNames() {
      return getSnapshot().packages
        .filter((pkg) => !BUILTIN_PROFILE_BUNDLES.has(pkg.name) && (pkg.installed || pkg.official || pkg.error !== undefined))
        .filter((pkg) => !pkg.official)
        .map((pkg) => pkg.name);
    }

    /** Merge the organizer with the installed set; persists when the merge changed stored data. */
    function reconcileOrganizer() {
      const s = getSnapshot();
      if (s.organizerStatus !== 'ready') return;
      const names = currentMineNames();
      const next = mergeOrganizer(s.organizer, names);
      const changed = JSON.stringify(next) !== JSON.stringify(s.organizer);
      if (changed) {
        patch({ organizer: next });
        schedulePersist();
      }
      // One-time repair for layouts created before the template bug was fixed:
      // categories exist, but every installed plugin is still uncategorized.
      // Only acts when nothing at all has been categorized, so user choices
      // are never overwritten.
      if (!autoCategorizeTried && next.categories.length > 0 && names.length > 0
        && names.every((name) => next.placement[name] === null)) {
        autoCategorizeTried = true;
        safeTimeout(() => organizerActions.categorizeUncategorized(), 0);
      }
    }

    async function loadOrganizer() {
      if (persisting) {
        persistPending = true;
        return;
      }
      const rpc = remoteOf();
      if (rpc?.settings?.describe === undefined) {
        patch({ organizerStatus: 'error', writable: false });
        return;
      }
      let answer;
      try {
        answer = await rpc.settings.describe();
      } catch (error) {
        patch({ organizerStatus: 'error' });
        return;
      }
      if (!answer?.ok) {
        patch({ organizerStatus: 'error' });
        return;
      }
      const view = answer.value?.namespaces?.find((row) => row.ns === SETTINGS_NS);
      const stored = view?.value?.organizer;
      const organizer = isPlainObject(stored) ? normalizeOrganizer(stored) : freshOrganizer();
      lastPersistedOrganizer = JSON.stringify(organizer);
      patch({
        organizer,
        organizerStatus: 'ready',
        organizerRevision: view?.revision ?? null,
        writable: answer.value?.writable !== false,
        ...(answer.value?.writable === false && getSnapshot().writable
          ? { notice: { kind: 'settings-readonly', seq: ++noticeSeq } }
          : {}),
      });
      reconcileOrganizer();
    }

    function schedulePersist() {
      if (persistTimer !== null) return;
      persistTimer = safeTimeout(() => {
        persistTimer = null;
        persistNow();
      }, PERSIST_DEBOUNCE_MS);
    }

    async function persistNow() {
      const rpc = remoteOf();
      const s = getSnapshot();
      if (rpc?.settings?.replace === undefined || s.organizerStatus !== 'ready' || s.writable === false) return;
      const serialized = JSON.stringify(s.organizer);
      if (serialized === lastPersistedOrganizer) return;
      persisting = true;
      try {
        const answer = await rpc.settings.replace(SETTINGS_NS, { organizer: s.organizer }, s.organizerRevision ?? undefined);
        if (!answer?.ok) {
          const message = answer?.error?.message ?? reasonOf(answer);
          if (answer?.error?.code === 'SETTINGS_CONFLICT' || /revision/i.test(message)) {
            if (persistRetry < 2) {
              persistRetry += 1;
              persisting = false;
              await loadOrganizer();
              persistPending = false;
              persistNow();
              return;
            }
          }
          patch({ persistError: { reason: message, seq: ++noticeSeq } });
          return;
        }
        persistRetry = 0;
        lastPersistedOrganizer = serialized;
        patch({ persistError: null });
        const nextRevision = answer.value?.revision;
        if (typeof nextRevision === 'number') patch({ organizerRevision: nextRevision });
        else persistPending = true;
      } catch (error) {
        patch({ persistError: { reason: reasonOf(error), seq: ++noticeSeq } });
      } finally {
        persisting = false;
        if (persistPending) {
          persistPending = false;
          loadOrganizer();
        }
      }
    }

    /** Drop the pending undo offer and its timer. */
    function clearUndo() {
      if (undoTimer !== null) {
        try { undoTimer(); } catch (ignored) { /* timer already fired */ }
        undoTimer = null;
      }
      if (getSnapshot().undo !== null) patch({ undo: null });
    }

    /** Offer a 10-second undo for a destructive organizer change. */
    function offerUndo(previous, message) {
      clearUndo();
      patch({ undo: { organizer: previous, message, seq: ++noticeSeq } });
      undoTimer = safeTimeout(() => {
        undoTimer = null;
        patch({ undo: null });
      }, 10000);
    }

    function undoLast() {
      const pending = getSnapshot().undo;
      if (pending === null) return;
      clearUndo();
      patch({ organizer: pending.organizer });
      schedulePersist();
    }

    function updateOrganizer(next, undoMessage) {
      const previous = getSnapshot().organizer;
      if (JSON.stringify(previous) === JSON.stringify(next)) return;
      patch({ organizer: next });
      if (typeof undoMessage === 'string' && undoMessage !== '') offerUndo(previous, undoMessage);
      else clearUndo();
      schedulePersist();
    }

    /* ---- inventory ---------------------------------------------------- */

    async function load() {
      if (disposed) return Promise.resolve();
      if (inFlight !== undefined) {
        rerun = true;
        return inFlight;
      }
      const run = Promise.resolve().then(() => read());
      inFlight = run;
      return run;
    }

    async function read() {
      try {
        do {
          rerun = false;
          const gen = ++generation;
          if (getSnapshot().status === 'idle') patch({ status: 'loading' });
          const rpc = remoteOf();
          const inventory = await withTimeout(rpc.pluginInventory.list(), 8000);
          if (gen !== generation) return;
          if (!inventory.ok) {
            patch({ status: 'error' });
            continue;
          }
          if (inventory.value.managementAvailable !== true) {
            patch({ status: 'unavailable', packages: [] });
            continue;
          }
          const [bundles, plugins] = await withTimeout(Promise.all([rpc.pluginManager.listBundles(), rpc.pluginManager.listPlugins()]), 12000);
          if (gen !== generation) return;
          if (!bundles.ok || !plugins.ok) {
            patch({ status: 'error' });
            continue;
          }
          patch({
            status: 'ready',
            refreshStatus: getSnapshot().refreshStatus === 'refreshing' ? 'refreshing' : 'idle',
            hasCachedInventory: true,
            packages: sortPackages(bundles.value.map((bundle) => packageView(bundle, plugins.value))),
          });
          reconcileOrganizer();
        } while (rerun);
      } catch (error) {
        patch({ status: 'error', refreshStatus: 'idle' });
      } finally {
        inFlight = undefined;
      }
    }

    async function refresh() {
      if (disposed || getSnapshot().refreshStatus === 'refreshing') return;
      const startedAt = Date.now();
      patch({ refreshStatus: 'refreshing', ...(getSnapshot().notice?.kind === 'refresh-failed' ? { notice: null } : {}) });
      try {
        await load();
      } catch (ignored) {
        patch({ status: 'error' });
      } finally {
        const remaining = REFRESH_SPINNER_MIN_MS - (Date.now() - startedAt);
        if (remaining > 0) await safeDelay(remaining);
        if (disposed) return;
        const failed = getSnapshot().status === 'error';
        patch(failed && getSnapshot().hasCachedInventory
          ? { status: 'ready', refreshStatus: 'idle', notice: { kind: 'refresh-failed', seq: ++noticeSeq } }
          : { refreshStatus: failed ? 'failed' : 'idle' });
      }
    }

    function ensure() {
      if (getSnapshot().status === 'idle') load();
      if (getSnapshot().organizerStatus === 'idle') loadOrganizer();
    }

    /* ---- enable / disable / uninstall -------------------------------- */

    function applied(answer, name, action) {
      if (!answer.ok) throw new Error(answer.error?.message ?? t('reasonOperationError'));
      const result = answer.value;
      switch (result.application) {
        case 'failed':
          throw Object.assign(new Error(result.error?.diagnostic ?? ''), { code: result.error?.code });
        case 'cancelled':
          patch({ notice: { kind: 'cancelled', seq: ++noticeSeq } });
          return;
        case 'restart-required':
          patch({ notice: { kind: 'restart', name, reason: result.restartReason, seq: ++noticeSeq } });
          return;
        case 'overridden':
          patch({ notice: { kind: 'overridden', name, seq: ++noticeSeq } });
          return;
        case 'applied':
          return;
        default:
          return;
      }
    }

    async function run(key, subject, action) {
      if (disposed || getSnapshot().busy.includes(key)) return;
      patch({ busy: [...getSnapshot().busy, key], notice: null });
      try {
        await action();
      } catch (error) {
        patch({ notice: { kind: 'failed', reason: reasonOf(error), code: error?.code, ...subject, seq: ++noticeSeq } });
      } finally {
        patch({ busy: getSnapshot().busy.filter((entry) => entry !== key) });
      }
      await load();
    }

    function setEnabled(name, enabled) {
      const pkg = getSnapshot().packages.find((entry) => entry.name === name);
      if (enabled && pkg?.availability === 'missing' && pkg.installTarget !== undefined) {
        openCatalogInstall(pkg, pkg.installTarget, true);
        return;
      }
      return run(name, { action: enabled ? 'enable' : 'disable', name }, async () => {
        const result = await remoteOf().pluginManager.setBundleEnabled(name, enabled);
        applied(result, name, enabled ? 'enable' : 'disable');
      });
    }

    function setRowEnabled(entryId, enabled) {
      return run(rowKey(entryId), { action: enabled ? 'rowEnable' : 'rowDisable', name: entryId }, async () => {
        const result = await remoteOf().pluginManager.setPluginEnabled(entryId, enabled);
        applied(result, entryId, enabled ? 'rowEnable' : 'rowDisable');
      });
    }

    function uninstall(name) {
      patch({ confirm: { action: 'uninstall', name } });
    }

    async function confirmPending() {
      const pending = getSnapshot().confirm;
      patch({ confirm: null });
      if (pending === null) return;
      await run(pending.name, { action: 'uninstall', name: pending.name }, async () => {
        applied(await remoteOf().pluginManager.removeBundle(pending.name), pending.name, 'uninstall');
      });
    }

    function cancelConfirm() {
      patch({ confirm: null });
    }

    function update(name) {
      const pkg = getSnapshot().packages.find((entry) => entry.name === name);
      const target = pkg?.installTarget;
      if (pkg === undefined || target === undefined || pkg.availability === 'installation') return;
      if (!pkg.installed) {
        openCatalogInstall(pkg, target, pkg.enabled);
        return;
      }
      run(name, { action: 'uninstall', name }, async () => {
        const removed = await remoteOf().pluginManager.removeBundle(name);
        try {
          applied(removed, name, 'uninstall');
        } catch (ignored) {
          /* the swap below still offers the install flow */
        }
        openCatalogInstall(pkg, target, pkg.enabled);
      });
    }

    /* ---- install flow -------------------------------------------------- */

    function setInstall(partial) {
      patch({ install: { ...getSnapshot().install, ...partial } });
    }

    function openInstall() {
      setInstall({ open: true });
    }

    function installFrom({ spec, registry, title, version }) {
      openInstallDialog();
      setInstall({
        spec: spec ?? '',
        confirmed: { title, version },
        ...(registry === undefined ? {} : { registry: { kind: 'custom', url: registry } }),
      });
      runInstall();
    }

    function openInstallDialog() {
      const started = getSnapshot().install.requestId === undefined;
      if (started) setInstall({ ...IDLE_INSTALL, open: true });
      else setInstall({ open: true });
      if (started) readRegistries();
      return started;
    }

    function closeInstall() {
      const install = getSnapshot().install;
      if (isInstallPending(install.phase)) {
        setInstall({ open: false });
        cancelInstall();
        return;
      }
      installAbort?.abort();
      installAbort = null;
      patch({ install: IDLE_INSTALL });
    }

    async function readRegistries() {
      const rpc = remoteOf();
      try {
        const answer = await rpc.pluginManager.registries();
        if (!answer.ok) return;
        setInstall({ registries: answer.value });
      } catch (ignored) { /* keep defaults */ }
    }

    function editInstallSpec(spec) {
      setInstall({ spec, inputError: null });
    }

    function chooseRegistry(kind, url) {
      setInstall({ registry: { kind, ...(url === undefined ? {} : { url }) }, inputError: null });
    }

    async function runInstall() {
      const state = getSnapshot();
      const install = state.install;
      const spec = install.spec.trim();
      if (install.phase === 'checking' || isInstallPending(install.phase) || spec === '') return;
      const listed = state.packages.find((pkg) => pkg.name === spec);
      if (listed !== undefined && listed.availability !== 'missing') {
        setInstall({ inputError: { problem: listed.availability === 'installation' ? 'shipped' : 'already-installed', reason: spec } });
        return;
      }
      const typed = install.registry.kind === 'custom' ? install.registry.url.trim() : undefined;
      if (typed !== undefined && !/^https?:\/\/\S+$/.test(typed)) {
        setInstall({ inputError: { problem: 'invalid-spec', reason: typed } });
        return;
      }
      const registry = typed !== undefined ? typed : install.registry.registry;
      installAbort?.abort();
      const controller = new AbortController();
      installAbort = controller;
      setInstall({ phase: 'checking', inputError: null, subject: null, runs: [], detailsOpen: false, installed: null, installedVersion: null, restartRequired: false, failure: null, pendingBuilds: [] });
      let inspected;
      try {
        inspected = await remoteOf().pluginManager.inspect(spec, { registry }, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        setInstall({ phase: 'idle', inputError: { problem: 'unknown', reason: reasonOf(error) } });
        return;
      }
      installAbort = null;
      if (controller.signal.aborted) return;
      if (!inspected.ok) {
        setInstall({ phase: 'idle', inputError: { problem: 'unknown', reason: inspected.error?.message ?? '' } });
        return;
      }
      if (inspected.value.status === 'refused') {
        const { problem, reason } = inspected.value;
        setInstall({ phase: 'idle', inputError: { problem, reason } });
        return;
      }
      await startInstall({ spec, ...inspected.value });
    }

    async function startInstall(subject, approvedBuilds) {
      const { spec, registry } = subject;
      const requestId = randomUUID();
      const request = { requestId, acknowledged: false, replyLost: false };
      installRequest = request;
      preInstallNames = new Set(getSnapshot().packages.map((pkg) => pkg.name));
      setInstall({
        phase: 'starting',
        requestId,
        subject,
        runs: [],
        failure: null,
        installed: null,
        installedVersion: null,
        pendingBuilds: [],
        detailsOpen: false,
      });
      const result = await remoteOf().pluginManager.installBundle(spec, {
        enabled: subject.selection ?? false,
        requestId,
        registry,
        ...(approvedBuilds === undefined ? {} : { approvedBuilds: [...approvedBuilds] }),
      });
      if (disposed || installRequest !== request) return;
      if (!result.ok) {
        request.replyLost = true;
        installUncertain(result.error.message);
        reconcileInstall();
        return;
      }
      settleInstall(result.value);
    }

    async function reconcileInstall() {
      const request = installRequest;
      if (request === undefined || !request.replyLost) return;
      const result = await remoteOf().pluginManager.waitForInstall(request.requestId);
      if (disposed || installRequest !== request) return;
      if (!result.ok) {
        installUncertain(result.error.message);
        return;
      }
      if (result.value !== null) {
        settleInstall(result.value);
        return;
      }
      installRequest = undefined;
      setInstall({ phase: 'unknown', failure: null, runs: settleRuns(getSnapshot().install.runs, null) });
      notifyHiddenInstall('unknown');
      load();
    }

    const settleRuns = (runs, exitCode) => runs.map((run) => (run.exitCode === undefined ? { ...run, exitCode } : run));

    function settleInstall(result) {
      const { runs } = getSnapshot().install;
      installRequest = undefined;
      if (result.application === 'cancelled') {
        patch({ notice: { kind: 'cancelled', seq: ++noticeSeq }, install: { ...getSnapshot().install, phase: 'idle', requestId: undefined, spec: '' } });
        load();
        return;
      }
      if (result.application === 'failed') {
        const packages = result.packageResult;
        setInstall({
          phase: 'failed',
          runs: settleRuns(runs, packages?.exitCode ?? null),
          failure: { code: result.error?.code, kind: packages?.kind, reason: result.error?.diagnostic ?? '' },
          pendingBuilds: result.pendingBuilds ?? [],
        });
      } else {
        setInstall({
          phase: 'done',
          runs: settleRuns(runs, 0),
          failure: null,
          installed: result.bundle ?? null,
          installedVersion: result.version ?? null,
          restartRequired: result.application === 'restart-required',
          ...(result.restartReason === undefined ? {} : { restartReason: result.restartReason }),
          pendingBuilds: result.approvedBuilds ?? [],
        });
        const completed = getSnapshot().install;
        if (completed.phase === 'done' && result.bundle !== undefined) {
          patch({ highlight: result.bundle });
          offerSuggestion(result.bundle);
        }
      }
      const phase = getSnapshot().install.phase;
      if (phase === 'done' || phase === 'failed') notifyHiddenInstall(phase);
      load();
    }

    /** Rule-based category suggestion for a newly installed bundle. */
    function offerSuggestion(name) {
      const s = getSnapshot();
      const pkg = s.packages.find((entry) => entry.name === name);
      if (pkg === undefined || preInstallNames.has(name)) return;
      if (s.organizerStatus !== 'ready' || s.writable === false) return;
      const categoriesById = new Map(s.organizer.categories.map((c) => [c.id, c]));
      if (categoriesById.size === 0) return;
      const resolveText = (value) => (currentCtx?.locale?.resolveText ? currentCtx.locale.resolveText(value) : value);
      const textOf = (entry) => packageText(entry, resolveText).title;
      const recommended = suggestCategory(pkg, categoriesById, textOf);
      patch({ suggestion: { name, recommended } });
    }

    function resolveSuggestion(catId) {
      const s = getSnapshot();
      const suggestion = s.suggestion;
      if (suggestion === null) return;
      const next = movePlugin(s.organizer, suggestion.name, catId ?? null, 'end');
      patch({ suggestion: null });
      updateOrganizer(next);
    }

    function dismissSuggestion() {
      patch({ suggestion: null });
    }

    async function cancelInstall() {
      const install = getSnapshot().install;
      if (install.phase === 'checking' || install.phase === 'failed' || install.phase === 'unknown' || install.phase === 'idle') {
        installAbort?.abort();
        installAbort = null;
        setInstall({ phase: 'idle', requestId: undefined, subject: null, inputError: null });
        return;
      }
      const request = installRequest;
      if (!isInstallPending(install.phase) || request === undefined) return;
      setInstall({ phase: 'cancelling', failure: null });
      const result = await remoteOf().pluginManager.cancelInstall(request.requestId);
      if (disposed || installRequest !== request) return;
      if (!result.ok) {
        installUncertain(result.error.message);
        return;
      }
      if (result.value.status === 'cancelled') {
        patch({ notice: { kind: 'cancelled', seq: ++noticeSeq } });
        setInstall({ phase: 'idle', requestId: undefined, subject: null });
        load();
      } else if (result.value.status === 'too-late') {
        request.acknowledged = true;
        setInstall({ phase: 'applying' });
        notifyHiddenInstall('applying');
        reconcileInstall();
      } else {
        installUncertain('');
        reconcileInstall();
      }
    }

    async function approveBuildsAndRetry() {
      const install = getSnapshot().install;
      const pending = install.failure?.pendingBuilds ?? install.pendingBuilds;
      if (install.phase !== 'failed' || install.subject === null || pending === undefined || pending.length === 0) return;
      await startInstall(install.subject, pending);
    }

    function installUncertain(reason) {
      const request = installRequest;
      if (request !== undefined) request.replyLost = true;
      setInstall({
        phase: getSnapshot().install.phase === 'applying' ? 'applying' : 'unconfirmed',
        failure: { reason, uncertainty: true },
      });
      notifyHiddenInstall('unconfirmed');
    }

    function notifyHiddenInstall(outcome) {
      if (!getSnapshot().install.open) patch({ notice: { kind: 'install', outcome, seq: ++noticeSeq } });
    }

    function installProgress(progress) {
      const install = getSnapshot().install;
      if (install.requestId !== progress.requestId || !isInstallPending(install.phase)) return;
      if (progress.phase === 'applying') setInstall({ phase: 'applying' });
      else if (progress.phase === 'installing') setInstall({ phase: 'running' });
    }

    function appendLog(chunk) {
      const install = getSnapshot().install;
      if (chunk.requestId !== install.requestId) return;
      const index = install.runs.findIndex((run) => run.jobId === chunk.jobId);
      const settled = chunk.exitCode === undefined ? {} : { exitCode: chunk.exitCode };
      const runs = index === -1
        ? [...install.runs, { jobId: chunk.jobId, command: (chunk.argv ?? []).join(' '), cwd: chunk.cwd, output: chunk.text ?? '', ...settled }]
        : install.runs.map((run, at) => (at === index ? { ...run, output: run.output + (chunk.text ?? ''), ...settled } : run));
      setInstall({ runs });
    }

    async function enableInstalled() {
      const install = getSnapshot().install;
      if (install.phase !== 'done' || install.enabling) return;
      const name = install.installed;
      setInstall({ enabling: true });
      if (name !== null && name !== undefined) {
        try {
          applied(await remoteOf().pluginManager.setBundleEnabled(name, true), name, 'enable');
        } catch (error) {
          patch({ notice: { kind: 'failed', reason: reasonOf(error), code: error?.code, action: 'enable', name, seq: ++noticeSeq } });
        }
      }
      patch({ install: IDLE_INSTALL, highlight: name, suggestion: getSnapshot().suggestion });
      await load();
    }

    function toggleInstallDetails() {
      setInstall({ detailsOpen: !getSnapshot().install.detailsOpen });
    }

    /** Install through the catalog target path (used by Update). */
    function openCatalogInstall(pkg, target, enabled) {
      const local = target.spec.startsWith('link:');
      const subject = {
        status: 'accepted',
        kind: local ? 'path' : 'registry',
        name: pkg.name,
        version: target.version,
        bundle: true,
        spec: target.spec,
        selection: enabled,
        ...(local ? {} : { saveExact: true }),
      };
      preInstallNames = new Set(getSnapshot().packages.map((entry) => entry.name));
      setInstall({
        ...IDLE_INSTALL,
        open: true,
        spec: target.spec,
        subject,
        confirmed: { title: packageText(pkg, (v) => v).title, version: target.version },
      });
      readRegistries();
      startInstall({ ...subject });
    }

    /* ---- organizer actions --------------------------------------------- */

    const organizerActions = {
      createCategory(name) {
        const s = getSnapshot();
        const errorKey = validateCategoryName(name, s.organizer.categories, t);
        if (errorKey !== null) return { error: t(errorKey) };
        const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const organizer = { ...s.organizer, initialized: true, categories: [...s.organizer.categories, { id, name: compact(name) }] };
        updateOrganizer(organizer);
        return { id };
      },
      renameCategory(id, name) {
        const s = getSnapshot();
        const errorKey = validateCategoryName(name, s.organizer.categories.filter((c) => c.id !== id), t);
        if (errorKey !== null) return { error: t(errorKey) };
        const organizer = {
          ...s.organizer,
          categories: s.organizer.categories.map((c) => (c.id === id ? { ...c, name: compact(name) } : c)),
        };
        updateOrganizer(organizer);
        return {};
      },
      deleteCategory(id) {
        const s = getSnapshot();
        const removed = s.organizer.categories.find((c) => c.id === id);
        const organizer = { ...s.organizer };
        organizer.categories = organizer.categories.filter((c) => c.id !== id);
        organizer.collapsed = organizer.collapsed.filter((c) => c !== id);
        const members = [...(organizer.order[id] || [])];
        delete organizer.order[id];
        for (const member of members) organizer.placement[member] = null;
        organizer.order[''] = [...new Set([...(organizer.order[''] || []), ...members])];
        updateOrganizer(organizer, t('undoDeletedCategory', { name: removed?.name ?? '' }));
      },
      moveCategory(id, delta) {
        updateOrganizer(moveCategory(getSnapshot().organizer, id, delta), t('undoCategoryOrder'));
      },
      setSort(sort, announce) {
        patch({ organizer: { ...getSnapshot().organizer, sort } });
        schedulePersist();
        if (announce) patch({ notice: { kind: 'sort-switched', seq: ++noticeSeq } });
      },
      toggleCollapse(id) {
        const s = getSnapshot();
        const collapsed = s.organizer.collapsed.includes(id)
          ? s.organizer.collapsed.filter((c) => c !== id)
          : [...s.organizer.collapsed, id];
        updateOrganizer({ ...s.organizer, collapsed });
      },
      expandAll() {
        updateOrganizer({ ...getSnapshot().organizer, collapsed: [] });
      },
      collapseAll() {
        const s = getSnapshot();
        updateOrganizer({ ...s.organizer, collapsed: [...s.organizer.categories.map((c) => c.id), ''] });
      },
      toggleFavorite(name) {
        const s = getSnapshot();
        const favorites = s.organizer.favorites.includes(name)
          ? s.organizer.favorites.filter((n) => n !== name)
          : [...s.organizer.favorites, name];
        updateOrganizer({ ...s.organizer, favorites });
      },
      moveInCategory(name, dir) {
        const ensureCustom = () => {
          if (getSnapshot().organizer.sort !== 'custom') {
            organizerActions.setSort('custom', true);
            return true;
          }
          return false;
        };
        ensureCustom();
        const s = getSnapshot();
        const catId = s.organizer.placement[name] ?? null;
        const key = catId ?? '';
        const list = s.organizer.order[key] || [];
        const at = list.indexOf(name);
        if (at < 0) return;
        const to = Math.max(0, Math.min(list.length - 1, at + dir));
        if (to === at) return;
        const nextList = [...list];
        const [item] = nextList.splice(at, 1);
        nextList.splice(to, 0, item);
        updateOrganizer({ ...s.organizer, order: { ...s.organizer.order, [key]: nextList } }, t('undoMovedPlugin'));
      },
      moveToPosition(name, position) {
        const ensureCustom = () => {
          if (getSnapshot().organizer.sort !== 'custom') {
            organizerActions.setSort('custom', true);
            return true;
          }
          return false;
        };
        ensureCustom();
        const s = getSnapshot();
        const catId = s.organizer.placement[name] ?? null;
        const key = catId ?? '';
        const list = s.organizer.order[key] || [];
        if (!list.includes(name)) return;
        const nextList = list.filter((n) => n !== name);
        if (position === 'top') nextList.unshift(name);
        else nextList.push(name);
        updateOrganizer({ ...s.organizer, order: { ...s.organizer.order, [key]: nextList } }, t('undoMovedPlugin'));
      },
      moveToCategory(name, catId) {
        const s = getSnapshot();
        updateOrganizer(movePlugin(s.organizer, name, catId ?? null, 'end'), t('undoMovedPlugin'));
      },
      applyTemplate() {
        const s = getSnapshot();
        const lang = currentCtx?.locale?.getSnapshot?.()?.active ?? 'zh';
        const pick = (value) => (typeof value === 'string' ? value : value?.[lang] ?? value?.zh ?? value?.en ?? '');
        const categories = buildTemplateCategories(pick);
        const categoriesById = new Map(categories.map((c) => [c.id, c]));
        const resolveText = (value) => (currentCtx?.locale?.resolveText ? currentCtx.locale.resolveText(value) : value);
        const textOf = (entry) => packageText(entry, resolveText).title;
        let organizer = { ...s.organizer, initialized: true, categories };
        for (const name of currentMineNames()) {
          const current = organizer.placement[name];
          // Keep a category the user chose; only unplaced/uncategorized packages get a suggestion.
          if (current !== undefined && current !== null) continue;
          const pkg = s.packages.find((entry) => entry.name === name);
          const suggested = pkg === undefined ? null : suggestCategory(pkg, categoriesById, textOf);
          organizer = movePlugin(organizer, name, suggested ?? null, 'end');
        }
        updateOrganizer(organizer, t('undoAppliedTemplate'));
        patch({ notice: { kind: 'template-applied', seq: ++noticeSeq } });
      },
      /** Re-run the keyword rules for packages currently in "uncategorized". */
      categorizeUncategorized() {
        const s = getSnapshot();
        // Nothing to sort into yet: create the recommended categories first,
        // then classify the uncategorized packages in the same action.
        if (s.organizer.categories.length === 0) {
          organizerActions.applyTemplate();
          return { count: currentMineNames().length };
        }
        const categoriesById = new Map(s.organizer.categories.map((c) => [c.id, c]));
        const resolveText = (value) => (currentCtx?.locale?.resolveText ? currentCtx.locale.resolveText(value) : value);
        const textOf = (entry) => packageText(entry, resolveText).title;
        let organizer = { ...s.organizer };
        let count = 0;
        for (const name of currentMineNames()) {
          const current = organizer.placement[name];
          if (current !== undefined && current !== null) continue;
          const pkg = s.packages.find((entry) => entry.name === name);
          const suggested = pkg === undefined ? null : suggestCategory(pkg, categoriesById, textOf);
          if (suggested === null) continue;
          organizer = movePlugin(organizer, name, suggested, 'end');
          count += 1;
        }
        if (count > 0) {
          updateOrganizer(organizer, t('undoCategorized', { count: String(count) }));
          patch({ notice: { kind: 'template-applied', seq: ++noticeSeq } });
        }
        return { count };
      },
      dismissTemplate() {
        const s = getSnapshot();
        updateOrganizer({ ...s.organizer, initialized: true });
      },
    };

    /* ---- misc ----------------------------------------------------------- */

    function dismissNotice() {
      if (getSnapshot().notice !== null) patch({ notice: null });
    }

    function clearHighlight() {
      if (getSnapshot().highlight !== null) patch({ highlight: null });
    }

    function resetView() {
      const s = getSnapshot();
      if (s.view.kind !== 'list') patch({ view: { kind: 'list' } });
    }

    function setView(view) {
      patch({ view });
    }

    function setTab(tab) {
      patch({ tab });
    }

    /* ---- slot ledgers ------------------------------------------------------ */

    function slotLabel(options, id, resolveText) {
      const label = options?.label;
      if (label === undefined || label === null) return id ?? '';
      if (typeof label === 'function') return label();
      if (typeof label === 'string') return label;
      const resolved = resolveText(label);
      return resolved ?? id ?? '';
    }

    function configLedgerSource(ctx) {
      let versions = [];
      let revision = -1;
      let ledger = { items: [], bundles: new Set(), rows: new Set() };
      const keysOf = (name) => new Set(ctx.slots.entries(name).flatMap((entry) => (entry.options.key === undefined ? [] : [entry.options.key])));
      return {
        getSnapshot: () => {
          const next = SLOT_SOURCES.map((name) => ctx.slots.getVersion(name));
          const current = ctx.locale.getSnapshot().revision;
          if (current !== revision || next.some((version, index) => version !== versions[index])) {
            versions = next;
            revision = current;
            ledger = {
              items: ctx.slots.entries('plugins.item').map((entry) => ({
                id: entry.options.id ?? '',
                label: slotLabel(entry.options, entry.options.id, ctx.locale.resolveText.bind(ctx.locale)),
              })),
              bundles: keysOf('plugins.bundle.config'),
              rows: keysOf('plugins.row.config'),
            };
          }
          return ledger;
        },
        subscribe: (listener) => {
          const offs = [...SLOT_SOURCES.map((name) => ctx.slots.subscribe(name, listener)), ctx.locale.subscribe(listener)];
          return () => {
            for (const off of offs) off();
          };
        },
      };
    }

    function tabLedgerSource(ctx) {
      let version = -1;
      let revision = -1;
      let tabs = [];
      return {
        getSnapshot: () => {
          const next = ctx.slots.getVersion('plugins.tab');
          const current = ctx.locale.getSnapshot().revision;
          if (next !== version || current !== revision) {
            version = next;
            revision = current;
            tabs = ctx.slots.entries('plugins.tab').map((entry) => ({
              id: entry.options.id ?? '',
              label: slotLabel(entry.options, entry.options.id, ctx.locale.resolveText.bind(ctx.locale)),
            }));
          }
          return tabs;
        },
        subscribe: (listener) => {
          const offs = [ctx.slots.subscribe('plugins.tab', listener), ctx.locale.subscribe(listener)];
          return () => {
            for (const off of offs) off();
          };
        },
      };
    }

    /* ================================================================ */
    /* Views                                                             */
    /* ================================================================ */

    const PACKAGE_ARTWORK_DEFAULT = () => h('span', { className: 'dpo-cardIcon', 'aria-hidden': 'true' }, ICONS.puzzle);

    function PackageArtwork({ pkg, small }) {
      const src = pkg?.meta?.icon;
      const [failed, setFailed] = useState(null);
      if (src === undefined || src === failed) return PACKAGE_ARTWORK_DEFAULT();
      const size = small ? 20 : 36;
      return h('img', {
        src,
        width: size,
        height: size,
        alt: '',
        style: { width: size, height: size, borderRadius: small ? 5 : 9, flex: 'none' },
        onError: () => setFailed(src),
      });
    }

    function Toast({ notice, onDone }) {
      const [visible, setVisible] = useState(true);
      useEffect(() => {
        setVisible(true);
        const dispose = safeTimeout(() => setVisible(false), toastHoldMs(noticeLine(notice)));
        return dispose;
      }, [notice]);
      useEffect(() => {
        if (!visible && typeof onDone === 'function') onDone();
      }, [visible, onDone]);
      if (!visible) return null;
      const text = noticeLine(notice);
      const errorish = notice.kind === 'failed' || notice.kind === 'persist-failed' || notice.kind === 'settings-load-failed';
      return h('div', { className: `dpo-toast${errorish ? ' is-error' : ''}`, role: 'status' },
        errorish ? ICONS.warn : ICONS.info,
        h('span', null, text),
        h('button', { type: 'button', className: 'dpo-btn dpo-btn-quiet', onClick: () => setVisible(false), 'aria-label': t('close') }, ICONS.close));
    }

    function Skeleton({ label }) {
      return h('div', { className: 'dpo-skeleton', role: 'status', 'aria-label': label },
        h('div', { className: 'dpo-skeleton-bar', style: { width: '38%' } }),
        h('div', { className: 'dpo-skeleton-bar', style: { width: '86%' } }),
        h('div', { className: 'dpo-skeleton-bar', style: { width: '72%' } }));
    }

    function StatusLine({ state, text }) {
      return h('p', { className: 'dpo-status', role: 'status' },
        h('span', { className: `dpo-dot ${state}`, 'aria-hidden': 'true' }), text);
    }

    function Tag({ children, tone }) {
      return h('span', { className: `dpo-tag${tone ? ` is-${tone}` : ''}` }, children);
    }

    function packageStatus(pkg) {
      if (pkg.error !== undefined) return 'problem';
      return pkg.enabled ? 'running' : 'disabled';
    }

    function EnableSwitch({ pkg, title, t, busy, onSetEnabled }) {
      const disabled = busy || pkg.readOnlyReason !== undefined || (!pkg.enabled && pkg.error !== undefined && !(pkg.availability === 'missing' && pkg.installTarget !== undefined));
      return h(Switch, {
        checked: pkg.enabled,
        label: t('enableToggle', { name: title }),
        disabled,
        title: pkg.readOnlyReason === undefined ? undefined : managementText({ code: pkg.readOnlyReason }),
        onChange: onSetEnabled,
      });
    }

    const PHASE_KEYS = { pending: 'rowPhasePending', loading: 'rowPhaseLoading', active: 'rowPhaseActive', failed: 'rowPhaseFailed', unloading: 'rowPhaseUnloading' };
    const PHASE_STATES = { pending: 'idle', loading: 'ongoing', active: 'done', failed: 'error', unloading: 'ongoing' };

    /* ---- organizer views ---------------------------------------------- */

    function PluginRow({ pkg, catId, t, resolveText, resolveTitle, dnd, dropTarget, dragState, onDrop, onDragOver, onDragStartRow, onDragEndRow, onJump }) {
      const s = useApp();
      const busy = s.busy.includes(pkg.name);
      const { title, description, beta } = packageText(pkg, resolveText);
      const favorite = s.organizer.favorites.includes(pkg.name);
      const status = packageStatus(pkg);
      const query = s.search.trim();
      const menu = useMenu();
      const menuState = () => ({
        items: [
          { id: 'open', label: t('openDetail', { name: title }) },
          'sep',
          { id: 'top', label: t('moveTop') },
          { id: 'up', label: t('moveUp') },
          { id: 'down', label: t('moveDown') },
          { id: 'bottom', label: t('moveBottom') },
          'sep',
          { id: 'move', label: t('moveToCategory') },
          'sep',
          { id: 'favorite', label: favorite ? t('unfavorite') : t('favorite') },
          'sep',
          { id: 'uninstall', label: t('uninstall'), danger: true, disabled: !pkg.removable || pkg.readOnlyReason !== undefined },
        ],
        onSelect: (id) => {
          switch (id) {
            case 'open': onJump(pkg.name, true); break;
            case 'up': organizerActions.moveInCategory(pkg.name, -1); break;
            case 'down': organizerActions.moveInCategory(pkg.name, 1); break;
            case 'top': organizerActions.moveToPosition(pkg.name, 'top'); break;
            case 'bottom': organizerActions.moveToPosition(pkg.name, 'bottom'); break;
            case 'move': patch({ moveTo: pkg.name }); break;
            case 'favorite': organizerActions.toggleFavorite(pkg.name); break;
            case 'uninstall': uninstall(pkg.name); break;
            default: break;
          }
        },
      });
      const onKeyHandle = (event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); organizerActions.moveInCategory(pkg.name, -1); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); organizerActions.moveInCategory(pkg.name, 1); }
        else if (event.key === 'Home') { event.preventDefault(); organizerActions.moveToPosition(pkg.name, 'top'); }
        else if (event.key === 'End') { event.preventDefault(); organizerActions.moveToPosition(pkg.name, 'bottom'); }
      };
      const classNames = ['dpo-row'];
      if (dropTarget?.row === pkg.name && dropTarget.catId === catId) classNames.push(`dpo-drop-${dropTarget.pos}`);
      if (dnd && dragState?.kind === 'plugin' && dragState.name === pkg.name) classNames.push('is-dragging');
      return h('li', {
        className: classNames.join(' '),
        'data-plugin-package': pkg.name,
        'data-plugin-status': status,
        onDragOver: dnd && onDragOver ? (event) => onDragOver(event, pkg.name, catId) : undefined,
        onDrop: dnd && onDrop ? (event) => {
          event.stopPropagation();
          onDrop(event, pkg.name, catId);
        } : undefined,
        children: [
          dnd ? h('span', {
            className: `dpo-grip${s.organizer.sort === 'custom' ? '' : ' is-dim'}`,
            role: 'button',
            tabIndex: 0,
            draggable: true,
            title: t('dragHandlePlugin', { name: title }),
            'aria-label': t('dragHandlePlugin', { name: title }),
            onDragStart: onDragStartRow ? (event) => onDragStartRow(event, pkg.name, catId) : undefined,
            onDragEnd: onDragEndRow,
            onKeyDown: onKeyHandle,
          }, ICONS.grip) : null,
          h(PackageArtwork, { pkg, small: true }),
          h('div', { className: 'dpo-rowMain' },
            h('div', { className: 'dpo-rowInfo' },
              h('div', { className: 'dpo-rowName' },
                h('button', {
                  type: 'button',
                  className: 'dpo-rowNameText',
                  onClick: () => onJump(pkg.name, true),
                  title: pkg.name,
                }, highlightText(title, query)),
                beta ? Tag({ children: t('statusBeta'), tone: 'info' }) : null,
                status === 'problem' ? Tag({ children: t('statusProblem'), tone: 'danger' }) : null),
              description === undefined ? null : h('div', { className: 'dpo-rowDesc' }, highlightText(description, query)))),
          pkg.version === undefined ? null : h('span', { className: 'dpo-rowMeta' }, t('versionTag', { version: pkg.version })),
          h('button', {
            type: 'button',
            className: `dpo-star${favorite ? ' is-on' : ''}`,
            'aria-label': t('favoriteAria', { action: favorite ? t('unfavorite') : t('favorite'), name: title }),
            title: favorite ? t('unfavorite') : t('favorite'),
            onClick: (event) => {
              event.stopPropagation();
              organizerActions.toggleFavorite(pkg.name);
            },
          }, ICONS.star(favorite)),
          h('button', {
            type: 'button',
            className: 'dpo-rowMore',
            'aria-label': t('openDetail', { name: title }),
            onClick: (event) => menu.anchor(event.currentTarget, menuState)(event),
          }, ICONS.more),
          h(EnableSwitch, {
            pkg,
            title,
            t,
            busy,
            onSetEnabled: (enabled) => {
              patch({ activation: enabled ? pkg.name : null });
              setEnabled(pkg.name, enabled);
            },
          }),
          menu.MenuView(),
        ],
      });
    }

    function CategorySection({ cat, members, t, resolveText, resolveTitle, lang, collapsed, dnd, dropTarget, setDropTarget, dragState, onDragStartCategory, onDragEndCategory, onDropCategory, onDragOverCategory, onDropRow, onDragOverRow, onDragStartRow, onDragEndRow, onJump, onEdit, onDelete }) {
      const id = cat.id;
      const count = members.length;
      const fixed = id === '';
      const menu = useMenu();
      const headClass = ['dpo-catHead'];
      if (dragState?.kind === 'category' && dragState.id === id) headClass.push('is-dragging');
      if (dropTarget?.catId === id && dropTarget.pos === 'into-cat') headClass.push('dpo-drop-target');
      return h('section', {
        className: 'dpo-cat',
        'data-plugin-category': id === '' ? 'uncategorized' : id,
        children: [
          h('div', {
            className: headClass.join(' '),
            onDragOver: dnd && !fixed && onDragOverCategory ? (event) => onDragOverCategory(event, id) : undefined,
            onDrop: dnd && !fixed && onDropCategory ? (event) => onDropCategory(event, id) : undefined,
            children: [
              dnd && !fixed ? h('span', {
                className: 'dpo-grip',
                role: 'button',
                tabIndex: 0,
                draggable: true,
                title: t('dragHandleCategory', { name: cat.name }),
                'aria-label': t('dragHandleCategory', { name: cat.name }),
                onDragStart: onDragStartCategory ? (event) => onDragStartCategory(event, id) : undefined,
                onDragEnd: onDragEndCategory,
                onKeyDown: (event) => {
                  if (event.key === 'ArrowUp') { event.preventDefault(); organizerActions.moveCategory(id, -1); }
                  else if (event.key === 'ArrowDown') { event.preventDefault(); organizerActions.moveCategory(id, 1); }
                },
              }, ICONS.grip) : null,
              h('button', {
                type: 'button',
                className: 'dpo-catToggle',
                'aria-expanded': !collapsed,
                onClick: () => organizerActions.toggleCollapse(id),
              }, collapsed ? ICONS.chevronRight : ICONS.chevronDown),
              h('h3', { className: 'dpo-catName' }, cat.name),
              h('span', { className: 'dpo-catCount' }, t('categoryCount', { count: String(count) })),
              h('span', { className: 'dpo-catSpacer' }),
              fixed ? null : h('button', {
                type: 'button',
                className: 'dpo-catMenu',
                'aria-label': t('manageCategories'),
                onClick: (event) => menu.anchor(event.currentTarget, () => ({
                  items: [
                    { id: 'rename', label: t('rename') },
                    { id: 'up', label: t('moveUp') },
                    { id: 'down', label: t('moveDown') },
                    'sep',
                    { id: 'delete', label: t('delete'), danger: true },
                  ],
                  onSelect: (itemId) => {
                    if (itemId === 'rename') onEdit(cat);
                    else if (itemId === 'up') organizerActions.moveCategory(id, -1);
                    else if (itemId === 'down') organizerActions.moveCategory(id, 1);
                    else if (itemId === 'delete') onDelete(cat);
                  },
                }))(event),
              }, ICONS.more),
              menu.MenuView(),
            ],
          }),
          collapsed ? null : count === 0
            ? h('p', { className: 'dpo-catEmpty' }, t('categoryEmpty'))
            : h('ul', {
              className: `dpo-catBody${dropTarget?.catId === id && dropTarget.pos === 'into-body' ? ' dpo-drop-target' : ''}`,
              onDragOver: dnd ? (event) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                if (dropTarget?.catId !== id || dropTarget.pos !== 'into-body') {
                  setDropTarget({ catId: id, pos: 'into-body' });
                }
              } : undefined,
              onDrop: dnd && onDropRow ? (event) => {
                if (event.target !== event.currentTarget) return;
                onDropRow(event, id);
              } : undefined,
              children: members.map((pkg) => h(PluginRow, {
                key: pkg.name,
                pkg,
                catId: id,
                t,
                resolveText,
                resolveTitle,
                lang,
                dnd,
                dropTarget,
                dragState,
                onDrop: onDropRow,
                onDragOver: onDragOverRow,
                onDragStartRow,
                onDragEndRow,
                onJump,
              })),
            }),
        ],
      });
    }

    function CategoryManagerDialog({ t, onClose, initialEdit }) {
      const s = useApp();
      const [draft, setDraft] = useState('');
      const [editing, setEditing] = useState(initialEdit ?? null);
      const [editValue, setEditValue] = useState(initialEdit ?? '');
      const [error, setError] = useState(null);
      const [pendingDelete, setPendingDelete] = useState(null);
      const [dragId, setDragId] = useState(null);
      const [dropId, setDropId] = useState(null);
      const [pendingReset, setPendingReset] = useState(false);
      const fileRef = useRef(null);

      const exportLayout = () => {
        try {
          const payload = {
            app: 'dsh-plugin-organizer',
            version: ORGANIZER_VERSION,
            exportedAt: new Date().toISOString(),
            organizer: s.organizer,
          };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'dsh-plugin-organizer-layout.json';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          safeTimeout(() => URL.revokeObjectURL(url), 1000);
          setError(null);
        } catch (failure) {
          setError(t('importFailed', { reason: reasonOf(failure) }));
        }
      };

      const importLayout = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file === undefined) return;
        try {
          const parsed = JSON.parse(await file.text());
          const raw = parsed?.organizer ?? parsed;
          const organizer = mergeOrganizer(normalizeOrganizer(raw), currentMineNames());
          updateOrganizer(organizer, t('importDone'));
          setError(null);
        } catch (failure) {
          setError(t('importFailed', { reason: reasonOf(failure) }));
        }
      };

      const resetLayout = () => {
        setPendingReset(false);
        updateOrganizer(freshOrganizer(), t('undoResetLayout'));
        setError(null);
      };

      useEffect(() => {
        if (initialEdit !== undefined) {
          setEditing(initialEdit);
          setEditValue(initialEdit ?? '');
        }
      }, [initialEdit]);

      const create = () => {
        const result = organizerActions.createCategory(draft);
        if (result.error) setError(result.error);
        else {
          setDraft('');
          setError(null);
        }
      };

      const commitRename = () => {
        const result = organizerActions.renameCategory(editing, editValue);
        if (result.error) setError(result.error);
        else {
          setEditing(null);
          setEditValue('');
          setError(null);
        }
      };

      const categories = s.organizer.categories;
      const rows = categories.map((cat) => {
        const count = categoryMembers(s.organizer, cat.id).length;
        return h('li', {
          key: cat.id,
          className: ['dpo-catRow', dragId === cat.id ? 'is-dragging' : '', dropId === cat.id ? 'dpo-drop-target' : ''].filter(Boolean).join(' '),
          draggable: editing === null,
          onDragStart: (event) => {
            setDragId(cat.id);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', cat.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setDropId(null);
          },
          onDragOver: (event) => {
            event.preventDefault();
            if (dragId !== null && dropId !== cat.id) setDropId(cat.id);
          },
          onDrop: (event) => {
            event.preventDefault();
            const from = dragId;
            const to = cat.id;
            if (from !== null && from !== to) {
              const fromIndex = s.organizer.categories.findIndex((c) => c.id === from);
              const toIndex = s.organizer.categories.findIndex((c) => c.id === to);
              organizerActions.moveCategory(from, toIndex - fromIndex);
            }
            setDragId(null);
            setDropId(null);
          },
          children: [
            h('span', { className: 'dpo-grip', 'aria-hidden': 'true' }, ICONS.grip),
            editing === cat.id
              ? h('div', { className: 'dpo-catRowInput' },
                h('input', {
                  type: 'text',
                  value: editValue,
                  autoFocus: true,
                  onChange: (event) => setEditValue(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') commitRename();
                    else if (event.key === 'Escape') { setEditing(null); setError(null); }
                  },
                }))
              : h('span', { className: 'dpo-catRowName' }, cat.name),
            h('span', { className: 'dpo-catCount' }, String(count)),
            h('button', {
              type: 'button',
              className: 'dpo-btn dpo-btn-quiet',
              'aria-label': t('rename'),
              onClick: () => {
                setEditing(cat.id);
                setEditValue(cat.name);
                setError(null);
              },
            }, ICONS.edit),
            h('button', {
              type: 'button',
              className: 'dpo-btn dpo-btn-quiet',
              'aria-label': t('delete'),
              onClick: () => setPendingDelete(cat),
            }, ICONS.trash),
          ],
        });
      });

      return h(Modal, {
        title: t('manageCategories'),
        onClose,
        footer: [
          h('button', { type: 'button', className: 'dpo-btn dpo-btn-quiet', onClick: () => organizerActions.expandAll() }, t('expandAll')),
          h('button', { type: 'button', className: 'dpo-btn dpo-btn-quiet', onClick: () => organizerActions.collapseAll() }, t('collapseAll')),
          h('button', {
            type: 'button',
            className: 'dpo-btn',
            onClick: () => {
              const result = organizerActions.categorizeUncategorized();
              if (result.count === 0) setError(t('nothingToCategorize'));
            },
          }, t('categorizeUncategorized')),
          h('button', { type: 'button', className: 'dpo-btn', onClick: onClose }, t('close')),
        ],
        children: [
          h('p', { className: 'dpo-hint' }, `${t('uncategorized')}: ${t('categoryCount', { count: String(categoryMembers(s.organizer, '').length) })}`),
          h('ul', { className: 'dpo-catList' }, rows),
          error === null ? null : h('p', { className: 'dpo-fieldError', role: 'alert' }, error),
          h('div', { className: 'dpo-layoutTools' },
            h('button', { type: 'button', className: 'dpo-btn', onClick: exportLayout }, t('exportLayout')),
            h('button', { type: 'button', className: 'dpo-btn', onClick: () => fileRef.current?.click() }, t('importLayout')),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'application/json,.json',
              style: { display: 'none' },
              onChange: importLayout,
            }),
            h('button', { type: 'button', className: 'dpo-btn dpo-btn-danger', onClick: () => setPendingReset(true) }, t('resetLayout'))),
          h('div', { className: 'dpo-field' },
            h('label', { htmlFor: 'dpo-new-cat' }, t('createCategory')),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('input', {
                id: 'dpo-new-cat',
                type: 'text',
                value: draft,
                placeholder: t('newCategoryPlaceholder'),
                onChange: (event) => { setDraft(event.target.value); setError(null); },
                onKeyDown: (event) => { if (event.key === 'Enter') create(); },
              }),
              h('button', { type: 'button', className: 'dpo-btn dpo-btn-primary', onClick: create, disabled: draft.trim() === '' }, t('createCategory')))),
          pendingDelete === null ? null : h(Modal, {
            title: t('deleteCategoryConfirmTitle', { name: pendingDelete.name }),
            onClose: () => setPendingDelete(null),
            footer: [
              h('button', { type: 'button', className: 'dpo-btn', onClick: () => setPendingDelete(null) }, t('cancel')),
              h('button', {
                type: 'button',
                className: 'dpo-btn dpo-btn-danger',
                onClick: () => {
                  organizerActions.deleteCategory(pendingDelete.id);
                  setPendingDelete(null);
                },
              }, t('delete')),
            ],
            children: h('p', { style: { margin: 0 } },
              t('deleteCategoryConfirmBody', { count: String(categoryMembers(s.organizer, pendingDelete.id).length) })),
          }),
          pendingReset ? h(Modal, {
            title: t('resetLayout'),
            onClose: () => setPendingReset(false),
            footer: [
              h('button', { type: 'button', className: 'dpo-btn', onClick: () => setPendingReset(false) }, t('cancel')),
              h('button', { type: 'button', className: 'dpo-btn dpo-btn-danger', onClick: resetLayout }, t('resetLayout')),
            ],
            children: h('p', { style: { margin: 0 } }, t('resetLayoutConfirm')),
          }) : null,
        ],
      });
    }

    function MoveToCategoryDialog({ name, t, onClose }) {
      const s = useApp();
      const items = [
        { id: '', label: t('uncategorized'), icon: ICONS.folder },
        ...s.organizer.categories.map((cat) => ({ id: cat.id, label: cat.name, icon: ICONS.folder })),
      ];
      return h(Modal, {
        title: t('moveToCategoryTitle', { name }),
        onClose,
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          items.map((item) => h('button', {
            type: 'button',
            key: item.id,
            className: 'dpo-menu-item',
            onClick: () => {
              organizerActions.moveToCategory(name, item.id === '' ? null : item.id);
              onClose();
            },
          }, item.icon, item.label))),
      });
    }

    function SuggestionDialog({ t }) {
      const s = useApp();
      const suggestion = s.suggestion;
      const [choosing, setChoosing] = useState(false);
      if (suggestion === null) return null;
      const pkg = s.packages.find((entry) => entry.name === suggestion.name);
      const title = pkg === undefined ? suggestion.name : packageText(pkg, (v) => v).title;
      const category = suggestion.recommended === null ? null : s.organizer.categories.find((c) => c.id === suggestion.recommended) ?? null;
      return h(Modal, {
        title: t('suggestionTitle'),
        onClose: dismissSuggestion,
        children: [
          category === null
            ? h('p', { style: { margin: 0 } }, t('suggestionUncertain', { name: title }))
            : h('p', { style: { margin: 0 } }, t('suggestionBody', { name: title, category: category.name })),
          choosing
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '8px' } },
              [{ id: '', label: t('uncategorized') }, ...s.organizer.categories.map((c) => ({ id: c.id, label: c.name }))].map((item) =>
                h('button', {
                  type: 'button',
                  key: item.id,
                  className: 'dpo-menu-item',
                  onClick: () => resolveSuggestion(item.id === '' ? null : item.id),
                }, ICONS.folder, item.label)))
            : null,
        ],
        footer: [
          category === null
            ? null
            : h('button', { type: 'button', className: 'dpo-btn dpo-btn-primary', onClick: () => resolveSuggestion(category.id) }, t('suggestionAccept')),
          h('button', {
            type: 'button',
            className: 'dpo-btn',
            onClick: () => (category === null ? resolveSuggestion(null) : setChoosing(true)),
          }, category === null ? t('suggestionKeepUncategorized') : t('suggestionChoose')),
          h('button', { type: 'button', className: 'dpo-btn dpo-btn-quiet', onClick: () => resolveSuggestion(null) }, category === null ? t('close') : t('suggestionKeepUncategorized')),
        ],
      });
    }

    function FilterMenu({ label, valueLabel, items, onSelect }) {
      const menu = useMenu();
      return h(Fragment, null,
        h('button', {
          type: 'button',
          className: 'dpo-btn',
          'aria-haspopup': 'menu',
          onClick: (event) => menu.anchor(event.currentTarget, () => ({ items: items.map((item) => ({ ...item, active: item.active })), onSelect: (id) => onSelect(id) }))(event),
        }, valueLabel, ICONS.chevronDown),
        menu.MenuView());
    }

    function InstalledList({ t, resolveText, lang }) {
      const s = useApp();
      const [catDialog, setCatDialog] = useState(false);
      const [editCatId, setEditCatId] = useState(null);
      const [dragState, setDragState] = useState(null);
      const [dropTarget, setDropTarget] = useState(null);
      const [pendingCategoryDelete, setPendingCategoryDelete] = useState(null);
      const searchRef = useRef(null);

      useEffect(() => {
        const onKey = (event) => {
          const target = event.target;
          const typing = target instanceof HTMLElement
            && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
          if (!typing && (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'))) {
            event.preventDefault();
            searchRef.current?.focus();
            return;
          }
          if (event.key === 'Escape' && target === searchRef.current) {
            event.preventDefault();
            patch({ search: '' });
            searchRef.current?.blur();
          }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, []);

      useEffect(() => {
        if (dragState === null) return undefined;
        const onDragOver = (event) => {
          const panel = document.querySelector('[data-plugin-panel]');
          const scroller = panel !== null && panel.scrollHeight > panel.clientHeight ? panel : document.scrollingElement;
          if (scroller === null) return;
          const edge = 72;
          if (event.clientY < edge) scroller.scrollTop -= 14;
          else if (event.clientY > window.innerHeight - edge) scroller.scrollTop += 14;
        };
        window.addEventListener('dragover', onDragOver);
        return () => window.removeEventListener('dragover', onDragOver);
      }, [dragState]);

      const resolveTitle = useCallback((pkg) => packageText(pkg, resolveText).title, [resolveText]);

      const listed = useMemo(() => s.packages.filter((pkg) => !BUILTIN_PROFILE_BUNDLES.has(pkg.name) && (pkg.installed || pkg.official || pkg.error !== undefined)), [s.packages]);
      const mine = useMemo(() => listed.filter((pkg) => !pkg.official), [listed]);

      const query = s.search.trim().toLowerCase();
      const filtering = query !== '' || s.categoryFilter !== 'all' || s.statusFilter !== 'all';
      const dnd = !filtering && s.writable !== false;

      const shownMine = useMemo(() => {
        let result = mine.filter((pkg) => matchesSearch(pkg, query, resolveTitle, resolveText));
        if (s.categoryFilter === 'favorites') result = result.filter((pkg) => s.organizer.favorites.includes(pkg.name));
        else if (s.categoryFilter !== 'all') result = result.filter((pkg) => (s.organizer.placement[pkg.name] ?? null) === s.categoryFilter);
        if (s.statusFilter === 'enabled') result = result.filter((pkg) => pkg.enabled);
        else if (s.statusFilter === 'disabled') result = result.filter((pkg) => !pkg.enabled);
        return result;
      }, [mine, query, s.categoryFilter, s.statusFilter, s.organizer, resolveTitle, resolveText]);

      const membersByCategory = useMemo(() => {
        const map = new Map();
        for (const catId of orderedCategoryIds(s.organizer)) {
          const owned = mine.filter((pkg) => (s.organizer.placement[pkg.name] ?? null) === (catId === '' ? null : catId));
          map.set(catId, sortMembers(s.organizer, catId === '' ? null : catId, owned, resolveTitle, lang));
        }
        return map;
      }, [mine, s.organizer, resolveTitle, lang]);

      /* ---- drag & drop -------------------------------------------------- */

      const onDragStartRow = useCallback((event, name, catId) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', name);
        setDragState({ kind: 'plugin', name, catId });
      }, []);

      const onDragEndRow = useCallback(() => {
        setDragState(null);
        setDropTarget(null);
      }, []);

      const onDragOverRow = useCallback((event, name, catId) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const pos = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        if (dropTarget?.row !== name || dropTarget.catId !== catId || dropTarget.pos !== pos) {
          setDropTarget({ row: name, catId, pos });
        }
      }, [dropTarget]);

      const onDropRow = useCallback((event, refName, targetCatId) => {
        event.preventDefault();
        const state = dragState;
        setDragState(null);
        setDropTarget(null);
        if (state === null || state.kind !== 'plugin') return;
        const pos = dropTarget?.pos === 'before' ? 'before' : 'after';
        const current = getSnapshot().organizer;
        if (current.sort !== 'custom') organizerActions.setSort('custom', true);
        const next = movePlugin(getSnapshot().organizer, state.name, targetCatId === '' ? null : targetCatId, pos, refName);
        updateOrganizer(next, t('undoMovedPlugin'));
      }, [dragState, dropTarget]);

      /** Drop a plugin into a category (header or empty body area). */
      const onDropIntoCategory = useCallback((event, catId) => {
        event.preventDefault();
        const state = dragState;
        setDragState(null);
        setDropTarget(null);
        if (state === null || state.kind !== 'plugin') return;
        const current = getSnapshot().organizer;
        if (current.sort !== 'custom') organizerActions.setSort('custom', true);
        const next = movePlugin(getSnapshot().organizer, state.name, catId === '' ? null : catId, 'end');
        updateOrganizer(next, t('undoMovedPlugin'));
      }, [dragState]);

      const onDragStartCategory = useCallback((event, id) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `cat:${id}`);
        setDragState({ kind: 'category', id });
      }, []);

      const onDragEndCategory = useCallback(() => {
        setDragState(null);
        setDropTarget(null);
      }, []);

      const onDragOverCategory = useCallback((event, id) => {
        event.preventDefault();
        if (dropTarget?.catId !== id || dropTarget.pos !== 'into-cat') setDropTarget({ catId: id, pos: 'into-cat' });
      }, [dropTarget]);

      const onDropCategory = useCallback((event, id) => {
        event.preventDefault();
        const state = dragState;
        setDragState(null);
        setDropTarget(null);
        if (state === null) return;
        if (state.kind === 'plugin') {
          const current = getSnapshot().organizer;
          if (current.sort !== 'custom') organizerActions.setSort('custom', true);
          const next = movePlugin(getSnapshot().organizer, state.name, id === '' ? null : id, 'end');
          updateOrganizer(next, t('undoMovedPlugin'));
          return;
        }
        if (state.kind !== 'category' || state.id === id) return;
        const org = getSnapshot().organizer;
        const fromIndex = org.categories.findIndex((c) => c.id === state.id);
        const toIndex = org.categories.findIndex((c) => c.id === id);
        if (fromIndex >= 0 && toIndex >= 0) organizerActions.moveCategory(state.id, toIndex - fromIndex);
      }, [dragState]);

      /* ---- jump ---------------------------------------------------------- */

      const jumpTo = useCallback((name, openDetail) => {
        if (openDetail) {
          setView({ kind: 'package', name });
          return;
        }
        const org = getSnapshot().organizer;
        const catId = org.placement[name] ?? null;
        if (catId !== null && org.collapsed.includes(catId)) organizerActions.toggleCollapse(catId);
        safeTimeout(() => {
          const node = document.querySelector(`[data-plugin-package="${CSS.escape(name)}"]`);
          if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 60);
      }, []);

      /* ---- rendering ---------------------------------------------------- */

      const categories = [
        ...s.organizer.categories.map((cat) => ({ ...cat, fixed: false })),
        fixedUncategorized(t),
      ];

      const favorites = s.organizer.favorites.map((name) => mine.find((pkg) => pkg.name === name)).filter(Boolean);

      const catFilterItems = [
        { id: 'all', label: t('filterAllCategories'), active: s.categoryFilter === 'all' },
        { id: 'favorites', label: t('favoritesFilter'), active: s.categoryFilter === 'favorites' },
        ...s.organizer.categories.map((cat) => ({ id: cat.id, label: cat.name, active: s.categoryFilter === cat.id })),
        { id: '', label: t('uncategorized'), active: s.categoryFilter === '' },
      ];
      const statusFilterItems = [
        { id: 'all', label: t('filterAllStatus'), active: s.statusFilter === 'all' },
        { id: 'enabled', label: t('filterEnabled'), active: s.statusFilter === 'enabled' },
        { id: 'disabled', label: t('filterDisabled'), active: s.statusFilter === 'disabled' },
      ];
      const sortItems = [
        { id: 'custom', label: t('sortCustom'), active: s.organizer.sort === 'custom' },
        { id: 'name', label: t('sortName'), active: s.organizer.sort === 'name' },
        { id: 'status', label: t('sortStatus'), active: s.organizer.sort === 'status' },
      ];

      const categoryFilterLabel = s.categoryFilter === 'all' ? t('filterCategory')
        : s.categoryFilter === 'favorites' ? t('favoritesFilter')
          : s.categoryFilter === '' ? t('uncategorized')
            : s.organizer.categories.find((c) => c.id === s.categoryFilter)?.name ?? t('filterCategory');
      const statusFilterLabel = s.statusFilter === 'all' ? t('filterStatus') : t(s.statusFilter === 'enabled' ? 'filterEnabled' : 'filterDisabled');
      const sortLabel = t(s.organizer.sort === 'name' ? 'sortName' : s.organizer.sort === 'status' ? 'sortStatus' : 'sortCustom');

      const showsFavorites = !filtering && favorites.length > 0;
      const showsFlatResults = filtering;

      const rowProps = (pkg, catId, extra) => ({
        key: pkg.name,
        pkg,
        catId,
        t,
        resolveText,
        resolveTitle,
        lang,
        dnd: extra.dnd,
        dropTarget: extra.dropTarget,
        dragState,
        onDrop: extra.onDrop,
        onDragOver: extra.onDragOver,
        onDragStartRow: extra.onDragStartRow,
        onDragEndRow: extra.onDragEndRow,
        onJump: extra.onJump,
      });

      return h(Fragment, null,
        h('div', { className: 'dpo-installedHead' },
          h('h2', { className: 'dpo-installedTitle' }, t('bundlesTitle')),
          h('span', { className: 'dpo-installedCount' }, t('categoryCount', { count: String(mine.length) }))),
        h('div', { className: 'dpo-toolbar2' },
          h('div', { className: 'dpo-search' },
            h('input', {
              type: 'search',
              ref: searchRef,
              value: s.search,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchAria'),
              onChange: (event) => patch({ search: event.target.value }),
            }),
            s.search === ''
              ? null
              : h('button', { type: 'button', className: 'dpo-search-clear', 'aria-label': t('clearSearch'), onClick: () => patch({ search: '' }) }, ICONS.close)),
          h(FilterMenu, { label: t('filterCategory'), valueLabel: categoryFilterLabel, items: catFilterItems, onSelect: (id) => patch({ categoryFilter: id }) }),
          h(FilterMenu, { label: t('filterStatus'), valueLabel: statusFilterLabel, items: statusFilterItems, onSelect: (id) => patch({ statusFilter: id }) }),
          h(FilterMenu, { label: t('sortLabel'), valueLabel: sortLabel, items: sortItems, onSelect: (id) => organizerActions.setSort(id, false) }),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', className: 'dpo-btn', onClick: () => organizerActions.expandAll() }, t('expandAll')),
          h('button', { type: 'button', className: 'dpo-btn', onClick: () => organizerActions.collapseAll() }, t('collapseAll')),
          h('button', { type: 'button', className: 'dpo-btn', onClick: () => { setEditCatId(null); setCatDialog(true); } }, ICONS.folder, t('manageCategories'))),
        s.persistError === null ? null : h('div', { className: 'dpo-banner dpo-banner-error', role: 'alert' },
          h('div', { className: 'dpo-banner-text' }, t('persistErrorBanner', { reason: s.persistError.reason })),
          h('div', { className: 'dpo-banner-actions' },
            h('button', { type: 'button', className: 'dpo-btn', onClick: () => persistNow() }, t('retry')))),
        s.undo === null ? null : h('div', { className: 'dpo-undo', role: 'status' },
          h('span', { className: 'dpo-undo-text' }, s.undo.message),
          h('button', { type: 'button', className: 'dpo-btn dpo-btn-quiet', onClick: undoLast }, t('undo'))),
        s.organizerStatus === 'ready' && s.status === 'ready' && !s.organizer.initialized ? h('div', { className: 'dpo-banner' },
          h('div', { className: 'dpo-banner-text' },
            h('strong', { style: { fontWeight: 600 } }, t('templateOfferTitle') + ' '),
            t('templateOfferBody')),
          h('div', { className: 'dpo-banner-actions' },
            h('button', { type: 'button', className: 'dpo-btn dpo-btn-primary', onClick: () => organizerActions.applyTemplate() }, t('templateApply')),
            h('button', { type: 'button', className: 'dpo-btn', onClick: () => organizerActions.dismissTemplate() }, t('templateDismiss')))) : null,
        s.writable === false ? h('p', { className: 'dpo-status', role: 'status' }, ICONS.warn, t('settingsReadonly')) : null,
        s.status === 'error' && s.refreshStatus !== 'refreshing' ? h('div', { className: 'dpo-failure' },
          h('span', { className: 'dpo-dot error' }), t(s.refreshStatus === 'failed' ? 'refreshError' : 'error'),
          h('button', { type: 'button', className: 'dpo-btn', onClick: refresh }, t('retry'))) : null,
        showsFavorites ? h('section', { className: 'dpo-cat' },
          h('div', { className: 'dpo-catHead' },
            h('button', { type: 'button', className: 'dpo-catToggle', 'aria-expanded': true, onClick: () => {} }, ICONS.chevronDown),
            h('h3', { className: 'dpo-catName' }, t('favoritesTitle')),
            h('span', { className: 'dpo-catCount' }, t('categoryCount', { count: String(favorites.length) }))),
          h('ul', { className: 'dpo-catBody' }, favorites.map((pkg) => h(PluginRow, {
            ...rowProps(pkg, s.organizer.placement[pkg.name] ?? '', { dnd: false, dropTarget: null, onDrop: null, onDragOver: null, onDragStartRow: null, onDragEndRow: null, onJump: (name) => jumpTo(name, false) }),
          })))) : null,
        !showsFlatResults ? categories.map((cat) => {
          const catId = cat.id === '' ? '' : cat.id;
          const members = membersByCategory.get(catId) ?? [];
          return h(CategorySection, {
            key: catId,
            cat,
            members,
            t,
            resolveText,
            resolveTitle,
            lang,
            collapsed: s.organizer.collapsed.includes(catId),
            dnd,
            dropTarget,
            setDropTarget,
            dragState,
            onDragStartCategory: dnd ? onDragStartCategory : null,
            onDragEndCategory,
            onDropCategory: dnd ? onDropCategory : null,
            onDragOverCategory: dnd ? onDragOverCategory : null,
            onDropRow: dnd ? onDropIntoCategory : null,
            onDragOverRow: dnd ? onDragOverRow : null,
            onDragStartRow: dnd ? onDragStartRow : null,
            onDragEndRow,
            onJump: jumpTo,
            onEdit: (cat) => { setEditCatId(cat.id); setCatDialog(true); },
            onDelete: (cat) => setPendingCategoryDelete(cat),
          });
        }) : null,
        showsFlatResults ? h('section', { className: 'dpo-cat' },
          h('div', { className: 'dpo-catHead' },
            h('button', { type: 'button', className: 'dpo-catToggle', 'aria-expanded': true, onClick: () => {} }, ICONS.chevronDown),
            h('h3', { className: 'dpo-catName' }, t('searchResultsTitle')),
            h('span', { className: 'dpo-catCount' }, t('categoryCount', { count: String(shownMine.length) }))),
          shownMine.length === 0
            ? h('p', { className: 'dpo-catEmpty' }, t('searchEmpty'))
            : h('ul', { className: 'dpo-catBody' },
              sortMembers({ ...s.organizer, sort: s.organizer.sort === 'custom' ? 'name' : s.organizer.sort }, null, shownMine, resolveTitle, lang)
                .map((pkg) => h(PluginRow, {
                  ...rowProps(pkg, s.organizer.placement[pkg.name] ?? '', { dnd: false, dropTarget: null, onDrop: null, onDragOver: null, onDragStartRow: null, onDragEndRow: null, onJump: jumpTo }),
                })))) : null,
        !filtering && mine.length === 0 && s.status === 'ready' ? h('div', { className: 'dpo-empty' }, h('strong', null, t('empty'))) : null,
        catDialog ? h(CategoryManagerDialog, { t, onClose: () => { setCatDialog(false); setEditCatId(null); }, initialEdit: editCatId }) : null,
        pendingCategoryDelete ? h(Modal, {
          title: t('deleteCategoryConfirmTitle', { name: pendingCategoryDelete.name }),
          onClose: () => setPendingCategoryDelete(null),
          footer: [
            h('button', { type: 'button', className: 'dpo-btn', onClick: () => setPendingCategoryDelete(null) }, t('cancel')),
            h('button', { type: 'button', className: 'dpo-btn dpo-btn-danger', onClick: () => { organizerActions.deleteCategory(pendingCategoryDelete.id); setPendingCategoryDelete(null); } }, t('delete')),
          ],
          children: h('p', { style: { margin: 0 } }, t('deleteCategoryConfirmBody', { count: String(categoryMembers(s.organizer, pendingCategoryDelete.id).length) })),
        }) : null);
    }

    /* ---- detail views ----------------------------------------------------- */

    function Crumb({ label, onClick }) {
      return h('div', { className: 'dpo-crumbRow' },
        h('button', { type: 'button', className: 'dpo-crumb', onClick }, ICONS.chevronLeft, h('span', null, label)));
    }

    function RowsSection({ rows, t, resolveText, toggle, configure }) {
      const [filter, setFilter] = useState('');
      const query = filter.trim().toLowerCase();
      const localized = rows.map((row) => ({ row, ...rowText(row, resolveText) }));
      const shown = query === ''
        ? localized
        : localized.filter(({ row, title, description }) =>
          [title, description, row.rowId, row.moduleName].some((value) => value?.toLowerCase().includes(query)));
      const partsSummary = () => {
        const failed = rows.filter((row) => row.phase === 'failed').length;
        const off = rows.filter((row) => !row.enabled).length;
        const running = rows.filter((row) => row.enabled && row.phase === 'active').length;
        return [
          t('partsCountTotal', { count: String(rows.length) }),
          ...(running > 0 ? [t('partsCountRunning', { count: String(running) })] : []),
          ...(off > 0 ? [t('partsCountOff', { count: String(off) })] : []),
          ...(failed > 0 ? [t('partsCountFailed', { count: String(failed) })] : []),
        ].join(' · ');
      };
      return h('section', { className: 'dpo-section', 'data-plugin-rows': true },
        h('div', { className: 'dpo-sectionHead' },
          h('h4', { className: 'dpo-sectionTitle' }, t('partsLabel')),
          rows.length === 0 ? null : h('span', { className: 'dpo-sectionCount' }, partsSummary())),
        rows.length === 0 ? h('p', { className: 'dpo-status' }, t('partsEmpty')) : null,
        rows.length > 10 ? h('input', {
          type: 'search',
          className: 'dpo-select',
          placeholder: t('partsFilter'),
          'aria-label': t('partsFilter'),
          value: filter,
          style: { marginBottom: 8 },
          onChange: (event) => setFilter(event.target.value),
        }) : null,
        rows.length > 0 && shown.length === 0 ? h('p', { className: 'dpo-status' }, t('partsFilterEmpty')) : null,
        shown.length === 0 ? null : h('ul', { className: 'dpo-rows' },
          shown.map(({ row, title, description }) => {
            const locked = row.readOnlyReason !== undefined || row.entryId === undefined;
            const dotState = !row.enabled || row.phase === null ? 'idle' : PHASE_STATES[row.phase] ?? 'idle';
            const stateText = !row.enabled ? t('partOff') : row.phase === null ? t('rowStateIdle') : t(PHASE_KEYS[row.phase] ?? 'rowStateIdle');
            return h('li', { key: row.rowId, 'data-plugin-row': row.entryId ?? row.rowId },
              h('span', { className: 'dpo-rowDot' }, h('span', { className: `dpo-dot ${dotState}` })),
              h('div', { className: 'dpo-rowInfo', style: { flex: 1, minWidth: 0 } },
                configure?.has(row) === true
                  ? h('button', { type: 'button', className: 'dpo-rowCfg', onClick: () => configure.open(row) },
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title), ICONS.chevronRight)
                  : h('span', { style: { fontSize: 13 } }, title),
                description === undefined ? null : h('div', { className: 'dpo-rowSub' }, description),
                title === row.rowId ? null : h('div', { className: 'dpo-rowSub' }, h('code', null, row.rowId))),
              h('span', { className: 'dpo-rowMeta', style: { marginRight: 8 } }, stateText),
              toggle === undefined ? null : h(Switch, {
                checked: row.enabled,
                label: t('partToggle', { name: title }),
                disabled: toggle.busy(row) || locked,
                title: row.readOnlyReason === undefined ? undefined : managementText({ code: row.readOnlyReason }),
                onChange: (enabled) => toggle.onSetEnabled(row, enabled),
              }));
          })));
    }

    function SourceSection({ pkg, t }) {
      if (pkg.source === undefined && !pkg.installed && pkg.availability === 'installation' && !pkg.optional) return null;
      return h('section', { className: 'dpo-section', 'data-plugin-source': true },
        h('div', { className: 'dpo-sectionHead' }, h('h4', { className: 'dpo-sectionTitle' }, t('sourceTitle'))),
        h('dl', { className: 'dpo-facts' },
          h('div', null,
            h('dt', null, t('sourceSpec')),
            h('dd', null, pkg.source !== undefined
              ? h('code', null, pkg.source)
              : pkg.availability === 'missing' ? t(pkg.installed ? 'statusMissingFiles' : 'statusNotInstalled') : t('sourceBuiltIn'))),
          pkg.version === undefined ? null : h('div', null, h('dt', null, t('sourceVersion')), h('dd', null, pkg.version))));
    }

    function PackageDetailView({ pkg, t, resolveText, renderSlot, ledger, onBack }) {
      const s = useApp();
      const { title, description, beta } = packageText(pkg, resolveText);
      const status = packageStatus(pkg);
      const busy = s.busy.includes(pkg.name);
      const configured = ledger.bundles.has(pkg.name);
      const configure = {
        has: (row) => ledger.rows.has(rowConfigKey(pkg.name, row.rowId)),
        open: (row) => setView({ kind: 'row', name: pkg.name, rowId: row.rowId }),
      };
      const subject = { kind: 'bundle', pkg: { name: pkg.name, ...(pkg.version === undefined ? {} : { version: pkg.version }), installed: pkg.installed, availability: pkg.availability, official: pkg.official, enabled: pkg.enabled, rows: pkg.rows.map((row) => ({ rowId: row.rowId, moduleName: row.moduleName, enabled: row.enabled })) } };
      return h('div', { className: 'dpo-detail', 'data-plugin-detail': pkg.name },
        h(Crumb, { label: t('crumbRoot'), onClick: onBack }),
        h('div', { className: 'dpo-detailHead' },
          h(PackageArtwork, { pkg }),
          h('div', { className: 'dpo-detailMain' },
            h('h3', { className: 'dpo-detailTitle' },
              title,
              pkg.version === undefined ? null : Tag({ children: t('versionTag', { version: pkg.version }) }),
              beta ? Tag({ children: t('statusBeta'), tone: 'info' }) : null,
              status === 'problem' ? Tag({ children: t('statusProblem'), tone: 'danger' }) : null,
              pkg.availability === 'missing' ? Tag({ children: t(pkg.installed ? 'statusMissingFiles' : 'statusNotInstalled') }) : null,
              updateAvailable(pkg) ? Tag({ children: t('statusUpdateAvailable'), tone: 'info' }) : null,
              renderSlot ? renderSlot('plugins.detail.badge', { subject }) : null),
            h('p', { className: 'dpo-detailName' }, h('code', null, pkg.name)),
            description === undefined ? null : h('p', { className: 'dpo-detailDesc' }, description)),
          h('div', { className: 'dpo-detailActions' },
            renderSlot ? renderSlot('plugins.detail.actions', { subject }) : null,
            updateAvailable(pkg) ? h('button', {
              type: 'button',
              className: 'dpo-btn',
              disabled: busy,
              onClick: () => update(pkg.name),
            }, ICONS.refresh, t('update')) : null,
            pkg.installed || pkg.removable ? h('button', {
              type: 'button',
              className: 'dpo-btn dpo-btn-danger',
              disabled: busy || !pkg.removable || pkg.readOnlyReason !== undefined,
              onClick: () => uninstall(pkg.name),
            }, ICONS.trash, t('uninstall')) : null,
            h(EnableSwitch, { pkg, title, t, busy, onSetEnabled: (enabled) => { patch({ activation: enabled ? pkg.name : null }); setEnabled(pkg.name, enabled); } }))),
        pkg.error === undefined ? null : h('p', { className: 'dpo-reason' }, t('reasonLabel') + ': ' + managementText(pkg.error)),
        pkg.readOnlyReason === undefined ? null : h('p', { className: 'dpo-reason' }, managementText({ code: pkg.readOnlyReason })),
        configured && renderSlot ? h('section', { className: 'dpo-section', 'data-plugin-config': true }, renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: pkg.name })) : null,
        pkg.availability === 'missing' ? null : h(RowsSection, {
          rows: pkg.rows,
          t,
          resolveText,
          toggle: pkg.enabled ? {
            busy: (row) => busy || s.busy.includes(rowKey(row.entryId ?? row.rowId)),
            onSetEnabled: (row, enabled) => {
              if (row.entryId !== undefined) setRowEnabled(row.entryId, enabled);
            },
          } : undefined,
          configure,
        }),
        h(SourceSection, { pkg, t }),
        renderSlot ? renderSlot('plugins.detail.section', { subject }) : null);
    }

    function RowDetailView({ pkg, row, t, resolveText, renderSlot, formFor, onBack }) {
      const { title } = packageText(pkg, resolveText);
      const { title: rowTitle, description } = rowText(row, resolveText);
      const key = rowConfigKey(pkg.name, row.rowId);
      const subject = {
        kind: 'row',
        pkg: { name: pkg.name, version: pkg.version, installed: pkg.installed, availability: pkg.availability, official: pkg.official, enabled: pkg.enabled, rows: pkg.rows.map((r) => ({ rowId: r.rowId, moduleName: r.moduleName, enabled: r.enabled })) },
        row: { rowId: row.rowId, moduleName: row.moduleName, enabled: row.enabled },
      };
      const form = formFor(row.rowId);
      return h('div', { className: 'dpo-detail', 'data-plugin-row-detail': key },
        h(Crumb, { label: title, onClick: onBack }),
        h('div', { className: 'dpo-detailMain' },
          h('h3', { className: 'dpo-detailTitle' }, rowTitle),
          rowTitle === row.rowId ? null : h('p', { className: 'dpo-detailName' }, h('code', null, row.rowId)),
          h('p', { className: 'dpo-detailName' }, h('code', null, row.moduleName)),
          description === undefined ? null : h('p', { className: 'dpo-detailDesc' }, description)),
        renderSlot ? renderSlot('plugins.row.config', { view: 'page', form }, { entryKey: key }) : null,
        renderSlot ? renderSlot('plugins.detail.section', { subject }) : null);
    }

    function ItemDetailView({ item, t, renderSlot, formFor, onBack }) {
      const subject = { kind: 'item', id: item.id };
      const form = formFor(item.id);
      return h('div', { className: 'dpo-detail', 'data-plugin-item-detail': item.id },
        h(Crumb, { label: t('crumbRoot'), onClick: onBack }),
        h('div', { className: 'dpo-detailMain' },
          h('h3', { className: 'dpo-detailTitle' }, item.label,
            renderSlot ? renderSlot('plugins.detail.badge', { subject }) : null),
          renderSlot ? h('p', { className: 'dpo-detailDesc' }, renderSlot('plugins.item', { view: 'summary' }, { only: item.id })) : null),
        renderSlot ? h('section', { className: 'dpo-section', 'data-plugin-config': true }, renderSlot('plugins.item', { view: 'page', form }, { only: item.id })) : null,
        renderSlot ? renderSlot('plugins.detail.section', { subject }) : null);
    }

    /* ---- install dialog --------------------------------------------------- */

    const INPUT_PROBLEM_KEYS = {
      'invalid-spec': 'installProblemInvalid',
      'already-installed': 'installProblemInstalled',
      shipped: 'installProblemShipped',
      'not-found': 'installProblemNotFound',
      'not-a-package': 'installProblemNotPackage',
      'not-a-bundle': 'installProblemNotBundle',
      network: 'installProblemNetwork',
      unknown: 'installProblemUnknown',
    };

    const FAILURE_KIND_KEYS = {
      'pnpm-missing': 'installFailurePnpmMissing',
      timeout: 'installFailureTimeout',
      'not-found': 'installFailureNotFound',
      'no-matching-version': 'installFailureNoMatchingVersion',
      network: 'installFailureNetwork',
      'disk-full': 'installFailureDiskFull',
      permission: 'installFailurePermission',
      'build-blocked': 'installFailureBuildBlocked',
      integrity: 'installFailureIntegrity',
      unknown: 'installFailureGeneric',
    };

    function failureText(failure, t) {
      if (failure === null || failure === undefined) return t('installFailureGeneric');
      if (failure.kind !== undefined && FAILURE_KIND_KEYS[failure.kind] !== undefined) return t(FAILURE_KIND_KEYS[failure.kind]);
      if (failure.code !== undefined) return managementText({ code: failure.code, diagnostic: failure.reason });
      return failure.reason !== '' ? failure.reason : t('installFailureGeneric');
    }

    function foldOutput(output, lines) {
      const list = output.split('\n');
      if (list.length <= lines) return output;
      return [...list.slice(0, 6), `… ${list.length - 12} more`, ...list.slice(-6)].join('\n');
    }

    function TerminalBlock({ runs, t }) {
      const [open, setOpen] = useState(false);
      if (runs.length === 0) return h('p', { className: 'dpo-hint' }, t('terminalNoOutput'));
      const shown = open ? runs : runs.map((run) => ({ ...run, output: foldOutput(run.output || '', 12) }));
      return h('div', null,
        h('div', { className: 'dpo-terminalHead' },
          h('span', null, runs.map((run) => `${run.command}`).join(' · ')),
          h('button', { type: 'button', className: 'dpo-btn dpo-btn-quiet', onClick: () => setOpen(!open) }, open ? t('terminalCollapse') : t('terminalExpand'))),
        h('pre', { className: 'dpo-terminal' }, shown.map((run) => run.output || t('terminalNoOutput')).join('\n')));
    }

    function InstallDialog({ t }) {
      const s = useApp();
      const install = s.install;
      if (!install.open) return null;
      const pending = isInstallPending(install.phase);
      const phaseTitle = install.phase === 'starting' || install.phase === 'running' ? t('installingTitle')
        : install.phase === 'applying' ? t('installApplying')
          : install.phase === 'cancelling' ? t('installCancelling')
            : install.phase === 'done' ? t('installedTitle')
              : install.phase === 'failed' ? t('installFailedTitle')
                : install.phase === 'unknown' || install.phase === 'unconfirmed' ? t('installUnknownTitle')
                  : install.phase === 'checking' ? t('installChecking')
                    : t('installTitle');
      const atSpec = install.phase === 'idle' || install.phase === 'checking' || (install.phase === 'failed' && install.subject === null);
      const inputError = install.inputError === null ? null
        : t(INPUT_PROBLEM_KEYS[install.inputError.problem] ?? 'installProblemUnknown', { reason: install.inputError.reason ?? '' });
      const registries = install.registries;
      const offered = registries === null ? [null] : [...new Set([...(registries.registry === null ? [] : [registries.registry]), ...(registries.fallbackRegistries ?? []), null])];
      const registryLabel = (url) => {
        if (url === null) return t('registryDefault');
        return registryHost(url) === 'registry.npmjs.org' ? t('registryOfficial') : url;
      };
      return h(Modal, {
        title: phaseTitle,
        onClose: pending ? undefined : closeInstall,
        closeLabel: t('close'),
        wide: pending || install.phase === 'done' || install.phase === 'failed',
        children: [
          atSpec ? h(Fragment, null,
            h('div', { className: 'dpo-field' },
              h('label', { htmlFor: 'dpo-install-spec' }, t('installSpecLabel')),
              h('input', {
                id: 'dpo-install-spec',
                type: 'text',
                value: install.spec,
                placeholder: t('installSpecPlaceholder'),
                autoFocus: true,
                disabled: install.phase === 'checking',
                onChange: (event) => editInstallSpec(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && install.phase !== 'checking') runInstall();
                },
              }),
              inputError === null ? null : h('p', { className: 'dpo-fieldError', role: 'alert' }, inputError)),
            h('div', { className: 'dpo-field' },
              h('label', { htmlFor: 'dpo-install-registry' }, t('registryToggle')),
              h('select', {
                id: 'dpo-install-registry',
                className: 'dpo-select',
                value: install.registry.kind === 'custom' ? '__custom' : String(install.registry.registry ?? ''),
                disabled: install.phase === 'checking',
                onChange: (event) => {
                  const value = event.target.value;
                  if (value === '__custom') chooseRegistry('custom', '');
                  else chooseRegistry('offered', value === '' ? null : value);
                },
              },
                offered.map((url) => h('option', { key: String(url), value: String(url ?? '') }, registryLabel(url))),
                h('option', { value: '__custom' }, t('registryCustom'))),
              install.registry.kind === 'custom' ? h('input', {
                type: 'text',
                placeholder: t('registryCustomPlaceholder'),
                value: install.registry.url ?? '',
                onChange: (event) => chooseRegistry('custom', event.target.value),
                style: { marginTop: 6 },
              }) : null),
            h('p', { className: 'dpo-hint' }, t('installDescription') + ' ' + t('installSafety'))) : null,
          pending || install.phase === 'done' || install.phase === 'failed' || install.phase === 'unknown' || install.phase === 'unconfirmed'
            ? h(Fragment, null,
              install.subject !== null ? h('p', { className: 'dpo-status' },
                h('code', { style: { fontSize: '11.5px' } }, install.subject.spec)) : null,
              install.phase === 'done' && install.restartRequired ? h('p', { className: 'dpo-hint', role: 'status' }, t('installDoneRestart')) : null,
              install.phase === 'done' && install.installed !== null ? h('p', { className: 'dpo-status', role: 'status' },
                h('span', { className: 'dpo-dot done' }), install.installed + (install.installedVersion !== null ? ` @ ${install.installedVersion}` : '')) : null,
              install.phase === 'failed' ? h('p', { className: 'dpo-fieldError', role: 'alert' }, failureText(install.failure, t)) : null,
              install.phase === 'unknown' || install.phase === 'unconfirmed' ? h('p', { className: 'dpo-fieldError', role: 'alert' }, t('installUnknownDescription')) : null,
              install.phase === 'failed' && install.failure?.kind === 'build-blocked' && (install.pendingBuilds ?? []).length > 0
                ? h('div', { className: 'dpo-field' },
                  h('p', { style: { margin: 0 }, className: 'dpo-fieldError' }, t('installApprovalTitle')),
                  h('p', { style: { margin: 0 }, className: 'dpo-hint' }, t('installApprovalDescription') + ' ' + t('installApprovalConsequence')),
                  h('p', { style: { margin: 0 }, className: 'dpo-hint' }, t('installApprovalCaution')))
                : null,
              install.detailsOpen ? h(TerminalBlock, { runs: install.runs, t }) : null)
            : null,
        ],
        footer: [
          pending && (install.phase === 'starting' || install.phase === 'running' || install.phase === 'applying' || install.phase === 'cancelling')
            ? h('button', { type: 'button', className: 'dpo-btn', disabled: install.phase === 'cancelling' || install.phase === 'applying', onClick: cancelInstall }, t('installCancel'))
            : null,
          install.phase === 'unknown' || install.phase === 'unconfirmed'
            ? h('button', { type: 'button', className: 'dpo-btn', onClick: reconcileInstall }, t('installReconcile'))
            : null,
          install.phase === 'failed'
            ? h('button', {
              type: 'button',
              className: 'dpo-btn dpo-btn-primary',
              disabled: install.subject === null,
              onClick: () => {
                if (install.failure?.kind === 'build-blocked' && (install.pendingBuilds ?? []).length > 0) approveBuildsAndRetry();
                else runInstall();
              },
            }, install.failure?.kind === 'build-blocked' && (install.pendingBuilds ?? []).length > 0 ? t('installApproveAndRetry') : t('installRetry'))
            : null,
          atSpec
            ? h('button', { type: 'button', className: 'dpo-btn dpo-btn-primary', disabled: install.spec.trim() === '' || install.phase === 'checking', onClick: runInstall }, t('installRun'))
            : null,
          pending || install.phase === 'failed' || install.phase === 'unknown' || install.phase === 'unconfirmed'
            ? h('button', { type: 'button', className: 'dpo-btn dpo-btn-quiet', onClick: toggleInstallDetails }, t(install.detailsOpen ? 'installDetailsHide' : 'installDetailsShow'))
            : null,
          install.phase === 'done' && install.installed !== null
            ? h('button', { type: 'button', className: 'dpo-btn dpo-btn-primary', disabled: install.enabling, onClick: enableInstalled }, t('installEnableNow'))
            : null,
          h('button', { type: 'button', className: 'dpo-btn', onClick: closeInstall }, t('installClose')),
        ],
      });
    }

    /* ---- main page -------------------------------------------------------- */

    class PageBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try { console.error('[dsh-plugin-organizer] page render failed:', error); } catch (ignored) { /* diagnostics only */ }
      }
      render() {
        if (this.state.error !== null) {
          return h('pre', { className: 'dpo-fatal' }, String(this.state.error && (this.state.error.stack || this.state.error.message) || this.state.error));
        }
        return this.props.children;
      }
    }

    function PageShell(props) {
      return h(PageBoundary, null, h(PluginOrganizerPage, props));
    }

    function PluginOrganizerPage(props) {
      const s = useApp();
      const addMenu = useMenu();
      const tProp = typeof props.t === 'function' ? props.t : null;
      const tt = tProp ?? t;
      const renderSlot = typeof props.renderSlot === 'function' ? props.renderSlot : null;
      const resolveText = (value) => (currentCtx?.locale?.resolveText ? currentCtx.locale.resolveText(value) : value);
      const lang = currentCtx?.locale?.getSnapshot?.()?.active ?? 'zh';
      const ledgerSource = useMemo(() => (currentCtx ? configLedgerSource(currentCtx) : null), []);
      const tabSource = useMemo(() => (currentCtx ? tabLedgerSource(currentCtx) : null), []);
      const ledger = ledgerSource ? useSyncExternalStore(ledgerSource.subscribe, ledgerSource.getSnapshot) : { items: [], bundles: new Set(), rows: new Set() };
      const tabs = tabSource ? useSyncExternalStore(tabSource.subscribe, tabSource.getSnapshot) : [];

      useEffect(() => {
        ensure();
      }, []);

      useEffect(() => {
        if (s.highlight === null) return undefined;
        const card = document.querySelector(`[data-plugin-package="${CSS.escape(s.highlight)}"]`);
        if (card !== null && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const dispose = safeTimeout(clearHighlight, HIGHLIGHT_MS);
        return dispose;
      }, [s.highlight]);

      const selectedTab = tabs.some((item) => item.id === s.tab) ? s.tab : INSTALLED_TAB;
      useEffect(() => {
        if (selectedTab !== s.tab) setTab(selectedTab);
      }, [selectedTab, s.tab]);
      useEffect(() => {
        if (s.highlight !== null) setTab(INSTALLED_TAB);
      }, [s.highlight]);

      const listed = s.packages.filter((pkg) => !BUILTIN_PROFILE_BUNDLES.has(pkg.name) && (pkg.installed || pkg.official || pkg.error !== undefined));
      const official = listed.filter((pkg) => pkg.official);
      const ordered = orderOptionalBundles(official);
      const pinned = new Set(official.filter(pinnedToMainList).map((pkg) => pkg.name));
      const extensions = ordered.filter((pkg) => pinned.has(pkg.name));
      const more = ordered;

      const view = s.view;
      const onInstalled = selectedTab === INSTALLED_TAB;
      const openPkg = view.kind === 'package' || view.kind === 'row' ? listed.find((pkg) => pkg.name === view.name) : undefined;
      const openItem = view.kind === 'item' ? ledger.items.find((item) => item.id === view.id) : undefined;
      const openRow = view.kind === 'row' && openPkg !== undefined ? openPkg.rows.find((row) => row.rowId === view.rowId) : undefined;
      const detailFromMore = (view.kind === 'package' || view.kind === 'row') && (view.from === 'more' || (MORE_BUNDLES.includes(view.name) && !pinned.has(view.name)));
      const showsCards = openPkg === undefined && openItem === undefined;
      const showsMoreList = onInstalled && showsCards && (view.kind === 'more' || detailFromMore);
      const showsMainList = onInstalled && showsCards && !showsMoreList;
      const loaded = s.status === 'ready' || s.status === 'error';
      const refreshing = s.refreshStatus === 'refreshing';

      const formFor = (id) => {
        const cf = currentCtx ? currentCtx.get('configForms') : undefined;
        if (cf === undefined) return undefined;
        let configurations;
        try {
          configurations = cf.describe?.()?.getSnapshot?.()?.view?.namespaces ?? [];
        } catch (ignored) {
          return undefined;
        }
        if (!configurations.some((viewRow) => viewRow.ns === id)) return undefined;
        try {
          const form = cf.get(id);
          return { state: form.getSnapshot(), mutate: (ops, revision) => form.mutate(ops, revision) };
        } catch (ignored) {
          return undefined;
        }
      };

      const packageCard = (pkg) => {
        const { title, description, beta } = packageText(pkg, resolveText);
        const status = packageStatus(pkg);
        const busy = s.busy.includes(pkg.name);
        return h('li', {
          className: 'dpo-card',
          key: pkg.name,
          'data-plugin-package': pkg.name,
          'data-plugin-status': status,
          children: h('div', { className: 'dpo-cardBody' },
            h(PackageArtwork, { pkg }),
            h('div', { className: 'dpo-cardMain' },
              h('div', { className: 'dpo-cardTitleRow' },
                h('button', { type: 'button', className: 'dpo-cardTitle', onClick: () => setView({ kind: 'package', name: pkg.name, ...(showsMoreList ? { from: 'more' } : {}) }) }, title),
                beta ? Tag({ children: tt('statusBeta'), tone: 'info' }) : null,
                status === 'problem' ? Tag({ children: tt('statusProblem'), tone: 'danger' }) : null,
                pkg.availability === 'missing' ? Tag({ children: tt(pkg.installed ? 'statusMissingFiles' : 'statusNotInstalled') }) : null,
                updateAvailable(pkg) ? Tag({ children: tt('statusUpdateAvailable'), tone: 'info' }) : null),
              description === undefined ? null : h('div', { className: 'dpo-cardDesc' }, description)),
            h('div', { className: 'dpo-cardEnd' },
              h(EnableSwitch, { pkg, title, t: tt, busy, onSetEnabled: (enabled) => { patch({ activation: enabled ? pkg.name : null }); setEnabled(pkg.name, enabled); } }))),
        });
      };

      const itemCards = ledger.items.map((item) => {
        const summary = renderSlot === null ? null : renderSlot('plugins.item', { view: 'summary' }, { only: item.id });
        return h('li', {
          className: 'dpo-card',
          key: `item:${item.id}`,
          'data-plugin-item': item.id,
          children: h('div', { className: 'dpo-cardBody' },
            PACKAGE_ARTWORK_DEFAULT(),
            h('div', { className: 'dpo-cardMain' },
              h('div', { className: 'dpo-cardTitleRow' },
                h('button', { type: 'button', className: 'dpo-cardTitle', onClick: () => setView({ kind: 'item', id: item.id }) }, item.label)),
              summary === null ? null : h('div', { className: 'dpo-cardDesc' }, summary))),
        });
      });

      const renderGroup = (id, heading, cards) => {
        if (cards.length === 0) return null;
        return h('section', { className: 'dpo-group', 'data-plugin-group': id },
          h('div', { className: 'dpo-groupHead' }, h('h3', { className: 'dpo-groupTitle' }, heading)),
          h('ul', { className: 'dpo-cards' }, cards));
      };

      const contributedContent = () => {
        if (renderSlot === null) return null;
        return renderSlot('plugins.tab', {
          install: installFrom,
          openPackage: (name) => {
            setTab(INSTALLED_TAB);
            setView({ kind: 'package', name });
          },
        }, { only: selectedTab });
      };

      const noticeNode = s.notice === null ? null : h(Toast, { key: s.notice.seq, notice: s.notice, onDone: dismissNotice });

      const activation = s.activation !== null
        ? s.packages.find((pkg) => pkg.name === s.activation && pkg.enabled && !s.busy.includes(pkg.name))
        : undefined;

      return h('section', { className: 'dpo-page', 'data-plugin-panel': true, 'aria-busy': s.status === 'loading' || refreshing },
        showsMainList ? h('header', { className: 'dpo-pageHead', 'data-window-drag': true },
          h('div', { className: 'dpo-pageHeading' },
            h('h1', { className: 'dpo-pageTitle' }, tt('title')),
            h('div', { className: 'dpo-pageIntro' },
              h('span', null, tt('intro')),
              h('button', {
                type: 'button',
                className: 'dpo-btn dpo-btn-quiet',
                style: { padding: '2px 5px' },
                'aria-label': tt('infoLabel'),
                title: tt('infoDescription'),
              }, ICONS.info))),
          h('div', { className: 'dpo-toolbar' },
            h('button', {
              type: 'button',
              className: 'dpo-btn',
              'aria-label': tt('refresh'),
              disabled: !loaded || refreshing,
              onClick: refresh,
            }, refreshing ? h('span', { className: 'dpo-dot ongoing', 'aria-hidden': 'true' }) : ICONS.refresh),
            s.install.requestId === undefined
              ? h('div', { className: 'dpo-addGroup' },
                h('button', { type: 'button', className: 'dpo-btn dpo-btn-primary', disabled: !loaded, onClick: openInstall }, ICONS.plus, tt('addPlugin')),
                h('button', {
                  type: 'button',
                  className: 'dpo-btn dpo-btn-primary dpo-addToggle',
                  disabled: !loaded,
                  'aria-haspopup': 'menu',
                  'aria-label': tt('addPluginMenu'),
                  title: tt('addPluginMenu'),
                  onClick: (event) => {
                    const makeState = () => ({
                      content: () => h(Fragment, null,
                        h('button', {
                          type: 'button',
                          role: 'menuitem',
                          className: 'dpo-menu-item dpo-addMenuRow',
                          onClick: () => {
                            addMenu.close();
                            openInstall();
                          },
                        },
                          ICONS.plus,
                          h('span', { className: 'dpo-addMenuText' },
                            h('span', null, tt('installBySpec')),
                            h('span', { className: 'dpo-addMenuDesc' }, tt('installBySpecDescription')))),
                        (currentCtx?.slots?.entries('plugins.add.actions')?.length ?? 0) > 0
                          ? h('div', { className: 'dpo-menu-sep' })
                          : null,
                        renderSlot === null ? null : renderSlot('plugins.add.actions', { onDismiss: addMenu.close })),
                    });
                    addMenu.anchor(event.currentTarget, makeState)(event);
                  },
                }, ICONS.chevronDown),
                addMenu.MenuView())
              : h('button', { type: 'button', className: 'dpo-btn dpo-btn-primary', disabled: !loaded, onClick: () => setInstall({ open: true }) }, tt('installViewTask')))) : null,
        showsMainList && tabs.length > 0 ? h('div', { className: 'dpo-tabs', role: 'tablist', 'aria-label': tt('tabsLabel') },
          [{ id: INSTALLED_TAB, label: tt('installedTab') }, ...tabs].map((tab) => h('button', {
            type: 'button',
            role: 'tab',
            key: tab.id,
            className: `dpo-tab${selectedTab === tab.id ? ' is-active' : ''}`,
            'aria-selected': selectedTab === tab.id,
            onClick: () => setTab(tab.id),
          }, tab.label))) : null,
        !onInstalled ? h('div', { role: 'tabpanel' }, contributedContent()) : null,
        showsMoreList ? h('header', { className: 'dpo-pageHead', 'data-window-drag': true },
          h(Crumb, { label: tt('crumbRoot'), onClick: () => setView({ kind: 'list' }) }),
          h('h1', { className: 'dpo-pageTitle' }, tt('moreTitle'))) : null,
        onInstalled && !loaded ? h('div', { className: 'dpo-status' },
          s.status === 'loading' ? h(Skeleton, { label: tt('loading') }) : null,
          s.status === 'unavailable' ? h(StatusLine, { state: 'idle', text: tt('unavailable') }) : null) : null,
        onInstalled && loaded && !showsCards && s.status === 'error' && !refreshing ? h('div', { className: 'dpo-failure' },
          h('span', { className: 'dpo-dot error' }), tt(s.refreshStatus === 'failed' ? 'refreshError' : 'error'),
          h('button', { type: 'button', className: 'dpo-btn', onClick: refresh }, tt('retry'))) : null,
        onInstalled && loaded && openRow !== undefined && openPkg !== undefined ? h(RowDetailView, {
          pkg: openPkg,
          row: openRow,
          t: tt,
          resolveText,
          renderSlot,
          formFor,
          onBack: () => setView({ kind: 'package', name: openPkg.name, ...(detailFromMore ? { from: 'more' } : {}) }),
        }) : null,
        onInstalled && loaded && openPkg !== undefined && openRow === undefined ? h(PackageDetailView, {
          pkg: openPkg,
          t: tt,
          resolveText,
          renderSlot,
          ledger,
          onBack: () => setView({ kind: detailFromMore ? 'more' : 'list' }),
        }) : null,
        onInstalled && loaded && openItem !== undefined ? h(ItemDetailView, {
          item: openItem,
          t: tt,
          renderSlot,
          formFor,
          onBack: () => setView({ kind: 'list' }),
        }) : null,
        loaded && onInstalled && showsCards
          ? showsMoreList
            ? h('section', { className: 'dpo-group', 'data-plugin-group': 'more' },
              h('ul', { className: 'dpo-cards' }, more.map(packageCard)))
            : h(Fragment, null,
              renderGroup('basic', tt('basicTitle'), itemCards),
              renderGroup('extensions', tt('extensionsTitle'), extensions.map(packageCard)),
              h(InstalledList, { t: tt, resolveText, lang }))
          : null,
        showsCards && activation !== undefined && !s.install.open && renderSlot !== null
          ? renderSlot('plugins.bundle.activation', {
            packageName: activation.name,
            onDismiss: () => patch({ activation: null }),
            onOpenDetails: () => {
              patch({ activation: null });
              setView({ kind: 'package', name: activation.name, ...(showsMoreList ? { from: 'more' } : {}) });
            },
          }, { entryKey: activation.name })
          : null,
        h(InstallDialog, { t: tt }),
        h(SuggestionDialog, { t: tt }),
        s.moveTo !== undefined && s.moveTo !== null ? h(MoveToCategoryDialog, { name: s.moveTo, t: tt, onClose: () => patch({ moveTo: null }) }) : null,
        s.confirm === null ? null : h(Modal, {
          title: tt('confirmUninstallTitle', { name: s.confirm.name }),
          onClose: cancelConfirm,
          footer: [
            h('button', { type: 'button', className: 'dpo-btn', onClick: cancelConfirm }, tt('cancel')),
            h('button', { type: 'button', className: 'dpo-btn dpo-btn-danger', onClick: confirmPending }, tt('confirmUninstall')),
          ],
          children: h('p', { style: { margin: 0 } }, tt('confirmUninstallDescription')),
        }),
        noticeNode);
    }

    /* ================================================================ */
    /* Plugin                                                             */
    /* ================================================================ */

    const CHILDREN = {
      'plugins.add.actions': { kind: 'list', scope: 'root' },
      'plugins.tab': { kind: 'list', scope: 'root' },
      'plugins.item': { kind: 'list', scope: 'root' },
      'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'plugins.row.config': { kind: 'keyed', scope: 'root' },
      'plugins.detail.actions': { kind: 'list', scope: 'root' },
      'plugins.detail.badge': { kind: 'list', scope: 'root' },
      'plugins.detail.section': { kind: 'list', scope: 'root' },
    };

    const face = {
      resolveText: (text) => (currentCtx?.locale?.resolveText ? currentCtx.locale.resolveText(text) : text),
      ensure,
      refresh,
      openInstall,
      installFrom,
      closeInstall,
      editInstallSpec,
      runInstall,
      cancelInstall,
      reconcileInstall,
      toggleInstallDetails,
      enableInstalled,
      approveBuildsAndRetry,
      chooseRegistry: (kind, url) => chooseRegistry(kind, url),
      dismissNotice,
      confirm: confirmPending,
      cancelConfirm,
      setEnabled,
      setRowEnabled,
      uninstall,
      update,
      clearHighlight,
    };

    /** Sidebar icon for the page; the stock page's entry disappears when its failing client row is disabled. */
    function PluginsPanelIcon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 4, y: 4, width: 6.5, height: 6.5, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('rect', { x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.6, opacity: 0.7 }),
        h('rect', { x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.6, opacity: 0.7 }),
        h('path', { d: 'M14.5 14.5h2.2m-1.1 0v2.2m4.4 1.3h-6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }));
    }

    function apply(ctx) {
      currentCtx = ctx;
      disposed = false;

      // Safety net: nothing in this plugin may take the web boot down. The
      // desktop Host treats a client entry that fails to activate as fatal
      // ("web boot: 1 entry did not activate"), so every risky registration
      // is contained and reported instead of thrown.
      const report = (place, error) => {
        try {
          console.error(`[dsh-plugin-organizer] ${place} failed; the stock Plugins page stays in place:`, error);
        } catch (ignored) { /* never throw from here */ }
      };

      ctx.effect(() => () => {
        disposed = true;
      }, 'plugin-organizer: disposal');

      try {
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'plugin-organizer: zh dictionary');
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'plugin-organizer: en dictionary');
      } catch (error) {
        report('locale registration', error);
      }

      try {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.id = 'dsh-plugin-organizer-style';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'plugin-organizer: styles');
      } catch (error) {
        report('style registration', error);
      }

      try {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 0,
          label: () => t('title'),
          locale: NS,
        }, PluginsPanelIcon));
      } catch (error) {
        report('sidebar entry', error);
      }

      try {
        ctx.effect(() => {
          const disposers = [
            ctx.remote.$on('plugin-manager/changed', () => {
              load();
            }),
            ctx.remote.$on('plugin-manager/install-log', (chunk) => {
              appendLog(chunk);
            }),
            ctx.remote.$on('plugin-manager/install-state', (progress) => {
              installProgress(progress);
            }),
            ctx.remote.$on('settings/document-updated', () => {
              loadOrganizer();
            }),
            ctx.on('connection/reset', () => {
              if (!reasserted && typeof reassertMain === 'function') {
                reasserted = true;
                try {
                  reassertMain();
                } catch (error) {
                  report('main panel re-assert', error);
                }
              }
              load();
              loadOrganizer();
            }),
          ];
          return () => {
            for (const dispose of disposers) dispose();
          };
        }, 'plugin-organizer: host invalidations');
      } catch (error) {
        report('host invalidation wiring', error);
      }

      try {
        // Replace the stock Installed-plugins panel. Registration is made
        // twice on purpose:
        //   1. once now, so the panel works even if this module is the only
        //      provider of the `plugins` key;
        //   2. again after a short delay, because the slot catalog replaces an
        //      occupant when its key is registered again — re-asserting after
        //      the boot pass makes this page the final occupant regardless of
        //      the order modules activate in.
        // The shell's built-in fallback owns `main[plugins]` at priority 0.
        // A same-priority registration is rejected, so this page enters at
        // priority -1 (lowest renders) and shadows the fallback for that key.
        // Child slots (`plugins.tab`, `plugins.item`, …) stay declared by the
        // fallback entry: re-declaring them here throws "already declared",
        // while the declarations themselves remain globally usable.
        const mainRegistration = () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          priority: -1,
          locale: NS,
          inject: () => face,
        }, PageShell);

        // The built-in page normally provides this navigation facade; when it
        // failed to activate, provide it here so other plugins that inject
        // `pluginNavigation` do not stay pending.
        try {
          const disposeNavigation = ctx.provide('pluginNavigation', {
            openList: () => {
              const layout = ctx.get('layout');
              if (layout?.selectPanel) layout.selectPanel(PANEL_ID);
              setTab(INSTALLED_TAB);
              setView({ kind: 'list' });
            },
            openBundle: (packageName) => {
              const layout = ctx.get('layout');
              if (layout?.selectPanel) layout.selectPanel(PANEL_ID);
              setTab(INSTALLED_TAB);
              setView({ kind: 'package', name: packageName });
            },
          });
          void disposeNavigation;
        } catch (error) {
          report('pluginNavigation', error);
        }

        ctx.slots.inject('main', () => {
          let dispose;
          const registerSafe = () => {
            try {
              return mainRegistration();
            } catch (error) {
              report('main panel registration', error);
              return undefined;
            }
          };
          reassertMain = () => {
            if (disposed) return;
            if (typeof dispose === 'function') {
              try {
                dispose();
              } catch (ignored) { /* replaced entry already disposed */ }
            }
            dispose = registerSafe();
          };
          dispose = registerSafe();
          const reassert = safeTimeout(reassertMain, 400);
          const layout = ctx.get('layout');
          let offPanel;
          try {
            offPanel = layout?.panelInfo?.subscribe
              ? layout.panelInfo.subscribe(() => {
                if (layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID) resetView();
              })
              : undefined;
          } catch (error) {
            report('panel info subscription', error);
          }
          return () => {
            reassertMain = null;
            if (typeof reassert === 'function') reassert();
            if (typeof offPanel === 'function') offPanel();
            if (typeof dispose === 'function') {
              try {
                dispose();
              } catch (ignored) { /* already disposed */ }
            }
          };
        });
      } catch (error) {
        report('main slot injection', error);
      }
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.pluginManager', 'remote.pluginInventory', 'remote.settings'],
      apply,
      __pure: {
        freshOrganizer,
        migrateOrganizer,
        normalizeOrganizer,
        mergeOrganizer,
        movePlugin,
        moveCategory,
        validateCategoryName,
        suggestCategory,
        buildTemplateCategories,
        sortMembers,
        matchesSearch,
        orderedCategoryIds,
        categoryMembers,
        TEMPLATE_CATEGORIES,
        SUGGESTION_RULES,
      },
    };
  },
});
