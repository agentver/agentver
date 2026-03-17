import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

export const alt = 'Agentver — The GitHub for AI Agents'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const url = new URL('https://fonts.googleapis.com/css2')
  url.searchParams.set('family', `${family}:wght@${weight}`)
  url.searchParams.set('display', 'swap')

  const css = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1',
    },
  }).then((res) => res.text())

  const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)
  if (!match?.[1]) throw new Error(`Could not load font: ${family}`)

  return fetch(match[1]).then((res) => res.arrayBuffer())
}

export default async function Image() {
  const [logoData, displayFont, bodyFont] = await Promise.all([
    readFile(join(process.cwd(), 'public', 'logo.png')),
    loadGoogleFont('Bricolage Grotesque', 700),
    loadGoogleFont('DM Sans', 500),
  ])

  const logoSrc = `data:image/png;base64,${logoData.toString('base64')}`

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: '#fefdfb',
        padding: '60px',
      }}
    >
      <img src={logoSrc} width={140} height={110} alt="" />

      <div
        style={{
          display: 'flex',
          fontFamily: 'Bricolage Grotesque',
          fontSize: 68,
          fontWeight: 700,
          marginTop: 20,
          letterSpacing: '-1px',
        }}
      >
        <span style={{ color: '#1a1a30' }}>agent</span>
        <span style={{ color: '#2d9b7d' }}>ver</span>
      </div>

      <div
        style={{
          display: 'flex',
          fontFamily: 'DM Sans',
          fontSize: 28,
          color: '#7b7b8e',
          marginTop: 12,
          fontWeight: 500,
        }}
      >
        The GitHub for AI Agents
      </div>

      <div
        style={{
          display: 'flex',
          fontFamily: 'DM Sans',
          fontSize: 17,
          color: '#9b9bae',
          marginTop: 36,
          letterSpacing: '2px',
          fontWeight: 500,
          textTransform: 'uppercase',
        }}
      >
        agentver.com
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Bricolage Grotesque', data: displayFont, weight: 700 },
        { name: 'DM Sans', data: bodyFont, weight: 500 },
      ],
    }
  )
}
