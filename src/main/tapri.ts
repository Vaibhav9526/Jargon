/**
 * Tapri main side: runs the user's chosen CLI once per round of chatter and talks to
 * ElevenLabs for voices + street ambience.
 *
 * Safety shape (same as llm.ts): the prompt travels on STDIN, never in argv; the CLI
 * runs in the temp dir with tools denied where the CLI lets us; the ElevenLabs key
 * lives in the encrypted secret broker and is read here, main-only — it never crosses
 * IPC (the renderer can only ask "do I have one" or hand over a new one).
 */
import { ipcMain, app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TAPRI_CAST, TAPRI_CLIS, DEFAULT_LANGUAGE, buildSummaryPrompt, buildTalkPrompt, isTapriCliId, isTapriLanguage, parseSummaryResponse, parseTalkResponse, parseTurnLine, characterById, ME_ID, ME_VOICE,
  type TapriCliStatus, type TapriSpeakResult, type TapriSummaryResult, type TapriTalkRequest, type TapriTalkResult, type TapriTurn,
} from '../shared/tapri';
import { deleteSecret, getSecret, hasSecret, setSecret } from './integrations';
import { resolveCommand, userShellPath } from './shellEnv';

const KEY_REF = 'apikey:elevenlabs';
const TTS_MODEL = 'eleven_flash_v2_5';
const TALK_TIMEOUT_MS = 90_000;
const HTTP_TIMEOUT_MS = 30_000;
const MAX_TTS_CHARS = 300;

/* ── CLI one-shot ─────────────────────────────────────────────────────────── */

function winWrap(exe: string): boolean {
  return process.platform === 'win32' && !/\.(exe|com)$/i.test(exe);
}

function runCli(cliId: string, prompt: string, onText?: (textSoFar: string) => void): Promise<{ ok: true; text: string } | { ok: false; error: string; missing?: boolean }> {
  const cli = TAPRI_CLIS.find((c) => c.id === cliId);
  if (!cli) return Promise.resolve({ ok: false, error: 'Unknown CLI.' });
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (r: { ok: true; text: string } | { ok: false; error: string; missing?: boolean }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const exe = resolveCommand(cli.command);
    // .cmd/.bat shims (npm globals) cannot be CreateProcess'd directly on Windows;
    // route them through cmd.exe /c with argv (no shell string, so nothing to inject).
    const wrap = winWrap(exe);
    const file = wrap ? (process.env.ComSpec || 'cmd.exe') : exe;
    const args = wrap ? ['/c', exe, ...cli.args] : [...cli.args];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        cwd: tmpdir(), windowsHide: true,
        env: { ...process.env, PATH: userShellPath(), CI: '1', NO_COLOR: '1' } as NodeJS.ProcessEnv,
      });
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : String(e), missing: true });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      finish({ ok: false, error: `${cli.label} took too long — try again.` });
    }, TALK_TIMEOUT_MS);
    // Claude streams events (one JSON object per line); everything else is plain text.
    let events = '';
    let finalResult = '';
    child.stdout?.on('data', (d) => {
      if (cli.stream !== 'claude') {
        out += d; if (out.length > 200_000) out = out.slice(0, 200_000);
        onText?.(out);
        return;
      }
      events += d;
      let nl: number;
      while ((nl = events.indexOf('\n')) >= 0) {
        const line = events.slice(0, nl).trim();
        events = events.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        try {
          const ev = JSON.parse(line) as { type?: string; result?: unknown; event?: { type?: string; delta?: { type?: string; text?: string } } };
          if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta' && ev.event.delta.text) {
            out += ev.event.delta.text;
            if (out.length > 200_000) out = out.slice(0, 200_000);
            onText?.(out);
          } else if (ev.type === 'result' && typeof ev.result === 'string') finalResult = ev.result;
        } catch { /* partial or non-event line */ }
      }
    });
    child.stderr?.on('data', (d) => { err += d; if (err.length > 20_000) err = err.slice(-20_000); });
    child.on('error', () => finish({
      ok: false, missing: true,
      error: `${cli.label} was not found. Install it (${cli.install}) and sign in, then try again.`,
    }));
    child.on('close', (code) => {
      const text = (finalResult || out).trim();
      if (code === 0 && text) finish({ ok: true, text });
      else finish({ ok: false, error: (err.trim() || `${cli.label} returned nothing.`).slice(-300) });
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(prompt);
  });
}

export async function talk(raw: unknown, emit?: (turn: TapriTurn) => void): Promise<TapriTalkResult> {
  const r = (raw ?? {}) as Partial<TapriTalkRequest>;
  if (!isTapriCliId(r.cli)) return { ok: false, error: 'Pick a CLI first.' };
  const present = Array.isArray(r.present)
    ? r.present.filter((id): id is string => typeof id === 'string' && !!characterById(id) && id !== ME_ID).slice(0, 8)
    : [];
  if (!present.length) return { ok: false, error: 'Nobody is at the tapri yet.' };
  const history = Array.isArray(r.history)
    ? r.history
      .filter((l) => l && typeof l.speaker === 'string' && typeof l.text === 'string')
      .map((l) => ({ speaker: l.speaker, text: l.text.slice(0, 400) }))
      .slice(-16)
    : [];
  const summary = Array.isArray(r.summary) ? r.summary.filter((s) => typeof s === 'string').slice(0, 6) : [];
  const prompt = buildTalkPrompt({
    cli: r.cli, present, history, summary, language: isTapriLanguage(r.language) ? r.language : DEFAULT_LANGUAGE,
    userSaid: typeof r.userSaid === 'string' ? r.userSaid : undefined,
    topic: r.topic,
  });
  // Speak-as-you-write: every completed line of output becomes a turn the moment it ends.
  let sent = 0;
  const flush = (text: string, final: boolean): void => {
    if (!emit) return;
    const lines = text.split('\n');
    const complete = final ? lines : lines.slice(0, -1);
    let seen = 0;
    for (const line of complete) {
      const t = parseTurnLine(line, present)?.turn;
      if (!t) continue;
      if (seen++ >= sent) { sent++; emit(t); }
    }
  };
  const res = await runCli(r.cli, prompt, (soFar) => flush(soFar, false));
  if (!res.ok) return res;
  flush(res.text, true);
  const round = parseTalkResponse(res.text, present);
  if (!round) return { ok: false, error: 'The CLI answered, but not in a shape the tapri could use. Try again.' };
  return { ok: true, round };
}

export async function summarize(raw: unknown): Promise<TapriSummaryResult> {
  const r = (raw ?? {}) as { cli?: unknown; language?: unknown; history?: unknown; summary?: unknown };
  if (!isTapriCliId(r.cli)) return { ok: false, error: 'Pick a CLI first.' };
  const history = Array.isArray(r.history)
    ? r.history.filter((l): l is { speaker: string; text: string } => !!l && typeof (l as { speaker?: unknown }).speaker === 'string' && typeof (l as { text?: unknown }).text === 'string')
      .map((l) => ({ speaker: l.speaker, text: l.text.slice(0, 400) })).slice(-30)
    : [];
  if (!history.length) return { ok: false, error: 'Nothing to summarise yet.' };
  const prev = Array.isArray(r.summary) ? r.summary.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  const res = await runCli(r.cli, buildSummaryPrompt(history, prev, isTapriLanguage(r.language) ? r.language : DEFAULT_LANGUAGE));
  if (!res.ok) return res;
  const summary = parseSummaryResponse(res.text);
  return summary ? { ok: true, summary } : { ok: false, error: 'Could not make a summary. Try again.' };
}

export async function cliStatus(): Promise<TapriCliStatus[]> {
  return TAPRI_CLIS.map((c) => {
    let installed = false;
    try {
      const exe = resolveCommand(c.command);
      // resolveCommand returns the bare name when nothing was found on PATH.
      installed = exe !== c.command || existsSync(exe);
    } catch { installed = false; }
    return { id: c.id, label: c.label, installed, install: c.install };
  });
}

/* ── ElevenLabs ───────────────────────────────────────────────────────────── */

async function http(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(timer); }
}

interface VoiceInfo { id: string; female: boolean | null; hindi: boolean }
let voiceCache: VoiceInfo[] | null = null;

/** The account's voices, flagged by gender and whether they are Hindi voices (library voices
 *  added from ElevenLabs' Hindi collection are picked up automatically; nothing is added for you). */
async function accountVoices(key: string): Promise<VoiceInfo[]> {
  if (voiceCache) return voiceCache;
  try {
    const r = await http('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    if (!r.ok) return [];
    const j = (await r.json()) as { voices?: {
      voice_id?: string; name?: string; description?: string;
      labels?: Record<string, string>; verified_languages?: { language?: string; locale?: string }[];
    }[] };
    voiceCache = (j.voices ?? []).filter((v) => !!v.voice_id).map((v) => {
      const labels = v.labels ?? {};
      const verified = (v.verified_languages ?? []).some((l) => /^(hi|hin)/i.test(l.language ?? l.locale ?? ''));
      const text = `${v.name ?? ''} ${v.description ?? ''} ${labels.accent ?? ''} ${labels.language ?? ''}`;
      return {
        id: v.voice_id as string,
        female: labels.gender ? labels.gender.toLowerCase() === 'female' : null,
        hindi: verified || /^(hi|hin)/i.test(labels.language ?? '') || /hindi|indian/i.test(text),
      };
    });
    return voiceCache;
  } catch { return []; }
}

/** A Hindi voice from the account when there is one (matched by gender, one per character),
 *  otherwise the stock voice, which the multilingual model still speaks Hindi with. */
function voiceFor(speaker: string, voices: VoiceInfo[]): string {
  if (speaker === ME_ID) return ME_VOICE;
  const c = characterById(speaker);
  const fallback = c?.voice ?? TAPRI_CAST[0].voice;
  const hindi = voices.filter((v) => v.hindi);
  if (!hindi.length) return fallback;
  const sameGender = hindi.filter((v) => v.female === (c?.female === true));
  const pool = sameGender.length ? sameGender : hindi;
  const idx = Math.max(0, TAPRI_CAST.findIndex((x) => x.id === speaker));
  return pool[idx % pool.length].id;
}

async function tts(key: string, voice: string, text: string, language: string): Promise<Response> {
  return http(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: TTS_MODEL, language_code: language }),
  });
}

export async function speak(raw: unknown): Promise<TapriSpeakResult> {
  const p = (raw ?? {}) as { speaker?: unknown; text?: unknown; language?: unknown };
  const lang = p.language === 'en' ? 'en' : 'hi';
  const key = getSecret(KEY_REF);
  if (!key) return { ok: false, error: 'Add your ElevenLabs key to hear the voices.', code: 'no_key' };
  if (typeof p.speaker !== 'string' || typeof p.text !== 'string' || !p.text.trim()) {
    return { ok: false, error: 'Nothing to say.' };
  }
  const text = p.text.trim().slice(0, MAX_TTS_CHARS);
  try {
    const voices = await accountVoices(key);
    let voice = voiceFor(p.speaker, voices);
    let r = await tts(key, voice, text, lang);
    if (r.status === 404 || r.status === 400) {
      // Stock voice id missing from this account: borrow a stable one from its library.
      const mine = voices;
      if (mine.length) {
        const idx = Math.abs([...p.speaker].reduce((a, c) => a + c.charCodeAt(0), 0)) % mine.length;
        voice = mine[idx].id;
        r = await tts(key, voice, text, lang);
      }
    }
    if (!r.ok) {
      const code = r.status === 401 ? 'no_key' : r.status === 402 || r.status === 429 ? 'quota' : 'voice';
      const msg = r.status === 401 ? 'ElevenLabs rejected the key.'
        : code === 'quota' ? 'ElevenLabs quota reached — voices paused.'
          : `ElevenLabs error ${r.status}.`;
      return { ok: false, error: msg, code };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, audioBase64: buf.toString('base64'), mime: 'audio/mpeg' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'network' };
  }
}

/** Street ambience via ElevenLabs sound generation. Generated once, cached on disk. */
export async function ambience(): Promise<TapriSpeakResult> {
  const key = getSecret(KEY_REF);
  if (!key) return { ok: false, error: 'Add your ElevenLabs key for street sound.', code: 'no_key' };
  const dir = join(app.getPath('userData'), 'tapri');
  const file = join(dir, 'ambience.mp3');
  try {
    if (existsSync(file)) return { ok: true, audioBase64: readFileSync(file).toString('base64'), mime: 'audio/mpeg' };
    const r = await http('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_64', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Busy Indian roadside chai stall ambience: distant auto-rickshaw horns, passing motorbikes, '
          + 'tea glasses clinking, low chatter, birds in a banyan tree. Seamless loop.',
        duration_seconds: 20, prompt_influence: 0.4,
      }),
    });
    if (!r.ok) return { ok: false, error: `Ambience unavailable (${r.status}).`, code: r.status === 401 ? 'no_key' : 'voice' };
    const buf = Buffer.from(await r.arrayBuffer());
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, buf);
    return { ok: true, audioBase64: buf.toString('base64'), mime: 'audio/mpeg' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'network' };
  }
}

/** Push-to-talk: transcribe a short mic clip with ElevenLabs Scribe. */
export async function transcribe(raw: unknown): Promise<{ ok: true; text: string } | { ok: false; error: string; code?: 'no_key' | 'quota' | 'network' | 'empty' }> {
  const p = (raw ?? {}) as { audioBase64?: unknown; mime?: unknown; language?: unknown };
  const key = getSecret(KEY_REF);
  if (!key) return { ok: false, error: 'Add your ElevenLabs key (🔑) to talk by voice.', code: 'no_key' };
  if (typeof p.audioBase64 !== 'string' || !p.audioBase64 || p.audioBase64.length > 9_000_000) {
    return { ok: false, error: 'That recording is empty or too long.', code: 'empty' };
  }
  const mime = typeof p.mime === 'string' && /^audio\/[a-z0-9.+-]+/i.test(p.mime) ? p.mime.split(';')[0] : 'audio/webm';
  try {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('tag_audio_events', 'false');
    form.append('language_code', p.language === 'en' ? 'eng' : 'hin');
    form.append('file', new Blob([Buffer.from(p.audioBase64, 'base64')], { type: mime }), `speech.${mime.split('/')[1] || 'webm'}`);
    const r = await http('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
    if (!r.ok) {
      const code = r.status === 401 ? 'no_key' : r.status === 402 || r.status === 429 ? 'quota' : undefined;
      return { ok: false, error: r.status === 401 ? 'ElevenLabs rejected the key.' : `Could not transcribe (${r.status}).`, code };
    }
    const j = (await r.json()) as { text?: unknown };
    const text = typeof j.text === 'string' ? j.text.trim() : '';
    return text ? { ok: true, text: text.slice(0, 500) } : { ok: false, error: 'Did not catch that — try again.', code: 'empty' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'network' };
  }
}

/** The mic is only granted while the Tapri level is on screen (see micFeatureLive in index.ts). */
let micLive = false;
export const tapriMicLive = (): boolean => micLive;

export function registerTapriIpc(): void {
  ipcMain.handle('tapri:transcribe', (_e, req: unknown) => transcribe(req));
  ipcMain.handle('tapri:mic', (_e, live: unknown) => { micLive = live === true; return micLive; });
  ipcMain.handle('tapri:talk', (e, req: unknown) => {
    const id = (req as { id?: unknown } | null)?.id;
    return talk(req, typeof id === 'string' ? (turn) => { if (!e.sender.isDestroyed()) e.sender.send('tapri:turn', { id, turn }); } : undefined);
  });
  ipcMain.handle('tapri:summarize', (_e, req: unknown) => summarize(req));
  ipcMain.handle('tapri:clis', () => cliStatus());
  ipcMain.handle('tapri:speak', (_e, req: unknown) => speak(req));
  ipcMain.handle('tapri:ambience', () => ambience());
  ipcMain.handle('tapri:keyHas', () => hasSecret(KEY_REF));
  ipcMain.handle('tapri:keySet', (_e, key: unknown) =>
    typeof key === 'string' && key.trim().length >= 8 && key.length < 200
      ? setSecret(KEY_REF, key.trim())
      : { ok: false, error: 'That does not look like an ElevenLabs key.' });
  ipcMain.handle('tapri:keyClear', () => { try { deleteSecret(KEY_REF); voiceCache = null; return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; } });
}
