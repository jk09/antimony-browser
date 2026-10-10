import { describe, expect, it } from 'vitest'
import { ImportFileError, parseCsv, parseEdgeCsv, parseTime } from './edge-csv'

const NOW = Date.parse('2026-10-10T12:00:00Z')

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, embedded newlines and CRLF', () => {
    const text = 'a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",z\r\n\r\n'
    expect(parseCsv(text, ',')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['line\nbreak', 'z'],
    ])
  })

  it('keeps empty fields and a last record without a newline', () => {
    expect(parseCsv('a,,c\n,,', ',')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })
})

describe('parseTime', () => {
  it('reads ISO, SQL-style (UTC), epoch and WebKit times', () => {
    const expected = Date.parse('2026-10-09T08:30:15Z')
    expect(parseTime('2026-10-09T08:30:15Z', NOW)).toBe(expected)
    expect(parseTime('2026-10-09T10:30:15+02:00', NOW)).toBe(expected)
    expect(parseTime('2026-10-09 08:30:15', NOW)).toBe(expected)
    expect(parseTime(String(expected / 1000), NOW)).toBe(expected)
    expect(parseTime(String(expected), NOW)).toBe(expected)
    expect(parseTime(String(expected * 1000), NOW)).toBe(expected)
    expect(parseTime(String((expected + 11_644_473_600_000) * 1000), NOW)).toBe(expected)
    expect(parseTime('Fri, 09 Oct 2026 08:30:15 GMT', NOW)).toBe(expected)
  })

  it('rejects unreadable times and clamps the future to now', () => {
    expect(parseTime('', NOW)).toBeNull()
    expect(parseTime('yesterday', NOW)).toBeNull()
    expect(parseTime('42', NOW)).toBeNull()
    expect(parseTime('2030-01-01T00:00:00Z', NOW)).toBe(NOW)
  })
})

describe('parseEdgeCsv', () => {
  it('finds columns by name in any order, with a BOM and aliases', () => {
    const csv =
      '\uFEFFTitle,Last Visit Time,URL,Visit count\n' +
      'Example,2026-10-09T08:30:15Z,https://example.com/a,3\n'
    expect(parseEdgeCsv(csv, NOW)).toEqual({
      rows: [
        { url: 'https://example.com/a', title: 'Example', at: Date.parse('2026-10-09T08:30:15Z') },
      ],
      total: 1,
      invalid: 0,
      unsupported: 0,
    })
  })

  it('reads semicolon-separated files and works without a title column', () => {
    const csv = 'address;visited\nhttps://a.example/;2026-10-09 08:00:00\n'
    const parsed = parseEdgeCsv(csv, NOW)
    expect(parsed.rows).toEqual([
      { url: 'https://a.example/', title: '', at: Date.parse('2026-10-09T08:00:00Z') },
    ])
  })

  it('counts rows it cannot use instead of failing', () => {
    const csv = [
      'url,title,visit time',
      'https://ok.example/,Ok,2026-10-09T08:00:00Z',
      'edge://settings,Settings,2026-10-09T08:00:01Z',
      'file:///C:/a.txt,File,2026-10-09T08:00:02Z',
      'not a url,Bad,2026-10-09T08:00:03Z',
      'https://nope.example/,No time,never',
      '',
    ].join('\n')
    const parsed = parseEdgeCsv(csv, NOW)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed).toMatchObject({ total: 5, invalid: 2, unsupported: 2 })
  })

  it('clips long titles', () => {
    const csv = `url,title,time\nhttps://a.example/,${'x'.repeat(900)},2026-10-09T08:00:00Z\n`
    expect(parseEdgeCsv(csv, NOW).rows[0]!.title).toHaveLength(500)
  })

  it('rejects files that are not a browsing-data export, naming what it found', () => {
    expect(() => parseEdgeCsv('', NOW)).toThrow(ImportFileError)
    expect(() => parseEdgeCsv('name,username,password\na,b,c\n', NOW)).toThrow(
      /needs an address and a visit-time column, found name, username, password/,
    )
    expect(() => parseEdgeCsv('url,title\nhttps://a.example/,A\n', NOW)).toThrow(ImportFileError)
  })
})
