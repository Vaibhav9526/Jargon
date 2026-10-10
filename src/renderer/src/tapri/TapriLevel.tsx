import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import bgUrl from '@/assets/tapri/tapri-bg.png?url';
import {
  DEFAULT_LANGUAGE, ME_ID, TAPRI_CLIS, TOPIC_LABELS, characterById,
  type TapriCliId, type TapriCliStatus, type TopicKind,
} from '@shared/tapri';
import { createEngine, type Engine, type EngineState } from './engine';
import { renderTapri } from './render';
import { H, W, createWorld, personById, tick, type World } from './sim';
import { GlyphBack, GlyphClose, GlyphCup, GlyphKey, GlyphRefresh, GlyphRoad, GlyphSpeaker } from './glyphs';
import { ListeningPill, usePushToTalk } from './pushToTalk';
import { settleVoice, speakLine, startAmbience, type Ambience } from './voice';

/** Whether the Tapri level replaces the office floor. Session-only on purpose: the
 *  app always boots onto the floor the user left their team on. */
export const useTapriLevel = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const LS = 'jargon.tapri.v1';

interface Prefs { cli: TapriCliId; voice: boolean; sound: boolean; volume: number }
const DEFAULT_PREFS: Prefs = { cli: 'claude', voice: false, sound: false, volume: 0.8 };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return {
        cli: TAPRI_CLIS.some((c) => c.id === p.cli) ? (p.cli as TapriCliId) : DEFAULT_PREFS.cli,
        voice: p.voice === true, sound: p.sound === true,
        volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : DEFAULT_PREFS.volume,
      };
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_PREFS;
}
function savePrefs(p: Prefs): void {
  try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

const TOPIC_KINDS = Object.keys(TOPIC_LABELS).filter((k) => k !== 'random') as TopicKind[];

/* ── component ────────────────────────────────────────────────────────────── */

const card: React.CSSProperties = {
  background: 'rgba(30, 18, 8, 0.82)', color: '#ffeccc', border: '1px solid rgba(255, 214, 150, 0.35)',
  borderRadius: 6, backdropFilter: 'blur(3px)', fontFamily: 'var(--cth-font-ui)', fontSize: 13,
};
const chipBtn: React.CSSProperties = {
  padding: '5px 10px', fontFamily: 'var(--cth-font-ui)', fontSize: 12, cursor: 'pointer',
  background: 'rgba(255, 236, 204, 0.12)', color: '#ffeccc', border: '1px solid rgba(255, 214, 150, 0.4)', borderRadius: 4,
};

export function TapriLevel() {
  const setOpen = useTapriLevel((s) => s.setOpen);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World>(createWorld(Date.now() >>> 0));
  const engineRef = useRef<Engine | null>(null);
  const ambienceRef = useRef<Ambience | null>(null);
  const prefsRef = useRef<Prefs>(loadPrefs());
  const [prefs, setPrefsState] = useState<Prefs>(prefsRef.current);
  const [snap, setSnap] = useState<EngineState | null>(null);
  const [clis, setClis] = useState<TapriCliStatus[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyNote, setKeyNote] = useState('');
  const [say, setSay] = useState('');
  const [typing, setTyping] = useState(false);
  const [pttNote, setPttNote] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [sumOpen, setSumOpen] = useState(false);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    prefsRef.current = { ...prefsRef.current, ...patch };
    savePrefs(prefsRef.current);
    setPrefsState(prefsRef.current);
  }, []);

  // Engine: one per visit to the tapri.
  useEffect(() => {
    const engine = createEngine({
      world: () => worldRef.current,
      talk: async (req, onTurn) => {
        // Lines arrive over IPC as the CLI finishes writing them; the reply resolves at the end.
        const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const off = window.cth.onTapriTurn((m) => { if (m.id === id) onTurn(m.turn); });
        try { return await window.cth.tapriTalk({ ...req, id }); } finally { off(); }
      },
      speak: (speaker, text, language) => speakLine(speaker, text, prefsRef.current.volume, language),
      summarize: (req) => window.cth.tapriSummarize(req),
      settle: (handle, maxMs) => settleVoice(handle as { stop?: () => void; done?: Promise<void> } | null, maxMs),
    }, { cli: prefsRef.current.cli, language: DEFAULT_LANGUAGE, voice: prefsRef.current.voice, auto: true });
    engineRef.current = engine;
    const off = engine.subscribe(() => setSnap({ ...engine.state(), lines: [...engine.state().lines], summary: [...engine.state().summary], present: [...engine.state().present] }));
    engine.start();
    const timer = setInterval(() => engine.step(), 450);
    return () => { clearInterval(timer); off(); engine.stop(); engineRef.current = null; };
  }, []);

  useEffect(() => {
    void window.cth.tapriClis().then(setClis).catch(() => undefined);
    void window.cth.tapriKeyHas().then(setHasKey).catch(() => undefined);
  }, []);

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current; const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = document.createElement('canvas');
    buf.width = W; buf.height = H;
    let bg: HTMLImageElement | null = null;
    const img = new Image();
    img.onload = () => { bg = img; };
    img.src = bgUrl;
    let cw = 0; let ch = 0; const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const r = stage.getBoundingClientRect();
      cw = Math.max(1, r.width); ch = Math.max(1, r.height);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    let raf = 0; let last = performance.now();
    const frame = (now: number) => {
      const dt = now - last; last = now;
      tick(worldRef.current, dt);
      renderTapri(ctx, buf, bg, worldRef.current, cw, ch, dpr);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // Street sound (ElevenLabs sound generation), only while the toggle is on.
  useEffect(() => {
    let cancelled = false;
    if (!prefs.sound) { ambienceRef.current?.stop(); ambienceRef.current = null; return; }
    void startAmbience(prefsRef.current.volume * 0.5).then((a) => {
      if (cancelled) { if (!('error' in a)) a.stop(); return; }
      if ('error' in a) { setPrefs({ sound: false }); engineRef.current?.state(); setKeyNote(a.error); return; }
      ambienceRef.current = a;
    });
    return () => { cancelled = true; ambienceRef.current?.stop(); ambienceRef.current = null; };
  }, [prefs.sound, setPrefs]);
  useEffect(() => { ambienceRef.current?.setVolume(prefs.volume * 0.5); }, [prefs.volume]);

  // The mic is only grantable while this level is on screen (main gates the permission).
  useEffect(() => {
    void window.cth.tapriMic(true).catch(() => undefined);
    return () => { void window.cth.tapriMic(false).catch(() => undefined); };
  }, []);

  const ptt = usePushToTalk({
    enabled: true,
    language: () => DEFAULT_LANGUAGE,
    onTalking: (on) => { const me = personById(worldRef.current, ME_ID); if (me) me.talking = on; },
    onTranscript: (text) => { setPttNote(''); void engineRef.current?.userSays(text); },
    onError: (m, code) => { setPttNote(m); if (code === 'no_key') setKeyOpen(true); },
  });

  // Enter opens a one-line typed fallback; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Enter' && !inField) { e.preventDefault(); setTyping(true); }
      else if (e.key === 'Escape' && typing) setTyping(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typing]);

  const saveKey = async () => {
    const r = await window.cth.tapriKeySet(keyDraft);
    if (r.ok) { setHasKey(true); setKeyDraft(''); setKeyOpen(false); setKeyNote(''); setPrefs({ voice: true }); engineRef.current?.setVoice(true); }
    else setKeyNote(r.error ?? 'Could not save the key.');
  };
  const clearKey = async () => {
    await window.cth.tapriKeyClear();
    setHasKey(false); setPrefs({ voice: false, sound: false }); engineRef.current?.setVoice(false);
  };
  const toggleVoice = () => {
    if (!hasKey) { setKeyOpen(true); return; }
    const on = !prefs.voice; setPrefs({ voice: on }); engineRef.current?.setVoice(on);
  };
  const toggleSound = () => {
    if (!hasKey) { setKeyOpen(true); return; }
    setPrefs({ sound: !prefs.sound });
  };
  const submit = () => {
    const t = say.trim();
    if (!t) return;
    setSay(''); setTyping(false);
    void engineRef.current?.userSays(t);
  };

  const cliInfo = useMemo(() => new Map(clis.map((c) => [c.id, c])), [clis]);
  const current = cliInfo.get(prefs.cli);
  const speakerName = (id: string) => (id === ME_ID ? 'You' : characterById(id)?.name ?? id);
  const sty = snap;

  return (
    <div ref={stageRef} style={{ position: 'absolute', inset: 0, background: '#1a1209', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {/* Top-left: engine + voice controls */}
      <div style={{ ...card, position: 'absolute', top: 54, left: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 330 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 14, letterSpacing: 0.5 }}>CHAI TAPRI</strong>
          <button style={{ ...chipBtn, marginLeft: 'auto' }} onClick={() => setOpen(false)} title="Back to the floor"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><GlyphBack /> floor</span></button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ opacity: 0.8 }}>CLI</span>
          <select
            value={prefs.cli}
            onChange={(e) => { const id = e.target.value as TapriCliId; setPrefs({ cli: id }); engineRef.current?.setCli(id); }}
            style={{ flex: 1, height: 26, background: '#2b1a0c', color: '#ffeccc', border: '1px solid rgba(255,214,150,0.4)', borderRadius: 3 }}
          >
            {TAPRI_CLIS.map((c) => {
              const info = cliInfo.get(c.id);
              return <option key={c.id} value={c.id}>{c.label}{info && !info.installed ? ' (not found)' : ''}</option>;
            })}
          </select>
        </label>
        {current && !current.installed && (
          <div style={{ fontSize: 11, color: '#ffb48a' }}>Not installed — <code>{current.install}</code></div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={{ ...chipBtn, background: prefs.voice ? 'rgba(120,200,120,0.3)' : chipBtn.background }} onClick={toggleVoice}
            title="ElevenLabs voices for each character"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><GlyphSpeaker off={!prefs.voice} /> Voices {prefs.voice ? 'on' : 'off'}</span></button>
          <button style={{ ...chipBtn, background: prefs.sound ? 'rgba(120,200,120,0.3)' : chipBtn.background }} onClick={toggleSound}
            title="ElevenLabs street ambience"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><GlyphRoad /> Street {prefs.sound ? 'on' : 'off'}</span></button>
          <button style={chipBtn} onClick={() => setKeyOpen((v) => !v)} title="ElevenLabs API key" aria-label="ElevenLabs API key"><GlyphKey /></button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value="" disabled={!!sty?.busy} aria-label="Start a topic"
            onChange={(e) => { const k = e.target.value as TopicKind; if (k) void engineRef.current?.startTopic(k); }}
            style={{ flex: 1, height: 26, background: '#2b1a0c', color: '#ffeccc', border: '1px solid rgba(255,214,150,0.4)', borderRadius: 3 }}
          >
            <option value="">Start a topic…</option>
            {TOPIC_KINDS.map((k) => <option key={k} value={k}>{TOPIC_LABELS[k]}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: 12 }} title="Let the regulars keep talking between your turns">
            <input type="checkbox" checked={sty?.auto ?? true} onChange={(e) => engineRef.current?.setAuto(e.target.checked)} />
            keep talking
          </label>
        </div>
        {(prefs.voice || prefs.sound) && (
          <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => setPrefs({ volume: Number(e.target.value) })} aria-label="Volume" />
        )}
        {keyOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>
              {hasKey ? 'ElevenLabs key saved (stored encrypted; never shown again).' : 'Paste your ElevenLabs API key. It is stored encrypted on this PC.'}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="password" value={keyDraft} placeholder="sk_…" autoComplete="off"
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(); }}
                style={{ flex: 1, height: 26, padding: '0 6px', background: '#2b1a0c', color: '#ffeccc', border: '1px solid rgba(255,214,150,0.4)', borderRadius: 3 }}
              />
              <button style={chipBtn} onClick={() => void saveKey()} disabled={keyDraft.trim().length < 8}>Save</button>
              {hasKey && <button style={chipBtn} onClick={() => void clearKey()}>Remove</button>}
            </div>
          </div>
        )}
        {keyNote && <div style={{ fontSize: 11, color: '#ffb48a' }}>{keyNote}</div>}
      </div>

      {/* Top-right: the Summarize button; its panel opens underneath */}
      <div style={{ position: 'absolute', top: 54, right: 12, width: 330, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, maxHeight: 'calc(100% - 140px)' }}>
        <button
          style={{ ...chipBtn, padding: '8px 14px', fontSize: 13, background: sumOpen ? 'rgba(255,214,150,0.28)' : 'rgba(30,18,8,0.82)' }}
          onClick={() => { const next = !sumOpen; setSumOpen(next); if (next) void engineRef.current?.summarize(); }}
          title="Summarise the talk so far"
        ><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><GlyphCup /> Summarize{sty?.summarizing ? '…' : ''}</span></button>
        {sumOpen && (
          <div style={{ ...card, width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid rgba(255,214,150,0.25)' }}>
              <strong style={{ fontSize: 13 }}>{logOpen ? 'Full talk' : 'Summary'}</strong>
              <button style={{ ...chipBtn, marginLeft: 'auto', padding: '2px 8px' }} onClick={() => setLogOpen((v) => !v)}>{logOpen ? 'summary' : 'full talk'}</button>
              {!logOpen && <button style={{ ...chipBtn, padding: '2px 8px' }} disabled={!!sty?.summarizing} onClick={() => void engineRef.current?.summarize()} aria-label="Refresh summary" title="Refresh summary"><GlyphRefresh /></button>}
              <button style={{ ...chipBtn, padding: '2px 8px' }} onClick={() => setSumOpen(false)} aria-label="Close"><GlyphClose /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: 10, userSelect: 'text' }}>
              {!logOpen && (
                sty?.summarizing
                  ? <div style={{ opacity: 0.8 }}>Summarising…</div>
                  : sty && sty.summary.length
                    ? <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>{sty.summary.map((x, i) => <li key={i} style={{ lineHeight: '17px' }}>{x}</li>)}</ul>
                    : <div style={{ opacity: 0.7 }}>Nothing yet. Say something, or start a topic.</div>
              )}
              {logOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sty?.lines.slice(-30).map((l, i) => (
                    <div key={i} style={{ lineHeight: '17px' }}><b style={{ color: l.speaker === ME_ID ? '#9ad7ff' : '#ffd27a' }}>{speakerName(l.speaker)}:</b> {l.text}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: just the listening capsule and a one-line status. No bar. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
        {ptt.state !== 'idle' && <ListeningPill state={ptt.state} levels={ptt.levels} />}
        {typing && (
          <input
            autoFocus value={say} placeholder="Say something…  (Enter to send, Esc to close)" maxLength={500}
            onChange={(e) => setSay(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            style={{ pointerEvents: 'auto', width: 'min(520px, 90%)', height: 32, padding: '0 12px', background: 'rgba(30,18,8,0.88)', color: '#fff3dc', border: '1px solid rgba(255,214,150,0.5)', borderRadius: 16, fontSize: 14 }}
          />
        )}
        <div style={{ ...card, padding: '4px 12px', borderRadius: 14, fontSize: 12, color: pttNote || sty?.error ? '#ffb48a' : 'rgba(255,236,204,0.85)' }}>
          {ptt.state === 'listening' ? 'Listening… release Alt+S to send'
            : ptt.state === 'thinking' ? 'Catching your words…'
              : pttNote || sty?.error || sty?.status || `Hold Alt+S to speak · Enter to type${sty ? ` · ${sty.present.length + 1} at the tapri${sty.auto ? '' : ' · auto-chat off'}` : ''}`}
        </div>
      </div>
    </div>
  );
}
