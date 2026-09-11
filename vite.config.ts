import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/crypto-lab-proof-tally/',
  test: {
    include: ['src/**/*.test.ts'],
  },
})