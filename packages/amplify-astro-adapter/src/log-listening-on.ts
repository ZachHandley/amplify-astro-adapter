import type http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import type { AstroIntegrationLogger } from 'astro';

const wildcardHosts = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000']);

export async function logListeningOn(
  logger: AstroIntegrationLogger,
  server: http.Server | https.Server,
  configuredHost: string | boolean | undefined
) {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const protocol = server instanceof https.Server ? 'https' : 'http';
  const host = getResolvedHostForHttpServer(configuredHost);
  const { port } = server.address() as AddressInfo;
  const address = getNetworkAddress(protocol, host, port);

  if (host === undefined || wildcardHosts.has(host)) {
    logger.info(
      `Server listening on \n  local: ${address.local[0]} \t\n  network: ${address.network[0]}\n`
    );
  } else {
    logger.info(`Server listening on ${address.local[0]}`);
  }
}

function getResolvedHostForHttpServer(host: string | boolean | undefined) {
  if (host === false) {
    return 'localhost';
  } else if (host === true) {
    return undefined;
  } else {
    return host;
  }
}

interface NetworkAddressOpt {
  local: string[];
  network: string[];
}

function getNetworkAddress(
  protocol: 'http' | 'https' = 'http',
  hostname: string | undefined,
  port: number,
  base?: string
) {
  const NetworkAddress: NetworkAddressOpt = {
    local: [],
    network: [],
  };
  Object.values(os.networkInterfaces())
    .flatMap((nInterface) => nInterface ?? [])
    .filter(
      (detail) =>
        detail &&
        detail.address &&
        (detail.family === 'IPv4' ||
          // @ts-expect-error Node 18.0 - 18.3 returns number
          detail.family === 4)
    )
    .forEach((detail) => {
      let host = detail.address.replace(
        '127.0.0.1',
        hostname === undefined || wildcardHosts.has(hostname) ? 'localhost' : hostname
      );
      if (host.includes(':')) {
        host = `[${host}]`;
      }
      const url = `${protocol}://${host}:${port}${base ? base : ''}`;
      if (detail.address.includes('127.0.0.1')) {
        NetworkAddress.local.push(url);
      } else {
        NetworkAddress.network.push(url);
      }
    });
  return NetworkAddress;
}
