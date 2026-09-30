// @ts-nocheck -- koffi FFI types don't have complete TS definitions
import koffi from 'koffi';
import path from 'path';
import { buildClientWrites, prepareClientPatches } from './client-patches';

// ─── Win32 Type Definitions ───

const SECURITY_ATTRIBUTES = koffi.struct('SECURITY_ATTRIBUTES', {
  nLength: 'uint32',
  lpSecurityDescriptor: 'void *',
  bInheritHandle: 'int',
});

const STARTUPINFOW = koffi.struct('STARTUPINFOW', {
  cb: 'uint32',
  lpReserved: 'void *',
  lpDesktop: 'void *',
  lpTitle: 'void *',
  dwX: 'uint32',
  dwY: 'uint32',
  dwXSize: 'uint32',
  dwYSize: 'uint32',
  dwXCountChars: 'uint32',
  dwYCountChars: 'uint32',
  dwFillAttribute: 'uint32',
  dwFlags: 'uint32',
  wShowWindow: 'uint16',
  cbReserved2: 'uint16',
  lpReserved2: 'void *',
  hStdInput: 'void *',
  hStdOutput: 'void *',
  hStdError: 'void *',
});

const PROCESS_INFORMATION = koffi.struct('PROCESS_INFORMATION', {
  hProcess: 'void *',
  hThread: 'void *',
  dwProcessId: 'uint32',
  dwThreadId: 'uint32',
});

// ─── Win32 Constants ───

const CREATE_SUSPENDED = 0x00000004;
const PROCESS_ALL_ACCESS = 0x001FFFFF;
const MEM_COMMIT = 0x00001000;
const PAGE_READWRITE = 0x04;

// ─── Win32 UI Bindings (for keystroke automation) ───

const user32 = koffi.load('user32.dll');
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });

const PostMessageW = user32.func('PostMessageW', 'int', ['void *', 'uint32', 'uintptr', 'intptr']);
const WM_CHAR = 0x0102;
const FindWindowW = user32.func('FindWindowW', 'void *', ['str16', 'str16']);
const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', ['void *', koffi.out(koffi.pointer('uint32'))]);
const SetForegroundWindow = user32.func('SetForegroundWindow', 'int', ['void *']);
const ShowWindow = user32.func('ShowWindow', 'int', ['void *', 'int']);
const GetClientRect = user32.func('GetClientRect', 'int', ['void *', koffi.out(koffi.pointer(RECT))]);
const ClientToScreen = user32.func('ClientToScreen', 'int', ['void *', 'void *']);
// keybd_event simulates real hardware keyboard input — works with DirectX/old games
const keybd_event = user32.func('keybd_event', 'void', ['uint8', 'uint8', 'uint32', 'uintptr']);
const MapVirtualKeyW = user32.func('MapVirtualKeyW', 'uint32', ['uint32', 'uint32']);
const VkKeyScanW = user32.func('VkKeyScanW', 'int16', ['uint16']);
// Mouse input
const SetCursorPos = user32.func('SetCursorPos', 'int', ['int', 'int']);
const mouse_event = user32.func('mouse_event', 'void', ['uint32', 'uint32', 'uint32', 'uint32', 'uintptr']);

const VK_RETURN = 0x0D;
const VK_TAB = 0x09;
const KEYEVENTF_KEYUP = 0x0002;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const SW_RESTORE = 9;

// ─── Win32 Function Bindings ───

const kernel32 = koffi.load('kernel32.dll');

const CreateProcessW = kernel32.func('CreateProcessW', 'int', [
  'str16',                              // lpApplicationName
  'str16',                              // lpCommandLine
  koffi.pointer(SECURITY_ATTRIBUTES),   // lpProcessAttributes
  koffi.pointer(SECURITY_ATTRIBUTES),   // lpThreadAttributes
  'int',                                // bInheritHandles
  'uint32',                             // dwCreationFlags
  'void *',                             // lpEnvironment
  'str16',                              // lpCurrentDirectory
  koffi.pointer(STARTUPINFOW),          // lpStartupInfo
  koffi.out(koffi.pointer(PROCESS_INFORMATION)), // lpProcessInformation
]);

const OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
const CloseHandle = kernel32.func('CloseHandle', 'int', ['void *']);
const ResumeThread = kernel32.func('ResumeThread', 'uint32', ['void *']);
const TerminateProcess = kernel32.func('TerminateProcess', 'int', ['void *', 'uint32']);

const WriteProcessMemory = kernel32.func('WriteProcessMemory', 'int', [
  'void *',   // hProcess
  'uintptr',  // lpBaseAddress (as integer address)
  'void *',   // lpBuffer
  'uintptr',  // nSize
  koffi.out(koffi.pointer('uintptr')), // lpNumberOfBytesWritten
]);

const ReadProcessMemory = kernel32.func('ReadProcessMemory', 'int', [
  'void *',   // hProcess
  'uintptr',  // lpBaseAddress
  'void *',   // lpBuffer (output)
  'uintptr',  // nSize
  koffi.out(koffi.pointer('uintptr')), // lpNumberOfBytesRead
]);

const VirtualAllocEx = kernel32.func('VirtualAllocEx', 'uintptr', [
  'void *',   // hProcess
  'uintptr',  // lpAddress
  'uintptr',  // dwSize
  'uint32',   // flAllocationType
  'uint32',   // flProtect
]);

// ─── Character data (DA client v7.41) ───

const CHARACTER_NAME_ADDR = 0x73D910;
const CHARACTER_NAME_LENGTH = 12;

// ─── Helper Functions ───

function writeBytes(hProcess: any, address: number, bytes: number[]): void {
  const buf = Buffer.from(bytes);
  const bytesWritten = [0];
  const result = WriteProcessMemory(hProcess, address, buf, buf.length, bytesWritten);
  if (!result || bytesWritten[0] !== buf.length) {
    throw new Error(`WriteProcessMemory failed at 0x${address.toString(16)}`);
  }
}

function readBytes(hProcess: any, address: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const bytesRead = [0];
  const result = ReadProcessMemory(hProcess, address, buf, length, bytesRead);
  if (!result || bytesRead[0] !== length) {
    throw new Error(`ReadProcessMemory failed at 0x${address.toString(16)}`);
  }
  return buf;
}

function allocAndWriteString(hProcess: any, str: string): number {
  const strBuf = Buffer.from(str + '\0', 'ascii');
  const remoteMem = VirtualAllocEx(hProcess, 0, strBuf.length, MEM_COMMIT, PAGE_READWRITE);
  if (!remoteMem) {
    throw new Error('VirtualAllocEx failed');
  }

  const bytesWritten = [0];
  const result = WriteProcessMemory(hProcess, remoteMem, strBuf, strBuf.length, bytesWritten);
  if (!result || bytesWritten[0] !== strBuf.length) {
    throw new Error('WriteProcessMemory failed for string allocation');
  }

  return remoteMem;
}

// ─── Public API ───

export interface LaunchOptions {
  localPort?: number;
  skipIntro?: boolean;
}

export interface LaunchedClient {
  processId: number;
  hProcess: any;
  hThread: any;
}

export function launchClient(clientExePath: string, options: LaunchOptions = {}): LaunchedClient {
  const port = options.localPort || 2610;
  const skipIntro = options.skipIntro !== false;

  console.log(`[Launcher] Launching: ${clientExePath}`);

  const si = {
    cb: 104, lpReserved: null, lpDesktop: null, lpTitle: null,
    dwX: 0, dwY: 0, dwXSize: 0, dwYSize: 0,
    dwXCountChars: 0, dwYCountChars: 0, dwFillAttribute: 0,
    dwFlags: 0, wShowWindow: 0, cbReserved2: 0, lpReserved2: null,
    hStdInput: null, hStdOutput: null, hStdError: null,
  };

  const sa = { nLength: 24, lpSecurityDescriptor: null, bInheritHandle: 0 };
  const pi = { hProcess: null, hThread: null, dwProcessId: 0, dwThreadId: 0 };
  const workDir = path.dirname(clientExePath);

  const result = CreateProcessW(clientExePath, null, sa, sa, 0, CREATE_SUSPENDED, null, workDir, si, pi);

  if (!result || pi.dwProcessId === 0) {
    throw new Error(`CreateProcess failed for ${clientExePath}`);
  }

  console.log(`[Launcher] Process created (PID: ${pi.dwProcessId}), suspended`);

  const hProcess = OpenProcess(PROCESS_ALL_ACCESS, 0, pi.dwProcessId);
  if (!hProcess) {
    TerminateProcess(pi.hProcess, 1);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    throw new Error('OpenProcess failed');
  }

  try {
    const profile = prepareClientPatches((address, length) => readBytes(hProcess, address, length), skipIntro);
    const hostnamePtr = allocAndWriteString(hProcess, 'localhost');
    for (const patch of buildClientWrites(profile, hostnamePtr, port, skipIntro)) {
      writeBytes(hProcess, patch.address, patch.bytes);
    }

    console.log(`[Launcher] Applied ${profile} endpoint patch -> localhost:${port}; resuming thread`);
  } catch (err) {
    TerminateProcess(hProcess, 1);
    CloseHandle(hProcess);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    throw err;
  }

  ResumeThread(pi.hThread);
  CloseHandle(pi.hProcess);

  return {
    processId: pi.dwProcessId,
    hProcess,
    hThread: pi.hThread,
  };
}

export function readCharacterName(processId: number): string {
  const hProcess = OpenProcess(0x0010 | 0x0400, 0, processId);
  if (!hProcess) return '';

  try {
    const buf = Buffer.alloc(CHARACTER_NAME_LENGTH + 1);
    const bytesRead = [0];
    const result = ReadProcessMemory(hProcess, CHARACTER_NAME_ADDR, buf, CHARACTER_NAME_LENGTH, bytesRead);
    if (!result) return '';

    const nullIdx = buf.indexOf(0);
    return buf.subarray(0, nullIdx > 0 ? nullIdx : CHARACTER_NAME_LENGTH).toString('ascii');
  } finally {
    CloseHandle(hProcess);
  }
}

// ─── Keystroke Automation via keybd_event ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Find the DA client window and bring it to the foreground */
function focusDaWindow(processId: number): boolean {
  const hwnd = FindWindowW(null as any, 'Darkages');
  if (!hwnd) {
    console.log('[AutoLogin] FindWindow: no "Darkages" window found');
    return false;
  }
  // Verify PID if possible
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  if (pid[0] !== processId) {
    console.log(`[AutoLogin] Window PID ${pid[0]} != expected ${processId}, using it anyway`);
  }
  ShowWindow(hwnd, SW_RESTORE);
  SetForegroundWindow(hwnd);
  return true;
}

/**
 * Click at a position relative to the DA client's client area.
 * Converts client-relative coords to screen coords, moves cursor, and clicks.
 */
function clickClientRelative(hwnd: any, clientX: number, clientY: number): void {
  // Get client area dimensions to scale coordinates
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  GetClientRect(hwnd, rect);

  // Convert client (0,0) to screen coordinates
  const point = Buffer.alloc(8); // POINT struct: int32 x, int32 y
  point.writeInt32LE(clientX, 0);
  point.writeInt32LE(clientY, 4);
  ClientToScreen(hwnd, point);
  const screenX = point.readInt32LE(0);
  const screenY = point.readInt32LE(4);

  SetCursorPos(screenX, screenY);
  mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
}

/** Click the OK button on the DA Notification screen and then Continue */
export async function clickThroughLoginScreens(processId: number): Promise<void> {
  // Wait for notification screen
  await sleep(6000);
  const hwnd = FindWindowW(null as any, 'Darkages');
  if (!hwnd) { console.log('[AutoLogin] No DA window found'); return; }
  focusDaWindow(processId);
  await sleep(200);
  // Click OK on notification
  clickClientRelative(hwnd, 440, 775);
  console.log('[AutoLogin] Clicked OK on Notification');
  // Wait for main menu, click Continue
  await sleep(3000);
  clickClientRelative(hwnd, 155, 620);
  await sleep(500);
  clickClientRelative(hwnd, 155, 620);
  console.log('[AutoLogin] Clicked Continue');
}

/** Send Enter key to the DA client (for submitting dialogs) */
export function sendEnterToDA(processId: number): void {
  focusDaWindow(processId);
  pressKey(VK_RETURN);
}

/** Press and release a virtual key using keybd_event (hardware-level) */
function pressKey(vk: number): void {
  const scan = MapVirtualKeyW(vk, 0); // MAPVK_VK_TO_VSC
  keybd_event(vk, scan, 0, 0);           // key down
  keybd_event(vk, scan, KEYEVENTF_KEYUP, 0); // key up
}

const VK_SHIFT = 0x10;

/** Type a string via keybd_event with correct case handling */
async function typeStringKbd(text: string): Promise<void> {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    const vkScan = VkKeyScanW(ch);
    const vk = vkScan & 0xFF;
    const needShift = (vkScan >> 8) & 1;
    const scan = MapVirtualKeyW(vk, 0);

    if (needShift) {
      keybd_event(VK_SHIFT, 0, 0, 0);
      await sleep(50);
    }
    keybd_event(vk, scan, 0, 0);
    await sleep(30);
    keybd_event(vk, scan, KEYEVENTF_KEYUP, 0);
    if (needShift) {
      await sleep(30);
      keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
    }
    await sleep(50);
  }
}

/** Type a string via WM_CHAR PostMessage — preserves exact case */
async function typeStringMsg(text: string, hwnd: any): Promise<void> {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    PostMessageW(hwnd, WM_CHAR, ch, 0);
    await sleep(30);
  }
}

/**
 * Automate the full DA client login sequence via keybd_event:
 * 1. Enter (accept Notification screen)
 * 2. Down, Down, Enter (select "Continue" on main menu)
 * 3. Type username, Enter, password, Enter (login)
 *
 * Uses keybd_event which simulates real hardware input —
 * works with DirectX/old games that ignore PostMessage/SendKeys.
 */
export async function automateLogin(processId: number, username: string, password: string): Promise<boolean> {
  console.log(`[AutoLogin] Starting login automation for PID ${processId}`);

  // Wait for the DA client window to appear (up to 15s)
  let windowFound = false;
  for (let i = 0; i < 30; i++) {
    if (focusDaWindow(processId)) {
      windowFound = true;
      break;
    }
    await sleep(500);
  }
  if (!windowFound) {
    console.log('[AutoLogin] Could not find DA client window after 15s');
    return false;
  }
  console.log('[AutoLogin] Window found and focused');

  // Step 1: Wait for Notification screen, click OK button
  // OK button is at roughly the center-left of the bottom of the notification dialog
  console.log('[AutoLogin] Step 1: Waiting 6s for Notification screen...');
  await sleep(6000);
  const hwnd1 = FindWindowW(null as any, 'Darkages');
  if (hwnd1) {
    focusDaWindow(processId);
    await sleep(200);
    clickClientRelative(hwnd1, 440, 775);
    console.log('[AutoLogin] Step 1: Clicked OK on Notification');
  } else {
    console.log('[AutoLogin] Step 1: Window not found, trying Enter key');
    pressKey(VK_RETURN);
  }

  // Step 2: Main menu — click "Continue"
  // "Continue" is on the left side of the main menu screen
  console.log('[AutoLogin] Step 2: Waiting 3s for main menu...');
  await sleep(3000);
  const hwnd2 = FindWindowW(null as any, 'Darkages');
  if (hwnd2) {
    focusDaWindow(processId);
    await sleep(100);
    clickClientRelative(hwnd2, 155, 620);
    console.log('[AutoLogin] Step 2: Clicked Continue');
    // Retry click in case the first one missed
    await sleep(500);
    clickClientRelative(hwnd2, 155, 620);
    console.log('[AutoLogin] Step 2: Retry clicked Continue');
  }

  // Step 3: Login screen — click Name field, type username, click Password field, type password, Enter
  console.log(`[AutoLogin] Step 3: Waiting 3s for login screen...`);
  await sleep(3000);
  const hwnd3 = FindWindowW(null as any, 'Darkages');
  if (hwnd3) {
    // Click the Name input field to ensure focus
    clickClientRelative(hwnd3, 630, 490);
    console.log('[AutoLogin] Step 3: Clicked Name field');
    await sleep(300);
    await typeStringMsg(username, hwnd3);
    console.log(`[AutoLogin] Step 3: Typed username`);
    await sleep(300);
    // Tab to advance to password field
    pressKey(VK_TAB);
    console.log('[AutoLogin] Step 3: Sent Tab (advance to password)');
    await sleep(1000);
    focusDaWindow(processId);
    await sleep(200);
    await typeStringKbd(password);
    console.log('[AutoLogin] Step 3: Typed password');
    await sleep(300);
    pressKey(VK_RETURN);
    console.log('[AutoLogin] Step 3: Sent Enter (submit login)');
  }

  console.log('[AutoLogin] Login sequence complete');
  return true;
}

export function terminateClient(client: LaunchedClient): void {
  try {
    if (client.hProcess) TerminateProcess(client.hProcess, 0);
  } catch { /* process may already be gone */ }
  closeClientHandles(client);
}

export function closeClientHandles(client: LaunchedClient): void {
  if (client.hProcess) CloseHandle(client.hProcess);
  if (client.hThread) CloseHandle(client.hThread);
}
