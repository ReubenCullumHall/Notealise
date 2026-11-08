import { describe, expect, it } from 'vitest'
import { separateBlocks } from './separateBlocks'

const A = '<audio controls src="a.m4a" data-name="Untitled 1"></audio>'
const B = '<audio controls src="b.m4a" data-name="Take 1"></audio>'
const V = '<video controls src="clip.mp4"></video>'

describe('separateBlocks — stuck blocks go back on their own lines when a note opens', () => {
  it('two voice notes on one line (the "Action plan" note, 2026-11-07)', () => {
    expect(separateBlocks(`${A}${B}\n\nText`)).toBe(`${A}\n${B}\n\nText`)
  })
  it('words typed onto a voice note’s line go on the line above it', () => {
    expect(separateBlocks(`test${A}\nBelow`)).toBe(`test\n${A}\nBelow`)
  })
  it('words after it go on the line below', () => {
    expect(separateBlocks(`${A} and then`)).toBe(`${A}\nand then`)
  })
  it('a voice note, words, a video — each on its own line, in order', () => {
    expect(separateBlocks(`${A} middle ${V}`)).toBe(`${A}\nmiddle\n${V}`)
  })
  it('a line of nothing but pictures puts each on its own line', () => {
    expect(separateBlocks('![](a.png) ![](b.png)')).toBe('![](a.png)\n![](b.png)')
  })
  it('keeps the indent of a block inside a list item', () => {
    expect(separateBlocks(`- item\n  ${A}${B}`)).toBe(`- item\n  ${A}\n  ${B}`)
  })
  it('a voice note after a list marker is still the list item', () => {
    expect(separateBlocks(`- ${A}${B}`)).toBe(`- ${A}\n  ${B}`)
  })

  // Nothing to do — null, so the note is not rewritten or marked changed.
  it('a note with every block already on its own line is left alone', () => {
    expect(separateBlocks(`Top\n${A}\n${B}\n\n${V}\n![](a.png)\nEnd`)).toBeNull()
  })
  it('a picture inside a sentence is ordinary Markdown and stays where it is', () => {
    expect(separateBlocks('See ![](a.png) here, and ![](b.png).')).toBeNull()
  })
  it('a single voice note in a list item stays', () => {
    expect(separateBlocks(`- [ ] ${A}`)).toBeNull()
  })
  it('never touches code — fenced or in backticks', () => {
    expect(separateBlocks('```html\n' + `${A}${B}` + '\n```')).toBeNull()
    expect(separateBlocks(`Write \`${A}${B}\` to embed`)).toBeNull()
  })
  it('never touches a quote, or a tag inside other HTML', () => {
    expect(separateBlocks(`> ${A}${B}`)).toBeNull()
    expect(separateBlocks(`<div>${A}</div>`)).toBeNull()
  })
  it('never touches the properties at the top', () => {
    expect(separateBlocks(`---\nvoice: ${A}${B}\n---\nText`)).toBeNull()
  })
  it('a fence left open runs to the end, and nothing inside it moves', () => {
    expect(separateBlocks('```\n' + `${A}${B}`)).toBeNull()
  })
  it('only the stuck line changes; everything around it is kept byte for byte', () => {
    const before = `# Title\n\n  indented text  \n${A}${B}\n\n\n| a | b |\n| - | - |\n`
    expect(separateBlocks(before)).toBe(`# Title\n\n  indented text  \n${A}\n${B}\n\n\n| a | b |\n| - | - |\n`)
  })
  it('running it twice changes nothing the second time', () => {
    const once = separateBlocks(`x${A}${B}y`)!
    expect(separateBlocks(once)).toBeNull()
  })
})
