import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SSRManifest } from 'astro';

export interface UserOptions {
  mode: 'middleware' | 'standalone';
  experimentalDisableStreaming?: boolean;
  experimentalStaticHeaders?: boolean;
  experimentalErrorPageHost?: string | URL;
}

export interface Options extends UserOptions {
  host: string | boolean;
  port: number;
  server: string;
  client: string;
  assets: string;
  trailingSlash?: SSRManifest['trailingSlash'];
  experimentalStaticHeaders: boolean;
}

export interface AwsAmplifyOptions {
  runtime?: 'nodejs20.x' | 'nodejs22.x';
}

export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (err?: unknown) => void,
  locals?: object
) => void | Promise<void>;
