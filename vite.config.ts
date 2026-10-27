import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the built site works from any folder: the root of a domain,
  // or a project page such as https://user.github.io/ArtiLife/.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
