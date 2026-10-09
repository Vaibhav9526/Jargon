'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');
const service = loadTs('src/renderer/src/components/officeThemeSwitch.ts');
const { effectiveOfficeTheme, planThemeSwitch, themeSwitchWorkers, executeThemeSwitch } = service;
const pickerPath = 'src/renderer/src/components/OfficeThemePicker.tsx';
const switcherPath = 'src/renderer/src/components/SchoolOfficeSwitcher.tsx';
const schoolPatch = { officeTheme: 'staffroom', tvShowOffices: true };
const initial = { tvShowOffices: false, officeTheme: 'office', autoMode: true, registeredRepos: ['keep-me'] };
const roster = [
  { id: 'god', name: 'Leader', isGod: true, ptyId: 'god-pty' },
  { id: 'assistant', name: 'Assistant', isAssistant: true, ptyId: 'assistant-pty' },
  { id: 'worker', ptyId: 'worker-pty' },
  { id: 'unstarted-worker' },
];

function lifecycle(agents = roster) {
  const calls = [];
  let config = initial;
  const deps = {
    agents: () => agents,
    killPty: async (id) => { calls.push(['kill', id]); return { ok: true }; },
    disposeTerminal: (id) => calls.push(['dispose', id]),
    archiveAgent: (id) => calls.push(['archive', id]),
    updateConfig: async (patch) => {
      calls.push(['save', patch]);
      config = { ...config, ...patch };
      return config;
    },
    commit: (saved) => calls.push(['commit', saved]),
  };
  return { calls, deps };
}

// Small injected hook harness tests the real owner handlers, without mounting
// Electron, importing terminalPool, loading the real store, or touching PTYs.
function ownerHarness(agents = roster, overrides = {}) {
  const { calls, deps } = lifecycle(agents);
  Object.assign(deps, overrides);
  const slots = [];
  let cursor = 0;
  let config = initial;
  let tree;
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useContext: () => tree.props.value,
    useState: (value) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], (next) => { slots[index] = next; }];
    },
    useRef: (value) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: value };
      return slots[index];
    },
    useEffect: () => {},
  };
  const storeState = {
    agents, archiveAgent: deps.archiveAgent,
    updateAgent: (id, patch) => { storeState.agents = storeState.agents.map((agent) => agent.id === id ? { ...agent, ...patch } : agent); },
    setOfficeTheme: (theme) => calls.push(['theme', theme]),
  };
  const store = (select) => select(storeState);
  store.getState = () => storeState;
  const output = ts.transpileModule(readFileSync(pickerPath, 'utf8'), {
    fileName: pickerPath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const injectedRequire = (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-dom') return { createPortal: (child) => child };
    if (name === 'react-i18next') return { useTranslation: () => ({ t: (key, args) => `${key}: ${args?.error ?? ''}` }) };
    if (name === './officeThemeSwitch') return service;
    if (name === '@/store/store') return { useStore: store };
    if (name === './terminalPool') return { disposeTerminal: deps.disposeTerminal };
    return {};
  };
  new Function('module', 'exports', 'require', 'window', 'document', output)(
    module, module.exports, injectedRequire,
    { cth: { killPty: deps.killPty, updateConfig: deps.updateConfig } }, { body: {} },
  );
  const render = (nextConfig = config) => {
    config = nextConfig;
    cursor = 0;
    tree = module.exports.OfficeThemeSwitchProvider({ config, onConfigChange: (saved) => { config = saved; }, children: null });
    return tree.props.value;
  };
  const modal = () => tree.props.children[1];
  return { render, modal, calls };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('School enables the flag; Office persists office without overwriting unrelated config', async () => {
  assert.equal(effectiveOfficeTheme({ tvShowOffices: false, officeTheme: 'staffroom' }), 'office');
  const request = planThemeSwitch(initial, schoolPatch);
  assert.equal(request.theme, 'staffroom');
  assert.equal(request.freshTeam, true);
  const { calls, deps } = lifecycle([]);
  await executeThemeSwitch(request, deps);
  const saved = calls.at(-1)[1];
  assert.equal(saved.autoMode, true);
  assert.deepEqual(saved.registeredRepos, ['keep-me']);
  assert.equal(saved.tvShowOffices, true);
  const office = planThemeSwitch(saved, { officeTheme: 'office' });
  assert.deepEqual(office.patch, { officeTheme: 'office' });
  assert.equal(office.theme, 'office');
});

test('saved School with flag disabled is not mistaken for the active School floor', () => {
  const config = { tvShowOffices: false, officeTheme: 'staffroom' };
  assert.equal(planThemeSwitch(config, schoolPatch).freshTeam, true);
  assert.equal(planThemeSwitch(config, { officeTheme: 'office' }).freshTeam, false);
  assert.equal(planThemeSwitch({ tvShowOffices: true, officeTheme: 'staffroom' }, schoolPatch), null);
});

test('Settings flag gating retains the saved theme and uses fresh-team flow when the effective floor changes', () => {
  const config = { tvShowOffices: true, officeTheme: 'staffroom' };
  const off = planThemeSwitch(config, { tvShowOffices: false });
  assert.equal(off.theme, 'office');
  assert.equal(off.freshTeam, true);
  assert.deepEqual(off.patch, { tvShowOffices: false });
  const on = planThemeSwitch({ ...config, tvShowOffices: false }, { tvShowOffices: true });
  assert.equal(on.theme, 'staffroom');
  assert.equal(on.freshTeam, true);
  assert.equal(planThemeSwitch(initial, { tvShowOffices: true }).freshTeam, false);
});

test('switching School back to Office closes workers and persists office, keeping the flag on', async () => {
  const config = { ...initial, ...schoolPatch };
  const { calls, deps } = lifecycle();
  let saved;
  deps.updateConfig = async (patch) => { saved = { ...config, ...patch }; return saved; };
  await executeThemeSwitch(planThemeSwitch(config, { officeTheme: 'office' }), deps);
  assert.equal(saved.officeTheme, 'office');
  assert.equal(saved.tvShowOffices, true);
  assert.equal(effectiveOfficeTheme(saved), 'office');
  assert.deepEqual(calls.slice(0, 4), [
    ['kill', 'worker-pty'], ['dispose', 'worker-pty'],
    ['archive', 'worker'], ['archive', 'unstarted-worker'],
  ]);
});

test('worker close -> dispose -> archive -> persist order preserves GOD and assistant', async () => {
  const { calls, deps } = lifecycle();
  assert.deepEqual(themeSwitchWorkers(roster).map((agent) => agent.id), ['worker', 'unstarted-worker']);
  await executeThemeSwitch(planThemeSwitch(initial, schoolPatch), deps);
  assert.deepEqual(calls.slice(0, 5), [
    ['kill', 'worker-pty'], ['dispose', 'worker-pty'],
    ['archive', 'worker'], ['archive', 'unstarted-worker'], ['save', schoolPatch],
  ]);
  assert.equal(calls[5][0], 'commit');
});

for (const failure of ['resolved-error', 'rejected']) {
  test(`PTY ${failure} aborts without disposing failed PTY, archiving or persisting`, async () => {
    const { calls, deps } = lifecycle();
    deps.killPty = async () => {
      if (failure === 'rejected') throw new Error('close failed');
      return { ok: false, error: 'close failed' };
    };
    await assert.rejects(executeThemeSwitch(planThemeSwitch(initial, schoolPatch), deps), /close failed/);
    assert.deepEqual(calls, []);
  });
}

test('later close failure never archives anyone or saves, even if earlier PTY closed', async () => {
  const { calls, deps } = lifecycle([...roster, { id: 'second', ptyId: 'second-pty' }]);
  const close = deps.killPty;
  deps.killPty = async (id) => id === 'second-pty' ? { ok: false } : close(id);
  await assert.rejects(executeThemeSwitch(planThemeSwitch(initial, schoolPatch), deps), /Could not close/);
  assert.deepEqual(calls, [['kill', 'worker-pty'], ['dispose', 'worker-pty']]);
});

test('a partial close failure marks only successfully closed workers as stopped', async () => {
  const { calls, deps } = lifecycle([...roster, { id: 'second', ptyId: 'second-pty' }]);
  const stopped = [];
  deps.workerClosed = (id) => stopped.push(id);
  const close = deps.killPty;
  deps.killPty = async (id) => id === 'second-pty' ? { ok: false } : close(id);
  await assert.rejects(executeThemeSwitch(planThemeSwitch(initial, schoolPatch), deps), /Could not close/);
  assert.deepEqual(stopped, ['worker']);
  assert.ok(!calls.some(([act]) => ['archive', 'save', 'commit'].includes(act)));
  const picker = readFileSync(pickerPath, 'utf8');
  assert.match(picker, /workerClosed:.*status: 'ghost'.*ptyId: undefined/);
});

test('failed config save does not commit the new active theme', async () => {
  const { calls, deps } = lifecycle([]);
  deps.updateConfig = async () => { throw new Error('save failed'); };
  await assert.rejects(executeThemeSwitch(planThemeSwitch(initial, schoolPatch), deps), /save failed/);
  assert.deepEqual(calls, []);
});

test('shared owner requires confirmation with workers, cancellation performs no lifecycle work', () => {
  const owner = ownerHarness();
  owner.render().request(schoolPatch);
  assert.equal(owner.render().pending, true);
  assert.deepEqual(owner.calls, []);
  // A request from the other control cannot replace the pending selection.
  owner.render().request({ officeTheme: 'friends' });
  owner.render();
  assert.equal(owner.modal().props.label, 'Staff Room');
  owner.modal().props.onCancel();
  assert.equal(owner.render().pending, false);
  assert.deepEqual(owner.calls, []);
});

test('confirmation executes once and synchronizes the shared owner config', async () => {
  const owner = ownerHarness();
  owner.render().request(schoolPatch);
  owner.render();
  owner.modal().props.onConfirm();
  owner.modal().props.onConfirm();
  assert.equal(owner.render().busy, true);
  await flush();
  const state = owner.render();
  assert.equal(state.busy, false);
  assert.equal(state.pending, false);
  assert.equal(state.enabled, true);
  assert.equal(state.current, 'staffroom');
  assert.equal(owner.calls.filter(([type]) => type === 'kill').length, 1);
  assert.equal(owner.calls.filter(([type]) => type === 'save').length, 1);
  assert.deepEqual(owner.calls.at(-1), ['theme', 'staffroom']);
});

test('GOD and assistant only skips confirmation; owner follows updated Settings config props', async () => {
  const owner = ownerHarness(roster.slice(0, 2));
  owner.render().request(schoolPatch);
  assert.equal(owner.render().pending, false);
  await flush();
  assert.equal(owner.calls.some(([type]) => type === 'kill' || type === 'archive'), false);
  const state = owner.render({ tvShowOffices: false, officeTheme: 'friends' });
  assert.equal(state.enabled, false);
  assert.equal(state.current, 'friends');
});

test('owner surfaces failed close and leaves selected theme/config unchanged', async () => {
  const owner = ownerHarness(roster, { killPty: async () => ({ ok: false, error: 'busy terminal' }) });
  owner.render().request(schoolPatch);
  owner.render();
  owner.modal().props.onConfirm();
  await flush();
  const state = owner.render();
  assert.equal(state.current, 'office');
  assert.equal(state.enabled, false);
  assert.equal(state.busy, false);
  assert.match(state.note, /busy terminal/);
  assert.deepEqual(owner.calls, []);
});

test('titlebar control is immediately left of logo, native accessible/no-drag, with one shared switch owner', () => {
  const app = readFileSync('src/renderer/src/App.tsx', 'utf8');
  const picker = readFileSync(pickerPath, 'utf8');
  const switcher = readFileSync(switcherPath, 'utf8');
  assert.match(app, /<SchoolOfficeSwitcher \/>\s*<img\s+src=\{brandLogo\}/);
  assert.match(app, /<OfficeThemeSwitchProvider config=\{config\} onConfigChange=\{setConfig\}>/);
  assert.match(app, /onConfigChanged\(setConfig\)/);
  assert.match(switcher, /<select[\s\S]*?className="cth-titlebar-nodrag"[\s\S]*?aria-label="School \/ Office"/);
  assert.match(switcher, /value=\{theme\}/);
  assert.match(switcher, /useOfficeThemeSwitch\(\)/);
  assert.match(switcher, /request\(\{ officeTheme: 'staffroom', tvShowOffices: true \}\)/);
  assert.match(switcher, /request\(\{ officeTheme: 'office' \}\)/);
  assert.doesNotMatch(switcher, /killPty|disposeTerminal|archiveAgent|updateConfig/);
  const settings = picker.slice(picker.indexOf('export function OfficeThemePicker'));
  assert.match(settings, /useOfficeThemeSwitch\(\)/);
  assert.doesNotMatch(settings, /executeThemeSwitch|killPty|updateConfig|setOfficeTheme/);
  assert.match(picker, /createPortal\(/);
  assert.match(picker, /role="dialog" aria-modal="true"/);
  assert.match(picker, /event.key === 'Escape'/);
});
