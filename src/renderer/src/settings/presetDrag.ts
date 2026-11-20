/** The saved look being dragged right now. A drop event can read the drag's
 *  data; a drop Chromium loses cannot (dragend has no data), so the space tab
 *  that lit up looks the look up here instead (dragLeaveGuard.ts, 2026-11-19). */
export const presetDrag = { id: null as string | null }
