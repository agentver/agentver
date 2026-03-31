import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  entry: {
    index: 'src/index.ts',
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
  noExternal: [
    '@agentver/agent-definitions',
    '@agentver/installer',
    '@agentver/shared',
    '@agentver/storage',
  ],
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
})
