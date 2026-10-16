import type { Page, Route } from '@playwright/test';

/**
 * Stateful stand-in for the Supabase-backed routes (auth, sessions, cloud co-think).
 * Everything else, including the guest simulator at /api/demo/cothink, reaches the real local server.
 */
export const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e-user@example.com' };
export const CLOUD_SESSION_ID = '11111111-2222-4333-8444-555555555555';
export const CLOUD_REPLY_TEXT = 'Mock Gemini: which outcome matters most to you here?';

export interface MockReply {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  method: string;
  path: string;
  search: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

export function cloudReply(message = CLOUD_REPLY_TEXT): MockReply {
  return {
    status: 200,
    body: {
      message,
      nextStep: 'clarify_objective',
      options: [
        { id: 'opt_speed', label: 'Speed of delivery' },
        { id: 'opt_maint', label: 'Long-term maintainability' },
      ],
      executionMode: 'gemini',
      modelName: 'gemini-2.5-flash',
      progressPercent: 30,
    },
  };
}

const MOCKED_PATHS = new Set([
  '/api/auth/session',
  '/api/auth/refresh',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/sessions',
  '/api/cothink',
]);

export class MockBackend {
  authenticated = false;
  canRefresh = false;
  sessions: Record<string, unknown>[] = [];
  sessionDetails = new Map<string, Record<string, unknown>>();
  refreshReplies: MockReply[] = [];
  cothinkReplies: MockReply[] = [];
  sessionCreateReplies: MockReply[] = [];
  calls: RecordedCall[] = [];

  constructor(private readonly page: Page) {}

  async install() {
    await this.page.route('**/api/**', (route) => this.handle(route));
  }

  callsTo(path: string, method = 'POST') {
    return this.calls.filter((c) => c.path === path && c.method === method);
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    let body: Record<string, unknown> | null = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    this.calls.push({ method: req.method(), path: url.pathname, search: url.search, body, headers: await req.allHeaders() });

    if (!MOCKED_PATHS.has(url.pathname)) return route.continue();
    const reply = this.reply(req.method(), url, body);
    return route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      headers: reply.headers,
      body: JSON.stringify(reply.body),
    });
  }

  private reply(method: string, url: URL, body: Record<string, unknown> | null): MockReply {
    const unauthorized: MockReply = { status: 401, body: { error: 'Authentication required' } };
    switch (`${method} ${url.pathname}`) {
      case 'GET /api/auth/session':
        return {
          status: 200,
          body: {
            authenticated: this.authenticated,
            canRefresh: !this.authenticated && this.canRefresh,
            user: this.authenticated ? USER : null,
          },
        };
      case 'POST /api/auth/refresh': {
        const queued = this.refreshReplies.shift();
        const reply =
          queued ??
          (this.canRefresh
            ? { status: 200, body: { success: true, user: USER, message: 'Token refreshed successfully' } }
            : { status: 401, body: { error: 'Refresh failed', code: 'REFRESH_FAILED' } });
        if (reply.status === 200) {
          this.authenticated = true;
          this.canRefresh = false;
        }
        return reply;
      }
      case 'POST /api/auth/login':
        if (body?.password === 'wrong-password') {
          return { status: 401, body: { error: 'Invalid login credentials' } };
        }
        this.authenticated = true;
        return { status: 200, body: { success: true, user: { ...USER, email: body?.email }, message: 'Signed in successfully' } };
      case 'POST /api/auth/signup':
        return {
          status: 200,
          body: {
            success: true,
            authenticated: false,
            requiresEmailConfirmation: true,
            user: { id: USER.id, email: body?.email },
            session: null,
            message: 'Account created. Please check your email to confirm your account before signing in.',
          },
        };
      case 'POST /api/auth/logout':
        this.authenticated = false;
        return { status: 200, body: { success: true, upstreamRevoked: true } };
      case 'GET /api/sessions': {
        if (!this.authenticated) return unauthorized;
        const id = url.searchParams.get('id');
        if (id) {
          const session = this.sessionDetails.get(id);
          return session ? { status: 200, body: { session } } : { status: 404, body: { error: 'Session not found or unauthorized' } };
        }
        return { status: 200, body: { sessions: this.sessions } };
      }
      case 'POST /api/sessions': {
        const queued = this.sessionCreateReplies.shift();
        if (queued) return queued;
        if (!this.authenticated) return unauthorized;
        const session = {
          id: CLOUD_SESSION_ID,
          userId: USER.id,
          title: body?.title,
          problemStatement: body?.problemStatement,
          currentMode: 'understand',
          currentStage: 'describe_problem',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.sessions = [session];
        return { status: 200, body: { session } };
      }
      case 'POST /api/cothink': {
        const queued = this.cothinkReplies.shift();
        if (queued) return queued;
        return this.authenticated ? cloudReply() : unauthorized;
      }
      default:
        return { status: 404, body: { error: `No mock for ${method} ${url.pathname}` } };
    }
  }
}
