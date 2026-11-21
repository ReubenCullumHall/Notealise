# Files in tabs: Windows checks

Real test windows on throwaway notes folders. They never touch real notes or the installed app.
A file is "blocked" by this script holding it open, the way Excel does.

- `probe_warn.py`: the close-tab warning and every way of leaving a blocked file.
- `probe_keep.py`: Recovered copies on quit, another program saving its own version, a deleted or binned file, spaces, renames, switching notes folder.
- `winlab.py`: opens one test window per case.

Run (a free port; `WORK` is an empty scratch folder holding `out/` from `electron-vite build --outDir <WORK>/out` and a `node_modules` junction):

    $env:WORK = '<scratch>'; python probe_warn.py 9481; python probe_keep.py 9481

For a packaged build set `$env:APP_EXE` to its `Notealise.exe`. The notes-folder switch is skipped there, because the real app's folder box can't be answered by a script.
