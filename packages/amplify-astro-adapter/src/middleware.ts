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
  // BEFORE: Handle session data synchronization
  // Check if we have session ID but missing session data cookie
  // This happens when the previous request set session data but couldn't write the cookie
  const sessionId = context.cookies.get('astro-session')?.value;
  const existingDataCookie = context.cookies.get(SESSION_DATA_COOKIE)?.value;
  let needsCookieSync = false;

  if (sessionId) {
    const inMemoryEntry = sessionStore.get(sessionId);

    if (inMemoryEntry?.dirty && !existingDataCookie) {
      // We have in-memory data that wasn't written to cookie yet
      // This is the deferred cookie sync case (happens after redirect)
      needsCookieSync = true;
    } else if (!inMemoryEntry && existingDataCookie) {
      // No in-memory data, but cookie exists - load from cookie
      sessionStore.set(sessionId, { data: existingDataCookie, dirty: false, timestamp: Date.now() });
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

  // Deferred cookie sync: If we detected session data in sessionStore without a cookie,
  // inject the cookie now (on the follow-up request after a redirect)
  if (needsCookieSync && sessionId) {
    const entry = sessionStore.get(sessionId);
    if (entry?.data) {
      const config = getDriverConfig();
      const ttl = config?.ttl ?? 604800;
      const cookieOptions = config?.cookieOptions;
      const hostname = new URL(context.request.url).hostname;
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
      const cookieDomain = isLocalhost ? undefined : '.' + hostname.replace(/^www\./, '');

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

      const newHeaders = new Headers(response.headers);
      newHeaders.append('Set-Cookie', cookieParts);

      // Mark as not dirty since we're writing the cookie
      sessionStore.set(sessionId, { ...entry, dirty: false });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
  }

  return response;
};
