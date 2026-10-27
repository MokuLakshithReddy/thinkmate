type Env = Record<string, string | undefined>;

export interface ConfigIssue {
  variable: string;
  message: string;
}

export interface ProductionConfigReport {
  ok: boolean;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

export const MIN_SESSION_KEY_BYTES = 32;
const PROXY_PROVIDERS = ['vercel', 'cloudflare', 'nginx', 'custom'];

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function getSessionEncryptionKeyStatus(env: Env = process.env): 'ready' | 'unconfigured' | 'weak' {
  const secret = env.SESSION_ENCRYPTION_KEY || env.ROTATION_SECRET;
  if (!secret) return 'unconfigured';
  return Buffer.byteLength(secret, 'utf8') >= MIN_SESSION_KEY_BYTES ? 'ready' : 'weak';
}

/**
 * Validates the environment a production deployment needs. Messages name variables but never echo values.
 */
export function validateProductionConfig(env: Env = process.env): ProductionConfigReport {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const error = (variable: string, message: string) => errors.push({ variable, message });
  const warn = (variable: string, message: string) => warnings.push({ variable, message });

  const requireHttpsUrl = (variable: string, purpose: string) => {
    const value = env[variable];
    if (!value) {
      error(variable, `required: ${purpose}`);
      return;
    }
    if (parseUrl(value)?.protocol !== 'https:') {
      error(variable, 'must be an https:// URL');
    }
  };

  // Supabase
  requireHttpsUrl('NEXT_PUBLIC_SUPABASE_URL', 'Supabase project URL for auth and cloud sessions');
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) error('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'required: Supabase anon key');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    error('SUPABASE_SERVICE_ROLE_KEY', 'required: server-side session revocation and readiness checks');
  }
  for (const variable of ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY']) {
    if (env[variable]) {
      error(variable, 'must not be set in production: session revocation prefers it over the production project');
    }
  }
  if (env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    warn('STAGING_SUPABASE_SERVICE_ROLE_KEY', 'staging-only variable is set in production');
  }

  // AI provider
  if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
    error('GEMINI_API_KEY', 'required (or GOOGLE_API_KEY): live AI responses');
  }

  // Distributed rate limiter
  requireHttpsUrl(
    'UPSTASH_REDIS_REST_URL',
    'distributed rate limiting; without it login, signup and refresh return 503 in production'
  );
  if (!env.UPSTASH_REDIS_REST_TOKEN) {
    error('UPSTASH_REDIS_REST_TOKEN', 'required: distributed rate limiting');
  }
  if (env.RATE_LIMIT_FAIL_CLOSED === 'false') {
    warn(
      'RATE_LIMIT_FAIL_CLOSED',
      'non-auth routes fall back to per-instance memory limits during a Redis outage (auth still fails closed)'
    );
  }

  // Token-rotation encryption key
  const keyStatus = getSessionEncryptionKeyStatus(env);
  if (keyStatus === 'unconfigured') {
    error(
      'SESSION_ENCRYPTION_KEY',
      `required: >= ${MIN_SESSION_KEY_BYTES} bytes, e.g. \`openssl rand -base64 48\``
    );
  } else if (keyStatus === 'weak') {
    error('SESSION_ENCRYPTION_KEY', `must be at least ${MIN_SESSION_KEY_BYTES} bytes`);
  } else {
    const secret = env.SESSION_ENCRYPTION_KEY || env.ROTATION_SECRET;
    if (secret === env.SUPABASE_SERVICE_ROLE_KEY || secret === env.UPSTASH_REDIS_REST_TOKEN) {
      error('SESSION_ENCRYPTION_KEY', 'must be a dedicated secret, not a reused credential');
    }
  }

  // Canonical application URL
  const hasCanonical = Boolean(env.APP_URL || env.NEXT_PUBLIC_APP_URL || env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!hasCanonical) {
    error('APP_URL', 'required: canonical https origin used for CSRF origin checks (or NEXT_PUBLIC_APP_URL)');
  }
  for (const variable of ['APP_URL', 'NEXT_PUBLIC_APP_URL']) {
    const value = env[variable];
    if (!value) continue;
    const parsed = parseUrl(value);
    if (!parsed) {
      error(variable, 'must be an absolute URL, e.g. https://thinkmate.example.com');
    } else if (isLocalHost(parsed.hostname)) {
      warn(variable, 'points at localhost');
    } else if (parsed.protocol !== 'https:') {
      error(variable, 'must use https://');
    }
  }

  // Trusted origins (comma-separated origins or hosts)
  if (env.TRUSTED_ORIGINS) {
    for (const entry of env.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (entry.includes('*')) {
        error('TRUSTED_ORIGINS', `wildcards are not supported ("${entry}")`);
        continue;
      }
      const parsed = parseUrl(entry.includes('://') ? entry : `https://${entry}`);
      if (!parsed) {
        error('TRUSTED_ORIGINS', `unparseable entry "${entry}"`);
      } else if (parsed.protocol !== 'https:' && !isLocalHost(parsed.hostname)) {
        warn('TRUSTED_ORIGINS', `non-https origin "${entry}"`);
      }
    }
  }

  // Client IP / proxy trust (rate-limit keys)
  const provider = (env.TRUSTED_PROXY_PROVIDER || '').toLowerCase().trim();
  if (provider && !PROXY_PROVIDERS.includes(provider)) {
    error('TRUSTED_PROXY_PROVIDER', `must be one of ${PROXY_PROVIDERS.join(', ')}`);
  }
  if (env.TRUSTED_PROXY_DEPTH !== undefined && !/^[1-9]\d*$/.test(env.TRUSTED_PROXY_DEPTH)) {
    error('TRUSTED_PROXY_DEPTH', 'must be a positive integer');
  }
  if (env.TRUST_PROXY === 'false' && !env.TRUSTED_PROXY_HEADER) {
    warn('TRUST_PROXY', 'proxy headers are ignored, so every client shares one rate-limit bucket');
  } else if (env.TRUST_PROXY !== 'false' && !env.TRUSTED_PROXY_HEADER && !provider && !env.VERCEL) {
    warn(
      'TRUSTED_PROXY_HEADER',
      'client IPs come from X-Forwarded-For (TRUSTED_PROXY_DEPTH from the right); confirm your proxy sets it, or configure TRUSTED_PROXY_HEADER / TRUSTED_PROXY_PROVIDER'
    );
  }

  // Subscription Billing (Razorpay)
  const razorVars = [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'RAZORPAY_PLAN_PRO',
    'RAZORPAY_PLAN_TEAM',
  ];
  const presentRazor = razorVars.filter((k) => env[k]);
  if (presentRazor.length > 0 && presentRazor.length < razorVars.length) {
    const missing = razorVars.filter((k) => !env[k]);
    for (const v of missing) {
      error(v, `Billing partially configured. Missing: ${missing.join(', ')}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
