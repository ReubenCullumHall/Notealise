import { describe, expect, it } from 'vitest'
import { cleanTitle, PLAYER_HOSTS, parseVideoUrl, singleWebUrl } from './embeds'

describe('parseVideoUrl', () => {
  it('reads every common YouTube shape', () => {
    const id = 'dQw4w9WgXcQ'
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&feature=share`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`
    ]) {
      const v = parseVideoUrl(url)
      expect(v?.provider, url).toBe('youtube')
      expect(v?.id, url).toBe(id)
    }
  })

  it('carries a start time into the player', () => {
    const v = parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')
    expect(v?.embedUrl).toContain('&start=90')
    expect(v?.watchUrl).toContain('&t=90s')
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=42')?.embedUrl).toContain('&start=42')
  })

  it('reads Vimeo, including an unlisted video', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789')?.id).toBe('123456789')
    expect(parseVideoUrl('https://vimeo.com/channels/staffpicks/123456789')?.id).toBe('123456789')
    expect(parseVideoUrl('https://player.vimeo.com/video/123456789')?.id).toBe('123456789')
    const unlisted = parseVideoUrl('https://vimeo.com/123456789/abcdef1234')
    expect(unlisted?.embedUrl).toBe('https://player.vimeo.com/video/123456789?autoplay=1&h=abcdef1234')
  })

  it('says no to anything that is not one video', () => {
    for (const url of [
      'https://www.youtube.com/',
      'https://www.youtube.com/@somechannel',
      'https://www.youtube.com/playlist?list=PL12345678901',
      'https://www.youtube.com/results?search_query=waves',
      'https://www.youtube.com/watch?v=short',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://vimeo.com/channels/staffpicks',
      'https://example.com/123456789',
      'ftp://youtu.be/dQw4w9WgXcQ',
      'not a url'
    ]) {
      expect(parseVideoUrl(url), url).toBeNull()
    }
  })

  it('only ever points a player at a host the CSP allows', () => {
    for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/123456789']) {
      const host = new URL(parseVideoUrl(url)!.embedUrl).hostname
      expect(PLAYER_HOSTS as readonly string[]).toContain(host)
    }
  })
})

describe('singleWebUrl', () => {
  it('takes one address, trimmed', () => {
    expect(singleWebUrl('  https://example.com/a?b=1#c\n')).toBe('https://example.com/a?b=1#c')
  })

  it('leaves a sentence or several addresses alone', () => {
    expect(singleWebUrl('see https://example.com')).toBeNull()
    expect(singleWebUrl('https://a.example https://b.example')).toBeNull()
    expect(singleWebUrl('https://a.example\nhttps://b.example')).toBeNull()
  })

  it('ignores everything that is not a web address', () => {
    for (const t of ['', 'example.com', 'mailto:a@b.co', 'file:///etc/passwd', 'javascript:alert(1)', 'https://', 'https://nodot']) {
      expect(singleWebUrl(t), t).toBeNull()
    }
  })
})

describe('cleanTitle', () => {
  it('flattens what would break a markdown link', () => {
    expect(cleanTitle('Waves\n  hit the [coast]')).toBe('Waves hit the (coast)')
    expect(cleanTitle('back\\slash')).toBe('backslash')
  })

  it('drops emphasis stars and backticks, but not a star that is just a star', () => {
    expect(cleanTitle('*Star Wars* and **more**')).toBe('Star Wars and more')
    expect(cleanTitle('Use `npm run dev` now')).toBe('Use npm run dev now')
    expect(cleanTitle('5 * 3 * 2')).toBe('5 * 3 * 2')
  })

  it('caps a runaway title', () => {
    const out = cleanTitle('x'.repeat(400))
    expect(out.length).toBe(140)
    expect(out.endsWith('…')).toBe(true)
  })
})
