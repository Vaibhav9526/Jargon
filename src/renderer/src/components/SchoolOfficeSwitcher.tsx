import { useStore } from '@/store/store';
import { useOfficeThemeSwitch } from './OfficeThemePicker';

/** Native select keeps platform keyboard navigation in Electron's drag region. */
export function SchoolOfficeSwitcher() {
  const theme = useStore((s) => s.officeTheme);
  const { busy, pending, note, request } = useOfficeThemeSwitch();
  const otherTheme = theme !== 'office' && theme !== 'staffroom';

  return (
    <div className="cth-titlebar-nodrag" style={{ position: 'relative', flexShrink: 0 }}>
      <select
        className="cth-titlebar-nodrag"
        aria-label="School / Office"
        title="Switch setting — start a fresh team (keeps the orchestrator and assistant)"
        value={theme}
        disabled={busy || pending}
        onChange={(event) => {
          if (event.target.value === 'staffroom') {
            request({ officeTheme: 'staffroom', tvShowOffices: true });
          } else if (event.target.value === 'office') {
            request({ officeTheme: 'office' });
          }
        }}
        style={{
          height: 26, minWidth: 92, padding: '2px 6px',
          fontFamily: 'var(--cth-font-ui)', fontSize: 12,
          color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)',
          border: '1px solid var(--cth-ink-300)', borderRadius: 2,
          boxShadow: 'inset 0 -2px 0 var(--cth-cream-200)',
          cursor: busy || pending ? 'default' : 'pointer',
        }}
      >
        <option value="staffroom">School</option>
        <option value="office">Office</option>
        {/* Settings still supports other themes; never mislabel their floor. */}
        {otherTheme && <option value={theme} disabled>Other theme</option>}
      </select>
      {note && (
        <div role="status" style={{
          position: 'absolute', top: 32, left: 0, width: 280, zIndex: 401,
          padding: 8, fontFamily: 'var(--cth-font-ui)', fontSize: 12,
          color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)',
          border: '1px solid var(--cth-ink-300)', userSelect: 'text',
        }}>{note}</div>
      )}
    </div>
  );
}
