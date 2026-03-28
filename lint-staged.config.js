export default {
  '*.{ts,tsx,js,jsx,json,css,md}': (filenames) => {
    const filtered = filenames.filter((f) => !/[/\\]dist[/\\]/.test(f))
    if (filtered.length === 0) return []
    return [`biome check --write --no-errors-on-unmatched ${filtered.join(' ')}`]
  },
}
