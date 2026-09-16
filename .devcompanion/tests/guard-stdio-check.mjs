import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

async function run(file, input, close = true) {
  const child = spawn(process.execPath, [resolve(file), 'guard', '--platform=cursor'], {
    env: { ...process.env, AIDEV_GUARD: '' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  const timer = setTimeout(() => child.kill(), 5000);
  child.stdin.write(input);
  if (close) child.stdin.end();
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    assert.equal(code, 0, stderr);
    return JSON.parse(stdout);
  } finally { clearTimeout(timer); }
}

for (const file of ['companion/dist/companion.mjs', '.companion/companion.mjs']) {
  assert.deepEqual(await run(file, '{'), { permission: 'deny', user_message: '守卫 stdin 不是 JSON' });
  assert.deepEqual(await run(file, '{', false), { permission: 'deny', user_message: '守卫 stdin 读取超时' });
  assert.deepEqual(await run(file, JSON.stringify({ hook_event_name: 'afterFileEdit' })), { permission: 'allow' });
  assert.deepEqual(await run(file, '{}'), {});
  assert.equal((await run(file, JSON.stringify({ hook_event_name: 'beforeShellExecution', command: 'git status' }))).permission, 'allow');
  assert.equal((await run(file, JSON.stringify({ hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: { path: '.companion/companion.mjs' } }))).permission, 'deny');
}
console.log('Cursor stdio checks passed for both bundles');
