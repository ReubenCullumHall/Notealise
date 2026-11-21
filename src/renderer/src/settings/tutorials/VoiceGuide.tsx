import { Card, Cards, Code, Face, Heading, Text, Tips } from './parts'
import { practiceText } from './tryIt'

// Settings → Help → Tutorials → Voice notes.
//
// The words are the website's (site/tutorials/voice.html), card for card:
// change one, change the other. Tried in a real build on 2026-11-20: opening the
// recorder, the / list, opening the mixer and the cassette player, the voice
// note's right-click menu. Described from the code or changelog, NOT tried:
// recording, Mark, the sidebar recording card, adding a file by picker, drag or
// paste, the player moving to the sidebar, the ↗ button, clicking a mark or a
// moment link, copying and pasting a moment link (the test link was typed),
// zoom, the skip-length menu, rename, the keyboard play/pause key, every Try it.
// Each new guide has only been opened in the :5173 preview, not a real window.
// No real iPhone. Not tried on Windows.

/** The start of every ask that needs a voice note to work on: the practice
 *  note can't carry a recording, so the card has you make one first. */
const RECORD_FIRST = 'Type `/voice` on the empty line below, press Enter and record a few seconds, then '

export function VoiceGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Voice notes</Heading>
      <Text>
        A voice note is a recording that sits in your note as its own block. It starts from the{' '}
        <Code className="text-ink-700">/</Code> menu.
      </Text>

      <Heading>Recording</Heading>
      <Cards>
        <Card
          type="/voice"
          title="Record"
          tryIt={practiceText('Record', 'Type `/voice` on the empty line below, press Enter, then Start recording.')}
          shows={<Face icon="mic">Start recording</Face>}
        >
          Press <Code>Enter</Code>, then Start recording — the microphone only turns on then. Stop puts the recording in
          the note.
        </Card>

        <Card
          type="Ctrl/Cmd + Shift + M"
          title="Mark a moment"
          tryIt={practiceText(
            'Mark a moment',
            'Type `/voice` on the empty line below, press Enter, Start recording, then press Ctrl/Cmd + Shift + M.'
          )}
          shows={<Face>▶ 0:07 · ▶ 0:18</Face>}
        >
          Press it while you record, or press Mark, at anything you will want to find again. The marks sit under the
          voice note — click one to play from there.
        </Card>

        <Card
          type="Voice note from a file"
          title="A recording you already have"
          tryIt={practiceText(
            'A recording you already have',
            'Type `/voice` on the empty line below and pick Voice note from a file.'
          )}
          shows={<Face icon="mic">Voice note from a file</Face>}
        >
          Pick it from the <Code>/</Code> menu, or drag or paste the recording straight into the note — from Voice
          Memos, Windows Voice Recorder, WhatsApp and the like.
        </Card>
      </Cards>

      <Heading>Listening</Heading>
      <Cards>
        <Card
          type="The mixer button"
          title="Volume, tone and speed"
          tryIt={practiceText('Volume, tone and speed', RECORD_FIRST + 'press the last button on the voice note.')}
          shows={<Face icon="sliders">Volume · Tone · Speed</Face>}
        >
          The last button on the voice note. Volume goes up to 200% for quiet recordings, Tone runs from warmer to
          brighter, and Speed from half to three times as fast without the voice going squeaky. The voice note
          remembers what you set.
        </Card>

        <Card
          type="The cassette button"
          title="Keep listening in another note"
          tryIt={practiceText(
            'Keep listening in another note',
            RECORD_FIRST + 'press the cassette button in the bottom-right corner of the note.'
          )}
          shows={<Face icon="cassette">Lecture 5</Face>}
        >
          It sits in the bottom-right corner of any note with a voice note in it. Play from there and switch to another
          tab — the player moves to the sidebar. <Code>↗</Code> takes you back to the voice note.
        </Card>

        <Card
          type="Copy link to 0:12"
          title="Link to a moment"
          tryIt={practiceText(
            'Link to a moment',
            RECORD_FIRST + 'right-click the waveform, choose Copy link to …, and paste it on a new line.'
          )}
          shows={<Face>▶ Lecture 5 · 0:12</Face>}
        >
          Right-click the waveform where it should start, choose Copy link to …, and paste it into any note. Clicking the
          link plays the voice note from there, opening its note first if it is somewhere else.
        </Card>
      </Cards>

      <Tips lead="Getting around a long recording:">
        <p>
          <Code className="text-ink-500">Cmd</Code>-click the waveform (<Code className="text-ink-500">Ctrl</Code>
          -click on Windows) to zoom in where you clicked; add <Code className="text-ink-500">Shift</Code> to step back
          out.
        </p>
        <p>Right-click either skip button to choose how far it jumps: 5, 10, 15 or 30 seconds, or 1 minute.</p>
        <p>Right-click a voice note and choose Rename voice note… to give it a name.</p>
        <p>Your keyboard&rsquo;s play/pause key plays and pauses the voice note that&rsquo;s playing.</p>
      </Tips>
    </>
  )
}
