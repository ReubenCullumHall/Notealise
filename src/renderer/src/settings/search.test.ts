import { describe, expect, it } from 'vitest'
import { SEARCH_INDEX, searchSettings } from './search'

// What people actually type into the settings search, and the setting that
// has to come FIRST for it. Built on 2026-09-29 from a 180-phrase pass over
// the new search box (Reuben: "test the search box feature for searching for
// settings"), which found fifteen of these landing somewhere wrong — "where
// are my notes" on Notes font, "update" on Date format, "restore" on Reopen
// your tabs, "accessibility" not reaching the easier-reading font at all.
// A keyword dropped in a later edit fails here rather than going unnoticed
// until someone can't find a setting.
const FIRST: [query: string, label: string][] = [
  // the look
  ['dark mode', 'Theme'],
  ['Dark Mode', 'Theme'],
  ['night mode', 'Theme'],
  ['how do i make the app dark', 'Theme'],
  ['oled', 'Theme'],
  ['white text', 'Text colour'],
  ['accent', 'Accent colour'],
  ['colour', 'Accent colour'],
  ['color', 'Accent colour'],
  ['font', 'Interface font'],
  ['how do I change the font', 'Interface font'],
  ['typeface', 'Interface font'],
  ['dyslexia', 'Easier reading font'],
  ['accessibility', 'Easier reading font'],
  ['easier to read', 'Easier reading font'],
  ['lined paper', 'Page look'],
  ['grid', 'Page look'],
  ['tint', 'Tint'],
  ['full width', 'Editor width'],
  ['margins', 'Editor width'],
  ['sidebar', 'Sidebar'],
  ['density', 'Density'],
  ['compact', 'Density'],
  ['folders first', 'Mix notes and folders freely'],
  ['icons only', 'Nav buttons'],
  ['palette', 'Your palette'],
  ['auto colour', 'Colour new folders automatically'],
  ['nested', 'Notes and folders inside a folder'],
  ['backlinks', 'Show a note’s links'],
  ['breadcrumb', 'Show the file path'],
  ['bookmark', 'Show the bookmark'],
  ['favorites', 'Show the bookmark'],
  ['word count', 'Show when it was last edited'],
  ['raw markdown', 'Markdown pro'],
  ['sticky', 'Keep bars on screen while you scroll'],
  ['hide tabs while scrolling', 'Keep bars on screen while you scroll'],
  ['toolbar', 'Shortcuts'],
  ['button edges', 'Stronger button edges'],
  ['advanced', 'Advanced'],
  ['customise', 'Look'],
  ['customize', 'Look'],
  // the app
  ['reopen tabs', 'Reopen your tabs'],
  ['splash', 'Play startup animation'],
  ['reduce motion', 'Interface animations'],
  ['24 hour', 'Date format'],
  ['can i change the date format', 'Date format'],
  ['timezone', 'Time zone'],
  ['decimal', 'Number format'],
  ['confirm delete', 'Check before deleting'],
  ['delete confirmation', 'Check before deleting'],
  ['onboarding', 'Replay the first-run walkthrough'],
  ['privacy', 'Terms and privacy'],
  ['licenses', 'Open source licences'],
  ['text size', 'Text size'],
  ['font size', 'Text size'],
  ['bigger text', 'Text size'],
  ['zoom', 'Text size'],
  // spaces and your collection
  ['new space', 'Add a space'],
  ['rename space', 'Space name'],
  ['emoji', 'Representational emoji'],
  ['delete space', 'Delete a space'],
  ['templates', 'Saved presets'],
  ['download fonts', 'Explore and install more'],
  ['import font', 'Import your own font'],
  // data
  ['where are my notes', 'Where your notes are stored'],
  ['where are my notes stored', 'Where your notes are stored'],
  ['vault', 'Your vault'],
  ['icloud', 'Source folder'],
  ['onedrive', 'Source folder'],
  ['backup', 'Recovery'],
  ['restore', 'Recovery'],
  ['where is the bin', 'Recovery'],
  ['trash', 'Recovery'],
  ['notion', 'Import'],
  ['how do i get my notes from notion', 'Import'],
  ['evernote', 'Import'],
  ['word', 'Import'],
  ['apple notes', 'Import'],
  ['new computer', 'Transfer data'],
  ['export', 'Transfer data'],
  // help and updates
  ['help', 'Tutorials'],
  ['tutorial', 'Tutorials'],
  ['how to link', 'Linking your notes'],
  ['crash', 'Report a bug'],
  ['feedback', 'Report a bug'],
  ['suggest', 'Request a feature'],
  ['update', 'Check for updates'],
  ['upgrade', 'Install updates automatically'],
  // typos
  ['recovry', 'Recovery'],
  ['dakr mode', 'Theme'],
  ['accnet', 'Accent colour'],
  ['fnot', 'Interface font'],
  ['densty', 'Density'],
  ['timezon', 'Time zone']
]

describe('settings search', () => {
  it.each(FIRST)('"%s" finds %s first', (query, label) => {
    expect(searchSettings(query)[0]?.label).toBe(label)
  })

  // A word that only appears inside another word is not a match: "spellcheck"
  // used to find Check before deleting, "password" the word count. There is
  // no setting for either, and saying so beats a wrong answer.
  it.each(['spellcheck', 'password'])('"%s" finds nothing', (query) => {
    expect(searchSettings(query)).toEqual([])
  })

  it('finds nothing for an empty box, or only filler words', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('how do i')).toEqual([])
  })

  // Every setting can be found by its own name. Top three rather than first:
  // "make a tint" drops "make" (people type it in questions), which leaves it
  // level with Tint.
  it.each(SEARCH_INDEX.map((e) => [e.label]))('"%s" finds itself', (label) => {
    const top = searchSettings(label).slice(0, 3).map((e) => e.label)
    expect(top).toContain(label)
  })

  // A result that asks for a fold that doesn't exist lands on a page with the
  // setting still hidden. These are the folds on Look (and on each space) plus
  // General's More — keep in step with SpaceForm.tsx and Settings.tsx.
  it('only asks for folds that exist', () => {
    const folds = new Set(['Page', 'Sidebar', 'Colour', 'Note extras', 'Shortcuts', 'Advanced', 'More'])
    for (const e of SEARCH_INDEX) if (e.disclosure) expect(folds).toContain(e.disclosure)
  })

  it('lists no setting twice', () => {
    const keys = SEARCH_INDEX.map((e) => `${e.section}/${e.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
