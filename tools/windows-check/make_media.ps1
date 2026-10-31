# Makes the sound files the voice checks paste into a note, in %TEMP%\notealise-check\media:
# speech.wav (spoken by Windows' own voice, ~22 s), memo.m4a, speech.mp3, speech.flac, speech.wma (the same speech through
# Windows' own converter) and phone-ulaw.wav (8 kHz u-law, like an old phone recording). No microphone, nothing downloaded.
# Not a substitute for a real Windows Voice Recorder file — ask for 2-3 of those as well.
$m = "$env:TEMP\notealise-check\media"
New-Item -ItemType Directory -Force $m | Out-Null
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile("$m\speech.wav")
$s.Speak("This is a test recording for the Notealise voice note check. One two three four five six seven eight nine ten. The quick brown fox jumps over the lazy dog, and then it talks for a good while longer so the recording is more than twenty seconds long. Here is some more speech to fill the time, and a little bit more after that to be safe.")
$s.Dispose()
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo([System.Speech.AudioFormat.EncodingFormat]::ULaw, 8000, 8, 1, 8000, 1, $null)
$s.SetOutputToWaveFile("$m\phone-ulaw.wav", $fmt)
$s.Speak("This is an old telephone style recording, short, for the converter check.")
$s.Dispose()
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFolder,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Storage.CreationCollisionOption,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Media.Transcoding.MediaTranscoder,Windows.Media,ContentType=WindowsRuntime]
$null = [Windows.Media.Transcoding.PrepareTranscodeResult,Windows.Media,ContentType=WindowsRuntime]
$null = [Windows.Media.MediaProperties.MediaEncodingProfile,Windows.Media,ContentType=WindowsRuntime]
$null = [Windows.Media.MediaProperties.AudioEncodingQuality,Windows.Media,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 }
$forOp = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$forProg = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' } | Select-Object -First 1
function Await($op, [Type]$t) { $task = $forOp.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }
function Make($name, $profile) {
  $src = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync("$m\speech.wav")) ([Windows.Storage.StorageFile])
  $folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($m)) ([Windows.Storage.StorageFolder])
  $dst = Await ($folder.CreateFileAsync($name, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $tc = [Windows.Media.Transcoding.MediaTranscoder]::new()
  $prep = Await ($tc.PrepareFileTranscodeAsync($src, $dst, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
  if ($prep.CanTranscode) { ($forProg.MakeGenericMethod([double]).Invoke($null, @($prep.TranscodeAsync()))).Wait(); "made $name" } else { "cannot make $name : $($prep.FailureReason)" }
}
$q = [Windows.Media.MediaProperties.AudioEncodingQuality]::Medium
Make "memo.m4a" ([Windows.Media.MediaProperties.MediaEncodingProfile]::CreateM4a($q))
Make "speech.wma" ([Windows.Media.MediaProperties.MediaEncodingProfile]::CreateWma($q))
Make "speech.mp3" ([Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp3($q))
Make "speech.flac" ([Windows.Media.MediaProperties.MediaEncodingProfile]::CreateFlac($q))
