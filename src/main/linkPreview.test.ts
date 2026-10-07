import { describe, expect, it } from 'vitest'
import { decodeEntities, decodeHtmlBody, extractTitle, isPublicHost } from './linkPreview'

describe('extractTitle', () => {
  it('prefers the social title, which has no site name tacked on', () => {
    const html = '<head><title>Waves | BBC News</title><meta property="og:title" content="Waves hit the coast"></head>'
    expect(extractTitle(html)).toBe('Waves hit the coast')
  })

  it('reads attributes in either order and either quote', () => {
    expect(extractTitle(`<meta content='A &amp; B' name="twitter:title">`)).toBe('A & B')
  })

  it('falls back to <title>, across lines and with entities', () => {
    expect(extractTitle('<TITLE lang="en">\n  Tides &ndash; a guide\n</TITLE>')).toBe('Tides – a guide')
  })

  it('returns null when there is nothing', () => {
    expect(extractTitle('<html><body>hi</body></html>')).toBeNull()
    expect(extractTitle('<title>   </title>')).toBeNull()
  })

  it('makes the title safe to put between [ and ]', () => {
    expect(extractTitle('<title>Part [2]</title>')).toBe('Part (2)')
  })
})

describe('decodeEntities', () => {
  it('handles named, decimal and hex, and leaves unknowns alone', () => {
    expect(decodeEntities('&amp; &#39; &#x2019; &madeup;')).toBe("& ' ’ &madeup;")
  })

  it('does not choke on an absurd code point', () => {
    expect(decodeEntities('&#99999999999;')).toBe('&#99999999999;')
  })
})

describe('isPublicHost', () => {
  it('says yes to ordinary sites and public addresses', () => {
    for (const h of ['example.com', 'www.bbc.co.uk', '8.8.8.8', '2606:4700:4700::1111', '172.32.0.1', '100.63.0.1'])
      expect(isPublicHost(h), h).toBe(true)
  })

  it('says no to the user’s own machine and network', () => {
    for (const h of [
      'localhost', 'foo.localhost', 'router', 'nas.local', 'printer.lan', 'host.internal',
      '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '0.0.0.0', '100.64.0.1', '224.0.0.1', '[::1]', '::', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', '999.1.1.1', ''
    ])
      expect(isPublicHost(h), h).toBe(false)
  })

  // The seam: what the guard is given is `new URL(...).hostname`, and the parser
  // rewrites an IPv4-in-IPv6 address into hex groups (`::ffff:7f00:1`) — a form the
  // dotted spellings above never exercise. Every spelling of "this machine" or "my
  // network" must come out private after the parser has had its say.
  it('still says no once the URL parser has rewritten the address', () => {
    for (const u of [
      'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:192.168.1.1]/',
      'http://[::ffff:a00:1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://[::127.0.0.1]/',
      'http://[64:ff9b::7f00:1]/', 'http://[fec0::1]/', 'http://[ff02::1]/', 'http://[fe80::1%25en0]/',
      'http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://[::1]:8080/'
    ]) {
      let host = ''
      try {
        host = new URL(u).hostname
      } catch {
        continue // not an address the parser accepts, so nothing can be fetched from it
      }
      expect(isPublicHost(host), `${u} -> ${host}`).toBe(false)
    }
  })

  it('still says yes to a public address in an IPv6 coat', () => {
    expect(isPublicHost(new URL('http://[::ffff:8.8.8.8]/').hostname)).toBe(true)
    expect(isPublicHost(new URL('http://[2606:4700:4700::1111]/').hostname)).toBe(true)
  })

  it('says no to something that is not an address at all', () => {
    for (const h of ['1:2:3', ':::', '1::2::3', 'g::1', '::ffff:1.2.3.999', '1:2:3:4:5:6:7:8:9']) expect(isPublicHost(h), h).toBe(false)
  })
})

describe('decodeHtmlBody', () => {
  const latin1 = (s: string): Buffer => Buffer.from(s, 'latin1')

  it('reads UTF-8 by default, BOM and all', () => {
    expect(decodeHtmlBody(Buffer.from('\ufeff<title>Café – ok</title>', 'utf8'), 'text/html')).toBe('<title>Café – ok</title>')
  })

  it('follows the header, then the page', () => {
    expect(decodeHtmlBody(latin1('<title>Café</title>'), 'text/html; charset=iso-8859-1')).toBe('<title>Café</title>')
    expect(decodeHtmlBody(latin1('<meta charset="ISO-8859-1"><title>Café</title>'), 'text/html')).toContain('Café')
    expect(decodeHtmlBody(latin1('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>“Hi”</title>'.replace('“', '\x93').replace('”', '\x94')), 'text/html')).toContain('“Hi”')
  })

  it('does not fail on an encoding it has never heard of', () => {
    expect(decodeHtmlBody(Buffer.from('<title>Hi</title>'), 'text/html; charset=klingon-9')).toBe('<title>Hi</title>')
  })
})
