# amplify-astro-adapter

AWS Amplify adapter for Astro. Extends `@astrojs/node` with Amplify Hosting deployment configuration.

## Version 0.3.0

This adapter extends `@astrojs/node` v9.5.1, adding AWS Amplify-specific deployment features.

### Features

- Astro 4.x and 5.x support
- **envGetSecret** support for type-safe environment variables
- **Cookie-based sessions** (built-in, zero setup)
- **Auto-generates `amplify.yml`** - detects your package manager and creates the build spec for you
- Configurable Node.js runtime (nodejs20.x, nodejs22.x)
- Generates proper `deploy-manifest.json` for Amplify Hosting

## Installation

```bash
# Using npm
npm install amplify-astro-adapter

# Using yarn
yarn add amplify-astro-adapter

# Using pnpm
pnpm add amplify-astro-adapter
```

## Configuration

Add the adapter to your Astro config:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import amplify from 'amplify-astro-adapter';

export default defineConfig({
  output: 'server', // or 'hybrid'
  adapter: amplify({
    runtime: 'nodejs20.x' // or 'nodejs22.x'
  })
});
```

## Sessions

This adapter includes built-in cookie-based session support. Sessions are stored in encrypted HTTP-only cookies and work immediately with AWS Lambda - no additional setup required.

```js
import { defineConfig } from 'astro/config';
import amplify from 'amplify-astro-adapter';
import { createDefaultSessionDriver } from 'amplify-astro-adapter/session';

export default defineConfig({
  adapter: amplify({ runtime: 'nodejs20.x' }),
  session: {
    driver: createDefaultSessionDriver()
  }
});
```

**Note**: Cookie sessions have a 4KB size limit, which is sufficient for most use cases (user ID, cart, preferences).

## envGetSecret Support

Use type-safe environment variables with Astro's `astro:env/server`:

```ts
import { getSecret } from 'astro:env/server';

const apiKey = await getSecret('API_KEY');
```

## AWS Amplify Hosting

### amplify.yml Auto-Generation

When you run `astro build` for the first time, this adapter automatically generates an `amplify.yml` file in your project root. It detects your package manager (npm, pnpm, yarn, or bun) and creates the appropriate build specification.

Just commit the generated `amplify.yml` to your repository and deploy!

### Build Settings

Set the custom image environment variable:

```
_CUSTOM_IMAGE=amplify:al2023
```

### Build Specifications (Reference)

The adapter generates these for you, but for reference:

**npm:**
```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
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
      - node_modules/**/*
```

**pnpm:**
```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm i -g pnpm
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
      - .pnpm-store/**/*
```

**yarn:**
```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - yarn install
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
      - node_modules/**/*
```

## Migration from astro-aws-amplify

If you're migrating from the old `astro-aws-amplify` package:

1. Update your dependencies:
   ```bash
   npm uninstall astro-aws-amplify
   npm install amplify-astro-adapter
   ```

2. Update your import:
   ```diff
   - import awsAmplify from 'astro-aws-amplify';
   + import amplify from 'amplify-astro-adapter';
   ```

3. No other changes needed - configuration is the same!

## License

MIT

## Author

Zach Handley <zachhandley@gmail.com>

## Acknowledgements

Extends the official [`@astrojs/node`](https://github.com/withastro/astro/tree/main/packages/integrations/node) adapter with AWS Amplify Hosting deployment configuration.
