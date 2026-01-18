# amplify-astro-adapter

AWS Amplify adapter for Astro with built-in cookie-based sessions.

## Features

- Astro 4.x and 5.x support
- **Cookie-based sessions** - Zero config, works with serverless
- **Auto-generates `amplify.yml`** - Detects your package manager
- **envGetSecret** support for type-safe environment variables
- Configurable Node.js runtime (nodejs20.x, nodejs22.x)

## Installation

```bash
npm install amplify-astro-adapter
# or
pnpm add amplify-astro-adapter
# or
yarn add amplify-astro-adapter
```

## Quick Start

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import amplify from 'amplify-astro-adapter';

export default defineConfig({
  output: 'server',
  adapter: amplify()
});
```

That's it! Sessions and middleware are configured automatically.

## Configuration Options

```js
export default defineConfig({
  output: 'server',
  adapter: amplify({
    runtime: 'nodejs20.x' // or 'nodejs22.x'
  })
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runtime` | `'nodejs20.x' \| 'nodejs22.x'` | `'nodejs20.x'` | Node.js runtime for AWS Lambda |

## Sessions

Sessions are **enabled by default** with zero configuration. Data is stored in encrypted HTTP-only cookies.

### Environment Variable

Set a session secret for encryption (32+ characters):

```bash
AMPLIFY_SESSION_PASSWORD=your-32-character-or-longer-secret
```

> In development, a secret is auto-generated. **Always set this in production.**

### Using Sessions

```astro
---
// src/pages/dashboard.astro
const username = await Astro.session?.get('username');
---

<h1>Welcome {username}!</h1>
```

### API Routes

```ts
// src/pages/api/login.ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ session, request, redirect }) => {
  const formData = await request.formData();
  const username = formData.get('username') as string;

  session?.set('username', username);

  return redirect('/');
};
```

```ts
// src/pages/api/logout.ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ session, redirect }) => {
  await session?.destroy();
  return redirect('/');
};
```

### Custom Session Configuration

```js
import { defineConfig } from 'astro/config';
import amplify from 'amplify-astro-adapter';
import { createCookieSessionDriver } from 'amplify-astro-adapter/session';

export default defineConfig({
  output: 'server',
  adapter: amplify(),
  session: {
    driver: createCookieSessionDriver({
      password: process.env.AMPLIFY_SESSION_PASSWORD,
      ttl: 86400, // 1 day in seconds
      cookieOptions: {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      }
    })
  }
});
```

### Session Limitations

- **4KB per cookie** - Large sessions auto-chunk across multiple cookies
- **Client-stored** - Encrypted, but don't store sensitive server-only data

## AWS Amplify Hosting

### amplify.yml Auto-Generation

On first build, the adapter generates `amplify.yml` for your package manager. Just commit it and deploy!

### Build Settings

Set the custom image environment variable in Amplify Console:

```
_CUSTOM_IMAGE=amplify:al2023
```

## envGetSecret Support

```ts
import { getSecret } from 'astro:env/server';

const apiKey = await getSecret('API_KEY');
```

## Migration from astro-aws-amplify

```bash
npm uninstall astro-aws-amplify
npm install amplify-astro-adapter
```

```diff
- import awsAmplify from 'astro-aws-amplify';
+ import amplify from 'amplify-astro-adapter';
```

## Package Exports

| Export | Description |
|--------|-------------|
| `amplify-astro-adapter` | Main adapter function |
| `amplify-astro-adapter/session` | Session driver for custom configuration |

## License

MIT

## Author

Zach Handley <zachhandley@gmail.com>
