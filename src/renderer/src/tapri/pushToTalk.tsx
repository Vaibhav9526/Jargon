// Hold Alt+S to talk to the tapri. Records the mic while the keys are down, then asks
// main (ElevenLabs Scribe) for the words. The listening indicator copies the dictation
// pill the owner pointed at: a dark capsule of white bars that bounce with your voice.
//
// Capture reliability (why it is built this way):
//  - Opening the mic takes a few hundred ms, and that is exactly when people start talking, so
//    the first words were lost. The stream is opened once (on the first Alt press, before S) and
//    kept warm for the visit; each press only starts a recorder on a stream that is already live.
//  - People release the keys a beat early, so recording runs on for TAIL_MS after release.
//  - A clip with no signal is reported as "could not hear" instead of being sent for transcription.
import { useCallback, useEffect, useRef, useState } from 'react';

export type PttState = 'idle' | 'listening' | 'thinking';

const MIN_MS = 450;
const MAX_MS = 45_000;
const TAIL_MS = 350;
const WARM_IDLE_MS = 120_000;
const SILENCE_PEAK = 0.05;

interface Opts {
  enabled: boolean;
  /** Spoken language for transcription ('en' | 'hi'). */
  language: () => string;
  /** Mirrors "the user is speaking" into the scene (mouth moves, bubble). */
  onTalking: (on: boolean) => void;
  onTranscript: (text: string) => void;
  onError: (message: string, code?: string) => void;
}

interface Warm { stream: MediaStream; ctx: AudioContext; an: AnalyserNode; src: MediaStreamAudioSourceNode }

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function pickMime(): string | undefined {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

const chunks = new WeakMap<MediaRecorder, Blob[]>();

export function usePushToTalk(opts: Opts): { state: PttState; levels: React.MutableRefObject<number[]> } {
  const [state, setState] = useState<PttState>('idle');
  const levels = useRef<number[]>(new Array(9).fill(0));
  const o = useRef(opts);
  o.current = opts;
  const warm = useRef<Warm | null>(null);
  const warming = useRef<Promise<Warm | null> | null>(null);
  const idleTimer = useRef<number>(0);
  const live = useRef<{ rec: MediaRecorder; started: number; raf: number; cap: number; peak: number; ending: boolean } | null>(null);
  const busy = useRef(false);

  const closeWarm = useCallback(() => {
    clearTimeout(idleTimer.current);
    const w = warm.current;
    warm.current = null;
    warming.current = null;
    if (!w) return;
    try { w.src.disconnect(); } catch { /* gone */ }
    w.stream.getTracks().forEach((t) => t.stop());
    void w.ctx.close().catch(() => undefined);
  }, []);

  const armIdle = useCallback(() => {
    clearTimeout(idleTimer.current);
    // The mic indicator should not stay lit forever after the last use.
    idleTimer.current = window.setTimeout(() => { if (!live.current) closeWarm(); }, WARM_IDLE_MS);
  }, [closeWarm]);

  const getWarm = useCallback(async (): Promise<Warm | null> => {
    const w = warm.current;
    if (w && w.stream.getAudioTracks().some((t) => t.readyState === 'live')) return w;
    if (warming.current) return warming.current;
    warming.current = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        const src = ctx.createMediaStreamSource(stream);
        src.connect(an);
        const next = { stream, ctx, an, src };
        warm.current = next;
        return next;
      } catch (e) {
        o.current.onError(e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone is blocked. Allow it in Windows settings, then hold Alt+S again.'
          : 'Could not open the microphone.');
        return null;
      } finally { warming.current = null; }
    })();
    return warming.current;
  }, []);

  const stopNow = useCallback(() => {
    const cur = live.current;
    if (!cur) return;
    live.current = null;
    cancelAnimationFrame(cur.raf);
    clearTimeout(cur.cap);
    o.current.onTalking(false);
    levels.current = levels.current.map(() => 0);
    const heard = Date.now() - cur.started;
    const rec = cur.rec;
    rec.onstop = async () => {
      armIdle();
      const parts = chunks.get(rec) ?? [];
      if (heard < MIN_MS || !parts.length) { setState('idle'); busy.current = false; return; }
      if (cur.peak < SILENCE_PEAK) {
        o.current.onError('I could not hear anything. Check that the right microphone is selected, then hold Alt+S and speak.');
        setState('idle'); busy.current = false; return;
      }
      setState('thinking');
      try {
        const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
        const r = await window.cth.tapriTranscribe({ audioBase64: toBase64(await blob.arrayBuffer()), mime: blob.type, language: o.current.language() });
        if (r.ok) o.current.onTranscript(r.text); else o.current.onError(r.error, r.code);
      } catch (e) {
        o.current.onError(e instanceof Error ? e.message : String(e));
      } finally { setState('idle'); busy.current = false; }
    };
    try { rec.stop(); } catch { setState('idle'); busy.current = false; }
  }, [armIdle]);

  /** Keys released (or window lost focus): keep recording for a short tail, then stop. */
  const finish = useCallback((immediate = false) => {
    const cur = live.current;
    if (!cur || cur.ending) return;
    cur.ending = true;
    if (immediate) stopNow(); else window.setTimeout(stopNow, TAIL_MS);
  }, [stopNow]);

  const start = useCallback(async () => {
    if (busy.current || live.current || !o.current.enabled) return;
    busy.current = true;
    const w = await getWarm();
    if (!w) { busy.current = false; return; }
    clearTimeout(idleTimer.current);
    if (w.ctx.state === 'suspended') void w.ctx.resume().catch(() => undefined);
    const mime = pickMime();
    const rec = new MediaRecorder(w.stream, mime ? { mimeType: mime, audioBitsPerSecond: 96_000 } : undefined);
    chunks.set(rec, []);
    rec.ondataavailable = (e) => { if (e.data.size) chunks.get(rec)!.push(e.data); };
    const data = new Uint8Array(w.an.frequencyBinCount);
    const cur = { rec, started: Date.now(), raf: 0, cap: window.setTimeout(() => finish(true), MAX_MS), peak: 0, ending: false };
    live.current = cur;
    const tickLevels = () => {
      w.an.getByteFrequencyData(data);
      // Nine bands over the voice range, smoothed so the bars bounce rather than flicker.
      let loudest = 0;
      for (let i = 0; i < 9; i++) {
        const from = 2 + i * 5;
        let sum = 0;
        for (let j = from; j < from + 5; j++) sum += data[j] ?? 0;
        const v = Math.min(1, sum / 5 / 150);
        loudest = Math.max(loudest, v);
        levels.current[i] = levels.current[i] * 0.55 + v * 0.45;
      }
      cur.peak = Math.max(cur.peak, loudest);
      if (live.current === cur) cur.raf = requestAnimationFrame(tickLevels);
    };
    rec.start();
    setState('listening');
    o.current.onTalking(true);
    cur.raf = requestAnimationFrame(tickLevels);
  }, [getWarm, finish]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Alt alone: open the mic now, so it is live by the time S lands.
      if (e.key === 'Alt' && !e.repeat && o.current.enabled) void getWarm();
      if (e.altKey && e.code === 'KeyS' && !e.repeat) { e.preventDefault(); void start(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyS' || e.code === 'AltLeft' || e.code === 'AltRight') {
        if (live.current) { e.preventDefault(); finish(); }
      }
    };
    const blur = () => finish(true);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      finish(true);
      closeWarm();
    };
  }, [start, finish, getWarm, closeWarm]);

  return { state, levels };
}

/** The dictation capsule: dark pill, nine cream bars driven by `levels`. */
export function ListeningPill({ state, levels }: { state: PttState; levels: React.MutableRefObject<number[]> }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const draw = (t: number) => {
      bars.current.forEach((el, i) => {
        if (!el) return;
        const idle = 0.12 + 0.1 * Math.sin(t / 220 + i * 0.9);
        const v = state === 'listening' ? Math.max(idle, levels.current[i] ?? 0) : state === 'thinking' ? 0.18 + 0.16 * Math.sin(t / 150 - i * 0.7) : 0.1;
        el.style.height = `${Math.round(8 + v * 30)}px`;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [state, levels]);
  return (
    <div role="status" aria-label={state === 'listening' ? 'Listening' : 'Transcribing'} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      width: 138, height: 64, borderRadius: 32, background: '#1b1a19',
      border: '3px solid #f1ece4', boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} ref={(el) => { bars.current[i] = el; }} style={{
          width: 5, height: 10, borderRadius: 3, background: '#fbf7da', transition: 'height 60ms linear',
        }} />
      ))}
    </div>
  );
}
