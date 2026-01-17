import type { Driver } from 'unstorage';
import { sealData, unsealData } from 'iron-session';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AstroCookies } from 'astro';

/**
 * Context passed from middleware to driver for concurrent request safety.
 */
export interface DriverContext {
  cookies: AstroCookies;
  isSecure: boolean;
  isLocalhost: boolean;
}

/**
 * Global reference to the current request's context.
 * Used by middleware to track request context.
 */
const CONTEXT_KEY = Symbol.for('amplify-astro-adapter-driver-context');

export function setDriverContext(ctx: DriverContext | null): void {
  (globalThis as Record<symbol, DriverContext | null>)[CONTEXT_KEY] = ctx;
}

export function getDriverContext(): DriverContext | null {
  return (globalThis as Record<symbol, DriverContext | null>)[CONTEXT_KEY] ?? null;
}

// AsyncLocalStorage for concurrent request safety in production
export const driverContextStorage = new AsyncLocalStorage<DriverContext>();

/**
 * Global session store - temporary buffer for the current request.
 * Keyed by session ID, holds encrypted data and dirty flag.
 * Middleware loads from cookie before request, writes back after.
 *
 * Uses globalThis with Symbol.for() to ensure the same Map instance is used
 * across all Vite module instances (Vite can create multiple instances of
 * the same module when imported with different specifiers).
 */
const SESSION_STORE_KEY = Symbol.for('amplify-astro-adapter-session-store');

type SessionStoreEntry = { data: string; dirty: boolean; timestamp: number };

export const sessionStore: Map<string, SessionStoreEntry> =
  ((globalThis as Record<symbol, Map<string, SessionStoreEntry> | undefined>)[SESSION_STORE_KEY] ??= new Map());

// TTL for sessionStore entries (5 minutes) - entries older than this can be cleaned up
const SESSION_STORE_TTL_MS = 5 * 60 * 1000;

/**
 * Clean up old sessionStore entries to prevent memory growth in long-running servers.
 * Called periodically from middleware.
 */
export function cleanupSessionStore(): void {
  const now = Date.now();
  for (const [id, entry] of sessionStore) {
    if (now - entry.timestamp > SESSION_STORE_TTL_MS) {
      sessionStore.delete(id);
    }
  }
}

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
      } catch {
        // Invalid or expired session data
        return null;
      }
    },

    async setItem(sessionId: string, value: string): Promise<void> {
      console.log('[session-driver] setItem:', sessionId.slice(0, 8));

      const dataToSeal: SessionDataWrapper = { _d: value };
      const sealed = await sealData(dataToSeal, {
        password: config.password,
        ttl: config.ttl,
      });

      // Store in sessionStore - adapter will inject cookie into response
      sessionStore.set(sessionId, { data: sealed, dirty: true, timestamp: Date.now() });
    },

    async removeItem(sessionId: string): Promise<void> {
      console.log('[session-driver] removeItem:', sessionId.slice(0, 8));
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
