import { IconQuiz, IconCheck, IconCross, IconSkip, IconTarget, IconBolt, IconBooks, IconBook, IconLink } from './icons';
export interface QuizData {
  topic: string;
  questions: Array<{ q: string; options: string[]; answer: number; explanation: string; concept: string }>;
}
export interface QuizResult {
  graded: {
    correct: number; total: number; percent: number;
    items: Array<{ index: number; picked: number | null; right: boolean; concept: string }>;
    weakConcepts: Array<{ concept: string; missed: number; of: number }>;
  };
  report: {
    summary: string;
    weakPoints: Array<{ concept: string; why: string; tip: string }>;
    strengths: string[];
    resources: {
      youtube: Array<{ channel: string; why: string; query: string; url: string }>;
      books: Array<{ title: string; author: string; why: string; url: string }>;
      other: Array<{ name: string; why: string; url: string }>;
    };
  } | null;
  /** Set when the score is real but the AI analysis could not be produced. */
  analysisError?: string;
}

const card: React.CSSProperties = {
  padding: 14, borderRadius: 14, background: 'var(--cth-paper-100)',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-900)', display: 'flex', flexDirection: 'column', gap: 12,
};
const LETTERS = ['A', 'B', 'C', 'D'];

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => { void window.cth.openExternal(href); }}
      style={{ border: 'none', cursor: 'pointer', textAlign: 'left', padding: '6px 10px', borderRadius: 10, background: 'var(--cth-sky-light)', color: 'var(--cth-ink-900)', fontSize: 13, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
      {children} <span aria-hidden>↗</span>
    </button>
  );
}

export function QuizCard({ phase, quiz, picks, result, error, onPick, onSubmit, onClose }: {
  phase: 'loading' | 'taking' | 'grading' | 'report';
  quiz: QuizData | null;
  picks: Array<number | null>;
  result: QuizResult | null;
  error: string;
  onPick: (question: number, option: number) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  if (phase === 'loading' || !quiz) {
    return <div style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 8 }}><IconQuiz size={18} /> Writing a quiz about your doubt…</div>;
  }
  const answered = picks.filter((p) => p !== null).length;
  const reviewing = phase === 'report' && !!result;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconQuiz size={18} /> Quiz — {quiz.topic}</strong>
        <span style={{ flex: 1 }} />
        {!reviewing && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{answered}/{quiz.questions.length} answered</span>}
        <button type="button" onClick={onClose} aria-label="Close quiz"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)', fontSize: 16 }}>×</button>
      </div>

      {reviewing && result && (
        <div style={{ padding: 12, borderRadius: 12, background: result.graded.percent >= 70 ? 'var(--cth-mint-light)' : result.graded.percent >= 40 ? 'var(--cth-lemon-light)' : 'var(--cth-coral-light)' }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{result.graded.correct}/{result.graded.total} · {result.graded.percent}%</div>
          {result.report?.summary && <div style={{ fontSize: 14, marginTop: 4, lineHeight: '20px' }}>{result.report.summary}</div>}
        </div>
      )}

      {quiz.questions.map((q, qi) => {
        const picked = picks[qi];
        const item = result?.graded.items[qi];
        return (
          <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: '20px' }}>{qi + 1}. {q.q}</div>
            {q.options.map((opt, oi) => {
              const isPicked = picked === oi;
              const isRight = reviewing && oi === q.answer;
              const isWrongPick = reviewing && isPicked && oi !== q.answer;
              return (
                <button key={oi} type="button" disabled={reviewing || phase === 'grading'} onClick={() => onPick(qi, oi)}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'baseline', textAlign: 'left', border: 'none',
                    cursor: reviewing || phase === 'grading' ? 'default' : 'pointer', padding: '7px 10px', borderRadius: 10, fontSize: 14, lineHeight: '19px',
                    color: 'var(--cth-ink-900)',
                    background: isRight ? 'var(--cth-mint-light)' : isWrongPick ? 'var(--cth-coral-light)' : isPicked ? 'var(--cth-lemon-light)' : 'var(--cth-cream-100)',
                    boxShadow: `inset 0 0 0 ${isPicked || isRight ? 2 : 1}px ${isRight ? 'var(--cth-mint)' : isWrongPick ? 'var(--cth-coral)' : isPicked ? 'var(--cth-lemon)' : 'var(--cth-ink-100)'}`,
                  }}>
                  <strong>{LETTERS[oi]}</strong><span style={{ flex: 1 }}>{opt}</span>
                  {isRight && <IconCheck size={18} title="correct answer" />}
                  {isWrongPick && <IconCross size={18} title="your answer, incorrect" />}
                </button>
              );
            })}
            {reviewing && (
              <div style={{ fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-700)', padding: '2px 4px' }}>
                {item?.right ? <IconCheck size={16} /> : picked == null ? <IconSkip size={16} /> : <IconCross size={16} />}{' '}
                {item?.right ? 'Correct. ' : picked == null ? 'Skipped. ' : 'Not quite. '}
                {q.explanation}
              </div>
            )}
          </div>
        );
      })}

      {!reviewing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={onSubmit} disabled={answered === 0 || phase === 'grading'}
            style={{ border: 'none', cursor: answered === 0 || phase === 'grading' ? 'default' : 'pointer', padding: '8px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600,
              background: answered === 0 || phase === 'grading' ? 'var(--cth-cream-300)' : 'var(--cth-ink-900)', color: answered === 0 || phase === 'grading' ? 'var(--cth-ink-500)' : 'var(--cth-paper-100)' }}>
            {phase === 'grading' ? 'Analysing your answers…' : 'Submit & get my analysis'}
          </button>
          {answered > 0 && answered < quiz.questions.length && phase !== 'grading' && (
            <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>Unanswered questions count as wrong.</span>
          )}
        </div>
      )}

      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{error}</div>}

      {reviewing && result && (
        <>
          {result.analysisError && (
            <div role="alert" style={{ fontSize: 13, color: 'var(--cth-coral)' }}>
              Your score above is exact, but the written analysis could not be created: {result.analysisError}
            </div>
          )}
          {result.report && result.report.weakPoints.length > 0 && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><IconTarget size={18} /> Your weak points</div>
              {result.report.weakPoints.map((w) => (
                <div key={w.concept} style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--cth-coral-light)', marginBottom: 6, fontSize: 13, lineHeight: '19px' }}>
                  <strong>{w.concept}</strong>
                  <div>{w.why}</div>
                  <div style={{ marginTop: 2 }}><em>How to fix it:</em> {w.tip}</div>
                </div>
              ))}
            </div>
          )}
          {result.report && result.report.strengths.length > 0 && (
            <div style={{ fontSize: 13, lineHeight: '19px' }}><strong><IconBolt size={16} /> Strengths:</strong> {result.report.strengths.join(' · ')}</div>
          )}
          {result.report && (result.report.resources.youtube.length > 0 || result.report.resources.books.length > 0 || result.report.resources.other.length > 0) && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><IconBooks size={18} /> Learn more</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.report.resources.youtube.map((y) => (
                  <LinkButton key={y.url} href={y.url}>▶ <strong>{y.channel}</strong> on YouTube{y.why ? ` — ${y.why}` : ''}</LinkButton>
                ))}
                {result.report.resources.books.map((b) => (
                  <LinkButton key={b.url} href={b.url}><IconBook size={16} /> <strong>{b.title}</strong>{b.author ? ` — ${b.author}` : ''}{b.why ? ` · ${b.why}` : ''}</LinkButton>
                ))}
                {result.report.resources.other.map((x) => (
                  <LinkButton key={x.url} href={x.url}><IconLink size={16} /> <strong>{x.name}</strong>{x.why ? ` — ${x.why}` : ''}</LinkButton>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', marginTop: 6 }}>
                Links open a YouTube or Google search for each suggestion, so you always land on current results. Check that a book suits your syllabus.
              </div>
            </div>
          )}
          <div><button type="button" onClick={onClose}
            style={{ border: 'none', cursor: 'pointer', padding: '7px 14px', borderRadius: 10, background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 13 }}>Done</button></div>
        </>
      )}
    </div>
  );
}
