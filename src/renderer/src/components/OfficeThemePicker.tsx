import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { effectiveOfficeTheme, executeThemeSwitch, planThemeSwitch, themeSwitchWorkers, type ThemePatch, type ThemeSwitchRequest } from './officeThemeSwitch';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import { disposeTerminal } from './terminalPool';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';
import type { ThemeId } from '@/scene/office/themeRegistry';

// Built themes use their own map+cast. Unbuilt themes use the loader's office
// fallback and show a "soon" tag plus a note after the same fresh-team flow.
interface ThemeMeta { id: ThemeId; label: string; blurb: string; built: boolean; swatch: string; }
const THEME_META: ThemeMeta[] = [
  { id: 'office',        label: 'The Office',         blurb: 'Dunder Mifflin — the original floor', built: true,  swatch: '#6b5a4a' },
  { id: 'friends',       label: 'Friends',            blurb: 'Central Perk coffee house',           built: false, swatch: '#9a5a32' },
  { id: 'brooklyn99',    label: 'Brooklyn Nine-Nine', blurb: 'The 99th precinct bullpen',           built: true,  swatch: '#3a5a7a' },
  { id: 'siliconvalley', label: 'Silicon Valley',     blurb: 'The Hacker Hostel',                   built: false, swatch: '#4a6a4a' },
  { id: 'got',           label: 'Game of Thrones',    blurb: 'The Red Keep throne room',            built: false, swatch: '#6a2630' },
  { id: 'hogwarts',      label: 'Harry Potter',       blurb: 'Hogwarts great hall',                 built: false, swatch: '#39305a' },
  { id: 'staffroom',     label: 'Staff Room',         blurb: 'The school staff room',               built: true,  swatch: '#c9a05a' },
];

interface OfficeThemeSwitchState {
  enabled: boolean;
  current: ThemeId;
  busy: boolean;
  pending: boolean;
  note: string;
  request: (patch: ThemePatch) => void;
}
const OfficeThemeSwitchContext = createContext<OfficeThemeSwitchState | null>(null);

export function useOfficeThemeSwitch(): OfficeThemeSwitchState {
  const owner = useContext(OfficeThemeSwitchContext);
  if (!owner) throw new Error('Office theme controls require OfficeThemeSwitchProvider');
  return owner;
}

/** One owner for Settings and the titlebar: one lock, confirmation and lifecycle. */
export function OfficeThemeSwitchProvider({ config, onConfigChange, children }: {
  config: HarnessConfig;
  onConfigChange: (config: HarnessConfig) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<ThemeSwitchRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const locked = useRef(false);
  const executing = useRef(false);
  const currentConfig = useRef(config);
  currentConfig.current = config;
  const agents = useStore((s) => s.agents);
  const workers = themeSwitchWorkers(agents);

  useEffect(() => {
    useStore.getState().setOfficeTheme(effectiveOfficeTheme(config));
  }, [config.tvShowOffices, config.officeTheme]);

  const applyTheme = async (selection: ThemeSwitchRequest) => {
    if (executing.current) return;
    // Re-read config at confirmation time, in case another Settings save arrived.
    const next = planThemeSwitch(currentConfig.current, selection.patch);
    if (!next) { locked.current = false; setPending(null); return; }
    executing.current = true;
    setBusy(true);
    try {
      await executeThemeSwitch(next, {
        agents: () => useStore.getState().agents,
        killPty: (id) => window.cth.killPty(id),
        disposeTerminal,
        workerClosed: (id) => useStore.getState().updateAgent(id, { status: 'ghost', action: 'terminal closed during theme switch', ptyId: undefined }),
        archiveAgent: (id) => useStore.getState().archiveAgent(id),
        updateConfig: (patch) => window.cth.updateConfig(patch),
        commit: (saved) => {
          currentConfig.current = saved;
          onConfigChange(saved);
          useStore.getState().setOfficeTheme(effectiveOfficeTheme(saved));
        },
      });
      const meta = THEME_META.find((theme) => theme.id === next.theme);
      if (meta && !meta.built) setNote(t('officeTheme.notBuiltYet', { label: meta.label }));
    } catch (e) {
      setNote(t('officeTheme.switchAborted', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      executing.current = false;
      locked.current = false;
      setBusy(false);
      setPending(null);
    }
  };

  const request = (patch: ThemePatch) => {
    if (locked.current) return;
    setNote('');
    const next = planThemeSwitch(currentConfig.current, patch);
    if (!next) return;
    locked.current = true;
    if (next.freshTeam && themeSwitchWorkers(useStore.getState().agents).length > 0) {
      setPending(next);
    } else {
      void applyTheme(next);
    }
  };
  const pendingMeta = pending ? THEME_META.find((theme) => theme.id === pending.theme) : null;

  return (
    <OfficeThemeSwitchContext.Provider value={{
      enabled: !!config.tvShowOffices, current: config.officeTheme ?? 'office',
      busy, pending: !!pending, note, request,
    }}>
      {children}
      {pending && pendingMeta && createPortal(
        <ThemeSwitchConfirmModal
          label={pendingMeta.label}
          agents={workers}
          busy={busy}
          onCancel={() => { if (!busy) { locked.current = false; setPending(null); } }}
          onConfirm={() => { if (!busy) void applyTheme(pending); }}
        />,
        document.body,
      )}
    </OfficeThemeSwitchContext.Provider>
  );
}

/** Settings keeps the experimental gate, but uses the shared live switch owner. */
export function OfficeThemePicker({ config: _config }: { config: HarnessConfig }) {
  const { t } = useTranslation();
  const { enabled, current, busy, pending, note, request } = useOfficeThemeSwitch();
  const disabled = busy || pending;
  const toggleFlag = () => request({ tvShowOffices: !enabled });
  const onSelect = (id: ThemeId) => request({ officeTheme: id });

  return (
    <div>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
        color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 10
      }}>
        {t('officeTheme.title')}
      </div>

      {/* Experimental feature flag */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
            {t('officeTheme.tvShow')} <span style={{ color: 'var(--cth-ink-500)' }}>({t('officeTheme.experimental')})</span>
          </span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
            {t('officeTheme.desc')}
          </span>
        </div>
        <PixelButton variant={enabled ? 'primary' : 'secondary'} size="sm" onClick={toggleFlag} disabled={disabled}>
          {enabled ? t('common.on') : t('common.off')}
        </PixelButton>
      </div>

      {/* Theme picker grid (only when the flag is on) */}
      {enabled && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {THEME_META.map((theme) => {
            const isCurrent = theme.id === current;
            return (
              <button
                key={theme.id}
                onClick={() => onSelect(theme.id)}
                disabled={disabled}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  padding: 8, cursor: busy ? 'default' : 'pointer',
                  background: isCurrent ? 'var(--cth-paper-100)' : 'transparent',
                  boxShadow: isCurrent
                    ? 'inset 0 0 0 1.5px var(--cth-ink-500)'
                    : 'inset 0 0 0 1px var(--cth-ink-300)',
                  opacity: busy && !isCurrent ? 0.6 : 1,
                }}
              >
                <span style={{
                  width: 28, height: 28, flexShrink: 0, background: theme.swatch,
                  boxShadow: 'inset 0 0 0 1.5px var(--cth-ink-500)',
                }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {theme.label}
                    </span>
                    {isCurrent && (
                      <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 7, color: 'var(--cth-mint)', textTransform: 'uppercase' }}>
                        {t('officeTheme.current')}
                      </span>
                    )}
                    {!theme.built && !isCurrent && (
                      <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 7, color: 'var(--cth-ink-500)', textTransform: 'uppercase' }}>
                        {t('officeTheme.soon')}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--cth-ink-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {theme.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {note && (
        <div role="status" style={{ marginTop: 10, fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</div>
      )}
    </div>
  );
}

interface VictimAgent { id: string; status?: string; }

/** Destructive confirm for a theme switch with live workers (report §E copy). */
function ThemeSwitchConfirmModal({
  label, agents, busy, onCancel, onConfirm,
}: {
  label: string;
  agents: VictimAgent[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const n = agents.length;
  const working = agents.filter((a) => a.status && !['idle', 'success', 'error'].includes(a.status)).length;
  const roster = useStore.getState().agents;
  const godName = roster.find((a) => a.isGod)?.name ?? 'the orchestrator';
  const assistantName = roster.find((a) => a.isAssistant)?.name;
  const carryNames = assistantName ? `${godName} + ${assistantName}` : godName;

  return (
    <div
      className="cth-titlebar-nodrag"
      onClick={busy ? undefined : onCancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); if (!busy) onCancel(); }
        if (event.key !== 'Tab') return;
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) { event.preventDefault(); return; }
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26, 19, 32, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400,
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('officeTheme.confirmTitle', { label: label.toUpperCase() })}
        onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: '92vw' }}>
        <PixelPanel variant="dialog" title={t('officeTheme.confirmTitle', { label: label.toUpperCase() })} noPadding>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{
                width: 32, height: 32, flexShrink: 0,
                background: 'var(--cth-coral-light)',
                boxShadow: 'inset 0 0 0 1.5px var(--cth-ink-500)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="bell" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: 'var(--cth-font-display)', fontSize: 12, lineHeight: '20px',
                  color: 'var(--cth-ink-900)', marginBottom: 4,
                }}>
                  {t('officeTheme.startsFreshCast')}
                </div>
                <div style={{ fontSize: 15, lineHeight: '22px', color: 'var(--cth-ink-700)' }}>
                  {n === 1
                    ? t('officeTheme.deleteCount', { count: n })
                    : t('officeTheme.deleteCountPlural', { count: n })}{' '}
                  {t('officeTheme.onlyCarries', { god: carryNames })}
                  {working > 0 && (
                    <span style={{ display: 'block', marginTop: 6, color: 'var(--cth-coral)' }}>
                      ⚠ {working === 1
                        ? t('officeTheme.stillWorking', { count: working })
                        : t('officeTheme.stillWorkingPlural', { count: working })}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)', marginTop: 8 }}>
                  {t('officeTheme.cantUndo')}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <PixelButton variant="secondary" size="md" onClick={onCancel} disabled={busy}>
                {t('common.cancel')}
              </PixelButton>
              <PixelButton variant="destructive" size="md" onClick={onConfirm} disabled={busy}>
                {busy ? t('officeTheme.switching') : t('officeTheme.deleteSwitch', { count: n })}
              </PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
