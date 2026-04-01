export function sanitiseRedirectUrl(input: string | null | undefined): string {
  if (!input) {
    return '/'
  }

  try {
    const parsed = new URL(input, 'https://placeholder.invalid')
    if (parsed.origin !== 'https://placeholder.invalid') return '/'
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return '/'
  }
}
