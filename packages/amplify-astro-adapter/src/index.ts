import type { AstroConfig, AstroIntegration } from "astro";

import { exists, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

export interface AwsAmplifyOptions {
  runtime?: "nodejs20.x" | "nodejs22.x";
}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

async function detectPackageManager(root: URL): Promise<PackageManager> {
  const rootPath = fileURLToPath(root);
  const entries = await readdir(rootPath);

  if (entries.includes("pnpm-lock.yaml")) return "pnpm";
  if (entries.includes("yarn.lock")) return "yarn";
  if (entries.includes("package-lock.json")) return "npm";
  if (entries.includes("bun.lockb")) return "bun";

  return "unknown";
}

function getAmplifyYaml(packageManager: PackageManager): string {
  const commonBase = `version: 1
frontend:
  phases:
    preBuild:
      commands:
`;

  const configs: Record<PackageManager, string> = {
    npm: `${commonBase}        - npm ci --cache .npm --prefer-offline
    build:
      commands:
        - npm run build
        - mv node_modules ./.amplify-hosting/compute/default
  artifacts:
    baseDirectory: .amplify-hosting
    files:
      - '**/*'
  cache:
    paths:
      - .npm/**/*`,

    pnpm: `${commonBase}        - npm i -g pnpm
        - pnpm config set store-dir .pnpm-store
        - pnpm i
    build:
      commands:
        - pnpm run build
  artifacts:
    baseDirectory: .amplify-hosting
    files:
      - '**/*'
  cache:
    paths:
      - .pnpm-store/**/*`,

    yarn: `${commonBase}        - yarn install
    build:
      commands:
        - yarn run build
        - mv node_modules ./.amplify-hosting/compute/default
  artifacts:
    baseDirectory: .amplify-hosting
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*`,

    bun: `${commonBase}        - bun install
    build:
      commands:
        - bun run build
        - mv node_modules ./.amplify-hosting/compute/default
  artifacts:
    baseDirectory: .amplify-hosting
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*`,

    unknown: `${commonBase}        - npm ci --cache .npm --prefer-offline
    build:
      commands:
        - npm run build
        - mv node_modules ./.amplify-hosting/compute/default
  artifacts:
    baseDirectory: .amplify-hosting
    files:
      - '**/*'
  cache:
    paths:
      - .npm/**/*`
  };

  return configs[packageManager] || configs.unknown;
}

export default function awsAmplify(options: AwsAmplifyOptions = {}): AstroIntegration {
  let _config: AstroConfig;
  const { runtime = "nodejs20.x" } = options;

  return {
    name: "amplify-astro-adapter",
    hooks: {
      "astro:config:setup": async ({ config, updateConfig, logger }) => {
        // Generate amplify.yml if it doesn't exist
        const amplifyYmlPath = join(fileURLToPath(config.root), "amplify.yml");
        const ymlExists = await exists(amplifyYmlPath);

        if (!ymlExists) {
          const packageManager = await detectPackageManager(config.root);
          const yamlContent = getAmplifyYaml(packageManager);
          await writeFile(amplifyYmlPath, yamlContent);
          logger.info(`Created amplify.yml for ${packageManager} - commit this file to your repository!`);
        }

        updateConfig({
          build: {
            client: new URL(
              `./.amplify-hosting/static${config.base}`,
              config.root,
            ),
            server: new URL("./.amplify-hosting/compute/default/", config.root),
          },
        });
      },
      "astro:config:done": ({ config, setAdapter }) => {
        setAdapter({
          name: "amplify-astro-adapter",
          serverEntrypoint: "amplify-astro-adapter/server",
          supportedAstroFeatures: {
            serverOutput: "stable",
            hybridOutput: "stable",
            staticOutput: "stable",
            sharpImageService: "stable",
            envGetSecret: "stable",
          },
          args: {
            client: config.build.client?.toString(),
            server: config.build.server?.toString(),
            host: config.server.host,
            port: 3000,
            assets: config.build.assets,
          },
        });

        _config = config;
      },
      "astro:build:done": async () => {
        const deployManifestConfig = {
          version: 1,
          routes: [
            {
              path: `${_config.base}assets/*`,
              target: {
                kind: "Static",
              },
            },
            {
              path: `${_config.base}*.*`,
              target: {
                kind: "Static",
              },
              fallback: {
                kind: "Compute",
                src: "default",
              },
            },
            {
              path: "/*",
              target: {
                kind: "Compute",
                src: "default",
              },
            },
          ],
          computeResources: [
            {
              name: "default",
              entrypoint: "entry.mjs",
              runtime,
            },
          ],
          framework: {
            name: "astro",
            version: "4.0.0",
          },
        };

        const functionsConfigPath = join(
          fileURLToPath(_config.root),
          "/.amplify-hosting/deploy-manifest.json",
        );
        await writeFile(
          functionsConfigPath,
          JSON.stringify(deployManifestConfig),
        );
      },
    },
  };
}
