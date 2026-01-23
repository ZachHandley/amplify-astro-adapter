import type { Driver } from 'unstorage';
import { sealData, unsealData } from 'iron-session';
import { createHash } from 'node:crypto';

/**
 * Global session store - cross-request buffer for session data.
 * Used as fallback when cookies can't be set (e.g., 302 redirects).
 * Uses process object to ensure sharing across Vite module instances.
 */
type SessionStoreEntry = { data: string; dirty: boolean; timestamp: number };
const SESSION_STORE_KEY = '__amplify_session_store__';
const processAny = process as typeof process & {
  [SESSION_STORE_KEY]?: Map<string, SessionStoreEntry>;
};
export const sessionStore: Map<string, SessionStoreEntry> = (processAny[SESSION_STORE_KEY] ??=
  new Map());

// TTL for sessionStore entries (5 minutes)
const SESSION_STORE_TTL_MS = 5 * 60 * 1000;

/** Clean up old sessionStore entries */
export function cleanupSessionStore(): void {
  const now = Date.now();
  for (const [id, entry] of sessionStore) {
    if (now - entry.timestamp > SESSION_STORE_TTL_MS) {
      sessionStore.delete(id);
    }
  }
}

// Auto-cleanup every 60 seconds
const cleanupInterval = setInterval(cleanupSessionStore, 60_000);
cleanupInterval.unref(); // Don't keep process alive

/**
 * Cookie options for setting session cookies
 */
export interface CookieSetOptions {
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  httpOnly?: boolean;
  path?: string;
  domain?: string;
  maxAge?: number;
}

/**
 * Configuration options for the cookie session driver
 */
export interface CookieSessionDriverOptions {
  /**
   * Password for encrypting session data.
   * Must be at least 32 characters long.
   * If not provided, falls back to AMPLIFY_SESSION_PASSWORD environment variable.
   */
  password?: string;

  /**
   * Session TTL in seconds. Default: 604800 (7 days)
   */
  ttl?: number;

  /**
   * Cookie options
   */
  cookieOptions?: CookieSetOptions;
}

interface ResolvedConfig {
  password: string;
  ttl: number;
  cookieOptions: Required<Pick<CookieSetOptions, 'secure' | 'sameSite' | 'httpOnly' | 'path'>> &
    Pick<CookieSetOptions, 'domain' | 'maxAge'>;
}

const DEFAULTS: ResolvedConfig = {
  password: '',
  ttl: 604800, // 7 days
  cookieOptions: {
    secure: true,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
  },
};

/**
 * Internal session data wrapper for encryption
 */
interface SessionDataWrapper {
  _d: string;
}

// Store the resolved config so middleware can access TTL
let resolvedConfig: ResolvedConfig | null = null;

/**
 * Get the resolved driver configuration (for middleware to access TTL, etc.)
 */
export function getDriverConfig() {
  return resolvedConfig;
}

/**
 * Create a cookie-based session driver for Astro.
 *
 * This driver stores session data in encrypted HTTP-only cookies,
 * making it ideal for serverless environments like AWS Lambda where
 * filesystem storage is not available.
 *
 * Features:
 * - Uses iron-session for encryption
 * - Works with Astro's native session system
 * - No AsyncLocalStorage needed - uses session ID as key
 *
 * @example
 * ```typescript
 * // astro.config.mjs
 * import { createCookieSessionDriver } from 'amplify-astro-adapter/session';
 *
 * export default defineConfig({
 *   adapter: amplify(),
 *   session: {
 *     driver: createCookieSessionDriver({
 *       password: process.env.SESSION_SECRET, // At least 32 chars
 *       ttl: 86400, // 1 day
 *     }),
 *   },
 * });
 * ```
 */
export function createCookieSessionDriver(options: CookieSessionDriverOptions = {}): Driver {
  // Merge options with defaults
  const config = {
    ...DEFAULTS,
    ...options,
    cookieOptions: {
      ...DEFAULTS.cookieOptions,
      ...options.cookieOptions,
    },
  };

  // Try to get password from environment if not provided
  if (!config.password) {
    config.password = process.env.AMPLIFY_SESSION_PASSWORD ?? '';
  }

  // Generate a default password for development if none provided
  if (!config.password) {
    const projectPath = process.cwd();
    config.password = createHash('sha256')
      .update(projectPath + 'amplify-astro-adapter-session-v1')
      .digest('hex');

    console.warn(
      '\x1b[33m[amplify-astro-adapter] Using auto-generated session password for development.\n' +
        'For production, set AMPLIFY_SESSION_PASSWORD environment variable (32+ chars).\x1b[0m'
    );
  }

  if (config.password.length < 32) {
    throw new Error('amplify-astro-adapter: session password must be at least 32 characters long.');
  }

  // Store for middleware access
  resolvedConfig = config;

  return {
    name: 'amplify-cookie-session-driver',

    async hasItem(sessionId: string): Promise<boolean> {
      return sessionStore.has(sessionId);
    },

    async getItem(sessionId: string): Promise<string | null> {
      const entry = sessionStore.get(sessionId);
      if (!entry) return null;

      try {
        // Decrypt the sealed data
        const decrypted = await unsealData<SessionDataWrapper>(entry.data, {
          password: config.password,
          ttl: config.ttl,
        });
        return decrypted?._d ?? null;
      } catch (err) {
        // Invalid or expired session data - log for debugging
        console.error(
          '[session-driver] Failed to unseal session data:',
          err instanceof Error ? err.message : String(err)
        );
        return null;
      }
    },

    async setItem(sessionId: string, value: string): Promise<void> {
      // Encrypt the data
      const dataToSeal: SessionDataWrapper = { _d: value };
      const sealed = await sealData(dataToSeal, {
        password: config.password,
        ttl: config.ttl,
      });

      // Store in the global map - middleware will write to cookie
      sessionStore.set(sessionId, { data: sealed, dirty: true, timestamp: Date.now() });
    },

    async removeItem(sessionId: string): Promise<void> {
      // Mark for deletion by setting empty data
      sessionStore.set(sessionId, { data: '', dirty: true, timestamp: Date.now() });
    },

    async getKeys(): Promise<string[]> {
      // Cookie-based sessions don't support listing keys
      return [];
    },

    async clear(): Promise<void> {
      sessionStore.clear();
    },

    async dispose(): Promise<void> {
      // No resources to clean up
    },
  };
}

export default createCookieSessionDriver;

/**
 * Generate a cryptographically secure random password for session encryption.
 * Useful for generating a secure SESSION_SECRET if one doesn't exist.
 */
export function generateSessionPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}
