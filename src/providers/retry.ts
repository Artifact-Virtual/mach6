// Mach6 — Simple retry wrapper for provider fetch calls

const RETRY_DELAYS = [1000, 2000, 4000];

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 429 && res.status < 500)) return res;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < RETRY_DELAYS.length) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        return res; // Return the error response on final attempt
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_DELAYS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
    }
  }
  throw lastError ?? new Error('Fetch failed after retries');
}
