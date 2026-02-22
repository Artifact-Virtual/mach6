// Mach6 — Simple retry wrapper for provider fetch calls

const RETRY_DELAYS = [1000, 2000, 4000];

// 400-class errors that are transient (backend quirks, not user errors)
const RETRYABLE_400_PATTERNS = [
  'assistant message prefill',
  'conversation must end with',
];

function isRetryable400(status: number, body?: string): boolean {
  if (status !== 400 || !body) return false;
  const lower = body.toLowerCase();
  return RETRYABLE_400_PATTERNS.some(p => lower.includes(p));
}

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;

      // Retry on 429 (rate limit) and 500+ (server errors)
      if (res.status === 429 || res.status >= 500) {
        if (attempt < RETRY_DELAYS.length) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        return res;
      }

      // Retry on known-transient 400 errors (copilot backend quirks)
      if (res.status === 400 && attempt < RETRY_DELAYS.length) {
        const body = await res.clone().text().catch(() => '');
        if (isRetryable400(res.status, body)) {
          console.warn(`[retry] Retryable 400 (attempt ${attempt + 1}): ${body.slice(0, 200)}`);
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
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
