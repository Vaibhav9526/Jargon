import { useEffect, useRef } from 'react';
import type { TeachingRequest } from '@shared/teaching';

/**
 * Hosts the hosted OpenMAIC classroom INSIDE the Jargon window. The page itself
 * is a native view owned by the main process; this div only reserves the space
 * and keeps the view's bounds in step with it.
 *
 * Unmounting only HIDES the view — the lesson keeps running in the background and
 * a later mount (`alreadyOpen`) simply re-attaches to it. Ending a lesson is an
 * explicit action (endLesson).
 */
export function TeachingPanelHost({ request, teacherId, alreadyOpen, onOpened, onFailed }: {
  request: TeachingRequest;
  teacherId: string;
  alreadyOpen: boolean;
  onOpened: () => void;
  onFailed: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const rect = () => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) };
    };
    const openFresh = async (): Promise<void> => {
      try {
        const res = await window.cth.teachingOpenPanel({ ...request, teacherId, bounds: rect() });
        if (!alive) return;
        if (res.ok) onOpened(); else onFailed(res.error ?? 'The classroom could not be opened.');
      } catch (e) {
        if (alive) onFailed(e instanceof Error ? e.message : 'The classroom could not be opened.');
      }
    };

    const attach = async (): Promise<void> => {
      // Re-attach to the running lesson; if the main process lost it, start over.
      try {
        const res = await window.cth.teachingPanelBounds(rect());
        if (!alive) return;
        if (res.ok) await window.cth.teachingPanelVisible(true); else await openFresh();
      } catch {
        if (alive) await openFresh();
      }
    };

    if (alreadyOpen) void attach(); else void openFresh();

    const sync = () => { void window.cth.teachingPanelBounds(rect()).catch(() => undefined); };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    // Sibling layout (sidebars, banners) can move the box without resizing it.
    const iv = setInterval(sync, 400);
    return () => {
      alive = false;
      ro.disconnect();
      window.removeEventListener('resize', sync);
      clearInterval(iv);
      void window.cth.teachingPanelVisible(false).catch(() => undefined);
    };
    // One attach per mount; a new lesson remounts this component (see `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} style={{ flex: 1, minHeight: 0, background: 'var(--cth-cream-100)', borderRadius: 10 }} />;
}
