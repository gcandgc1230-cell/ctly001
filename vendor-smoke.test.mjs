/**
 * Smoke test: the vendored schemastery must produce a Config the settings
 * system can project: validate + volatile wrap + toJSON round-trip.
 */
import z from '../dsh-plugin-organizer/vendor/schemastery/index.mjs';

const Config = z.object({
  organizer: z.any().volatile(),
});

// 1. plain validation
const out = Config({ organizer: { sort: 'custom', categories: [] } });
if (typeof out.organizer.get !== 'function') throw new Error('organizer should be a volatile reference');
if (out.organizer.get().sort !== 'custom') throw new Error('volatile value wrong');

// 2. undefined config resolves with a wrapped undefined field (schemastery semantics)
const empty = Config(undefined);
if (typeof empty?.organizer?.get !== 'function' || empty.organizer.get() !== undefined) {
  throw new Error('expected volatile-wrapped undefined passthrough');
}

// 3. toJSON round-trip through a second schemastery copy (what settings does)
const json = Config.toJSON();
const rebuilt = new z(json);
const via = rebuilt({ organizer: { favorites: ['a'] } });
if (via.organizer.get().favorites[0] !== 'a') throw new Error('round-trip failed');

// 4. the projection the settings service performs
function volatileForm(schema) {
  if (schema.meta.volatile) return schema;
  if (schema.type === 'object') {
    const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = volatileForm(child);
      return field === undefined ? [] : [[key, field]];
    }));
    return Object.keys(dict).length === 0 ? undefined : z.object(dict);
  }
}
const form = volatileForm(rebuilt);
if (form === undefined) throw new Error('expected a volatile form');
const projected = (function projectForm(schema, value) {
  if (schema.type === 'object' && value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = Reflect.get(value, key);
      return field === undefined ? [] : [[key, projectForm(child, field)]];
    }));
  }
  return value;
})(form, { organizer: { sort: 'name' } });
if (projected.organizer.sort !== 'name') throw new Error('projection failed');

// 5. volatile path check (settings.write guards)
function isVolatilePath(schema, path) {
  if (schema.meta.volatile) return true;
  const [key, ...rest] = path;
  const child = key === undefined ? undefined : schema.dict?.[key];
  return child !== undefined && isVolatilePath(child, rest);
}
if (!isVolatilePath(rebuilt, ['organizer'])) throw new Error('organizer path should be volatile');

console.log('vendored schemastery smoke test passed');
