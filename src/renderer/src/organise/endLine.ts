/** The line under the whole notes list (Sidebar.tsx draws it over the empty space
 *  below the rows). A class on the list's box, not React state: two components own
 *  the two halves of that space. */
export function clearEndLine(): void {
  for (const el of document.querySelectorAll('.tree-drop-end')) el.classList.remove('tree-drop-end')
}
