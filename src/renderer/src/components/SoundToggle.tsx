import { useStore } from '@/store/store';
import { clampVolume } from '@/audio/soundEngine';

const BAR_HEIGHT = 26;

/**
 * Ambient floor sound, live from the top bar: mute/unmute and level, without
 * opening Settings mid-demo.
 *
 * Deliberately just a store write. `audio/soundBridge` is the one subscriber and
 * it re-applies the master gain on every store change, so the click is heard
 * immediately — nothing here touches the engine, which is what keeps mute a
 * single instant action instead of a per-component job.
 */
export function SoundToggle() {
  const enabled = useStore((s) => s.soundEnabled);
  const volume = useStore((s) => s.soundVolume);
  const setEnabled = useStore((s) => s.setSoundEnabled);
  const setVolume = useStore((s) => s.setSoundVolume);

  return (
    <div className="cth-titlebar-nodrag" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <button
        className="cth-titlebar-nodrag"
        aria-label={enabled ? 'Mute floor sound' : 'Unmute floor sound'}
        aria-pressed={enabled}
        title={enabled ? 'Mute floor sound' : 'Unmute floor sound'}
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          void window.cth.updateConfig({ soundEnabled: next }).catch(() => undefined);
        }}
        style={{
          height: BAR_HEIGHT, minWidth: 28, padding: '0 6px', fontSize: 14, lineHeight: 1,
          background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
          border: '1px solid var(--cth-ink-300)', borderRadius: 2,
          boxShadow: 'inset 0 -2px 0 var(--cth-cream-200)',
          cursor: 'pointer', opacity: enabled ? 1 : 0.55
        }}
      >
        {enabled ? '🔊' : '🔇'}
      </button>
      {enabled && (
        <input
          className="cth-titlebar-nodrag"
          type="range"
          aria-label="Floor sound volume"
          title="Floor sound volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => {
            const next = clampVolume(Number(event.target.value));
            setVolume(next);
            void window.cth.updateConfig({ soundVolume: next }).catch(() => undefined);
          }}
          style={{ width: 64, accentColor: 'var(--cth-ink-500)' }}
        />
      )}
    </div>
  );
}