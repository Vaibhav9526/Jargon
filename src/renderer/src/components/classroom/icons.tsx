import type { ReactNode, CSSProperties } from 'react';

// Cartoon icon set for the Classroom — chunky round outlines and flat fills in
// the app's own palette, so nothing falls back to system emoji (which clash with
// the pixel/cartoon theme and look different on every OS).

const INK = 'var(--cth-ink-900)';

function Svg({ size = 18, children, style, title }: { size?: number; children: ReactNode; style?: CSSProperties; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0, verticalAlign: '-0.2em', ...style }}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}
type P = { size?: number; style?: CSSProperties; title?: string };

/** Crescent moon with a sleepy z — "put to sleep". */
export const IconSleep = (p: P) => (
  <Svg {...p}>
    <path d="M17.5 14.2A7.3 7.3 0 0 1 9.8 6.5a7.3 7.3 0 0 0-.1-1.4 7.4 7.4 0 1 0 9.2 9.2c-.5-.1-.9-.1-1.4-.1Z" fill="var(--cth-lemon-light)" />
    <path d="M14.5 3.5h3.5l-3.5 4h3.5" strokeWidth={1.5} />
  </Svg>
);

/** Smiling sun — "wake up". */
export const IconWake = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.6" fill="var(--cth-lemon)" />
    <path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6" strokeWidth={1.5} />
    <path d="M10.4 12.4q1.6 1.5 3.2 0" strokeWidth={1.3} />
  </Svg>
);

/** Little bin with a wobbly lid — "delete". */
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 7.5h13l-1 12.2a1.6 1.6 0 0 1-1.6 1.4H8.1a1.6 1.6 0 0 1-1.6-1.4L5.5 7.5Z" fill="var(--cth-coral-light)" />
    <path d="M4 6.8c3-1.2 13-1.2 16 0M9.5 5.2l.4-1.5h4.2l.4 1.5M10 11v6M14 11v6" />
  </Svg>
);

export const IconChat = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5Z" fill="var(--cth-sky-light)" />
    <path d="M7.5 10.5h9M7.5 13h5.5" strokeWidth={1.4} />
  </Svg>
);

/** Graduation cap — a running lesson. */
export const IconCap = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5Z" fill="var(--cth-lilac-light)" />
    <path d="M6.5 11.8V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.2M21 10v5" />
  </Svg>
);

/** Pencil on a sheet — quizzes. */
export const IconQuiz = (p: P) => (
  <Svg {...p}>
    <path d="M5 3.5h10l4 4V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" fill="var(--cth-cream-100)" />
    <path d="M15 3.5v4h4M7.5 11h6M7.5 14h4" strokeWidth={1.4} />
    <path d="m13.5 19.2.4-2.4 5.3-5.3 2 2-5.3 5.3-2.4.4Z" fill="var(--cth-peach)" strokeWidth={1.4} />
  </Svg>
);

/** Stack of books — the library. */
export const IconBooks = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="4.5" height="16" rx="1" fill="var(--cth-coral-light)" />
    <rect x="9" y="4" width="4.5" height="16" rx="1" fill="var(--cth-mint-light)" />
    <path d="m15 6.2 4-1.1 3 12.2-4 1.1L15 6.2Z" fill="var(--cth-sky-light)" />
    <path d="M3.5 8h4.5M9 8h4.5" strokeWidth={1.3} />
  </Svg>
);

/** Open book — a reading suggestion. */
export const IconBook = (p: P) => (
  <Svg {...p}>
    <path d="M12 6.5C10 5 6.5 4.5 3 5v13c3.5-.5 7 0 9 1.5 2-1.5 5.5-2 9-1.5V5c-3.5-.5-7 0-9 1.5Z" fill="var(--cth-peach-light, var(--cth-cream-100))" />
    <path d="M12 6.5v13" strokeWidth={1.4} />
  </Svg>
);

export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

/** Bullseye — weak points. */
export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" fill="var(--cth-coral-light)" />
    <circle cx="12" cy="12" r="5.2" fill="var(--cth-cream-50)" />
    <circle cx="12" cy="12" r="1.8" fill="var(--cth-coral)" />
    <path d="m12 12 7-7M16.5 4.5l.3 2.7 2.7.3" strokeWidth={1.4} />
  </Svg>
);

/** Lightning bolt — strengths. */
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="m13.5 2.5-8 11h5.5l-1 8 8-11.5h-5.5l1-7.5Z" fill="var(--cth-lemon)" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.3" fill="var(--cth-mint-light)" />
    <path d="m7.8 12.4 2.8 2.8 5.6-6" />
  </Svg>
);
export const IconCross = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.3" fill="var(--cth-coral-light)" />
    <path d="m8.8 8.8 6.4 6.4M15.2 8.8l-6.4 6.4" />
  </Svg>
);
export const IconSkip = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.3" fill="var(--cth-cream-200)" />
    <path d="m9 8.5 4 3.5-4 3.5M15.5 8.5v7" strokeWidth={1.5} />
  </Svg>
);

/** A friendly cartoon face — the "You" avatar. */
export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.3" fill="var(--cth-lemon-light)" />
    <circle cx="9" cy="10.5" r="1" fill={INK} stroke="none" />
    <circle cx="15" cy="10.5" r="1" fill={INK} stroke="none" />
    <path d="M8.6 14.2q3.4 3 6.8 0" />
  </Svg>
);

/** Sealed envelope — Mail. */
export const IconMail = (p: P) => (
  <Svg {...p}>
    <rect x="2.8" y="5.5" width="18.4" height="13" rx="1.8" fill="var(--cth-sky-light)" />
    <path d="m3.4 7 8.6 6.2L20.6 7" />
    <circle cx="17.6" cy="16.2" r="1.3" fill="var(--cth-coral)" stroke="none" />
  </Svg>
);

/** Mood faces for the character overlay (replaces the emoji set). */
export function MoodFace({ mood, size = 18 }: { mood: string; size?: number }) {
  const eyes = (l: ReactNode, r: ReactNode) => <>{l}{r}</>;
  const dot = (cx: number, cy: number, r = 1) => <circle cx={cx} cy={cy} r={r} fill={INK} stroke="none" />;
  let face: ReactNode;
  switch (mood) {
    case 'smug':
      face = <>{eyes(<path d="M7 10.5h3.2" />, <path d="M13.8 10.5H17" />)}{dot(8.8, 11.4, 0.8)}{dot(15.6, 11.4, 0.8)}<path d="M8.5 15.2q4.5 1.8 7.5-.8" /></>;
      break;
    case 'annoyed':
      face = <>{eyes(<path d="m7 9 3.4 1.2" />, <path d="m17 9-3.4 1.2" />)}{dot(8.9, 12, 0.9)}{dot(15.1, 12, 0.9)}<path d="M8.8 16h6.4" /></>;
      break;
    case 'eye-roll':
      face = <>
        <circle cx="9" cy="10.4" r="2.4" fill="var(--cth-cream-50)" strokeWidth={1.3} />
        <circle cx="15" cy="10.4" r="2.4" fill="var(--cth-cream-50)" strokeWidth={1.3} />
        {dot(9.4, 9.4, 1)}{dot(15.4, 9.4, 1)}
        <path d="M8.8 16.2h6.4" /></>;
      break;
    case 'excited':
      face = <>
        <path d="m9 8.4.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2.7-1.5Z" fill="var(--cth-lemon)" strokeWidth={1} />
        <path d="m15 8.4.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2.7-1.5Z" fill="var(--cth-lemon)" strokeWidth={1} />
        <path d="M8 14.2h8a4 4 0 0 1-8 0Z" fill="var(--cth-cream-50)" /></>;
      break;
    case 'thinking':
      face = <>{dot(9, 11, 1)}{dot(15, 11, 1)}<path d="M13.2 8.3q1.8-.9 3.3.1" /><path d="M9 15.6q2.5-1 5.5 0" /></>;
      break;
    case 'shocked':
      face = <>{dot(9, 10, 1.6)}{dot(15, 10, 1.6)}<ellipse cx="12" cy="16" rx="1.9" ry="2.4" fill="var(--cth-cream-50)" /></>;
      break;
    case 'laughing':
      face = <><path d="M7.4 11q1.6-2.4 3.2 0M13.4 11q1.6-2.4 3.2 0" /><path d="M7.8 13.8h8.4a4.2 4.2 0 0 1-8.4 0Z" fill="var(--cth-cream-50)" /></>;
      break;
    default: // neutral
      face = <>{dot(9, 10.8)}{dot(15, 10.8)}<path d="M8.8 15q3.2 2.2 6.4 0" /></>;
  }
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9.3" fill="var(--cth-lemon-light)" />
      {face}
    </Svg>
  );
}
