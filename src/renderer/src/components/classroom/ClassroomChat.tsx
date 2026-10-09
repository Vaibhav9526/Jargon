import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore, type Agent } from '@/store/store';
import { findTeacherAgent, parseTeachingRequest, type TeachingAttachment, type TeachingRequest } from '@shared/teaching';
import { Face, IdCard } from './IdCard';
import { IconQuiz } from './icons';
import { FileToolResultCard } from './FileToolResult';
import { fileToolAlias, type FileToolResult } from '@shared/fileTools';
import { sendFileToolDraft } from '../MessageQueueComposer';
import { TeachingPanelHost } from './TeachingPanelHost';
import { endLesson, markLessonOpened, releaseLesson, showLessonIn, startLesson, useLesson } from './lessonSession';
import { isSchoolCast } from './art';
import { LibraryStrip } from './LibraryStrip';
import { QuizCard, type QuizData, type QuizResult } from './QuizCard';

export interface ChatMsg {
  id: string;
  role: 'user' | 'agent' | 'note';
  text: string;
  mood?: string;
  sources?: string[];
  ts: number;
}

interface Suggestion { alias: string; hint: string; teacherOnly?: boolean; onlyCast?: string }
const SUGGESTIONS: Suggestion[] = [
  { alias: '@teach-me', hint: 'Open the interactive classroom for a topic (attach PDFs/images)', teacherOnly: true },
  { alias: '@quiz', hint: 'Quiz me on my doubt: MCQs, analysis, weak points and what to study', onlyCast: 'teacher' },
  { alias: '@memory-notes', hint: 'Answer from the notes the Librarian keeps' },
  { alias: '@convert', hint: 'PDF ↔ PPT, image → PDF, PDF → image — attach a file first', onlyCast: 'librarian' },
  { alias: '@compress', hint: 'Shrink an image by a percentage — e.g. @compress 50%', onlyCast: 'librarian' },
];

const STARTERS: Record<string, string[]> = {
  teacher: ['Explain photosynthesis simply', '@teach-me ', '@quiz adding fractions'],
  topper: ['Check my answer: 12 × 12 = 124', 'Why is the sky blue?', 'Give me a tough question'],
  smartguy: ['Quick trick to square 85?', 'Shortcut for percentages?', 'How do I remember the quadratic formula?'],
  librarian: ['@memory-notes what do my notes say about ', '@convert to pdf', '@compress 50%'],
  principal: ['Help me plan my study week', 'What should I prioritise today?'],
};

function Bubble({ msg, agent }: { msg: ChatMsg; agent: Agent }) {
  if (msg.role === 'note') {
    return <div style={{ alignSelf: 'center', fontSize: 12, color: 'var(--cth-ink-500)', padding: '2px 8px' }}>{msg.text}</div>;
  }
  const mine = msg.role === 'user';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: mine ? 'row-reverse' : 'row' }}>
      {!mine && <Face agent={agent} mood={msg.mood} size={36} />}
      <div style={{
        maxWidth: '78%', padding: '8px 12px', borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: mine ? 'var(--cth-lemon-light)' : 'var(--cth-paper-100)',
        boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-900)',
        fontSize: 14, lineHeight: '21px', overflowWrap: 'anywhere',
      }}>
        {mine
          ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
          : <div className="cth-chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown></div>}
        {msg.sources && msg.sources.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--cth-ink-500)' }}>From notes: {msg.sources.join(', ')}</div>
        )}
      </div>
    </div>
  );
}

/** Chat with one staff-room character. `variant` only changes layout density. */
export function ClassroomChat({ agent, variant, onActivity, onMood }: { agent: Agent; variant: 'side' | 'focus'; onActivity?: () => void; onMood?: (mood: string) => void }) {
  const agents = useStore((s) => s.agents);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<TeachingAttachment[]>([]);
  const [toolResult, setToolResult] = useState<FileToolResult | null>(null);
  const lesson = useLesson();
  // Unique per mounted chat view: only the owner may show the (native) lesson page.
  const viewId = useRef(`chat-${Math.random().toString(36).slice(2)}`).current;
  const showingLesson = !!lesson && lesson.owner === viewId;
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const cast = agent.character;
  const school = isSchoolCast(cast);

  // Leaving this chat only HIDES the lesson; it stays reachable from the dropdown.
  useEffect(() => () => releaseLesson(viewId), [viewId]);

  // Load history when switching characters.
  useEffect(() => {
    let live = true;
    setMsgs([]); setError(''); setFiles([]); setToolResult(null);
    void window.cth.classroomHistory(agent.id).then((h) => { if (live) setMsgs(h as ChatMsg[]); }).catch(() => undefined);
    return () => { live = false; };
  }, [agent.id]);


  // Grow the input with its text (one line up to ~6), shrink back when cleared.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(160, Math.max(34, el.scrollHeight))}px`;
  }, [text, showingLesson]);

  const lastMood = useMemo(() => [...msgs].reverse().find((m) => m.role === 'agent')?.mood, [msgs]);
  // The face you see right now: thinking while a reply is being written, then the
  // mood of the last reply.
  const liveMood = busy ? 'thinking' : (lastMood ?? 'neutral');
  useEffect(() => { onMood?.(liveMood); }, [liveMood, onMood]);

  // "@" suggestions.
  const m = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  const query = m ? m[2].toLowerCase() : null;
  const start = m ? caret - m[2].length - 1 : -1;
  const options = query === null || dismissed === start ? [] : SUGGESTIONS.filter((s) =>
    (!s.teacherOnly || cast === 'teacher' || !!findTeacherAgent(agents)) && (!s.onlyCast || s.onlyCast === cast) &&
    s.alias.slice(1).startsWith(query) && s.alias.slice(1) !== query);
  const open = options.length > 0 && !busy;

  const accept = (s: Suggestion) => {
    const next = `${text.slice(0, start)}${s.alias} ${text.slice(caret).replace(/^\s/, '')}`;
    const pos = start + s.alias.length + 1;
    setText(next); setCaret(pos); setPick(0);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(pos, pos); });
  };

  const pickFiles = async () => {
    const res = await window.cth.attachFiles();
    if (res.ok) setFiles((prev) => [...prev, ...res.files.filter((f) => !prev.some((p) => p.path === f.path))]);
  };

  // ── Quiz (Teacher): MCQs from the student's doubt → exact score → weak points + resources ──
  type QuizPhase = 'loading' | 'taking' | 'grading' | 'report';
  const [quizPhase, setQuizPhase] = useState<QuizPhase | null>(null);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [picks, setPicks] = useState<Array<number | null>>([]);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [quizError, setQuizError] = useState('');

  // Keep the newest thing (message, quiz, report) in view.
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs, busy, quizPhase === 'loading', quizPhase === 'report']);

  const closeQuiz = () => { setQuizPhase(null); setQuiz(null); setPicks([]); setQuizResult(null); setQuizError(''); };

  const startQuiz = async (doubt: string) => {
    if (busy || quizPhase) return;
    setError(''); setQuizError(''); setQuizPhase('loading'); setQuiz(null); setQuizResult(null);
    try {
      const res = await window.cth.classroomQuiz({ agentId: agent.id, doubt });
      if (res.ok && res.quiz) {
        setQuiz(res.quiz); setPicks(res.quiz.questions.map(() => null)); setQuizPhase('taking');
      } else {
        closeQuiz(); setError(res.error ?? 'The quiz could not be created.');
      }
    } catch (e) {
      closeQuiz(); setError(e instanceof Error ? e.message : 'The quiz could not be created.');
    }
  };

  const submitQuiz = async () => {
    if (!quiz || quizPhase !== 'taking') return;
    setQuizPhase('grading'); setQuizError('');
    try {
      const res = await window.cth.classroomQuizReport({ agentId: agent.id, quiz, answers: picks.map((p) => ({ picked: p })) });
      if (res.ok && res.graded) {
        setQuizResult({ graded: res.graded, report: res.report ?? null, analysisError: res.report ? undefined : res.error });
        setQuizPhase('report');
        if (res.note) { setMsgs((x) => [...x, res.note as ChatMsg]); onActivity?.(); }
      } else {
        setQuizPhase('taking'); setQuizError(res.error ?? 'Could not analyse the quiz — try again.');
      }
    } catch (e) {
      setQuizPhase('taking'); setQuizError(e instanceof Error ? e.message : 'Could not analyse the quiz — try again.');
    }
  };

  const send = useCallback(async (override?: string) => {
    const raw = (override ?? text).trim();
    if (!raw || busy) return;
    setError('');

    // @quiz [doubt] → MCQ quiz built from the doubt (or the student's last question).
    const quizCmd = /^@quiz\b\s*([\s\S]*)$/i.exec(raw);
    if (quizCmd && cast === 'teacher') {
      setText('');
      void startQuiz(quizCmd[1].trim());
      return;
    }

    // @convert / @compress → the Librarian's file desk (runs locally, nothing uploaded).
    if (fileToolAlias(raw)) {
      if (cast !== 'librarian') { setError('Converting and compressing files is the Librarian\'s job — open the Librarian\'s chat.'); return; }
      setToolResult(null); setBusy(true);
      try {
        const out = await sendFileToolDraft(raw, files, window.cth);
        if (out.kind === 'blocked') { setError(out.error); return; }
        if (out.kind === 'done') {
          setMsgs((x) => [...x, { id: `u-${Date.now()}`, role: 'user', text: raw, ts: Date.now() }]);
          setToolResult(out.result); setText(''); setFiles([]);
          onActivity?.();
        }
      } finally { setBusy(false); }
      return;
    }

    // @teach-me → open the interactive classroom inside this window.
    let teaching: TeachingRequest | null = null;
    try { teaching = parseTeachingRequest(raw, files); } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (teaching) {
      const teacher = cast === 'teacher' ? agent : findTeacherAgent(agents);
      if (!teacher) { setError('No Teacher on the roster — hire the Teacher first.'); return; }
      setMsgs((x) => [...x, { id: `u-${Date.now()}`, role: 'user', text: raw, ts: Date.now() },
        { id: `n-${Date.now()}`, role: 'note', text: 'Opening the classroom…', ts: Date.now() }]);
      startLesson(teaching, teacher.id, viewId);
      setText(''); setFiles([]);
      return;
    }

    const useNotes = cast === 'librarian' || /(^|\s)@memory-notes(?=\s|$)/.test(raw);
    const clean = raw.replace(/(^|\s)@memory-notes(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim() || raw;
    const tempId = `u-${Date.now()}`;
    setMsgs((x) => [...x, { id: tempId, role: 'user', text: clean, ts: Date.now() }]);
    setText(''); setBusy(true);
    try {
      const res = await window.cth.classroomSend({ agentId: agent.id, cast, name: agent.name, text: clean, useNotes });
      if (res.ok && res.agent) {
        setMsgs((x) => [...x, res.agent as ChatMsg]);
        onActivity?.();
      } else {
        setMsgs((x) => x.filter((y) => y.id !== tempId));
        setText(raw);
        setError(res.error ?? 'No reply — try again.');
      }
    } catch (e) {
      setMsgs((x) => x.filter((y) => y.id !== tempId));
      setText(raw);
      setError(e instanceof Error ? e.message : 'No reply — try again.');
    } finally { setBusy(false); }
  }, [text, busy, files, cast, agent, agents, onActivity]);

  if (!school) {
    return <div style={{ padding: 16, fontSize: 13, color: 'var(--cth-ink-500)' }}>Chat is available for the school cast.</div>;
  }

  const focus = variant === 'focus';
  const starters = STARTERS[cast] ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' }}>
      {!focus && <div style={{ padding: '10px 10px 0' }}><IdCard agent={agent} mood={liveMood} compact /></div>}

      {/* Dropdown: this agent's chat, or the running classroom lesson. */}
      <div style={{ padding: focus ? '10px 24px 0' : '8px 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <select
          aria-label="Chat or classroom"
          value={showingLesson ? 'lesson' : 'chat'}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'lesson') showLessonIn(viewId);
            else if (v === 'end') { endLesson(); }
            else releaseLesson(viewId);
          }}
          style={{ padding: '5px 8px', borderRadius: 10, border: 'none', background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 13, fontWeight: 600, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', cursor: 'pointer', maxWidth: '100%' }}
        >
          <option value="chat">{agent.name} chat</option>
          {lesson && <option value="lesson">Classroom — {lesson.request.topic ? lesson.request.topic.slice(0, 40) : 'lesson'}</option>}
          {lesson && <option value="end">End lesson</option>}
        </select>
        {lesson && !showingLesson && <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>Lesson running in the background</span>}
      </div>

      {showingLesson && lesson ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 10, gap: 8 }}>
          <TeachingPanelHost
            key={`${lesson.request.topic}:${lesson.teacherId}`}
            request={lesson.request}
            teacherId={lesson.teacherId}
            alreadyOpen={lesson.opened}
            onOpened={markLessonOpened}
            onFailed={(message) => { endLesson(); setError(message); }}
          />
        </div>
      ) : (
        <>
          <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: focus ? '24px 0' : 10 }}>
            <div style={{ maxWidth: focus ? 760 : undefined, margin: '0 auto', padding: focus ? '0 24px' : 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cast === 'librarian' && <LibraryStrip />}
              {msgs.length === 0 && (
                <div style={{ textAlign: 'center', padding: focus ? '40px 0 8px' : '16px 0' }}>
                  {focus && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Face agent={agent} mood="neutral" size={96} card /></div>}
                  <div style={{ fontSize: focus ? 28 : 16, fontWeight: 800, color: 'var(--cth-ink-900)' }}>
                    Hi, I&apos;m {agent.name}.
                  </div>
                  <div style={{ fontSize: focus ? 16 : 13, color: 'var(--cth-ink-500)', marginTop: 4 }}>What would you like to work on?</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 16 }}>
                    {starters.map((s) => (
                      <button key={s} type="button" onClick={() => { setText(s); area.current?.focus(); setCaret(s.length); }}
                        style={{ border: 'none', cursor: 'pointer', padding: '8px 12px', borderRadius: 12, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', fontSize: 13, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', textAlign: 'left' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((x) => <Bubble key={x.id} msg={x} agent={agent} />)}
              {toolResult && <FileToolResultCard result={toolResult} />}
              {quizPhase && (
                <QuizCard phase={quizPhase} quiz={quiz} picks={picks} result={quizResult} error={quizError}
                  onPick={(qi, oi) => setPicks((p) => p.map((v, i) => (i === qi ? oi : v)))}
                  onSubmit={() => { void submitQuiz(); }} onClose={closeQuiz} />
              )}
              {busy && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <Face agent={agent} mood="thinking" size={36} />
                  <div style={{ padding: '8px 12px', borderRadius: 14, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-500)', fontSize: 13 }}>
                    {agent.name} is typing…
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: focus ? '0 24px 20px' : '0 10px 10px', maxWidth: focus ? 808 : undefined, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
            {error && <div role="alert" style={{ fontSize: 12, color: 'var(--cth-coral)', marginBottom: 6 }}>{error}</div>}
            {open && (
              <div role="listbox" style={{ marginBottom: 6, background: 'var(--cth-paper-100)', borderRadius: 10, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', overflow: 'hidden' }}>
                {options.map((o, i) => (
                  <button key={o.alias} type="button" role="option" aria-selected={i === pick}
                    onMouseDown={(e) => { e.preventDefault(); accept(o); }} onMouseEnter={() => setPick(i)}
                    style={{ display: 'flex', gap: 10, alignItems: 'baseline', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: '6px 10px', background: i === pick ? 'var(--cth-lemon-light)' : 'transparent', color: 'var(--cth-ink-900)', fontSize: 12 }}>
                    <code style={{ fontWeight: 700 }}>{o.alias}</code><span style={{ color: 'var(--cth-ink-500)' }}>{o.hint}</span>
                  </button>
                ))}
              </div>
            )}
            {cast === 'teacher' && !quizPhase && (msgs.length > 0 || text.trim()) && (
              <div style={{ marginBottom: 6 }}>
                <button type="button" onClick={() => { void startQuiz(text.replace(/^@quiz\b/i, '').trim()); setText(''); }} disabled={busy}
                  title="Teacher writes MCQs about your doubt, then analyses your answers"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: busy ? 'default' : 'pointer', padding: '5px 12px', borderRadius: 999, background: 'var(--cth-lilac-light)', color: 'var(--cth-ink-900)', fontSize: 12, fontWeight: 600, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
                  <IconQuiz size={15} /> Quiz me on this
                </button>
              </div>
            )}
            {files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {files.map((f) => (
                  <span key={f.path} title={f.path} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '2px 8px', borderRadius: 8, background: 'var(--cth-cream-200)', fontSize: 12, color: 'var(--cth-ink-900)' }}>
                    {f.name}
                    <button type="button" onClick={() => setFiles((p) => p.filter((y) => y.path !== f.path))} aria-label="Remove file" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)', padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '8px 8px', borderRadius: focus ? 16 : 12, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
              <button type="button" onClick={() => { void pickFiles(); }} title={cast === 'librarian' ? 'Attach PDFs, slides or images for @convert / @compress' : 'Attach PDFs or images for @teach-me'} aria-label="Attach files"
                style={{ border: 'none', cursor: 'pointer', width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>+</button>
              <textarea
                ref={area}
                rows={1}
                value={text}
                disabled={busy}
                placeholder={`Message ${agent.name} — type @ for options`}
                onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setPick(0); setDismissed(null); setError(''); }}
                onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (open) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setPick((i) => (i + 1) % options.length); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setPick((i) => (i - 1 + options.length) % options.length); return; }
                    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); accept(options[Math.min(pick, options.length - 1)]); return; }
                    if (e.key === 'Escape') { e.preventDefault(); setDismissed(start); return; }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                }}
                style={{ flex: 1, minWidth: 0, resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 14, lineHeight: '20px', padding: '7px 2px', boxSizing: 'border-box', minHeight: 34, maxHeight: 160, overflowY: 'auto', display: 'block' }}
              />
              <button type="button" onClick={() => { void send(); }} disabled={busy || !text.trim()} aria-label="Send"
                style={{ border: 'none', cursor: busy || !text.trim() ? 'default' : 'pointer', width: 34, height: 34, flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, borderRadius: 10, background: busy || !text.trim() ? 'var(--cth-cream-300)' : 'var(--cth-ink-900)', color: busy || !text.trim() ? 'var(--cth-ink-500)' : 'var(--cth-paper-100)', fontSize: 16 }}>↑</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
