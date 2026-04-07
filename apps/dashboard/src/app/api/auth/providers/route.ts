import { NextResponse } from 'next/server'

export type SocialProviders = {
  github: boolean
  google: boolean
}

export function GET(): NextResponse<SocialProviders> {
  return NextResponse.json({
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  })
}
