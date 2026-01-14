// Built-in cookie session support
// Uses Astro's cookie driver - data stored in encrypted HTTP-only cookies
// Works with Lambda immediately, no external storage needed (4KB limit)

import { createDriver as createCookieDriver } from 'astro/drivers/cookie';

export { createCookieDriver as createSessionDriver };

// Optional: export a configured driver with sensible defaults
export function createDefaultSessionDriver() {
  return createCookieDriver({
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}
