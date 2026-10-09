import { useEffect, useRef } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';

export interface TeachingAccessDialogProps {
  /** Dismissed — purely informational, so closing never sends or saves
   *  anything; the composer's draft and files stay untouched. */
  onClose: () => void;
}

/** Hosted-provider transparency for teach mode (@teach-me / @teacher), styled
 *  like the app's other Pixel dialogs: which service the Jargon Teaching
 *  window opens and what the user does there themselves. Jargon stores no
 *  access code and calls no provider API, so there is nothing to enter here. */
export function TeachingAccessDialog({ onClose }: TeachingAccessDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus the dialog on open so Escape works without tabbing into it first;
  // the composer hands focus back to the draft on close.
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(26,19,32,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Teach mode — provider details"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        style={{ outline: 'none' }}
      >
        <PixelPanel variant="dialog" title="TEACH MODE — PROVIDER DETAILS" noPadding>
          <div style={{
            width: 380, maxWidth: 'calc(100vw - 48px)', boxSizing: 'border-box',
            padding: 12, display: 'flex', flexDirection: 'column', gap: 10
          }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-900)' }}>
              Teaching drafts open the hosted learning site in the Jargon Teaching
              window and hand the topic plus file list to the Teacher — nothing is
              generated or uploaded by the app itself.
            </p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)' }}>
              In that window you sign in (or create an account), paste the topic, upload
              the listed files and press Generate. The lesson view uses Jargon branding.
              Sign-in, payment and legal pages keep the provider identity. Account, quota
              and any charges remain between you and the provider — no API access code
              is required and Jargon makes no generation API calls.
            </p>
            <span style={{
              fontFamily: 'var(--cth-font-display)', fontSize: 9, letterSpacing: 0.5,
              textTransform: 'uppercase', color: 'var(--cth-ink-500)'
            }}>Hosted provider — OpenMAIC</span>
            <a
              href="https://open.maic.chat/"
              onClick={(e) => { e.preventDefault(); void window.cth.openExternal('https://open.maic.chat/'); }}
              style={{
                alignSelf: 'flex-start',
                fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
                color: 'var(--cth-ink-900)', textDecoration: 'underline'
              }}
            >open.maic.chat — sign in and generate there</a>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <PixelButton variant="primary" size="sm" onClick={onClose}>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  Close <Icon name="check" />
                </span>
              </PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
