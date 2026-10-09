import { useStore } from '@/store/store';

/** Classic / Modern art for the floor. Cosmetic: nothing is reset, the scene just
 *  redraws on the other tileset (same seats, zones and cast). */
export function TilesetSwitcher() {
  const style = useStore((s) => s.tilesetStyle);
  const setStyle = useStore((s) => s.setTilesetStyle);
  return (
    <div className="cth-titlebar-nodrag" style={{ position: 'relative', flexShrink: 0 }}>
      <select
        className="cth-titlebar-nodrag"
        aria-label="Tileset"
        title="Floor art — Modern (new) or Classic (original). Only changes how the floor looks."
        value={style}
        onChange={(event) => {
          const next = event.target.value === 'classic' ? 'classic' : 'modern';
          setStyle(next);
          void window.cth.updateConfig({ tilesetStyle: next }).catch(() => undefined);
        }}
        style={{
          height: 26, minWidth: 84, padding: '2px 6px',
          fontFamily: 'var(--cth-font-ui)', fontSize: 12,
          color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)',
          border: '1px solid var(--cth-ink-300)', borderRadius: 2,
          boxShadow: 'inset 0 -2px 0 var(--cth-cream-200)', cursor: 'pointer',
        }}
      >
        <option value="modern">Modern</option>
        <option value="classic">Classic</option>
      </select>
    </div>
  );
}
