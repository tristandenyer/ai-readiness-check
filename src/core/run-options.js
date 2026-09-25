import { AsyncLocalStorage } from "node:async_hooks";

/* Options for one runCheck() call, visible to every fetch that call makes.
   The checkers call fetchWithTimeout directly, so passing these as
   arguments would mean threading them through every checker. The store is
   per async call chain, so two checks running at the same time on one
   server never see each other's options.

   Outside a run (a checker called directly, a test) the defaults apply,
   and the default never allows private addresses. */
const storage = new AsyncLocalStorage();

const DEFAULTS = Object.freeze({
  allowPrivateNetwork: false,
  timeoutMs: undefined,
  userAgent: undefined,
  headers: undefined,
  headersOrigin: undefined,
});

export function withRunOptions(options, fn) {
  return storage.run(
    {
      allowPrivateNetwork: options?.allowPrivateNetwork === true,
      timeoutMs: options?.timeoutMs,
      userAgent: options?.userAgent,
      // Extra request headers, sent only to headersOrigin (see fetch.js).
      headers: options?.headers,
      headersOrigin: options?.headersOrigin,
      // URL -> network error code, for URLs that could not be fetched.
      networkErrors: new Map(),
      // GET responses already fetched in this run, keyed by URL and request headers (see fetch.js).
      fetchCache: new Map(),
    },
    fn,
  );
}

export function currentRunOptions() {
  return storage.getStore() ?? DEFAULTS;
}

/* The network error (e.g. "timeout") that stopped `url` being fetched in
   this run, or undefined. Lets a check whose file couldn't be fetched be
   reported as inconclusive instead of "not found". */
export function recordNetworkError(url, code) {
  storage.getStore()?.networkErrors.set(url, code);
}
export function networkErrorFor(url) {
  return url ? storage.getStore()?.networkErrors.get(url) : undefined;
}
