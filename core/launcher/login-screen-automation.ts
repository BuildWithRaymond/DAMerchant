export interface LoginScreenRuntime {
  findWindow(processId: number): unknown | null;
  isOwned(window: unknown, processId: number): boolean;
  focus(window: unknown): void;
  click(window: unknown, x: number, y: number): void;
  wait(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

/** Retry screen navigation through the intro; never click another client's window. */
export async function navigateLoginScreens(
  processId: number, runtime: LoginScreenRuntime, signal?: AbortSignal, loginReady?: () => boolean,
): Promise<void> {
  const windowForClick = () => {
    signal?.throwIfAborted();
    const window = runtime.findWindow(processId);
    if (!window || !runtime.isOwned(window, processId)) throw new Error('Login window does not belong to the reconnect process');
    runtime.focus(window);
    return window;
  };
  const click = (window: unknown, x: number, y: number) => {
    signal?.throwIfAborted();
    if (!runtime.isOwned(window, processId)) throw new Error('Login window process changed');
    runtime.click(window, x, y);
  };

  await runtime.wait(6000, signal);
  for (let poll = 0; poll < 30; poll++) {
    signal?.throwIfAborted();
    const window = runtime.findWindow(processId);
    if (window) {
      if (!runtime.isOwned(window, processId)) throw new Error('Login window belongs to another process');
      break;
    }
    if (poll === 29) throw new Error('Reconnect process did not create a login window');
    await runtime.wait(500, signal);
  }
  for (let cycle = 0; cycle < 12; cycle++) {
    signal?.throwIfAborted();
    if (loginReady?.()) return;
    const notificationWindow = windowForClick();
    await runtime.wait(200, signal);
    click(notificationWindow, 440, 775);
    await runtime.wait(3000, signal);
    signal?.throwIfAborted();
    const menuWindow = windowForClick();
    await runtime.wait(200, signal);
    click(menuWindow, 155, 620);
    await runtime.wait(500, signal);
    if (!loginReady?.()) click(menuWindow, 155, 620);
    await runtime.wait(500, signal);
    signal?.throwIfAborted();
    if (!loginReady || loginReady()) return;
  }
  throw new Error('Login controls did not become ready');
}
