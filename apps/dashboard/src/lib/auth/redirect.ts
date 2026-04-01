export function sanitiseRedirectUrl(input: string | null | undefined): string {
  if (!input) {
    return '/'
  }

  if (!input.startsWith('/') || input.startsWith('//')) {
    return '/'
  }

  return input
}
