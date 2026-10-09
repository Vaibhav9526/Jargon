import { useSyncExternalStore } from 'react';
import type { TeachingRequest } from '@shared/teaching';

/**
 * The running classroom lesson. It outlives any one chat: switching to another
 * agent only HIDES the embedded page (the main process keeps it alive), and the
 * "Classroom" entry in a chat's dropdown brings it back exactly where it was.
 *
 * `owner` is the one chat view currently allowed to show the page — the native
 * view floats above the UI, so two views must never show it at once.
 */
export interface LessonSession {
  request: TeachingRequest;
  teacherId: string;
  /** True once the main process has actually opened the page. */
  opened: boolean;
  /** Id of the chat view that is showing the lesson, or null when hidden. */
  owner: string | null;
}

let session: LessonSession | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

export function getLesson(): LessonSession | null { return session; }

export function startLesson(request: TeachingRequest, teacherId: string, owner: string): void {
  // A new lesson replaces the old one (the main process swaps the page).
  session = { request, teacherId, opened: false, owner };
  emit();
}

export function markLessonOpened(): void {
  if (session && !session.opened) { session = { ...session, opened: true }; emit(); }
}

export function showLessonIn(owner: string): void {
  if (session && session.owner !== owner) { session = { ...session, owner }; emit(); }
}

export function releaseLesson(owner: string): void {
  if (session && session.owner === owner) { session = { ...session, owner: null }; emit(); }
}

/** End the lesson for good: closes the page in the main process too. */
export function endLesson(): void {
  if (!session) return;
  session = null;
  emit();
  void window.cth.teachingPanelClose().catch(() => undefined);
}

export function useLesson(): LessonSession | null {
  return useSyncExternalStore(
    (onChange) => { subs.add(onChange); return () => subs.delete(onChange); },
    () => session,
  );
}
