import { NextRequest } from 'next/server';

export interface BoundedJsonResult<T> {
  data?: T;
  error?: string;
  status?: number;
}

/**
 * Reads and parses JSON payload from incoming NextRequest while strictly enforcing
 * a byte limit on both Content-Length and actual streaming bytes received.
 * Protects against missing, spoofed, or chunked-transfer header bypasses.
 */
export async function readBoundedJson<T = unknown>(
  req: NextRequest,
  maxBytes: number = 65536
): Promise<BoundedJsonResult<T>> {
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return {
      error: `Payload too large: request body exceeds ${Math.round(maxBytes / 1024)}KB limit`,
      status: 413,
    };
  }

  try {
    // If request body stream is available, consume with byte counter
    if (req.body) {
      const reader = req.body.getReader();
      let totalBytes = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > maxBytes) {
            await reader.cancel('Request body exceeded size limit');
            return {
              error: `Payload too large: streaming request body exceeded ${Math.round(maxBytes / 1024)}KB limit`,
              status: 413,
            };
          }
          chunks.push(value);
        }
      }

      if (totalBytes === 0) {
        return { error: 'Empty request body', status: 400 };
      }

      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const decodedText = new TextDecoder('utf-8').decode(merged);
      const data = JSON.parse(decodedText) as T;
      return { data };
    }

    // Fallback if req.body stream is unavailable in mock tests
    const text = await req.text();
    if (!text || text.trim().length === 0) {
      return { error: 'Empty request body', status: 400 };
    }
    if (new TextEncoder().encode(text).length > maxBytes) {
      return {
        error: `Payload too large: request body exceeds ${Math.round(maxBytes / 1024)}KB limit`,
        status: 413,
      };
    }
    const data = JSON.parse(text) as T;
    return { data };
  } catch (err: unknown) {
    const isJsonSyntax = err instanceof SyntaxError;
    return {
      error: isJsonSyntax ? 'Malformed JSON payload in request body' : 'Failed to read request payload',
      status: 400,
    };
  }
}
