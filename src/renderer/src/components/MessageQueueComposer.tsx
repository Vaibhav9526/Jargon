import { ClipboardEvent, DragEvent, KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';
import { useStore, type Agent, type QueuedMessage } from '@/store/store';
import { clearTerminalDraft, dismissTerminalPicker, terminalAutomationBlockFor } from './terminalPool';
import type { TerminalAutomationBlock } from './terminalAutomation';
import { freeflowRecorder, useFreeflow } from '@/freeflow/recorder';
import { useTerminalFontSize } from './terminalFontSize';
import { isComposingKey } from '@shared/imeGuard';
import { useRtl } from '@/i18n/useDirection';
import { parseTeachingRequest, findTeacherAgent, type TeachingAgent, type TeachingAttachment, type TeachingRequest } from '@shared/teaching';
import { TeachingAccessDialog } from './TeachingAccessDialog';
import { parseFileToolRequest, fileToolAlias, type FileToolResult } from '@shared/fileTools';
import { parseMailRequest } from '@shared/mailAliases';
import { FileToolResultCard } from './classroom/FileToolResult';

const EMPTY_QUEUE: QueuedMessage[] = [];

/** A file/image attached to the draft. Travels to the agent as a PATH it Reads. */
interface Attachment {
  path: string;
  name: string;
}

// Prepended (only to the enqueued value, never the visible draft) when the

// --- Teach mode: @teach-me / @teacher drafts open the hosted learning site in
// the Jargon Teaching window and are handed to the Teacher agent. -------------

/** The teaching IPC surface is landing on the preload bridge in parallel, so
 *  `CthApi` may not declare it yet — same convention as SettingsModal's
 *  TriggersApi: read `window.cth` through a narrow local view and treat a
 *  missing/rejecting method as a normal failure, never a renderer crash.
 *  Only `teachingOpen` is used: the flow is manual (the user works the hosted
 *  site themselves), so there is no status check and no stored access code. */
export interface TeachingBridge {
  teachingOpen(request: TeachingRequest & { teacherId: string }): Promise<{ ok: boolean; error?: string; jobId?: string }>;
}
const teachingBridge = (): TeachingBridge => window.cth as unknown as TeachingBridge;

export type TeachingSendOutcome =
  /** The draft isn't a teaching request — the caller runs its normal send. */
  | { kind: 'ordinary' }
  | { kind: 'sent'; teacherId: string; jobId?: string }
  /** Invalid request, no Teacher on the roster, or an IPC failure — the draft
   *  and files must stay. */
  | { kind: 'blocked'; error: string };

/** What the Teacher's queue row shows: the raw topic plus file-path context,
 *  in the same "Attached files:" convention the agent Reads directly. */
export function teachingQueueText(request: TeachingRequest): string {
  const filesBlock = request.attachments.length
    ? `Attached files:\n${request.attachments.map((a) => `- ${a.path} (${a.name})`).join('\n')}`
    : '';
  return request.topic
    ? (filesBlock ? `${request.topic}\n\n${filesBlock}` : request.topic)
    : filesBlock;
}

/** What is typed to the Teacher: the app opened the hosted learning site in
 *  the Jargon Teaching window and the user works it manually, so the agent
 *  must not call any teaching API or try to generate a lesson itself. */
export function teachingQueueInstruction(request: TeachingRequest): string {
  const filesBlock = request.attachments.length
    ? `Attached files:\n${request.attachments.map((a) => `- ${a.path} (${a.name})`).join('\n')}`
    : '';
  return [
    request.topic ? `Teach the user about: ${request.topic}` : 'Teach the user from the attached files.',
    filesBlock,
    'The app opened the hosted learning site (OpenMAIC, open.maic.chat) in the Jargon Teaching window — the user signs in there, pastes the topic, uploads the selected materials and presses Generate themselves. Do NOT call the OpenMAIC API or auto-generate a classroom; guide the user through those manual steps here using the topic and the file paths above.'
  ].filter(Boolean).join('\n\n');
}

/** The draft can still grow while the async handoff runs (a dictation can land
 *  in it) — strip exactly the sent snapshot and keep whatever came after. */
export function draftAfterSend(live: string, sent: string): string {
  if (live === sent) return '';
  return live.startsWith(sent) ? live.slice(sent.length).replace(/^\s+/, '') : live;
}

/** One seam for the whole teach-mode send: parse the draft snapshot, find the
 *  active Teacher, open the hosted learning site in the Jargon Teaching
 *  window, then hand the topic to the Teacher's own queue. Everything past
 *  the parse awaits IPC, so callers must pass a SNAPSHOT — later edits can
 *  never leak into the request. */
export async function sendTeachingDraft(
  text: string,
  attachments: readonly TeachingAttachment[],
  deps: {
    agents: readonly TeachingAgent[];
    api: TeachingBridge;
    enqueue: (agentId: string, text: string, meta?: { instruction?: string }) => void;
    select: (agentId: string) => void;
    trackSent: () => void;
  }
): Promise<TeachingSendOutcome> {
  let request: TeachingRequest | null;
  try {
    request = parseTeachingRequest(text, attachments);
  } catch (err) {
    return { kind: 'blocked', error: err instanceof Error ? err.message : String(err) };
  }
  if (!request) return { kind: 'ordinary' };

  const teacher = findTeacherAgent(deps.agents);
  if (!teacher) {
    return {
      kind: 'blocked',
      error: 'No Teacher agent on the roster — hire the Teacher character (or name an agent "Teacher") and send again. Your draft and files are kept.'
    };
  }

  let res: { ok: boolean; error?: string; jobId?: string };
  try {
    res = await deps.api.teachingOpen({ ...request, teacherId: teacher.id });
  } catch (err) {
    return { kind: 'blocked', error: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) {
    return { kind: 'blocked', error: res.error ?? 'The hosted learning site could not be opened. Your draft and files are kept.' };
  }

  deps.enqueue(teacher.id, teachingQueueText(request), { instruction: teachingQueueInstruction(request) });
  deps.select(teacher.id);
  deps.trackSent();
  return { kind: 'sent', teacherId: teacher.id, jobId: res.jobId };
}

/** @convert / @compress run locally in the main process (the Librarian's file
 *  desk) — no agent turn, no upload. The draft snapshot is validated here for a
 *  fast error and again in main before anything touches a file. */
export type FileToolOutcome =
  | { kind: 'ordinary' }
  | { kind: 'done'; result: FileToolResult }
  | { kind: 'blocked'; error: string };

export async function sendFileToolDraft(
  text: string,
  attachments: readonly TeachingAttachment[],
  api: { fileToolsRun(p: { text: string; files: Array<{ path: string; name: string }> }): Promise<FileToolResult> }
): Promise<FileToolOutcome> {
  try {
    if (!parseFileToolRequest(text, attachments)) return { kind: 'ordinary' };
  } catch (err) {
    return { kind: 'blocked', error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const result = await api.fileToolsRun({ text, files: attachments.map((a) => ({ path: a.path, name: a.name })) });
    return result.ok ? { kind: 'done', result } : { kind: 'blocked', error: result.error ?? 'The conversion failed.' };
  } catch (err) {
    return { kind: 'blocked', error: err instanceof Error ? err.message : String(err) };
  }
}

interface MentionOption { alias: string; hint: string; insert?: string; officeOnly?: boolean; action?: 'open-mail' }
const MENTION_OPTIONS: ReadonlyArray<MentionOption> = [
  { alias: '@teacher', hint: 'Open the hosted learning site and hand the topic to the Teacher' },
  { alias: '@teach-me', hint: 'Same as @teacher — teach me this topic' },
  { alias: '@convert', hint: 'Librarian: PDF ↔ PPT, image → PDF, PDF → image — attach a file, e.g. “@convert to pdf”' },
  { alias: '@compress', hint: 'Librarian: shrink an image by a percentage — e.g. “@compress 50%”' },
  // Office floor only: opens Jargon Mail (read / summarize / extract / rewrite / send).
  { alias: '@mailman', officeOnly: true, action: 'open-mail', hint: 'Mailman: open Mail — read, summarize, extract, rewrite and send' },
  { alias: '@email', officeOnly: true, action: 'open-mail', hint: 'Same as @mailman' },
  { alias: '@mail', officeOnly: true, action: 'open-mail', hint: 'Same as @mailman' },
  { alias: '@inbox', officeOnly: true, action: 'open-mail', hint: 'Same as @mailman — your inbox' }
];

export interface MessageQueueComposerProps {
  agent: Agent;
}

/**
 * Lets the user keep messaging an agent whose terminal is mid-run. Typed
 * messages park in a per-agent queue and are submitted to the agent's Claude
 * TUI one-by-one as soon as it goes idle (see useHive's flush loop).
 */
export function MessageQueueComposer({ agent }: MessageQueueComposerProps) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const queue = useStore((s) => s.messageQueues[agent.id]) ?? EMPTY_QUEUE;
  const enqueueMessage = useStore((s) => s.enqueueMessage);
  const removeQueuedMessage = useStore((s) => s.removeQueuedMessage);
  const releaseQueuedMessage = useStore((s) => s.releaseQueuedMessage);
  const clearQueue = useStore((s) => s.clearQueue);
  const agents = useStore((s) => s.agents);
  const select = useStore((s) => s.select);

  // Draft lives in the store, keyed by agent — switching agents remounts this
  // component, and component-local state would silently eat the typed text.
  const text = useStore((s) => s.drafts[agent.id] ?? '');
  const setDraft = useStore((s) => s.setDraft);
  const setText = (t: string) => setDraft(agent.id, t);

  // Free Flow voice dictation (entry point A). The mic button shows only when the
  // feature is enabled in Settings; a transcript is appended to this draft for
  // review before sending (never auto-sent). When enabled but no Groq key is set,
  // the button stays VISIBLE but DISABLED with a tooltip pointing to Settings
  // (hasGroqKey is boolean presence only — the key value never reaches the store).
  const freeflowEnabled = useStore((s) => s.freeflowEnabled);
  const hasGroqKey = useStore((s) => s.hasGroqKey);
  const ff = useFreeflow();
  const ffMine = ff.targetAgentId === agent.id;
  const ffHint = !freeflowEnabled
    ? null
    : ffMine && ff.status === 'recording'
    ? t('queueComposer.recording')
    : ffMine && ff.status === 'transcribing'
    ? t('queueComposer.transcribing')
    : ff.error && (ffMine || ff.targetAgentId === null)
    ? `${t('queueComposer.voice')}: ${ff.error}`
    : null;

  // The draft box is the terminal's twin — it should read at the same size the
  // agent's output does, at every zoom level.
  const composerFontSize = useTerminalFontSize();
  const composerLineHeight = Math.round(composerFontSize * 1.4);

  const idle = agent.status === 'idle';

  // Only the god/Michael agent gets the delegation toggle. Default OFF.

  // Files/images staged for the next message. Component-local: switching agents
  // remounts this component, so attachments are cleared on tab switch (drafts
  // persist in the store, attachments deliberately don't carry over).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Teach-mode handoff (@teach-me / @teacher). teachingBusy locks the send for
  // the whole async flow; the ref twin closes the synchronous gap — two clicks
  // in one tick must not open two teaching windows.
  const [teachingBusy, setTeachingBusy] = useState(false);
  const [teachError, setTeachError] = useState<string | null>(null);
  const teachingBusyRef = useRef(false);
  const [fileToolResult, setFileToolResult] = useState<FileToolResult | null>(null);
  // Purely informational — the provider-details dialog is never part of a send.
  const [providerInfoOpen, setProviderInfoOpen] = useState(false);

  const closeProviderInfo = () => {
    setProviderInfoOpen(false);
    // Focus return — the dialog took focus on open; hand it back to the draft.
    textareaRef.current?.focus({ preventScroll: true });
  };

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Disclosed the moment the draft reads as teaching — before anything sends.
  // A throw here still means an alias was recognised (unaliased text never
  // throws), so the disclosure stays up while the draft is being fixed.
  let teachAliasSeen = false;
  try {
    teachAliasSeen = parseTeachingRequest(text, []) !== null;
  } catch {
    teachAliasSeen = true;
  }

  const fileToolSeen = fileToolAlias(text);

  const addAttachments = (incoming: Attachment[]) =>
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.path));
      const fresh = incoming.filter((a) => a.path && !seen.has(a.path));
      return fresh.length ? [...prev, ...fresh] : prev;
    });

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path));

  // '+' button → OS picker (images group + all files).
  const pickFiles = async () => {
    const res = await window.cth.attachFiles();
    if (res.ok) addAttachments(res.files);
  };

  // Drop files onto the composer → resolve each to its absolute path.
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (!dropped.length) return;
    const atts = dropped
      .map((f) => ({ path: window.cth.pathForFile(f), name: f.name }))
      .filter((a) => a.path);
    if (atts.length) addAttachments(atts);
  };

  // Paste a screenshot (no path → persist the native clipboard image to a temp
  // file) or paste files copied from the OS file manager (carry a real path).
  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const hasImage = items.some((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (hasImage) {
      e.preventDefault();
      const res = await window.cth.saveClipboardImage();
      if (res.ok) addAttachments([res.file]);
      return;
    }
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      const atts = files
        .map((f) => ({ path: window.cth.pathForFile(f), name: f.name }))
        .filter((a) => a.path);
      if (atts.length) {
        e.preventDefault();
        addAttachments(atts);
      }
    }
  };

  // "@" suggestions — the aliases the composer actually understands. Shown while
  // the caret sits inside an "@word" token that starts the draft or follows
  // whitespace; Up/Down move, Tab/Enter accept, Esc dismisses.
  const onOfficeFloor = useStore((s) => s.officeTheme) === 'office';
  const [caret, setCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
  const mentionMatch = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null;
  const mentionStart = mentionMatch ? caret - mentionMatch[2].length - 1 : -1;
  const mentionOptions = mentionQuery === null || mentionDismissed === `${mentionStart}`
    ? []
    : MENTION_OPTIONS.filter((o) => (!o.officeOnly || onOfficeFloor)
        && o.alias.slice(1).startsWith(mentionQuery) && o.alias.slice(1) !== mentionQuery);
  const mentionOpen = mentionOptions.length > 0 && !teachingBusy;

  const acceptMention = (opt: MentionOption) => {
    const before = text.slice(0, mentionStart);
    const after = text.slice(caret);
    if (opt.action === 'open-mail') {
      // Drop the "@email" token and ask the app shell to open the Mail panel.
      setText(`${before}${after.replace(/^\s/, '')}`);
      setCaret(before.length);
      window.dispatchEvent(new CustomEvent('jargon:open-mail', { detail: { request: '' } }));
      return;
    }
    // Email actions expand into a ready instruction; teaching aliases stay as-is.
    const inserted = opt.insert ?? `${opt.alias} `;
    const next = `${before}${inserted}${after.replace(/^\s/, '')}`;
    const pos = before.length + inserted.length;
    setText(next);
    setCaret(pos);
    setMentionIdx(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(pos, pos); }
    });
  };

  const canSend = !!text.trim() || attachments.length > 0;

  /** @mail / @email / @mailman / @inbox: the Mailman's desk. Handled at send time
   *  too — typing the whole alias closes the suggestion list, so Enter used to
   *  send it to the agent as plain text and nothing opened. */
  const runMailDraft = (draftText: string): boolean => {
    const mail = parseMailRequest(draftText);
    if (!mail) return false;
    if (!onOfficeFloor) { setTeachError('Mail lives on the Office floor — switch the office theme back to Office to use the Mailman.'); return true; }
    window.dispatchEvent(new CustomEvent('jargon:open-mail', { detail: { request: mail.request } }));
    setText(draftAfterSend(useStore.getState().drafts[agent.id] ?? '', draftText));
    return true;
  };

  /** @convert / @compress: true when the draft was a file-tool request (handled
   *  here, success or failure); false means fall through to the normal send. */
  const runFileToolDraft = async (draftText: string, draftFiles: readonly Attachment[]): Promise<boolean> => {
    const tool = await sendFileToolDraft(draftText, draftFiles, window.cth);
    if (tool.kind === 'ordinary') return false;
    if (tool.kind === 'blocked') { setTeachError(tool.error); return true; }
    setFileToolResult(tool.result);
    setText(draftAfterSend(useStore.getState().drafts[agent.id] ?? '', draftText));
    const done = new Set(draftFiles.map((a) => a.path));
    setAttachments((prev) => prev.filter((a) => !done.has(a.path)));
    return true;
  };

  const queueIt = () => {
    if (!canSend || teachingBusyRef.current) return;
    setTeachError(null);
    setFileToolResult(null);
    // Snapshot before any await: the request that launches must be exactly this
    // draft, and only this snapshot is cleared afterwards.
    const draftText = text;
    const draftFiles = attachments;
    teachingBusyRef.current = true;
    setTeachingBusy(true);
    void (async () => {
      try {
        if (runMailDraft(draftText)) return;
        if (await runFileToolDraft(draftText, draftFiles)) return;
        const outcome = await sendTeachingDraft(draftText, draftFiles, {
          agents: agents.filter((a) => !a.archived),
          api: teachingBridge(),
          enqueue: enqueueMessage,
          select,
          trackSent: () => void window.cth.trackMessageSent('composer')
        });
        if (outcome.kind === 'ordinary') {
          // Not a teaching draft — the existing enqueue, unchanged.
          // Prepend an "Attached files:" block using the same path-based convention as
          // the Slack inbound path (useHive.ts) so agents Read the files directly.
          const body = draftFiles.length
            ? (draftText.trim()
                ? `${draftText}\n\nAttached files:\n`
                : 'Attached files:\n') + draftFiles.map((a) => `- ${a.path} (${a.name})`).join('\n')
            : draftText;
          enqueueMessage(agent.id, body);
          // Counted HERE, at the composer's submit, and NOT inside enqueueMessage:
          // that store action is also how work orders, Slack inbound, nudges and
          // compact commands reach an agent, and none of those is a person sending a
          // message. Past the isComposingKey guard in onKey, so an IME candidate
          // Enter never counts. (TELEMETRY.md → message_sent)
          void window.cth.trackMessageSent('composer');
          setText('');
          setAttachments([]);
        } else if (outcome.kind === 'sent') {
          // Clear only the sent snapshot — anything appended to the draft
          // (dictation, an edit) while the handoff ran stays.
          setText(draftAfterSend(useStore.getState().drafts[agent.id] ?? '', draftText));
          const sentPaths = new Set(draftFiles.map((a) => a.path));
          setAttachments((prev) => prev.filter((a) => !sentPaths.has(a.path)));
        } else if (outcome.kind === 'blocked') {
          setTeachError(outcome.error);
        }
      } finally {
        teachingBusyRef.current = false;
        setTeachingBusy(false);
        textareaRef.current?.focus({ preventScroll: true });
      }
    })();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKey(e)) return;
    if (mentionOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionOptions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionOptions.length) % mentionOptions.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        acceptMention(mentionOptions[Math.min(mentionIdx, mentionOptions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setMentionDismissed(`${mentionStart}`); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      queueIt();
    }
  };

  // Delivery can be held back by the agent's own terminal (a half-typed draft or
  // an open slash-command picker owns the prompt). That used to be invisible —
  // the hint claimed it was sending while nothing moved — so poll it and say so.
  // Poll whenever something is queued, busy or not: a busy agent is exactly when
  // a user might have half-typed in the terminal above, and it is when the queue
  // is in use — so the hold must be reported then, not only once the agent idles.
  const block = useTerminalBlock(agent.ptyId, queue.length > 0);

  // Floor-wide auto-delivery pause (Command Center switch) also holds the queue.
  // Without saying so — and without the per-row "send now" override — messages
  // look permanently stuck with no explanation and no escape hatch.
  const deliveryPaused = useDeliveryPaused(agent.id, queue.length > 0);

  const statusHint = queue.length === 0
    ? null
    : block === 'draft'
    ? t('queueComposer.heldDraft', { name: agent.name })
    : block === 'picker'
    ? t('queueComposer.heldPicker', { name: agent.name })
    : block === 'exited'
    ? t('queueComposer.heldExited', { name: agent.name })
    : !idle
    ? t('queueComposer.busyQueued', { name: agent.name, count: queue.length })
    : deliveryPaused && !queue[0]?.manual
    ? t('queueComposer.heldFloor')
    : t('queueComposer.sendingOneByOne', { name: agent.name });

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => {
        // Only clear when the cursor actually leaves the composer, not on child enter.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--cth-ink-700)',
        background: 'var(--cth-cream-100)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        boxShadow: dragOver ? 'inset 0 0 0 2px var(--cth-lilac)' : undefined
      }}>
      {dragOver && (
        <span style={{
          fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '12px',
          color: 'var(--cth-ink-700)', textAlign: 'center'
        }}>{t('queueComposer.dropToAttach')}</span>
      )}
      {/* Header: label, count, status, clear-all */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--cth-font-display)',
          fontSize: 9, lineHeight: '12px',
          color: 'var(--cth-ink-700)'
        }}>{t('queueComposer.queue')}</span>
        {queue.length > 0 && (
          <span style={{
            fontSize: 11, padding: '1px 6px 0',
            background: 'var(--cth-cream-200)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
            fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink-900)'
          }}>{queue.length}</span>
        )}
        {statusHint && (
          <span
            title={deliveryPaused && !queue[0]?.manual
              ? t('queueComposer.pausedTitle')
              : statusHint}
            style={{
              fontSize: 12,
              color: idle ? 'var(--cth-ink-700)' : 'var(--cth-ink-500)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}
          >{statusHint}</span>
        )}
        {(block === 'draft' || block === 'picker') && agent.ptyId && (
          <button
            onClick={() => {
              // A picker and a draft are unblocked by different keys: Escape
              // closes the picker, Ctrl-U kills the input line. Sending Ctrl-U
              // at a picker leaves it open while telling automation the prompt
              // is free, which is how a queued message ends up typed into a
              // menu and marked delivered.
              if (block === 'picker') { dismissTerminalPicker(agent.ptyId!); return; }
              // Keep whatever was on the prompt — it lands in this composer so
              // the user can send it properly instead of losing it to Ctrl-U.
              const discarded = clearTerminalDraft(agent.ptyId!);
              if (discarded.trim()) setText(text ? `${text}\n${discarded}` : discarded);
            }}
            title={block === 'picker'
              ? "Close the picker this agent has open so queued messages can be delivered"
              : "Move the leftover text on this agent's prompt into this box so queued messages can be delivered"}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              fontFamily: 'var(--cth-font-ui)', fontSize: 12,
              color: 'var(--cth-ink-900)', textDecoration: 'underline'
            }}
          >{block === 'picker' ? t('queueComposer.closePicker') : t('queueComposer.recoverPrompt')}</button>
        )}
        {queue.length > 1 && (
          <button
            onClick={() => clearQueue(agent.id)}
            title={t('queueComposer.clearAllTitle')}
            style={{
              marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap',
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--cth-font-ui)', fontSize: 12,
              color: 'var(--cth-ink-500)'
            }}
          >{t('queueComposer.clearAll')}</button>
        )}
      </div>

      {/* Pending list */}
      {queue.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          maxHeight: 280, overflowY: 'auto'
        }}>
          {queue.map((m, i) => (
            <QueuedMessageRow
              key={m.id}
              index={i}
              message={m}
              paused={deliveryPaused}
              onSendNow={() => releaseQueuedMessage(agent.id, m.id)}
              onRemove={() => removeQueuedMessage(agent.id, m.id)}
            />
          ))}
        </div>
      )}

      {/* Free Flow recording / transcription status (entry point A) */}
      {ffHint && (
        <span style={{
          fontSize: 12, lineHeight: '16px',
          color: ff.error && !(ffMine && ff.status !== 'idle') ? 'var(--cth-coral)' : 'var(--cth-ink-500)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{ffHint}</span>
      )}

      {/* Attached files/images — chips with a remove 'x', above the textarea. */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {attachments.map((a) => (
            <span
              key={a.path}
              title={a.path}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                maxWidth: '100%',
                padding: '2px 4px 2px 6px',
                background: 'var(--cth-cream-200)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
                color: 'var(--cth-ink-900)'
              }}
            >
              <Icon name="folder" />
              <span style={{
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: 180
              }}>{a.name}</span>
              <button
                onClick={() => removeAttachment(a.path)}
                title={t('queueComposer.removeAttachment')}
                style={{
                  flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--cth-ink-500)', padding: 0,
                  display: 'inline-flex', alignItems: 'center'
                }}
              >
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Composer — full-width input above a single tidy control bar (cc-ui-polish),
          with file/image attachment chips + paste-to-attach (rich-composer). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Hosted-provider disclosure — shown as soon as a teach alias is
            recognised, before anything is sent. The flow is manual: Jargon
            only opens the site and hands the topic to the Teacher. */}
        {teachAliasSeen && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}><Icon name="info" /></span>
            <span>
              Teaching draft — Jargon opens the hosted learning site in the Jargon Teaching
              window; the topic{attachments.length ? ' and attached files' : ''} go to the Teacher&apos;s
              queue so you can paste the topic, upload the files and press Generate on the site
              yourself. Jargon stores no access code and calls no teaching API — a provider
              account, quota or charges may apply.
              {' '}
              <button
                type="button"
                onClick={() => setProviderInfoOpen(true)}
                title="Which provider hosts the learning site — opening this never sends the draft"
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit',
                  color: 'var(--cth-ink-900)', textDecoration: 'underline'
                }}
              >Provider details</button>
            </span>
          </div>
        )}
        {(fileToolSeen && !fileToolResult) && (
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
            {fileToolSeen === 'convert'
              ? 'Librarian file desk — attach a PDF, PPT or image and say “to pdf”, “to ppt” or “to image”. Runs on this computer; nothing is uploaded.'
              : 'Librarian file desk — attach an image and say how much smaller, e.g. “@compress 50%”. Runs on this computer; nothing is uploaded.'}
          </span>
        )}
        {fileToolResult && <FileToolResultCard result={fileToolResult} />}
        {teachError && (
          <span role="alert" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-coral)' }}>
            {teachError}
          </span>
        )}
        {mentionOpen && (
          <div role="listbox" aria-label="Suggestions" style={{
            display: 'flex', flexDirection: 'column',
            background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-700)'
          }}>
            {mentionOptions.map((o, i) => (
              <button
                key={o.alias}
                type="button"
                role="option"
                aria-selected={i === mentionIdx}
                onMouseDown={(e) => { e.preventDefault(); acceptMention(o); }}
                onMouseEnter={() => setMentionIdx(i)}
                style={{
                  display: 'flex', gap: 10, alignItems: 'baseline', textAlign: 'left',
                  border: 'none', cursor: 'pointer', padding: '4px 8px',
                  background: i === mentionIdx ? 'var(--cth-lemon)' : 'transparent',
                  color: 'var(--cth-ink-900)', fontSize: 12, lineHeight: '16px'
                }}
              >
                <code style={{ fontFamily: 'var(--cth-font-mono)', fontWeight: 600 }}>{o.alias}</code>
                <span style={{ color: 'var(--cth-ink-500)' }}>{o.hint}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          dir={rtl ? 'auto' : undefined}
          className="cth-input"
          value={text}
          // read-only (not disabled) while a send is being handled: a disabled
          // field drops keyboard focus, so the next keystrokes went nowhere until
          // the user clicked the box again.
          readOnly={teachingBusy}
          aria-busy={teachingBusy}
          onChange={(e) => {
            setText(e.target.value); setTeachError(null);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setMentionIdx(0); setMentionDismissed(null);
          }}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow') && !mentionOpen) setCaret(e.currentTarget.selectionStart ?? 0); }}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKey}
          onPaste={onPaste}
          rows={5}
          placeholder={idle ? t('queueComposer.messagePlaceholder', { name: agent.name }) : t('queueComposer.busyPlaceholder', { name: agent.name })}
          style={{
            width: '100%',
            resize: 'vertical',
            // Track the terminal's zoom (Cmd +/- or the terminal's own zoom
            // buttons) instead of a hardcoded 13px. On a large display the
            // terminal text scaled up while this box stayed tiny; box height is
            // derived from the same size so the visible line count is stable.
            minHeight: composerLineHeight * 5 + 14,
            maxHeight: composerLineHeight * 18,
            padding: '6px 8px',
            background: 'var(--cth-paper-100)',
            border: 'none',
            // Border lives in .cth-input so :focus can change it — an inline
            // boxShadow here would outrank the stylesheet and the focus state
            // would silently never apply.
            fontFamily: 'var(--cth-font-mono)',
            fontSize: composerFontSize, lineHeight: `${composerLineHeight}px`,
            color: 'var(--cth-ink-900)',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
        {/* Control bar: Attach + voice + Send aligned right. flexWrap so a
            narrow sidebar wraps the buttons onto a second row instead of
            pushing Send off-screen. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, rowGap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ flex: 1 }} />
          <PixelButton variant="secondary" size="sm" onClick={pickFiles}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Icon name="plus" /> {t('queueComposer.files')}
            </span>
          </PixelButton>
          {freeflowEnabled && <FreeFlowButton agentId={agent.id} hasGroqKey={hasGroqKey} />}
          <PixelButton variant="primary" size="sm" onClick={queueIt} disabled={!canSend || teachingBusy}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {t('commandBar.send')} <Icon name="arrow-right" />
            </span>
          </PixelButton>
        </div>
      </div>
      {providerInfoOpen && (
        <TeachingAccessDialog onClose={closeProviderInfo} />
      )}
    </div>
  );
}

/** Poll the pty's automation block while there is something waiting on it. The
 * flag lives in the terminal pool (a plain module map, not the store), so there
 * is nothing to subscribe to — a 1s tick while the queue is pending is enough. */
function useTerminalBlock(ptyId: string | undefined, active: boolean): TerminalAutomationBlock {
  const [block, setBlock] = useState<TerminalAutomationBlock>(null);
  useEffect(() => {
    if (!ptyId || !active) { setBlock(null); return; }
    const read = () => setBlock(terminalAutomationBlockFor(ptyId));
    read();
    const iv = setInterval(read, 1000);
    return () => clearInterval(iv);
  }, [ptyId, active]);
  // 'settling' is a sub-second gap between writes — not worth telling anyone.
  return block === 'settling' ? null : block;
}

/** Poll the floor-wide auto-delivery pause (main-process control state) while
 * this agent has messages waiting. 2s is plenty — the pause flips on human
 * timescales, and the drain re-reads the live snapshot before every send. */
function useDeliveryPaused(agentId: string, active: boolean): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!active) { setPaused(false); return; }
    let alive = true;
    const read = () => {
      window.cth.controlSnapshot(agentId)
        .then((s) => { if (alive) setPaused(!!s?.autoDeliveryPaused); })
        .catch(() => { /* main not ready — assume not paused */ });
    };
    read();
    const iv = setInterval(read, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [agentId, active]);
  return paused;
}

/**
 * One pending queue row. Collapsed it clamps to 2 lines; "see more" expands it
 * in place so a long message can be read without hovering for the tooltip. The
 * toggle only renders when the text actually clips, so short messages stay tidy.
 */
function QueuedMessageRow(
  { index, message, paused, onSendNow, onRemove }: {
    index: number;
    message: QueuedMessage;
    /** Floor-wide auto-delivery is paused — offer the per-message override. */
    paused: boolean;
    onSendNow: () => void;
    onRemove: () => void;
  }
) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Measure against the CLAMPED box, so the toggle survives being expanded (the
  // expanded box never overflows and would otherwise report clipped = false).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      if (expanded) return;
      setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    // The panel is resizable — re-measure on width changes, not just text ones.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [message.text, expanded]);

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 6,
      padding: '4px 6px',
      background: 'var(--cth-paper-100)',
      boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>
      <span style={{
        fontFamily: 'var(--cth-font-mono)', fontSize: 12,
        color: 'var(--cth-ink-500)', lineHeight: '18px', flexShrink: 0
      }}>{`${index + 1}.`}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          ref={bodyRef}
          dir={rtl ? 'auto' : undefined}
          title={expanded ? undefined : message.text}
          style={{
            fontSize: 12, lineHeight: '18px',
            color: 'var(--cth-ink-900)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            ...(expanded
              // Cap the expanded body so one long message can't push the rest of
              // the queue out of the list's own 280px scroll area.
              ? { maxHeight: 220, overflowY: 'auto' as const }
              : {
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                })
          }}
        >{message.text}</div>
        {(clipped || expanded || paused) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {(clipped || expanded) && (
              <button
                onClick={() => setExpanded((e) => !e)}
                title={expanded ? t('queueComposer.collapse') : t('queueComposer.showFull')}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
                  color: 'var(--cth-ink-500)', textDecoration: 'underline'
                }}
              >{expanded ? t('queueComposer.seeLess') : t('queueComposer.seeMore')}</button>
            )}
            {paused && !message.manual && (
              <button
                onClick={onSendNow}
                title={t('queueComposer.sendNowTitle')}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
                  color: 'var(--cth-ink-900)', textDecoration: 'underline'
                }}
              >{t('queueComposer.sendNow')}</button>
            )}
            {paused && message.manual && (
              <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                {t('queueComposer.sendingWhenFree')}
              </span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={onRemove}
        title={t('queueComposer.removeFromQueue')}
        style={{
          flexShrink: 0, border: 'none', background: 'transparent',
          cursor: 'pointer',
          color: 'var(--cth-ink-500)', padding: 0,
          display: 'inline-flex', alignItems: 'center'
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}


/**
 * Push-to-talk button for the queue composer. Click to start recording, click
 * again to stop → transcribe → the text is appended to this agent's draft. While
 * another agent is mid-dictation it's disabled (one shared recorder). The actual
 * capture + Groq call live in the freeflow recorder singleton.
 *
 * When no Groq key is configured the button stays visible but disabled, with a
 * tooltip pointing to Settings — it never starts a recording, so getUserMedia and
 * the Groq STT call are never reached (preserving the zero-call-when-unavailable
 * guarantee). `hasGroqKey` is boolean presence only; the key value never gets here.
 */
function FreeFlowButton({ agentId, hasGroqKey }: { agentId: string; hasGroqKey: boolean }) {
  const { t } = useTranslation();
  const ff = useFreeflow();
  const mine = ff.targetAgentId === agentId;
  const recording = ff.status === 'recording' && mine;
  const transcribing = ff.status === 'transcribing' && mine;
  // Block while another agent's clip is recording/uploading (single recorder).
  const busyElsewhere = ff.status !== 'idle' && !mine;
  const noKey = !hasGroqKey;

  const hintRef = useRef<HTMLSpanElement | null>(null);
  const iconRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [hint, setHint] = useState<{ left: number; top: number } | null>(null);
  const hintOpen = hint !== null;

  const HINT_W = 244;
  const HINT_GAP = 8;
  const EST_H = 188;

  const title = noKey
    ? t('queueComposer.ffNoKeyTitle')
    : recording ? t('queueComposer.ffStopTranscribe')
    : transcribing ? t('queueComposer.transcribing')
    : t('queueComposer.ffTitle');

  /** Same placement rule as RealtimeMichaelToggle's hint: prefer above (the
   *  composer sits low in the panel), flip below only when there is no room, and
   *  clamp both axes so it can never hang off an edge. */
  const toggleHint = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    if (hint) { setHint(null); return; }
    const r = iconRef.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.top - HINT_GAP - EST_H;
    const top = above >= 8 ? above : Math.min(r.bottom + HINT_GAP, window.innerHeight - EST_H - 8);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - HINT_W - 8));
    setHint({ left, top: Math.max(8, top) });
  };

  useEffect(() => {
    if (!hintOpen) return;
    const onDown = (ev: globalThis.MouseEvent): void => {
      const t = ev.target as Node;
      // Portalled, so an inside-click has to be tested against BOTH nodes.
      if (hintRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setHint(null);
    };
    const onKey = (ev: globalThis.KeyboardEvent): void => { if (ev.key === 'Escape') setHint(null); };
    const onReflow = (): void => setHint(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [hintOpen]);

  const openKeySettings = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    setHint(null);
    window.dispatchEvent(new CustomEvent('cth:open-settings', { detail: { section: 'Voice' } }));
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: noKey ? 4 : 0, minWidth: 0 }}>
      {/* Wrap in a (non-disabled) span so the native tooltip still shows on hover
          even when the inner button is disabled — Chromium suppresses tooltips on
          a disabled <button> itself. */}
      <span title={title} style={{ display: 'inline-flex' }}>
        <PixelButton
          variant={recording ? 'destructive' : 'secondary'}
          size="sm"
          onClick={() => { if (noKey) return; freeflowRecorder.toggle(agentId); }}
          disabled={noKey || transcribing || busyElsewhere}
        >
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <Icon name="mic" />
            {transcribing ? '…' : recording ? t('queueComposer.stop') : t('queueComposer.voice')}
          </span>
        </PixelButton>
      </span>

      {/* A missing key is a SETUP STATE, not a failure — the same treatment Talk
          already gets. Without this the button is simply dead on click, and the
          two facts that would make someone act (it is FREE, and there is a
          hold-to-talk shortcut) were written down nowhere in the UI. */}
      {noKey && (
        <span ref={hintRef} style={{ display: 'inline-flex', flexShrink: 0 }}>
          <button
            ref={iconRef}
            type="button"
            aria-label={t('queueComposer.ffHowEnable')}
            aria-expanded={hintOpen}
            onClick={toggleHint}
            style={{
              border: 'none', background: 'none', padding: 0, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center',
              color: 'var(--cth-ink-500)',
              opacity: hintOpen ? 1 : 0.75
            }}
          >
            <Icon name="info" />
          </button>

          {hint && createPortal(
            <div
              ref={panelRef}
              role="dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed', left: hint.left, top: hint.top, zIndex: 460,
                width: HINT_W, padding: '10px 12px', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column', gap: 7,
                background: 'var(--cth-paper-100)',
                boxShadow: 'inset 0 0 0 1.5px var(--cth-ink-500), 4px 4px 0 rgba(26,19,32,0.25)',
                fontFamily: 'var(--cth-font-ui)', fontSize: 11, lineHeight: '15px',
                color: 'var(--cth-ink-900)', textAlign: 'left', whiteSpace: 'normal'
              }}
            >
              <span style={{
                fontFamily: 'var(--cth-font-display)', fontSize: 9, letterSpacing: 0.5,
                textTransform: 'uppercase', color: 'var(--cth-ink-500)'
              }}>{t('queueComposer.ffSetupTitle')}</span>

              {/* Lead with the cost, because "add an API key" reads as "this will
                  bill me" and that assumption is what stops people here. */}
              <span>
                {t('queueComposer.ffSetupIntro')}
              </span>

              <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <li>
                  {t('queueComposer.ffCreateKey')}{' '}
                  <a
                    href="https://console.groq.com/keys"
                    onClick={(e) => { e.preventDefault(); void window.cth.openExternal('https://console.groq.com/keys'); }}
                    style={{ color: 'var(--cth-ink-900)' }}
                  >console.groq.com/keys</a>
                </li>
                <li>{t('queueComposer.ffPasteKey')}</li>
                <li>{t('queueComposer.ffClickOrHold')}</li>
              </ol>

              <span style={{ color: 'var(--cth-ink-500)' }}>
                {t('queueComposer.ffHoldHint')}
              </span>

              <button
                type="button"
                onClick={openKeySettings}
                style={{
                  border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                  alignSelf: 'flex-start',
                  fontFamily: 'var(--cth-font-ui)', fontSize: 11, lineHeight: '15px',
                  color: 'var(--cth-ink-900)', textDecoration: 'underline'
                }}
              >				{t('realtimeToggle.setItUpNow')}</button>
            </div>,
            document.body
          )}
        </span>
      )}
    </span>
  );
}
