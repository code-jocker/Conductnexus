import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/env.setup.ts'],
    fileParallelism: false,
    // A cold `dropDatabase()` plus seeding every role and permission takes well
    // over a minute on a shared CI runner; a timeout here fails the whole file
    // before a single assertion runs.
    hookTimeout: 180_000,
    testTimeout: 45_000,
  },
})
