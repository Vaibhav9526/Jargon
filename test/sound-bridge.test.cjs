'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const loadTs = require('./load-ts.cjs');

const {
  SOUND_NAMES,
  DEFAULT_SOUND_VOLUME,
  TYPE_TICK_WINDOW_MS,
  TYPE_TICK_JITTER_MS,
  clampVolume,
  createTypeThrottle
} = loadTs('src/renderer/src/audio/soundEngine.ts');
const { createSoundBridge } = loadTs('src/renderer/src/audio/soundBridge.ts');

const agent = (id, status) => ({ id, status });

// A store stand-in that records every cue the bridge decides on and every gain
// it hands the engine. No Electron, no React, no AudioContext — the whole point
// of injecting the dependencies is that these rules can be read this way.
function harness(seed = []) {
  const log = [];
  const gains = [];
  let clock = 0;
  let state = { agents: seed, godStatus: 'ready', soundEnabled: true, soundVolume: 0.5 };
  let listener = null;
  const dispose = createSoundBridge({
    subscribe: (fn) => { listener = fn; return () => { listener = null; }; },
    getState: () => state,
    play: (name) => log.push(name),
    configure: (options) => gains.push(options),
    now: () => clock,
    // No jitter, so a throttle window is exactly TYPE_TICK_WINDOW_MS unless a
    // test says otherwise — a random window is its own test.
    random: () => 0
  });
  return {
    log,
    gains,
    latestGain: () => gains[gains.length - 1],
    dispose,
    advance: (ms) => { clock += ms; },
    emit: (patch) => {
      if (!listener) return;
      const next = { ...state, ...patch };
      listener(next, state);
      state = next;
    }
  };
}

// --- the level setting -------------------------------------------------------

test('an absent volume reads as the install default, never as silence', () => {
  // The user asked for floor sound. A config that predates the setting, or one
  // hand-edited into nonsense, must not mute the app behind their back.
  for (const unreadable of [undefined, null, NaN, 'loud', {}]) {
    assert.equal(clampVolume(unreadable), DEFAULT_SOUND_VOLUME, String(unreadable));
  }
});

test('levels are clamped to the 0..1 the master gain can use', () => {
  assert.equal(clampVolume(-3), 0);
  assert.equal(clampVolume(0.25), 0.25);
  assert.equal(clampVolume(9), 1);
});

test('a fresh install is audible', () => {
  const h = harness();
  assert.equal(h.latestGain().enabled, true, 'sound defaults ON');
  assert.equal(h.latestGain().volume, DEFAULT_SOUND_VOLUME);
});

// --- the tick throttle -------------------------------------------------------

test('a busy agent ticks once per window instead of once per transition', () => {
  const h = harness([agent('a', 'idle')]);
  h.emit({ agents: [agent('a', 'working')] });
  assert.deepEqual(h.log, ['type'], 'starting work ticks');
  // 'waiting' is a state the bridge says nothing about, so the next transition
  // back into working is measured and not masked by a chime.
  h.emit({ agents: [agent('a', 'waiting')] });
  h.emit({ agents: [agent('a', 'working')] });
  assert.deepEqual(h.log, ['type'], 'a flapping agent must not machine-gun');
  h.advance(TYPE_TICK_WINDOW_MS);
  h.emit({ agents: [agent('a', 'waiting')] });
  h.emit({ agents: [agent('a', 'working')] });
  assert.deepEqual(h.log, ['type', 'type'], 'the window reopens');
});

test('the tick window is jittered so a floor cannot tick in lockstep', () => {
  // Fixed zero jitter = the bare window; a full jitter = the widest one.
  const bare = createTypeThrottle(() => 0);
  const jittered = createTypeThrottle(() => 1);
  const halfway = TYPE_TICK_WINDOW_MS + TYPE_TICK_JITTER_MS / 2;
  assert.equal(bare.allow('a', 0), true);
  assert.equal(bare.allow('a', halfway), true, 'the base window has elapsed');
  assert.equal(jittered.allow('a', 0), true);
  assert.equal(
    jittered.allow('a', halfway), false,
    'the same moment is still inside a window that drew the full jitter'
  );
  assert.equal(jittered.allow('a', TYPE_TICK_WINDOW_MS + TYPE_TICK_JITTER_MS), true);
});

test('an agent leaving the floor frees its tick window', () => {
  // Otherwise a re-hired agent is silent until the window its PREVIOUS tenancy
  // opened has elapsed, which reads as the sound being broken.
  const throttle = createTypeThrottle(() => 0);
  assert.equal(throttle.allow('a', 0), true);
  assert.equal(throttle.allow('a', 100), false);
  throttle.forget('a');
  assert.equal(throttle.allow('a', 100), true);
});

// --- what the floor says -----------------------------------------------------

test('a task that finishes chimes', () => {
  const h = harness([agent('a', 'working')]);
  h.emit({ agents: [agent('a', 'idle')] });
  assert.deepEqual(h.log, ['taskDone']);
});

test('two agents finishing together make one chime', () => {
  const h = harness([agent('a', 'working'), agent('b', 'working')]);
  h.emit({ agents: [agent('a', 'idle'), agent('b', 'idle')] });
  assert.deepEqual(h.log, ['taskDone'], 'stacked chimes are noise, not feedback');
});

test('someone joining or leaving the floor makes a door', () => {
  const h = harness([agent('a', 'idle')]);
  h.emit({ agents: [agent('a', 'idle'), agent('b', 'idle')] });
  h.advance(500);
  h.emit({ agents: [agent('a', 'idle')] });
  assert.deepEqual(h.log, ['agentJoin', 'agentLeave']);
});

test('a roster restored at boot does not land a burst of doors', () => {
  const h = harness();
  h.emit({ agents: ['a', 'b', 'c', 'd'].map((id) => agent(id, 'idle')) });
  assert.deepEqual(h.log, ['agentJoin'], 'one cue for the arrival, not four');
});

test('a blocked agent and a failed orchestrator blip, but only once', () => {
  const h = harness([agent('a', 'working')]);
  h.emit({ agents: [agent('a', 'blocked')] });
  assert.deepEqual(h.log, ['error']);
  h.emit({ godStatus: 'failed' });
  assert.deepEqual(h.log, ['error'], 'the same moment is not a second failure');
  h.advance(1300);
  h.emit({ godStatus: 'ready' });
  h.emit({ godStatus: 'failed' });
  assert.deepEqual(h.log, ['error', 'error']);
});

test('the floor only speaks in the five cues it knows', () => {
  assert.deepEqual(
    [...SOUND_NAMES].sort(),
    ['agentJoin', 'agentLeave', 'error', 'taskDone', 'type']
  );
});

// --- the mute has to be instant ----------------------------------------------

test('muting reaches the engine on the next store write, with no cue first', () => {
  const h = harness([agent('a', 'working')]);
  h.emit({ soundEnabled: false });
  assert.deepEqual(h.latestGain(), { enabled: false, volume: 0.5 });
  // …and the floor keeps ticking; it is the engine that is now silent.
  h.emit({ agents: [agent('a', 'waiting')] });
  h.advance(TYPE_TICK_WINDOW_MS);
  h.emit({ agents: [agent('a', 'working')] });
  assert.deepEqual(h.log, ['type'], 'muting is a mixer change, not a mute of events');
});

test('a store write that leaves the roster alone is silent', () => {
  const roster = [agent('a', 'idle')];
  const h = harness(roster);
  h.emit({ agents: roster });
  assert.deepEqual(h.log, [], 'every pty chunk rewrites the roster; most say nothing');
});

test('disposing the bridge silences the floor', () => {
  const h = harness([agent('a', 'idle')]);
  h.dispose();
  h.emit({ agents: [agent('a', 'working')] });
  assert.deepEqual(h.log, []);
});

// --- one subscriber, not cues sprinkled through the UI ------------------------

test('soundBridge is the only thing in the renderer that plays a cue', () => {
  // The point of the bridge is that components never reach for the engine, so
  // mute stays one master gain and the trigger map stays in one readable place.
  const root = 'src/renderer/src';
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  })(root);

  const callers = files
    .filter((f) => /\bplaySound\b/.test(fs.readFileSync(f, 'utf8')))
    // The audio modules may of course talk about the engine; what must not
    // exist is a second caller anywhere in the app.
    .filter((f) => !f.startsWith(`${root}/audio/`));
  assert.deepEqual(
    callers.map((f) => f.replace(/\\/g, '/')),
    ['src/renderer/src/hooks/useHive.ts'],
    'useHive is the one wiring site; nothing else may reach for the engine'
  );

  const hive = fs.readFileSync(`${root}/hooks/useHive.ts`, 'utf8');
  assert.match(hive, /createSoundBridge\(\{/);
  assert.match(hive, /subscribe: useStore\.subscribe/);
});