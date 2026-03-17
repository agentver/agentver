const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 0) return 'just now'

  if (diff < MINUTE) return 'just now'
  if (diff < 2 * MINUTE) return '1 minute ago'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} minutes ago`
  if (diff < 2 * HOUR) return '1 hour ago'
  if (diff < DAY) return `${Math.floor(diff / HOUR)} hours ago`
  if (diff < 2 * DAY) return '1 day ago'
  if (diff < WEEK) return `${Math.floor(diff / DAY)} days ago`
  if (diff < 2 * WEEK) return '1 week ago'
  if (diff < MONTH) return `${Math.floor(diff / WEEK)} weeks ago`
  if (diff < 2 * MONTH) return '1 month ago'
  if (diff < YEAR) return `${Math.floor(diff / MONTH)} months ago`
  if (diff < 2 * YEAR) return '1 year ago'

  return `${Math.floor(diff / YEAR)} years ago`
}
