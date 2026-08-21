/**
 * Jest stub for the `puppeteer` package.
 *
 * WHY this exists
 * ---------------
 * `puppeteer`'s published entry point (`node_modules/puppeteer/lib/puppeteer/
 * puppeteer.js`) is pure ESM — its first statement is `export * from
 * 'puppeteer-core'`. Jest's default `transformIgnorePatterns` skips
 * `node_modules`, so that file reaches the CJS sandbox untransformed and dies
 * with `SyntaxError: Unexpected token 'export'`.
 *
 * That breaks suites that never touch a browser, because the import is pulled
 * in transitively:
 *     billing.service.spec.ts
 *       -> billing.service.ts
 *         -> events/invoice-created.listener.ts
 *           -> pdf/invoice-pdf.service.ts
 *             -> puppeteer            <-- boom
 *
 * Two ways out:
 *   1. Let ts-jest transform puppeteer via `transformIgnorePatterns`. That
 *      means compiling puppeteer + puppeteer-core + their ESM dependency tree
 *      on every run — slow, and it only postpones the next ESM-in-node_modules
 *      surprise (chromium-bidi, devtools-protocol, ...).
 *   2. Map the specifier to this stub. A unit test has no business launching a
 *      real headless Chromium (300 MB of processes, seconds of startup, needs a
 *      downloaded browser binary), so there is nothing of value to lose.
 *
 * We take (2) — see `moduleNameMapper` in package.json.
 *
 * The stub is *inert but functional* rather than throw-on-use: production code
 * wraps `launch()` in try/finally cleanup paths (see
 * common/browser/close-browser.util.ts), and a throwing stub would exercise
 * those error branches instead of the happy path a future test might want.
 * Nothing here spawns a process, opens a socket, or blocks — every method
 * resolves immediately.
 *
 * NOTE: this only replaces the *runtime* module. TypeScript still type-checks
 * production code against the real `puppeteer` typings, so a stub that drifts
 * from the real API cannot silently mask a type error.
 */

// Minimal shape of a Puppeteer page as used by src/pdf/invoice-pdf.service.ts
// and src/delivery/carriers/scrapers/scrape.util.ts. Deliberately typed loose
// (`any`) — this is a test double, not a re-implementation of the API surface.
/* eslint-disable @typescript-eslint/no-explicit-any */

const makePage = () => ({
  setContent: jest.fn(async () => undefined),
  setViewport: jest.fn(async () => undefined),
  setUserAgent: jest.fn(async () => undefined),
  setDefaultNavigationTimeout: jest.fn(() => undefined),
  setDefaultTimeout: jest.fn(() => undefined),
  emulateMediaType: jest.fn(async () => undefined),
  goto: jest.fn(async () => null),
  content: jest.fn(async () => '<html></html>'),
  waitForSelector: jest.fn(async () => null),
  waitForFunction: jest.fn(async () => null),
  waitForNavigation: jest.fn(async () => null),
  evaluate: jest.fn(async () => undefined),
  $: jest.fn(async () => null),
  $$: jest.fn(async () => []),
  $eval: jest.fn(async () => undefined),
  $$eval: jest.fn(async () => []),
  type: jest.fn(async () => undefined),
  click: jest.fn(async () => undefined),
  screenshot: jest.fn(async () => Buffer.from('')),
  // A recognisable, non-empty buffer: a test asserting "we produced a PDF"
  // gets something truthy with a real %PDF magic number, without us pretending
  // to have rendered anything.
  pdf: jest.fn(async () => Buffer.from('%PDF-1.4 stub')),
  close: jest.fn(async () => undefined),
  isClosed: jest.fn(() => false),
});

const makeBrowser = () => ({
  newPage: jest.fn(async () => makePage()),
  pages: jest.fn(async () => []),
  close: jest.fn(async () => undefined),
  // `forceCloseBrowser` reads process()?.pid and may call kill(). Returning
  // undefined is the truthful answer here — there is no OS process — and the
  // util already handles that (`proc?.kill`).
  process: jest.fn(() => undefined),
  connected: true,
  isConnected: jest.fn(() => true),
  version: jest.fn(async () => 'HeadlessChrome/stub'),
  target: jest.fn(() => ({ createCDPSession: jest.fn(async () => ({})) })),
});

const puppeteer = {
  launch: jest.fn(async (_options?: any) => makeBrowser()),
  connect: jest.fn(async (_options?: any) => makeBrowser()),
  executablePath: jest.fn(() => '/stub/chrome'),
  defaultArgs: jest.fn(() => [] as string[]),
};

// Production code imports two shapes:
//   import puppeteer from 'puppeteer'           (default — runtime)
//   import { Browser, Page } from 'puppeteer'   (type-only — erased by tsc)
// ts-jest compiles this file to CJS with `__esModule: true`, so the
// `esModuleInterop` default-import helper in the consumer picks up
// `exports.default` below. The named exports are here for symmetry only.
export default puppeteer;
export const launch = puppeteer.launch;
export const connect = puppeteer.connect;
