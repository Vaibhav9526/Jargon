import { useStore } from '@/store/store';
import { castForTheme, type OfficeCharacterName } from '@/scene/office/cast';
import { quickHire } from './classroom/quickHire';
import type { Address } from '@shared/agentAddress';

const ALL_THEME_NAMES = (theme: string): OfficeCharacterName[] => castForTheme(theme).map((m) => m.name).filter((n) => n !== 'mailman');

/** Open a chat on `id`: the focus view when it is up, otherwise the sidebar selection. */
function showAgent(id: string) {
  const st = useStore.getState();
  if (st.fullscreenAgentId) st.setFullscreen(id); else st.select(id);
}

/**
 * Act on a message addressed to somebody else ("tell michael to …", "wake jim",
 * "I need two more agents"). Sleeping agents are woken as themselves; the task is
 * queued in the target's own terminal and their chat opens so the work is visible.
 * Returns a short note for the composer, or throws with a readable reason.
 */
export async function routeAddress(addr: Address): Promise<string> {
  const config = await window.cth.getConfig();
  const st = () => useStore.getState();

  if (addr.kind === 'agent') {
    const lower = addr.name.toLowerCase();
    let target = st().agents.find((a) => !a.archived && a.name.toLowerCase() === lower) ?? null;
    let woke = false;
    if (!target) {
      const sleeper = st().archivedAgents.find((a) => a.name.toLowerCase() === lower);
      if (!sleeper) throw new Error(`Nobody called ${addr.name} is on the roster.`);
      target = await quickHire(sleeper.character, config);
      woke = true;
    }
    if (addr.body) st().enqueueMessage(target.id, addr.body);
    showAgent(target.id);
    return woke
      ? `Woke ${target.name}${addr.body ? ' and passed your message on.' : '.'}`
      : addr.body ? `Passed your message to ${target.name}.` : `Opened ${target.name}'s chat.`;
  }

  // More agents: wake sleepers first, then hire fresh characters from this floor's cast.
  const theme = st().officeTheme;
  const open = new Set(st().agents.filter((a) => !a.archived).map((a) => a.character));
  const themeNames = ALL_THEME_NAMES(theme);
  const sleeperChars = st().archivedAgents.map((a) => a.character).filter((c) => !open.has(c) && themeNames.includes(c));
  const fresh = themeNames.filter((c) => !open.has(c) && !sleeperChars.includes(c));
  const picks = [...new Set([...sleeperChars, ...fresh])].slice(0, addr.count);
  if (!picks.length) throw new Error('Everyone on this floor is already at their desk.');
  const added: string[] = [];
  let lastErr = '';
  for (const c of picks) {
    try { added.push((await quickHire(c, config)).name); } catch (e) { lastErr = e instanceof Error ? e.message : String(e); break; }
  }
  if (!added.length) throw new Error(lastErr || 'Could not bring in more agents.');
  const god = st().agents.find((a) => a.isGod && !a.archived);
  if (god) {
    st().enqueueMessage(god.id, `The human asked for more agents (“${addr.body.slice(0, 300)}”). ${added.join(', ')} just joined the floor. Check the roster, give each of them work from the task board or this request, and tell the human who is doing what.`);
  }
  return `Brought in ${added.join(', ')}${god ? ` and told ${god.name}.` : '.'}${lastErr ? ` (Stopped early: ${lastErr})` : ''}`;
}
