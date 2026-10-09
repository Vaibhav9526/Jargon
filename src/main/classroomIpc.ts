/** IPC for the classroom chat (staff-room cast as chat partners). */
import { app, BrowserWindow, dialog } from 'electron';
import type { IpcMain } from 'electron';
import { join } from 'node:path';
import { ChatStore, isCastId, sendChat, type NoteSnippet } from './classroom';
import { runClaudeOnce } from './llm';
import { Library, SUPPORTED } from './library';
import { buildQuizPrompt, buildReportPrompt, gradeQuiz, parseQuiz, parseReport, reportToMarkdown } from './quiz';

const ID = /^[\w-]{1,64}$/;
let store: ChatStore | null = null;
let library: Library | null = null;
const getLibrary = () => (library ??= new Library(join(app.getPath('userData'), 'classroom', 'library')));
const getStore = () => (store ??= new ChatStore(join(app.getPath('userData'), 'classroom', 'chats')));

/** Supplies library notes for a question — set by the Librarian module (phase 2). */
let notesProvider: ((question: string) => NoteSnippet[]) | null = null;
export function setClassroomNotesProvider(fn: ((question: string) => NoteSnippet[]) | null): void {
  notesProvider = fn;
}

const cleanName = (v: unknown) =>
  (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40) : '') || 'Teacher';

export function registerClassroomIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  // The shelf the Librarian keeps feeds every character's @memory-notes answers.
  setClassroomNotesProvider((question) => getLibrary().search(question, 5).map((h) => ({ source: h.source, text: h.text })));

  ipcMain.handle('library:list', () => getLibrary().list());
  ipcMain.handle('library:remove', (_e, id: unknown) => ({ ok: typeof id === 'string' && getLibrary().remove(id) }));
  ipcMain.handle('library:add', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const opts = {
      title: 'Add notes, books or slides to the library',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Notes, books, slides', extensions: SUPPORTED.map((e) => e.slice(1)) }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled) return { ok: true as const, added: [], errors: [] };
    const added = [];
    const errors: string[] = [];
    for (const p of res.filePaths.slice(0, 20)) {
      const r = await getLibrary().add(p);
      if (r.ok) added.push(r.doc); else errors.push(r.error);
    }
    return { ok: true as const, added, errors };
  });

  ipcMain.handle('classroom:history', (_e, agentId: unknown) =>
    typeof agentId === 'string' && ID.test(agentId) ? getStore().list(agentId) : []);

  ipcMain.handle('classroom:clear', (_e, agentId: unknown) => {
    if (typeof agentId === 'string' && ID.test(agentId)) getStore().clear(agentId);
    return { ok: true as const };
  });

  // ── Teacher quiz: MCQs from the student's doubt, exact grading, weak-point analysis ──
  ipcMain.handle('classroom:quiz', async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { agentId?: unknown; doubt?: unknown };
    if (typeof p.agentId !== 'string' || !ID.test(p.agentId)) return { ok: false as const, error: 'Unknown chat.' };
    const history = getStore().list(p.agentId).map((m) => ({ role: m.role, text: m.text }));
    // The doubt is what the student typed after @quiz; with nothing typed, use their last question.
    const typed = typeof p.doubt === 'string' ? p.doubt.trim() : '';
    const doubt = typed || [...history].reverse().find((m) => m.role === 'user')?.text || '';
    if (!doubt) return { ok: false as const, error: 'Tell me what you are stuck on first — e.g. "@quiz adding fractions".' };
    let lastError = 'The quiz could not be created.';
    for (let attempt = 0; attempt < 2; attempt++) {   // one retry: models occasionally break the format
      const res = await runClaudeOnce(buildQuizPrompt(doubt, history, 5));
      if (!res.ok) return { ok: false as const, error: res.error };
      const parsed = parseQuiz(res.text);
      if (parsed.ok) return { ok: true as const, quiz: parsed.quiz };
      lastError = parsed.error;
    }
    return { ok: false as const, error: lastError };
  });

  ipcMain.handle('classroom:quizReport', async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { agentId?: unknown; quiz?: unknown; answers?: unknown };
    if (typeof p.agentId !== 'string' || !ID.test(p.agentId)) return { ok: false as const, error: 'Unknown chat.' };
    // Never trust the renderer's copy: re-validate the quiz, then grade it HERE.
    const q = parseQuiz(JSON.stringify(p.quiz ?? null));
    if (!q.ok) return { ok: false as const, error: q.error };
    const answers = (Array.isArray(p.answers) ? p.answers : []).slice(0, q.quiz.questions.length)
      .map((a) => ({ picked: typeof (a as { picked?: unknown })?.picked === 'number' ? (a as { picked: number }).picked : null }));
    const graded = gradeQuiz(q.quiz, answers);
    let report = null as ReturnType<typeof parseReport> | null;
    let err = 'The analysis could not be created.';
    for (let attempt = 0; attempt < 2 && !(report && report.ok); attempt++) {
      const res = await runClaudeOnce(buildReportPrompt(q.quiz, graded, answers));
      if (!res.ok) { err = res.error; break; }
      report = parseReport(res.text);
      if (!report.ok) err = report.error;
    }
    if (!report || !report.ok) {
      // The score is still real even if the AI analysis failed — return it.
      return { ok: true as const, graded, report: null, error: err };
    }
    // Keep a recap in the chat: it survives restarts and the teacher sees the weak spots next time.
    const note = {
      id: `quiz-${Date.now().toString(36)}`, role: 'agent' as const, mood: 'thinking' as const,
      text: reportToMarkdown(q.quiz, graded, report.report), ts: Date.now(),
    };
    getStore().append(p.agentId, note);
    return { ok: true as const, graded, report: report.report, note };
  });

  ipcMain.handle('classroom:send', async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { agentId?: unknown; cast?: unknown; name?: unknown; text?: unknown; useNotes?: unknown };
    if (typeof p.agentId !== 'string' || !ID.test(p.agentId)) return { ok: false as const, error: 'Unknown chat.' };
    if (!isCastId(p.cast)) return { ok: false as const, error: 'Unknown character.' };
    if (typeof p.text !== 'string') return { ok: false as const, error: 'Type a message first.' };
    const notes = p.useNotes === true && notesProvider ? notesProvider(p.text) : [];
    try {
      return await sendChat({
        store: getStore(), llm: runClaudeOnce, agentId: p.agentId, cast: p.cast,
        agentName: cleanName(p.name), text: p.text, notes, notesRequested: p.useNotes === true,
      });
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
