import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NodeApp } from 'astro/app/node';
import type { Options, RequestHandler } from './types.js';
import { sessionStore, getDriverConfig } from './session-driver.js';

type NodeRequest = IncomingMessage & { body?: unknown };

/**
 * Create a request handler for the Astro app.
 * Session cookie handling is primarily done by middleware.
 * This handler provides a fallback for direct responses (e.g., API routes with redirects).
 */
export function createAppHandler(app: NodeApp, options: Options): RequestHandler {
  const als = new AsyncLocalStorage<string>();
  const logger = app.getAdapterLogger();

  process.on('unhandledRejection', (reason) => {
    const requestUrl = als.getStore();
    logger.error(`Unhandled rejection while rendering ${requestUrl}`);
    console.error(reason);
  });

  const originUrl = options.experimentalErrorPageHost
    ? new URL(options.experimentalErrorPageHost)
    : undefined;

  const prerenderedErrorPageFetch = originUrl
    ? (url: string) => {
        const errorPageUrl = new URL(url);
        errorPageUrl.protocol = originUrl.protocol;
        errorPageUrl.host = originUrl.host;
        return fetch(errorPageUrl);
      }
    : undefined;

  return async (req: NodeRequest, res: ServerResponse, next?: () => void, locals?: object) => {
    let request: Request;
    try {
      request = NodeApp.createRequest(req, {
        allowedDomains: app.getAllowedDomains?.() ?? [],
      });
    } catch (err) {
      logger.error(`Could not render ${req.url}`);
      console.error(err);
      res.statusCode = 500;
      res.end('Internal Server Error');
      return;
    }

    const routeData = app.match(request, true);

    if (routeData) {
      // Run render with URL tracking for error reporting
      const response = await als.run(request.url, () =>
        app.render(request, {
          addCookieHeader: true,
          locals,
          routeData,
          prerenderedErrorPageFetch,
        })
      );

      const finalResponse = await injectSessionCookieIfNeeded(request, response);
      await NodeApp.writeResponse(finalResponse, res);
    } else if (next) {
      return next();
    } else {
      // Unmatched route
      const response = await app.render(request, {
        addCookieHeader: true,
        prerenderedErrorPageFetch,
      });

      const finalResponse = await injectSessionCookieIfNeeded(request, response);
      await NodeApp.writeResponse(finalResponse, res);
    }
  };
}

/**
 * Inject session data cookie into response if needed.
 * Waits for one microtask tick to allow Astro's session.persist() to complete,
 * then checks if session data needs to be written to cookie.
 * If not available yet, middleware will handle it on the next request
 * via deferred cookie sync.
 */
async function injectSessionCookieIfNeeded(
  request: Request,
  response: Response
): Promise<Response> {
  const setCookieHeaders = response.headers.getSetCookie?.() ?? [];

  let sessionId: string | null = null;

  for (const cookie of setCookieHeaders) {
    const match = cookie.match(/^astro-session=([^;]+)/);
    if (match) {
      sessionId = match[1];
      break;
    }
  }

  if (!sessionId) {
    return response;
  }

  // Wait for next event loop tick to allow Astro's session.persist() to complete
  // persist() runs in a finally block after render completes
  await new Promise((resolve) => setImmediate(resolve));

  const entry = sessionStore.get(sessionId);

  // Only inject if we have dirty data ready
  if (!entry?.dirty || !entry.data) {
    return response;
  }

  const config = getDriverConfig();
  const ttl = config?.ttl ?? 604800;
  const cookieOptions = config?.cookieOptions;
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const isSecure = request.url.startsWith('https://');

  const cookieParts = [
    `astro-session-data=${entry.data}`,
    `Path=${cookieOptions?.path ?? '/'}`,
    `Max-Age=${ttl}`,
    cookieOptions?.httpOnly !== false ? 'HttpOnly' : '',
    (cookieOptions?.secure ?? isSecure) ? 'Secure' : '',
    `SameSite=${cookieOptions?.sameSite ?? 'Lax'}`,
    !isLocalhost && cookieOptions?.domain ? `Domain=${cookieOptions.domain}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  const newHeaders = new Headers(response.headers);
  newHeaders.append('Set-Cookie', cookieParts);

  // Mark as clean after writing cookie
  sessionStore.set(sessionId, { ...entry, dirty: false, timestamp: Date.now() });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
