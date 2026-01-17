import type { MiddlewareHandler } from 'astro';
import { sessionStore, getDriverConfig } from './session-driver.js';

const SESSION_DATA_COOKIE = 'astro-session-data';

/**
 * Middleware that handles cookie-based session storage.
 *
 * Flow:
 * 1. BEFORE next(): Load existing session data from cookie into sessionStore
 * 2. During request: Astro's session system uses our driver (reads/writes sessionStore)
 * 3. AFTER next(): Write dirty session data from sessionStore back to cookie
 *
 * This approach works because:
 * - Session ID is unique per session, used as the key
 * - The sessionStore is just a temporary buffer for ONE request
 * - Cookies are the actual persistence layer
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  // BEFORE: Load existing session data from cookie into sessionStore
  const sessionId = context.cookies.get('astro-session')?.value;
  if (sessionId) {
    const existingData = context.cookies.get(SESSION_DATA_COOKIE)?.value;
    if (existingData) {
      // Store the encrypted data - driver will decrypt when needed
      sessionStore.set(sessionId, { data: existingData, dirty: false });
    }
  }

  // Run the request - session.persist() happens during this via Astro's finally block
  const response = await next();

  // AFTER: Write dirty session data back to cookie
  // Check for session ID again - it may have been created during the request
  const finalSessionId = context.cookies.get('astro-session')?.value;
  if (finalSessionId) {
    const entry = sessionStore.get(finalSessionId);
    if (entry?.dirty) {
      const config = getDriverConfig();
      const ttl = config?.ttl ?? 604800;
      const cookieOptions = config?.cookieOptions;

      if (entry.data) {
        // Set the session data cookie
        context.cookies.set(SESSION_DATA_COOKIE, entry.data, {
          httpOnly: cookieOptions?.httpOnly ?? true,
          secure: cookieOptions?.secure ?? true,
          sameSite: cookieOptions?.sameSite ?? 'lax',
          path: cookieOptions?.path ?? '/',
          domain: cookieOptions?.domain,
          maxAge: ttl,
        });
      } else {
        // Empty data means delete
        context.cookies.delete(SESSION_DATA_COOKIE, {
          path: cookieOptions?.path ?? '/',
          domain: cookieOptions?.domain,
        });
      }
    }
    // Cleanup this request's data from the store
    sessionStore.delete(finalSessionId);
  }

  return response;
};
