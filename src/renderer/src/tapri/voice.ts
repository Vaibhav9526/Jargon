// Playback for Tapri's ElevenLabs audio. Lines arrive as base64 mp3 from main; this turns
// them into a one-shot <audio> and reports when each one has been heard. Nothing here
// holds the API key — main does the fetching.
import type { TapriSpeakResult } from '@shared/tapri';

export interface VoiceHandle { stop: () => void; done: Promise<void> }

function toUrl(base64: string, mime: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** Fetch a voiced line and get it ready; call `start()` to play. Fetching early (before it is
 *  this line's turn) hides most of the ElevenLabs round trip. `volume` is 0..1. */
export async function speakLine(speaker: string, text: string, volume: number, language: string): Promise<
  { ok: true; start: () => void; stop: () => void; done: Promise<void> } | { ok: false; error: string; code?: string }
> {
  let res: TapriSpeakResult;
  try { res = await window.cth.tapriSpeak({ speaker, text, language }); } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, error: res.error, code: res.code };
  const url = toUrl(res.audioBase64, res.mime);
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.volume = Math.max(0, Math.min(1, volume));
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const cleanup = () => { URL.revokeObjectURL(url); finish(); };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  return {
    ok: true, done,
    start: () => { audio.play().catch(cleanup); }, // autoplay refused → just show text
    stop: () => { try { audio.pause(); } catch { /* gone */ } cleanup(); },
  };
}

/** Wait for a voiced line to end, but never longer than `maxMs`. */
export async function settleVoice(handle: { stop?: () => void; done?: Promise<void> } | null, maxMs: number): Promise<void> {
  if (!handle || !handle.done) { await new Promise((r) => setTimeout(r, maxMs)); return; }
  await Promise.race([handle.done, new Promise((r) => setTimeout(r, maxMs))]);
  handle.stop?.();
}

/** Looping ElevenLabs street ambience (generated once by main, cached on disk). */
export interface Ambience { setVolume: (v: number) => void; stop: () => void }

export async function startAmbience(volume: number): Promise<Ambience | { error: string; code?: string }> {
  let res: TapriSpeakResult;
  try { res = await window.cth.tapriAmbience(); } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { error: res.error, code: res.code };
  const url = toUrl(res.audioBase64, res.mime);
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = Math.max(0, Math.min(1, volume));
  try { await audio.play(); } catch { /* needs a gesture; the user just clicked, so rare */ }
  return {
    setVolume: (v) => { audio.volume = Math.max(0, Math.min(1, v)); },
    stop: () => { try { audio.pause(); } catch { /* gone */ } URL.revokeObjectURL(url); },
  };
}
