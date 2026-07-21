import { Logger } from '@nestjs/common';
import type { Browser } from 'puppeteer';

// `browser.close()` has no timeout, and it hangs indefinitely when a page is
// wedged. Callers here drop their `browser` reference *before* awaiting the
// close (so a concurrent caller doesn't hand out a browser that's shutting
// down), which means a hung close strands the entire Chromium process tree —
// browser + zygotes + gpu + network/storage utilities + renderers, ~8 processes
// and several hundred MB — with nothing left holding a reference able to close
// it. The next launch then stacks a fresh tree on top of the stranded one.
//
// Left unbounded that ratchet exhausted a 4 GB host: ~19 leaked trees, ~150
// processes. So: bound the graceful close, then SIGKILL what's left. Failures
// are logged rather than swallowed — the original `.catch(() => undefined)`
// meant the leak produced no evidence at all until the OOM killer started
// firing hours later.
const CLOSE_TIMEOUT_MS = 10_000;

export async function forceCloseBrowser(
  browser: Browser | undefined,
  logger: Logger,
  label: string,
): Promise<void> {
  if (!browser) return;

  // Captured up front: process() returns null once the browser has exited, so
  // reading it after a failed close would lose the pid we need to kill.
  const proc = browser.process();

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      browser.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`close() did not settle within ${CLOSE_TIMEOUT_MS}ms`)),
          CLOSE_TIMEOUT_MS,
        );
        // Don't hold the event loop open just for the watchdog.
        timer.unref?.();
      }),
    ]);
    return;
  } catch (e: any) {
    logger.error(
      `${label}: graceful close failed (${e?.message ?? e}); killing pid ${proc?.pid ?? '?'}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  // SIGKILL, not SIGTERM: we're already past a failed graceful shutdown, so a
  // signal Chromium could ignore or handle slowly is no use. Its child
  // processes exit once the browser process is gone.
  try {
    proc?.kill('SIGKILL');
  } catch (e: any) {
    logger.error(
      `${label}: SIGKILL failed for pid ${proc?.pid ?? '?'}: ${e?.message ?? e}`,
    );
  }
}
