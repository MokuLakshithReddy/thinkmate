export const safeErr = (e: unknown): string =>
  String(e instanceof Error ? e.name + ': ' + e.message : e)
    .replace(/(key|token|bearer)[=: ]+[A-Za-z0-9._-]+/gi, '$1=[redacted]')
    .slice(0, 200);
