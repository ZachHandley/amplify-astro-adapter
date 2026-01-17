# amplify-astro-adapter

AWS Amplify adapter for Astro. Extends `@astrojs/node` with Amplify Hosting deployment configuration.

## Version 0.1.0

This adapter is based on `@astrojs/node` architecture, adding AWS Amplify-specific deployment features and cookie-based session support.

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

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runtime` | `'nodejs20.x' \| 'nodejs22.x'` | `'nodejs20.x'` | Node.js runtime for AWS Lambda |
| `experimentalDisableStreaming` | `boolean` | `false` | Disable HTML streaming (useful for Lambda response constraints) |
| `experimentalStaticHeaders` | `boolean` | `false` | Enable static header file processing (`_headers.json`) |
| `experimentalErrorPageHost` | `string \| URL` | - | Custom host for fetching prerendered error pages |

```js
// Advanced configuration example
export default defineConfig({
  output: 'server',
  adapter: amplify({
    runtime: 'nodejs22.x',
    experimentalDisableStreaming: true,
    experimentalStaticHeaders: false,
    experimentalErrorPageHost: 'https://errors.example.com',
  })
});
```

### Server Modes

The adapter supports two server modes (inherited from `@astrojs/node`):

- **`standalone`** (default) - Auto-starts an HTTP server, serves static files, handles all requests. Used by AWS Amplify Lambda.
- **`middleware`** - Exports a handler for integration with Express, Fastify, or other Node.js frameworks.

## Sessions

This adapter includes built-in cookie-based session support as the **default Astro session driver**. No external session storage (Redis, DynamoDB, etc.) is needed - sessions are stored in HTTP-only cookies and work immediately with AWS Lambda.

### Key Features

- **Zero configuration** - Cookie sessions are enabled by default
- **Encrypted with iron-session** - Session data is securely encrypted
- **Automatic chunking** - Large sessions are automatically split across multiple cookies
- **No external dependencies** - No Redis, DynamoDB, or other storage required

### Environment Variable

Set a session secret for encryption (32+ characters recommended):

```bash
SESSION_SECRET=your-32-character-or-longer-secret
```

> **Note:** If `SESSION_SECRET` is not set, a default secret is used in development. Always set a secure secret in production.

### Auto-Configuration

Sessions are automatically enabled when you use this adapter (no configuration needed):

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import amplify from 'amplify-astro-adapter';

export default defineConfig({
  output: 'server',
  adapter: amplify(),
  session: {
    // Cookie session is the default - no driver config needed!
    // Or explicitly:
    // driver: 'amplify-astro-adapter/session',
  },
});
```

### Custom Session Options

If you want to customize the session behavior, you can manually configure it:

```js
import { defineConfig } from 'astro/config';
import amplify from 'amplify-astro-adapter';
import { createSessionStorage } from 'amplify-astro-adapter/session';

export default defineConfig({
  adapter: amplify({ runtime: 'nodejs20.x' }),
  session: createSessionStorage({
    prefix: 'myapp_session',
    cookie: {
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
    }
  })
});
```

### Using Sessions in Pages

Access sessions directly in `.astro` files:

```astro
---
// src/pages/dashboard.astro
const session = await Astro.session;
const user = await session?.get('user');
await session?.set('lastVisit', new Date().toISOString());
---

<html>
  <body>
    {user ? (
      <h1>Welcome back, {user.name}!</h1>
    ) : (
      <a href="/login">Please log in</a>
    )}
  </body>
</html>
```

### Using Sessions in API Routes

```ts
// src/pages/api/session.ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ session }) => {
  // Set session data
  await session?.set('userId', '123');
  await session?.set('cart', ['item1', 'item2']);

  return Response.json({ success: true });
};

export const GET: APIRoute = async ({ session }) => {
  // Get session data
  const userId = await session?.get('userId');
  const cart = await session?.get('cart') ?? [];

  return Response.json({ userId, cart });
};

export const DELETE: APIRoute = async ({ session }) => {
  // Destroy session
  await session?.delete('userId');
  // or destroy entire session:
  await session?.destroy();

  return Response.json({ success: true });
};
```

### Direct Cookie Helpers (Bypass Astro Sessions)

For simple cases where you don't need the full Astro session API, you can use the helper functions directly:

```ts
import type { APIRoute } from 'astro';
import { getSession, setSession, destroySession } from 'amplify-astro-adapter/session';

export const POST: APIRoute = async ({ cookies }) => {
  await setSession(cookies, { userId: '123', cart: ['item1', 'item2'] });
  return Response.json({ success: true });
};

export const GET: APIRoute = async ({ cookies }) => {
  const session = await getSession(cookies);
  return Response.json({ session });
};

export const DELETE: APIRoute = async ({ cookies }) => {
  await destroySession(cookies);
  return Response.json({ success: true });
};
```

### Middleware Integration

To make sessions available automatically across your app, add this to your `src/env.d.ts`:

```typescript
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /**
     * Session data automatically available in middleware and pages
     */
    session?: import('amplify-astro-adapter/session').SessionData;
  }
}
```

Then create `src/middleware.ts`:

```ts
import { defineMiddleware } from 'astro:middleware';
import { getSession } from 'amplify-astro-adapter/session';

export const onRequest = defineMiddleware(async (context) => {
  // Load session into context.locals
  context.locals.session = await getSession(context.cookies);

  // Session is now automatically available in all pages
  return next();
});
```

Access the session in components:

```astro
---
// Session is automatically available via Astro.locals
const userId = Astro.locals.session?.userId;
---
<h1>Welcome {userId}</h1>
```

### Session Limitations

- **4KB size limit** per cookie (browsers support ~50+ cookies = ~200KB total)
- **Client-stored** - data can be viewed by the user (use httpOnly for XSS protection)
- **Cannot invalidate** before expiration (delete the cookie to invalidate)

**What fits in 4KB:**
- User IDs, auth tokens
- Shopping cart contents
- User preferences
- Session metadata

**What doesn't fit:**
- Large file uploads
- Extensive logging data
- Large datasets

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

## Package Exports

The adapter provides multiple entry points:

| Export | Description |
|--------|-------------|
| `amplify-astro-adapter` | Main adapter function |
| `amplify-astro-adapter/server` | Server runtime (used internally by Astro) |
| `amplify-astro-adapter/session` | Session driver and helpers |
| `amplify-astro-adapter/middleware` | Cookie context middleware (used internally) |

## License

MIT

## Author

Zach Handley <zachhandley@gmail.com>

## Acknowledgements

Extends the official [`@astrojs/node`](https://github.com/withastro/astro/tree/main/packages/integrations/node) adapter with AWS Amplify Hosting deployment configuration.
