import type { HarnessConfig } from '@/store/config';
import type { ThemeId } from '@/scene/office/themeRegistry';

export type ThemeConfig = Pick<HarnessConfig, 'tvShowOffices' | 'officeTheme'>;
export type ThemePatch = Partial<ThemeConfig>;
export interface ThemeSwitchRequest {
  patch: ThemePatch;
  theme: ThemeId;
  freshTeam: boolean;
}

export function effectiveOfficeTheme(config: ThemeConfig): ThemeId {
  return config.tvShowOffices ? (config.officeTheme ?? 'office') : 'office';
}

/** Compare the effective floor, not just the saved theme (the flag gates it). */
export function planThemeSwitch(config: ThemeConfig, patch: ThemePatch): ThemeSwitchRequest | null {
  const next = { ...config, ...patch };
  if (!!next.tvShowOffices === !!config.tvShowOffices
    && (next.officeTheme ?? 'office') === (config.officeTheme ?? 'office')) return null;
  const theme = effectiveOfficeTheme(next);
  return { patch, theme, freshTeam: theme !== effectiveOfficeTheme(config) };
}

interface SwitchAgent { id: string; ptyId?: string; isGod?: boolean; isAssistant?: boolean; }
export function themeSwitchWorkers<T extends SwitchAgent>(agents: readonly T[]): T[] {
  return agents.filter((agent) => !agent.isGod && !agent.isAssistant);
}

/** Injected lifecycle keeps regression tests away from real Electron PTYs. */
export async function executeThemeSwitch<T>(request: ThemeSwitchRequest, deps: {
  agents: () => readonly SwitchAgent[];
  killPty: (id: string) => Promise<{ ok: boolean; error?: string }>;
  disposeTerminal: (id: string) => void;
  workerClosed?: (id: string) => void;
  archiveAgent: (id: string) => void;
  updateConfig: (patch: ThemePatch) => Promise<T>;
  commit: (config: T) => void;
}): Promise<void> {
  const victims = request.freshTeam ? themeSwitchWorkers(deps.agents()) : [];
  // Close and dispose all worker terminals before archiving any workers. A
  // failed close aborts persistence and archive, including resolved IPC errors.
  for (const agent of victims) {
    if (!agent.ptyId) continue;
    const result = await deps.killPty(agent.ptyId);
    if (!result.ok) throw new Error(result.error ?? `Could not close terminal ${agent.ptyId}`);
    deps.disposeTerminal(agent.ptyId);
    deps.workerClosed?.(agent.id);
  }
  for (const agent of victims) deps.archiveAgent(agent.id);
  const config = await deps.updateConfig(request.patch);
  deps.commit(config);
}
