import test from 'node:test';
import assert from 'node:assert/strict';

async function automation() {
  const modulePath = '../core/launcher/login-screen-automation';
  const module = await import(modulePath).catch(() => null);
  assert.ok(module, 'process-owned, cancellable screen automation must exist');
  return module.navigateLoginScreens;
}

test('login navigation rechecks process ownership before each click and rejects another client window', async () => {
  const navigate = await automation();
  const clicks: number[][] = [];
  let owned = true;
  const runtime = {
    findWindow: () => 'owned-window', isOwned: () => owned,
    focus: () => {}, click: (_window: unknown, x: number, y: number) => clicks.push([x, y]),
    wait: async (delay: number) => { if (delay === 3000) owned = false; },
  };
  await assert.rejects(navigate(12, runtime), /window|process/i);
  assert.deepEqual(clicks, [[440, 775]]);
});

test('canceled login automation stops before any further mouse input', async () => {
  const navigate = await automation();
  const controller = new AbortController();
  const clicks: number[][] = [];
  const runtime = {
    findWindow: () => 'owned-window', isOwned: () => true,
    focus: () => {}, click: (_window: unknown, x: number, y: number) => clicks.push([x, y]),
    wait: async (delay: number) => { if (delay === 3000) controller.abort(); },
  };
  await assert.rejects(navigate(12, runtime, controller.signal));
  assert.deepEqual(clicks, [[440, 775]]);
});

test('screen navigation retries through the newer intro until login controls arrive', async () => {
  const navigate = await automation();
  let ready = false;
  let continues = 0;
  let notifications = 0;
  const runtime = {
    findWindow: () => 'owned-window', isOwned: () => true, focus: () => {},
    click: (_window: unknown, x: number) => {
      if (x === 440) notifications++;
      if (x === 155 && ++continues === 4) ready = true;
    },
    wait: async () => {},
  };
  await navigate(12, runtime, undefined, () => ready);
  assert.equal(continues, 4);
  assert.equal(notifications, 2);
});

test('screen navigation waits for its own window to appear before clicking', async () => {
  const navigate = await automation();
  let available = false;
  let clicks = 0;
  const runtime = {
    findWindow: () => available ? 'owned-window' : null,
    isOwned: () => true, focus: () => {}, click: () => { clicks++; },
    wait: async (delay: number) => { if (delay === 500) available = true; },
  };
  await navigate(12, runtime);
  assert.equal(clicks, 3);
});
