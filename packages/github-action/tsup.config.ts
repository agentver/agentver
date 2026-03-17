import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node20',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: [/@agentver\//, '@actions/core'],
})
