// The small scripts behind "Edit in Excel" (main/sideBySide.ts). Every value they need
// arrives in an environment variable and never in the script's text, so a file with an
// odd name cannot change what a script does.

/** macOS: which app opens BESIDE_FILE. Asks for no permission. */
export const MAC_LOOKUP = String.raw`
ObjC.import('AppKit')
function run() {
  const env = $.NSProcessInfo.processInfo.environment
  const url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(env.objectForKey('BESIDE_FILE')))
  if (url.isNil()) return ''
  const bundle = $.NSBundle.bundleWithURL(url)
  return JSON.stringify({
    name: ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(url.path)),
    id: ObjC.unwrap(bundle.bundleIdentifier)
  })
}
`

/** macOS: find the window showing BESIDE_STEM in the app BESIDE_APP (a bundle id, or
 *  "pid:123") and put it at BESIDE_X/Y/W/H, right edge fixed. Uses the Accessibility
 *  permission only. Prints where the window really ended up. */
export const MAC_PLACE = String.raw`
ObjC.import('Foundation'); ObjC.import('AppKit'); ObjC.import('ApplicationServices')
ObjC.bindFunction('AXUIElementCreateApplication', ['id', ['int']])
ObjC.bindFunction('AXUIElementCopyAttributeValue', ['int', ['id', 'id', 'id*']])
ObjC.bindFunction('AXUIElementSetAttributeValue', ['int', ['id', 'id', 'id']])
ObjC.bindFunction('AXValueCreate', ['id', ['int', 'void*']])
ObjC.bindFunction('CFCopyDescription', ['id', ['id']])
const POINT = 1, SIZE = 2
const read = (el, name) => { const out = Ref(); return $.AXUIElementCopyAttributeValue(el, $(name), out) === 0 ? out[0] : null }
const write = (el, name, value) => $.AXUIElementSetAttributeValue(el, $(name), value)
// This bridge can't fill a C struct directly, so the two numbers go in as raw bytes,
// and come back out of the value's own description.
function pair(kind, a, b) {
  const bytes = new Uint8Array(new Float64Array([a, b]).buffer)
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let text = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    text += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? A[n & 63] : '=')
  }
  return $.AXValueCreate(kind, $.NSData.alloc.initWithBase64EncodedStringOptions($(text), 0).bytes)
}
function unpair(value) {
  const m = /[xw]:(-?[\d.]+)\s+[yh]:(-?[\d.]+)/.exec(ObjC.unwrap($.CFCopyDescription(value)))
  return [Number(m[1]), Number(m[2])]
}
const nap = (s) => $.NSThread.sleepForTimeInterval(s)
function pidOf(app) {
  if (app.startsWith('pid:')) return Number(app.slice(4))
  const list = $.NSRunningApplication.runningApplicationsWithBundleIdentifier($(app))
  return list.count > 0 ? list.objectAtIndex(0).processIdentifier : 0
}
function findWindow(app, stem) {
  const pid = pidOf(app)
  if (!pid) return null
  const windows = read($.AXUIElementCreateApplication(pid), 'AXWindows')
  if (!windows || windows.isNil()) return null
  const all = []
  for (let i = 0; i < windows.count; i++) all.push(windows.objectAtIndex(i))
  const named = all.find((w) => {
    const t = read(w, 'AXTitle')
    return t && !t.isNil() && ObjC.unwrap(t).toLowerCase().includes(stem)
  })
  return { named: named || null, only: all.length === 1 ? all[0] : null }
}
function run() {
  const env = $.NSProcessInfo.processInfo.environment
  const get = (k) => ObjC.unwrap(env.objectForKey(k))
  const app = get('BESIDE_APP'), stem = get('BESIDE_STEM').toLowerCase()
  const x = Number(get('BESIDE_X')), y = Number(get('BESIDE_Y')), w = Number(get('BESIDE_W')), h = Number(get('BESIDE_H'))
  let win = null, only = null
  for (let i = 0; i < 40 && !win; i++) {
    const found = findWindow(app, stem)
    if (found) { win = found.named; only = found.only }
    if (!win) nap(0.2)
  }
  win = win || only
  if (!win) return ''
  const full = read(win, 'AXFullScreen')
  if (full && !full.isNil() && ObjC.unwrap(full)) { write(win, 'AXFullScreen', $.kCFBooleanFalse); nap(1) }
  write(win, 'AXMinimized', $.kCFBooleanFalse)
  write(win, 'AXPosition', pair(POINT, x, y))
  write(win, 'AXSize', pair(SIZE, w, h))
  const [width] = unpair(read(win, 'AXSize'))
  write(win, 'AXPosition', pair(POINT, x + w - width, y))
  const at = unpair(read(win, 'AXPosition'))
  const end = unpair(read(win, 'AXSize'))
  return JSON.stringify({ x: at[0], y: at[1], width: end[0], height: end[1] })
}
`

/** Windows: the name of the app that opens BESIDE_EXT. Asks for no permission. */
export const WIN_LOOKUP = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class BesideLookup {
  [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
  static extern int AssocQueryString(int flags, int str, string assoc, string extra, StringBuilder o, ref uint n);
  public static string Name(string ext) {
    uint n = 512; var s = new StringBuilder(512);
    return AssocQueryString(0, 4, ext, null, s, ref n) == 0 ? s.ToString() : "";
  }
}
'@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[BesideLookup]::Name($env:BESIDE_EXT)
`

/** Windows: find the visible window whose title holds BESIDE_STEM (never our own,
 *  BESIDE_OURS) and put it at BESIDE_X/Y/W/H, in screen pixels. Prints where it ended up. */
export const WIN_PLACE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class BesidePlace {
  public delegate bool Each(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Each e, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int t, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  public static IntPtr Find(string stem, long ours) {
    IntPtr hit = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (h.ToInt64() == ours || !IsWindowVisible(h)) return true;
      var s = new StringBuilder(512); GetWindowText(h, s, 512);
      if (s.ToString().IndexOf(stem, StringComparison.OrdinalIgnoreCase) < 0) return true;
      hit = h; return false;
    }, IntPtr.Zero);
    return hit;
  }
}
'@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $h -eq [IntPtr]::Zero; $i++) {
  $h = [BesidePlace]::Find($env:BESIDE_STEM, [long]$env:BESIDE_OURS)
  if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200 }
}
if ($h -eq [IntPtr]::Zero) { exit 0 }
[void][BesidePlace]::ShowWindow($h, 9)
[void][BesidePlace]::SetWindowPos($h, [IntPtr]::Zero, [int]$env:BESIDE_X, [int]$env:BESIDE_Y, [int]$env:BESIDE_W, [int]$env:BESIDE_H, 0x0014)
$r = New-Object BesidePlace+Rect
[void][BesidePlace]::GetWindowRect($h, [ref]$r)
'{"x":' + $r.Left + ',"y":' + $r.Top + ',"width":' + ($r.Right - $r.Left) + ',"height":' + ($r.Bottom - $r.Top) + '}'
`
