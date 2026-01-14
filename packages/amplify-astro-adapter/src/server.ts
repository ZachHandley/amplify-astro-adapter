import type { SSRManifest } from "astro";
import { NodeApp } from "astro/app/node";

// Deep import from @astrojs/node
import { createStandaloneHandler } from '@astrojs/node/dist/standalone.js';
import { startServer as nodeStartServer } from '@astrojs/node/dist/standalone.js';
import type { Options } from './types.js';

export function createExports(manifest: SSRManifest, options: Options) {
  const app = new NodeApp(manifest, !options.experimentalDisableStreaming);
  options.trailingSlash = manifest.trailingSlash;
  return {
    options: options,
    handler: createStandaloneHandler(app, options),
    startServer: () => nodeStartServer(app, options),
  };
}

export function start(manifest: SSRManifest, options: Options) {
  const app = new NodeApp(manifest, !options.experimentalDisableStreaming);
  nodeStartServer(app, options);
}
