import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    agentver: 'bin/agentver.ts',
  },
  format: 'esm',
  target: 'node20',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: ['@agentver/agent-definitions', '@agentver/shared'],
})
