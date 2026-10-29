/**
 * Host half of dsh-plugin-organizer.
 *
 * The whole organizer layout (categories, custom order, favorites, collapsed
 * state, sort mode) is one plain JSON document persisted through the DSH
 * settings system under this entry's namespace (`plugin-organizer`). Declaring
 * the field `volatile` makes it editable live through `ctx.remote.settings`
 * without restarting, and the settings service already handles optimistic
 * revisions and atomic writes for us.
 *
 * schemastery (and its cosmokit dependency) are vendored under `vendor/`
 * with a relative import: profile-linked bundles cannot resolve bare
 * `@deepseek-ai/*` specifiers from outside the profile directory, and an
 * unresolvable import fails the whole Host startup.
 */
import z from './vendor/schemastery/index.mjs';

export const Config = z.object({
  organizer: z.any().volatile(),
});

export function apply(ctx) {
  // Keep the auto-generated Settings page hidden, but never let this optional
  // UI policy block Host startup: a duplicate policy, a late Settings service,
  // or a service-shape change is swallowed instead of failing the boot.
  try {
    const settings = ctx.get('settings');
    if (settings !== undefined && typeof settings.configure === 'function') {
      settings.configure({ auto: false }, ctx.fiber);
    }
  } catch (ignored) { /* optional UI policy only */ }
}
