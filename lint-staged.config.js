export default {
  '*.{ts,tsx,js,jsx,json,css,md}': (filenames) => {
    const filtered = filenames.filter((f) => !/[/\\]dist[/\\]/.test(f))
    if (filtered.length === 0) return []
    const escaped = filtered.map((f) => JSON.stringify(f)).join(' ')
    return [`biome check --write --no-errors-on-unmatched -- ${escaped}`]
  },
}
