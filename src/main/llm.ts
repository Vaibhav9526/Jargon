/**
 * One-shot, tool-less AI call through the user's own Claude Code login.
 * Shared by Jargon Mail (summarize/extract/rewrite) and the classroom chat.
 * Tools are denied and the process runs in the temp dir, so untrusted text in the
 * prompt (an email body, a pasted note) can never drive file or shell access.
 * No electron imports — usable from plain-node tests.
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

/** One-shot, tool-less Claude Code call (uses the user's existing Claude login).
 *  Tools are denied and the process runs in the temp dir, so mail text can never
 *  drive file or shell access. */
export function runClaudeOnce(prompt: string, timeoutMs = 120_000): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (r: { ok: true; text: string } | { ok: false; error: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(
      'claude',
      ['-p', '--output-format', 'text', '--no-session-persistence',
        '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],
      { cwd: tmpdir(), shell: process.platform === 'win32', windowsHide: true },
    );
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      finish({ ok: false, error: 'The AI took too long — try again.' });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 200_000) out = out.slice(0, 200_000); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => finish({ ok: false, error: 'Claude Code CLI was not found. Install it and sign in, then try again.' }));
    child.on('close', (code) => {
      const text = out.trim();
      if (code === 0 && text) finish({ ok: true, text });
      else finish({ ok: false, error: (err.trim() || 'The AI returned no result.').slice(0, 300) });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(prompt);
  });
}
