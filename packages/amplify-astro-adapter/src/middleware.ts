import type { MiddlewareHandler } from 'astro';
// IMPORTANT: Import via package specifier to ensure same module instance as session driver
// Using ./session-driver.js would create a separate module instance in Vite
import {
  sessionStore,
  driverContextStorage,
  setDriverContext,
  getDriverConfig,
  cleanupSessionStore,
  type DriverContext,
} from 'amplify-astro-adapter/session';

const SESSION_DATA_COOKIE = 'astro-session-data';

/**
 * Middleware that handles cookie-based session storage.
 *
 * Flow:
 * 1. BEFORE next(): Load existing session data from cookie into sessionStore
 * 2. Store cookies context in AsyncLocalStorage for driver access
 * 3. During request: Driver writes cookies directly via ALS when setItem is called
 * 4. AFTER next(): Cleanup sessionStore (cookie writing happens in driver now)
 *
 * The AsyncLocalStorage approach solves the timing issue where session.persist()
 * is called AFTER middleware completes in Astro's dev server.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  // BEFORE: Load existing session data from cookie into sessionStore
  // Check sessionStore first - there may be data from a previous setItem that couldn't
  // be written to the cookie (because response was already sent)
  const sessionId = context.cookies.get('astro-session')?.value;
  if (sessionId) {
    const inMemoryEntry = sessionStore.get(sessionId);
    if (!inMemoryEntry) {
      // No in-memory data, try loading from cookie
      const existingData = context.cookies.get(SESSION_DATA_COOKIE)?.value;
      if (existingData) {
        // Store the encrypted data - driver will decrypt when needed
        sessionStore.set(sessionId, { data: existingData, dirty: false, timestamp: Date.now() });
      }
    }
  }

  // Periodically clean up old sessionStore entries (every request is fine, it's fast)
  cleanupSessionStore();

  // Prepare context for driver to write cookies directly
  const url = new URL(context.request.url);
  const driverContext: DriverContext = {
    cookies: context.cookies,
    isSecure: context.request.url.startsWith('https://'),
    isLocalhost: url.hostname === 'localhost' || url.hostname === '127.0.0.1',
  };

  // Set global context so driver can write cookies even AFTER middleware returns
  // This is needed because session.persist() runs in Astro's finally block
  setDriverContext(driverContext);

  // Also run with ALS for concurrent request safety in production
  const response = await driverContextStorage.run(driverContext, () => next());

  // AFTER: Check for session and try to inject cookie into response
  const finalSessionId = context.cookies.get('astro-session')?.value;

  // For redirects (302), we need to wait for session.persist() and add cookie to response
  // The response object can be modified before we return it
  if (finalSessionId && (response.status === 302 || response.status === 301)) {
    // Wait for Astro's session.persist() to complete
    await new Promise((resolve) => setImmediate(resolve));

    let entry = sessionStore.get(finalSessionId);
    if (!entry?.dirty) {
      for (let i = 0; i < 20 && !entry?.dirty; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        entry = sessionStore.get(finalSessionId);
      }
    }

    if (entry?.dirty && entry.data) {
      const config = getDriverConfig();
      const ttl = config?.ttl ?? 604800;
      const cookieOptions = config?.cookieOptions;

      // Build cookie string
      // For localhost: no Domain (host-only cookie)
      // For production: .domain.com (include subdomains)
      const url = new URL(context.request.url);
      const hostname = url.hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
      const cookieDomain = isLocalhost
        ? undefined
        : '.' + hostname.replace(/^www\./, '');

      const cookieParts = [
        `${SESSION_DATA_COOKIE}=${entry.data}`,
        `Path=${cookieOptions?.path ?? '/'}`,
        `Max-Age=${ttl}`,
        cookieOptions?.httpOnly !== false ? 'HttpOnly' : '',
        (cookieOptions?.secure ?? driverContext.isSecure) ? 'Secure' : '',
        `SameSite=${cookieOptions?.sameSite ?? 'Lax'}`,
        cookieDomain ? `Domain=${cookieDomain}` : '',
      ]
        .filter(Boolean)
        .join('; ');

      // Clone response with added cookie header
      const newHeaders = new Headers(response.headers);
      newHeaders.append('Set-Cookie', cookieParts);

      console.log('[middleware] Injected session cookie into redirect response');
      // Don't delete - keep as fallback for redirect race condition
      // TTL cleanup will remove old entries

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
  }

  return response;
};
