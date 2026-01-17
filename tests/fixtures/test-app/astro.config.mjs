import { defineConfig } from 'astro/config';
import amplify from 'amplify-astro-adapter';

export default defineConfig({
  output: 'server',
  adapter: amplify(),
});
