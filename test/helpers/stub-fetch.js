/* Makes every request the checkers send answer with one fixed response,
   through the fetcher's test hook. The real fetchWithTimeout still runs
   (safety check, headers, body cap), so the checker sees exactly what it
   would see from a real server. Pass an Error to simulate a network
   failure. */
import { __setFetchImplForTests } from "../../src/core/fetch.js";

export function stubFetch(response) {
  __setFetchImplForTests(async () => {
    if (response instanceof Error) throw response;
    return new Response(response.text ?? "", {
      status: response.status ?? 200,
      headers: {
        ...(response.contentType ? { "content-type": response.contentType } : {}),
        ...(response.headers ?? {}),
      },
    });
  });
}

export function resetFetch() {
  __setFetchImplForTests(null);
}
