import type { Metadata } from 'next'
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from 'next/font/google'
import { Footer } from '@/components/footer'
import { GoogleAnalytics } from '@/components/google-analytics'
import { Nav } from '@/components/nav'
import './globals.css'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Agentver - The GitHub for AI Agents',
    template: '%s | Agentver',
  },
  description:
    'Open-source version control for AI agent skills, plugins, configs, and prompts. One CLI, 43+ agents, zero lock-in.',
  icons: {
    icon: '/favicon.png',
  },
  openGraph: {
    title: 'Agentver - The GitHub for AI Agents',
    description:
      'Open-source version control for AI agent skills. One CLI, 43+ agents, zero lock-in.',
    url: 'https://agentver.com',
    siteName: 'Agentver',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@agentver_',
    title: 'Agentver — The GitHub for AI Agents',
    description:
      'Open-source version control for AI agent skills. One CLI, 43+ agents, zero lock-in.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-GB"
      className={`${dmSans.variable} ${jetbrainsMono.variable} ${bricolage.variable}`}
    >
      <body className="bg-background font-sans text-foreground antialiased">
        <GoogleAnalytics />
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  )
}
