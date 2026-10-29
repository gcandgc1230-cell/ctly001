/**
 * Unit tests for the pure logic of dsh-plugin-organizer.
 *
 * Run with node: `node logic.test.mjs`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(dir, 'client.js'), 'utf8');

let captured = null;
const reactStub = {
  createElement: (...args) => args,
  Fragment: Symbol('Fragment'),
  Component: class Component {
    constructor(props) { this.props = props; this.state = {}; }
  },
  useState: () => [null, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};
globalThis.window = {
  __ModuleLoader__: {
    load(mod) {
      captured = mod;
    },
  },
};

// Executing the client module source checks its syntax and top-level safety.
new Function(source)(); // eslint-disable-line no-new-func

assert.ok(captured, 'module loader captured the client module');
const factory = captured.factory;
const moduleExports = factory((name) => (name === 'react' ? reactStub : undefined));
const pure = moduleExports.__pure;
assert.ok(pure, '__pure export present');

const {
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
  categoryMembers,
} = pure;

const dictT = (key) => (key === 'uncategorized' ? '未分类' : key);
const resolveTitle = (pkg) => pkg.title ?? pkg.name;
const resolveText = (v) => v;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

/* ---- category name validation ---------------------------------------- */

test('rejects empty category names', () => {
  assert.equal(validateCategoryName('   ', [], dictT), 'nameEmpty');
});

test('rejects duplicate names case-insensitively', () => {
  const categories = [{ id: 'a', name: '网络搜索与浏览器' }];
  assert.equal(validateCategoryName(' 网络搜索与浏览器 ', categories, dictT), 'nameDuplicate');
  assert.equal(validateCategoryName('network', [{ id: 'a', name: 'Network' }], dictT), 'nameDuplicate');
});

test('rejects the reserved uncategorized name', () => {
  assert.equal(validateCategoryName('未分类', [], dictT), 'nameReserved');
});

test('accepts a fresh valid name', () => {
  assert.equal(validateCategoryName('开发与编程', [{ id: 'a', name: '其他插件' }], dictT), null);
});

/* ---- merge / cleanup --------------------------------------------------- */

test('merge keeps valid data and appends new packages at the end', () => {
  const org = freshOrganizer();
  const merged = mergeOrganizer(org, ['pkg-b', 'pkg-a', 'pkg-c']);
  assert.deepEqual(merged.order[''], ['pkg-b', 'pkg-a', 'pkg-c']);
  assert.equal(merged.placement['pkg-a'], null);
});

test('merge drops stale references after uninstall', () => {
  const org = {
    ...freshOrganizer(),
    initialized: true,
    categories: [{ id: 'dev', name: '开发' }],
    placement: { gone: 'dev', kept: 'dev' },
    order: { dev: ['gone', 'kept'], '': [] },
    favorites: ['gone', 'kept'],
    collapsed: ['dev'],
  };
  const merged = mergeOrganizer(org, ['kept']);
  assert.deepEqual(merged.order.dev, ['kept']);
  assert.equal(merged.placement.gone, undefined);
  assert.deepEqual(merged.favorites, ['kept']);
  assert.deepEqual(merged.collapsed, ['dev']);
});

test('merge moves a package out of a deleted category', () => {
  const org = {
    ...freshOrganizer(),
    categories: [{ id: 'dev', name: '开发' }],
    placement: { pkg: 'dev' },
    order: { dev: ['pkg'], '': [] },
  };
  // category deleted: drop it from categories and placement before merging
  const afterDelete = {
    ...org,
    categories: [],
    placement: { pkg: null },
    order: { '': ['pkg'] },
  };
  const merged = mergeOrganizer(afterDelete, ['pkg']);
  assert.deepEqual(merged.order[''], ['pkg']);
  assert.equal(merged.placement.pkg, null);
});

test('merge preserves the saved custom order and ranks new packages last', () => {
  const org = {
    ...freshOrganizer(),
    categories: [{ id: 'dev', name: '开发' }],
    placement: { a: 'dev', b: 'dev', n1: null, n2: null },
    order: { dev: ['b', 'a'], '': ['n2', 'n1'] },
  };
  const merged = mergeOrganizer(org, ['a', 'b', 'n1', 'n2', 'fresh']);
  assert.deepEqual(merged.order.dev, ['b', 'a']);
  assert.deepEqual(merged.order[''], ['n2', 'n1', 'fresh']);
});

/* ---- moves ------------------------------------------------------------- */

test('move within one category: before and after', () => {
  let org = {
    ...freshOrganizer(),
    categories: [{ id: 'dev', name: '开发' }],
    placement: { a: 'dev', b: 'dev', c: 'dev' },
    order: { dev: ['a', 'b', 'c'], '': [] },
  };
  org = movePlugin(org, 'c', 'dev', 'before', 'a');
  assert.deepEqual(org.order.dev, ['c', 'a', 'b']);
  org = movePlugin(org, 'a', 'dev', 'after', 'b');
  assert.deepEqual(org.order.dev, ['c', 'b', 'a']);
});

test('move across categories keeps a single instance', () => {
  const org0 = {
    ...freshOrganizer(),
    categories: [{ id: 'dev', name: '开发' }, { id: 'ai', name: 'AI' }],
    placement: { a: 'dev', b: 'dev', m: 'ai' },
    order: { dev: ['a', 'b'], ai: ['m'], '': [] },
  };
  const org1 = movePlugin(org0, 'b', 'ai', 'end');
  assert.deepEqual(org1.order.dev, ['a']);
  assert.deepEqual(org1.order.ai, ['m', 'b']);
  assert.equal(org1.placement.b, 'ai');
  const flat = [...categoryMembers(org1, 'dev'), ...categoryMembers(org1, 'ai')];
  assert.deepEqual(flat.sort(), ['a', 'b', 'm']);
});

test('move to uncategorized', () => {
  const org0 = {
    ...freshOrganizer(),
    categories: [{ id: 'dev', name: '开发' }],
    placement: { a: 'dev' },
    order: { dev: ['a'], '': [] },
  };
  const org1 = movePlugin(org0, 'a', null, 'end');
  assert.deepEqual(org1.order.dev, []);
  assert.deepEqual(org1.order[''], ['a']);
  assert.equal(org1.placement.a, null);
});

test('category reorder clamps at both ends', () => {
  const org = {
    ...freshOrganizer(),
    categories: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
  };
  const up = moveCategory(org, 'c', -1);
  assert.deepEqual(up.categories.map((c) => c.id), ['a', 'c', 'b']);
  const down = moveCategory(org, 'a', 1);
  assert.deepEqual(down.categories.map((c) => c.id), ['b', 'a', 'c']);
  assert.equal(moveCategory(org, 'a', -5), org);
  assert.equal(moveCategory(org, 'c', 5), org);
});

/* ---- sorting ------------------------------------------------------------ */

test('custom sort follows the stored order', () => {
  const org = {
    ...freshOrganizer(),
    categories: [{ id: 'dev', name: '开发' }],
    placement: { a: 'dev', b: 'dev', c: 'dev' },
    order: { dev: ['c', 'a', 'b'], '': [] },
  };
  const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(sortMembers(org, 'dev', items, resolveTitle, 'en').map((p) => p.name), ['c', 'a', 'b']);
});

test('name sort is locale aware', () => {
  const org = { ...freshOrganizer(), sort: 'name' };
  const items = [{ name: 'z' }, { name: 'a' }, { name: 'm' }];
  assert.deepEqual(sortMembers(org, '', items, resolveTitle, 'en').map((p) => p.name), ['a', 'm', 'z']);
});

test('status sort puts enabled first', () => {
  const org = { ...freshOrganizer(), sort: 'status' };
  const items = [{ name: 'b', enabled: false }, { name: 'a', enabled: true }, { name: 'c', enabled: false }];
  assert.deepEqual(sortMembers(org, '', items, resolveTitle, 'en').map((p) => p.name), ['a', 'b', 'c']);
});

test('rapid consecutive moves leave a consistent order', () => {
  let org = freshOrganizer();
  const names = Array.from({ length: 12 }, (_, i) => `pkg-${i}`);
  org = mergeOrganizer(org, names);
  const move = (name, pos, ref) => {
    org = movePlugin(org, name, null, pos, ref);
  };
  move('pkg-0', 'after', 'pkg-5');
  move('pkg-11', 'before', 'pkg-1');
  move('pkg-3', 'end');
  move('pkg-7', 'start');
  move('pkg-0', 'after', 'pkg-11');
  move('pkg-11', 'end');
  const list = org.order[''];
  assert.equal(list.length, 12);
  assert.equal(new Set(list).size, 12, 'no duplicates');
  for (const name of names) assert.ok(list.includes(name), `${name} present`);
});

/* ---- search -------------------------------------------------------------- */

test('search matches name, title, description and rows; AND across terms', () => {
  const pkg = {
    name: 'dsh-plugin-bulk-remove',
    title: '批量删除',
    description: 'Bulk removal for installed plugins',
    rows: [{ rowId: 'bulk-remove', moduleName: 'dsh-plugin-bulk-remove' }],
  };
  assert.equal(matchesSearch(pkg, 'bulk', resolveTitle, resolveText), true);
  assert.equal(matchesSearch(pkg, '批量', resolveTitle, resolveText), true);
  assert.equal(matchesSearch(pkg, 'removal', resolveTitle, resolveText), true);
  assert.equal(matchesSearch(pkg, 'bulk 删除', resolveTitle, resolveText), true);
  assert.equal(matchesSearch(pkg, 'whale', resolveTitle, resolveText), false);
  assert.equal(matchesSearch(pkg, 'bulk whale', resolveTitle, resolveText), false);
});

/* ---- suggestions ---------------------------------------------------------- */

test('suggestCategory recognizes model and search plugins, and falls back to null', () => {
  const categoriesById = new Map(buildTemplateCategories((v) => v.zh).map((c) => [c.id, c]));
  const llm = { name: 'dsh-plugin-llm-boost', title: 'LLM 模型增强', description: 'better model routing', rows: [] };
  const web = { name: 'dsh-plugin-web-search', title: '网络搜索', description: 'browse the web', rows: [] };
  const unknown = { name: 'dsh-plugin-mystery', title: 'mystery tool', description: 'does things', rows: [] };
  assert.equal(suggestCategory(llm, categoriesById, resolveTitle), 'ai-model');
  assert.equal(suggestCategory(web, categoriesById, resolveTitle), 'web-search');
  assert.equal(suggestCategory(unknown, categoriesById, resolveTitle), null);
});

test('suggestCategory never picks a category that does not exist', () => {
  const categoriesById = new Map([[ 'ai-model', { id: 'ai-model', name: 'AI' } ]]);
  const web = { name: 'dsh-plugin-web-search', title: 'Web search', description: '', rows: [] };
  assert.equal(suggestCategory(web, categoriesById, resolveTitle), null);
});

/* ---- normalization ---------------------------------------------------------- */

test('normalizeOrganizer repairs malformed stored documents', () => {
  const raw = {
    sort: 'bogus',
    categories: [{ id: 'a', name: 'A' }, { id: '', name: '' }, { id: 'a', name: 'dup' }, 'junk'],
    placement: { pkg: 'missing-cat', ok: 'a', nope: 42 },
    order: { a: ['ok', 123, null], nope: ['x'] },
    favorites: ['ok', 'ok', 7],
    collapsed: ['a', 'a', 'missing'],
  };
  const org = normalizeOrganizer(raw);
  assert.equal(org.sort, 'custom');
  assert.deepEqual(org.categories.map((c) => c.id), ['a']);
  assert.deepEqual(org.placement, { ok: 'a' });
  assert.deepEqual(org.order.a, ['ok']);
  assert.equal(org.order.nope, undefined);
  assert.deepEqual(org.favorites, ['ok']);
  assert.deepEqual(org.collapsed, ['a']);
});

test('normalizeOrganizer falls back for non-object input', () => {
  const org = normalizeOrganizer('garbage');
  assert.deepEqual(org, freshOrganizer());
});

test('migrateOrganizer upgrades legacy version 0 and keeps its fields', () => {
  const legacy = { categories: [{ id: 'a', name: 'A' }], placement: { p: 'a' } };
  const migrated = migrateOrganizer(legacy);
  assert.equal(migrated.version, 1);
  assert.deepEqual(migrated.categories, legacy.categories);
  const org = normalizeOrganizer(legacy);
  assert.equal(org.version, 1);
  assert.deepEqual(org.placement, { p: 'a' });
});

test('migrateOrganizer leaves newer data readable and normalize clamps the version', () => {
  const future = { version: 99, categories: [{ id: 'a', name: 'A' }], placement: { p: 'a' }, futureField: true };
  assert.equal(migrateOrganizer(future).version, 99);
  const org = normalizeOrganizer(future);
  assert.equal(org.version, 1);
  assert.deepEqual(org.placement, { p: 'a' });
});

console.log(`\n${passed} tests passed`);
