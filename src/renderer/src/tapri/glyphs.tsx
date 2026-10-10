// Stroke icons for the Tapri HUD. Same construction as the title-bar glyphs in App.tsx:
// a 16-unit box, 1.4 stroke, round caps, `currentColor`, so they follow the app's look
// instead of the platform's emoji set.
import type { ReactNode } from 'react';

function G({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}
    >{children}</svg>
  );
}

/** Speaker with sound waves (voices). */
export const GlyphSpeaker = ({ off }: { off?: boolean }) => (
  <G>
    <path d="M2.5 6.2h2.3L8 3.4v9.2L4.8 9.8H2.5z" />
    {off ? <path d="M10.4 6.2l3 3.6M13.4 6.2l-3 3.6" /> : <path d="M10.4 5.8a3.1 3.1 0 0 1 0 4.4M12.2 4a5.6 5.6 0 0 1 0 8" />}
  </G>
);

/** A road with its centre line (street sound). */
export const GlyphRoad = () => (
  <G>
    <path d="M5.2 2.5L2.6 13.5M10.8 2.5l2.6 11M8 3v2M8 7.2v2M8 11.4v2" />
  </G>
);

export const GlyphKey = () => (
  <G>
    <circle cx="5.2" cy="8" r="2.6" />
    <path d="M7.8 8h6M11.2 8v2.2M13.4 8v1.6" />
  </G>
);

/** A chai glass with steam (summary). */
export const GlyphCup = () => (
  <G>
    <path d="M3.5 7h8l-.8 6H4.3z" />
    <path d="M11.2 8.2h1.2a1.3 1.3 0 0 1 0 2.6h-1.5" />
    <path d="M6 2.4c-.6.8.6 1.4 0 2.3M8.6 2.4c-.6.8.6 1.4 0 2.3" />
  </G>
);

export const GlyphBack = () => (
  <G><path d="M9.6 3.2L4.8 8l4.8 4.8M5 8h8" /></G>
);

export const GlyphClose = () => (
  <G><path d="M4 4l8 8M12 4l-8 8" /></G>
);

export const GlyphRefresh = () => (
  <G><path d="M12.8 6A5 5 0 1 0 13 9.2M12.9 2.6V6H9.5" /></G>
);

export const GlyphMic = () => (
  <G>
    <rect x="6" y="2" width="4" height="7" rx="2" />
    <path d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8V14M6 14h4" />
  </G>
);
