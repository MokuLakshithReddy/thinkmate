let inflight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  inflight ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const run = () => fetch(input, { credentials: 'same-origin', ...init });
  let res = await run();
  if (res.status === 401 && (await refreshSession())) {
    res = await run();
  }
  if (res.status === 401 && typeof window !== 'undefined') {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  return res;
}
