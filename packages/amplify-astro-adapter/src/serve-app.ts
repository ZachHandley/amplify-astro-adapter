import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NodeApp } from 'astro/app/node';
import type { Options, RequestHandler } from './types.js';

type NodeRequest = IncomingMessage & { body?: unknown };

/**
 * Create a request handler for the Astro app.
 * Session handling is done by middleware, not here.
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

  return async (
    req: NodeRequest,
    res: ServerResponse,
    next?: () => void,
    locals?: object
  ) => {
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

      await NodeApp.writeResponse(response, res);
    } else if (next) {
      return next();
    } else {
      // Unmatched route
      const response = await app.render(req, {
        addCookieHeader: true,
        prerenderedErrorPageFetch,
      });

      await NodeApp.writeResponse(response, res);
    }
  };
}
