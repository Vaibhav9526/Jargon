import { useStore, type Agent } from '@/store/store';
import { buildSpawnCommand, inferAgentProvider, isClaudeProvider, tokenizeCommand, type HarnessConfig } from '@/store/config';
import { CAST_BY_NAME, type OfficeCharacterName } from '@/scene/office/cast';
import type { AccentColorName } from '@/design/tokens';
import { ROLE_INFO } from './IdCard';
import { disposeTerminal } from '../terminalPool';

const ACCENT: Partial<Record<OfficeCharacterName, AccentColorName>> = {
  principal: 'sky', teacher: 'coral', topper: 'mint', smartguy: 'lemon', librarian: 'lilac',
};

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/**
 * One-click hire for a school character: the same spawn the Add Agent form does,
 * with its defaults (the global default command/model, the first registered
 * project — or the folder an existing agent already works in).
 */
export async function quickHire(character: OfficeCharacterName, config: HarnessConfig | null | undefined): Promise<Agent> {
  if (!config) throw new Error('Settings are still loading — try again in a moment.');
  const existing = useStore.getState().agents.find((a) => a.character === character && !a.archived);
  if (existing) return existing;

  // A sleeping (archived) agent wakes up as THEMSELVES: same id, so the hive
  // memory and the classroom history survive. ensureAgent clears its archived flag.
  const sleeper = useStore.getState().archivedAgents.find((a) => a.character === character);
  if (sleeper) {
    const prov = sleeper.provider ?? inferAgentProvider(sleeper.command ?? config.defaultCommand);
    const cmd = sleeper.command || buildSpawnCommand(config, sleeper.model, prov);
    const ptyId = `pty-${sleeper.id}-${Date.now().toString(36)}`;
    const [exe, ...args] = tokenizeCommand(cmd.trim());
    const res = await window.cth.spawnPty({
      id: ptyId, cwd: sleeper.cwd, command: exe, provider: prov, args, cols: 100, rows: 30, isolate: false,
      hive: { id: sleeper.id, name: sleeper.name, provider: prov, cwd: sleeper.cwd, role: sleeper.description },
    });
    if (!res.ok) throw new Error(res.error ?? 'Could not wake the agent.');
    const woke: Agent = {
      ...sleeper, archived: false, ptyId, status: 'idle', action: 'starting up', progress: 0,
      currentStation: 'desk', cwd: res.cwd || sleeper.cwd, seedPrompt: res.seedPrompt, recentTextTs: Date.now(),
    };
    useStore.getState().removeArchivedAgent(sleeper.id);
    useStore.getState().addAgent(woke);
    return woke;
  }


  const cwd = config.registeredRepos[0] || useStore.getState().agents.find((a) => a.cwd)?.cwd || '';
  if (!cwd) throw new Error('Register a project folder first (Add agent → Workspace), then wake them up.');

  const name = CAST_BY_NAME[character].displayName;
  const provider = inferAgentProvider(config.defaultCommand);
  const model = isClaudeProvider(provider) ? config.defaultModel : undefined;
  const command = buildSpawnCommand(config, model, provider);
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  const ptyId = `pty-${id}`;
  const description = ROLE_INFO[character]?.tagline ?? CAST_BY_NAME[character].blurb;
  const [exe, ...args] = tokenizeCommand(command.trim());

  const res = await window.cth.spawnPty({
    id: ptyId, cwd, command: exe, provider, args, cols: 100, rows: 30, isolate: false,
    hive: { id, name, provider, cwd, role: description },
  });
  if (!res.ok) throw new Error(res.error ?? 'Could not start the agent.');

  const spawnedCwd = res.cwd || cwd;
  const agent: Agent = {
    id, name, character, accent: ACCENT[character] ?? 'sky', description,
    project: basename(spawnedCwd), tmuxTarget: '', cwd: spawnedCwd,
    status: 'idle', action: 'starting up', progress: 0, currentStation: 'desk',
    ptyId, command: command.trim(), provider, model,
    worktreePath: res.worktreePath, seedPrompt: res.seedPrompt, recentTextTs: Date.now(),
  };
  useStore.getState().addAgent(agent);
  return agent;
}

/** Put an open agent to sleep: end its process and keep it (flagged) in the
 *  archive so it can be woken later with its memory intact. */
export async function sleepAgent(agent: Agent): Promise<void> {
  if (agent.isGod) throw new Error(`${agent.name} leads the school and can't be put to sleep.`);
  if (agent.ptyId) {
    await window.cth.killPty(agent.ptyId);
    disposeTerminal(agent.ptyId);
  }
  useStore.getState().archiveAgent(agent.id);
}

/** Delete an agent for good — open or sleeping. Its process ends, the hive marks
 *  it archived (so it is not restored), and it leaves the app entirely. */
export async function deleteAgent(agent: Agent): Promise<void> {
  if (agent.isGod) throw new Error(`${agent.name} leads the school and can't be deleted.`);
  if (agent.ptyId) {
    await window.cth.killPty(agent.ptyId).catch(() => undefined);
    disposeTerminal(agent.ptyId);
  }
  await window.cth.hiveSetArchived(agent.id, true).catch(() => undefined);
  const st = useStore.getState();
  st.removeAgent(agent.id);
  st.removeArchivedAgent(agent.id);
  st.removeRestorableAgent(agent.id);
}
