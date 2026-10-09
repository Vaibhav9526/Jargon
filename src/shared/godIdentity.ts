/** God's identity before anyone has customized it — the app's own default,
 *  not a magic string sprinkled at every spawn call site. */
export const DEFAULT_GOD_NAME = 'Michael';

/**
 * Resolve god's display name for a (re)spawn.
 *
 * `renameAgent()` (`store.ts`) persists a rename straight into `registry.json`
 * via `hive.ts`'s `renameAgent()` — but the god-spawn effect used to rebuild
 * god's agent object from scratch with `name: DEFAULT_GOD_NAME` hardcoded in
 * three places, so a custom name reverted to "Michael" on every app restart
 * even though the registry still had it right. Reading the persisted name
 * back here (instead of hardcoding the default) is what keeps a rename from
 * reverting. Falls back to the default only when nothing has been persisted
 * yet — a fresh hive, or a registry not yet written this run.
 */
export function resolveGodName(persistedName: string | undefined | null, theme?: string, officeName?: string): string {
  if (theme === 'staffroom') return 'Principal';
  const trimmed = persistedName?.trim();
  if (theme && trimmed === 'Principal') return officeName?.trim() || DEFAULT_GOD_NAME;
  return trimmed ? trimmed : officeName?.trim() || DEFAULT_GOD_NAME;
}

export interface OfficeGodIdentity { name: string; character: string; }
export function godIdentityStorageKey(home: string): string {
  return `jargon:office-god-identity:${home.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()}`;
}
export function officeGodIdentity(name?: string | null, character?: string | null): OfficeGodIdentity {
  const school = ['principal', 'teacher', 'topper', 'smartguy', 'librarian'];
  return {
    name: name?.trim() && name.trim() !== 'Principal' ? name.trim() : DEFAULT_GOD_NAME,
    character: character && !school.includes(character) ? character : 'michael',
  };
}

export function createIdentityRenameQueue(
  rename: (name: string) => Promise<{ ok: boolean; error?: string }>,
  onError: (error: string) => void,
): (name: string) => Promise<void> {
  let desired = '', applied = '', running: Promise<void> | null = null;
  return (name) => {
    desired = name;
    if (!running) {
      applied = '';
      running = (async () => {
        while (desired !== applied) {
          const next = desired;
          try {
            const result = await rename(next);
            if (!result.ok) { onError(result.error ?? 'Could not update leader identity'); break; }
            applied = next;
          } catch (error) { onError(String(error)); break; }
        }
      })().finally(() => { running = null; });
    }
    return running;
  };
}
