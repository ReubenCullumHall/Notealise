import { Card, Cards, Code, Face, Heading, Text, Tips } from './parts'
import { practiceText } from './tryIt'

// Settings → Help → Tutorials → Editing and transcribing.
//
// The words are the website's (site/tutorials/voice-editing.html), card for
// card: change one, change the other. Tried in a real build on 2026-11-20:
// Transcribe, and in the clip editor trim, select, delete, split and Remove
// silences. Described from the code or changelog, NOT tried: Keep only this,
// moving or deleting sections, Speed, Save, Save as new clip, the More accurate
// download and Remove, every Try it.
// Each new guide has only been opened in the :5173 preview, not a real window.
// No real iPhone. Not tried on Windows.
// "Edit by the words" is left out on purpose — it is not released yet.

const RECORD_FIRST = 'Type `/voice` on the empty line below, press Enter and record a few seconds, then '

export function VoiceEditGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Editing and transcribing</Heading>
      <Text>
        Both start from the voice note itself: Transcribe sits under it, and the scissors open the editor.
      </Text>

      <Heading>Words</Heading>
      <Cards>
        <Card
          type="Transcribe"
          title="Turn it into text"
          tryIt={practiceText('Turn it into text', RECORD_FIRST + 'press Transcribe under it.')}
          shows={<Face icon="text">Transcribe</Face>}
        >
          Press it under the voice note, or right-click the voice note and choose Transcribe. The words appear under it
          in a fold you can open and shut. It all happens on your computer — nothing is sent online — and it finds the
          language by itself.
        </Card>

        <Card
          type="Settings → Extra features"
          title="More accurate words"
          shows={<Face>Download · 550 MB</Face>}
        >
          More accurate transcription downloads a bigger speech model once, for fewer wrong words — especially outside
          English. Remove switches back.
        </Card>
      </Cards>

      <Heading>Editing the recording</Heading>
      <Cards>
        <Card
          type="The scissors"
          title="Trim the ends"
          tryIt={practiceText('Trim the ends', RECORD_FIRST + 'press the scissors on it.')}
          shows={<Face icon="scissors">Edit clip</Face>}
        >
          Press the scissors on the voice note, or right-click it and choose Edit clip…. Drag the dark handle at either
          end of the waveform inwards.
        </Card>

        <Card
          type="Drag across the waveform"
          title="Take out a stretch"
          tryIt={practiceText(
            'Take out a stretch',
            RECORD_FIRST + 'press the scissors, drag across part of the waveform and press Backspace.'
          )}
          shows={<Face>Delete · Keep only this</Face>}
        >
          Press <Code>Backspace</Code> or <Code>Delete</Code> and the gap closes up. Keep only this keeps just the
          stretch you chose.
        </Card>

        <Card
          type="S"
          title="Split into sections"
          tryIt={practiceText(
            'Split into sections',
            RECORD_FIRST + 'press the scissors, click the waveform where you want the cut and press S.'
          )}
          shows={<Face>Section 1 · Section 2</Face>}
        >
          Cuts the recording in two where the playhead is (<Code>Ctrl/Cmd + B</Code> does the same). Each section has
          six dots to move it and a <Code>×</Code> to delete it.
        </Card>

        <Card
          type="Remove silences"
          title="Remove silences"
          tryIt={practiceText(
            'Remove silences',
            RECORD_FIRST + 'press the scissors, then Remove silences.'
          )}
          shows={<Face>Shortened 3 pauses to a breath</Face>}
        >
          Every pause longer than a second becomes a short breath, so the words don&rsquo;t run together.
        </Card>

        <Card
          type="Save or Save as new clip"
          title="Save"
          tryIt={practiceText('Save', RECORD_FIRST + 'press the scissors, make a change and press Save as new clip.')}
          shows={<Face>Save as new clip · Save</Face>}
        >
          Save swaps the recording for your edit, and the old one goes to the Bin. Save as new clip keeps the original
          and puts the edit straight under it. With sections, the second button reads Save as separate sections.
        </Card>
      </Cards>

      <Tips lead="While you edit:">
        <p>Speed (0.5× to 2×) is saved into the clip, and the voice keeps its pitch.</p>
        <p>
          <Code className="text-ink-500">Ctrl/Cmd + Z</Code> undoes anything until you save.
        </p>
        <p>Point at the ? beside Edit clip for every key.</p>
      </Tips>
    </>
  )
}
