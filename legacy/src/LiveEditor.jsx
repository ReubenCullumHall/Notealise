import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor, placeholder as cmPlaceholder } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { markdownStyling, livePreviewPlugin } from "./livePreview.js";
import { completionExtension } from "./completions.js";
import { formatKeymap } from "./format.js";

/*
  A CodeMirror 6 editor with Obsidian-style live preview.
  Uncontrolled after mount (CodeMirror owns the text); the parent remounts it
  per note via a `key`, so we never fight CodeMirror over the document.
*/
export default function LiveEditor({ value, onChange, onExit, getWikiTargets, viewRef }) {
  const box = useRef(null);
  const onChangeRef = useRef(onChange);
  const onExitRef = useRef(onExit);
  onChangeRef.current = onChange;
  onExitRef.current = onExit;

  useEffect(() => {
    const state = EditorState.create({
      doc: value || "",
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        // GFM, not bare CommonMark — otherwise ~~strikethrough~~, tables and
        // task lists parse in the reading view but not here
        markdown({ base: markdownLanguage }),
        markdownStyling,
        livePreviewPlugin,
        completionExtension(getWikiTargets),
        cmPlaceholder("Type  /  for commands, or  [[  to link a note…"),
        keymap.of([
          ...formatKeymap,          // before defaultKeymap: Mod-i/u are otherwise taken
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: "Escape", run: () => { onExitRef.current && onExitRef.current(); return true; } },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: box.current });
    // hand the view to the parent so the formatting toolbar can drive it
    if (viewRef) viewRef.current = view;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return () => {
      if (viewRef && viewRef.current === view) viewRef.current = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={box} className="h-full w-full overflow-hidden" />;
}
