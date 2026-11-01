# Nexus Dock - SMTC bridge (Windows PowerShell 5.1)
#
# Protocol: JSON Lines on stdout (UTF-8, no BOM), one JSON object per line.
#   {"type":"ready"}
#   {"type":"media","status":"playing|paused|stopped","title":"...","artist":"...",
#    "album":"...","durationMs":123456,"positionMs":1234,"canNext":true,"canPrev":true,
#    "appId":"MSEdge","artPath":"C:\\...\\art-<hash>.png"}   (artPath only when changed)
#   {"type":"error","message":"..."}
#
# stdin: one command per line: playpause | next | prev | seek:<milliseconds>
#
# The loop must never terminate on SMTC errors: every poll is wrapped in try/catch and
# errors are reported as events, then polling continues.

$ErrorActionPreference = 'Stop'

# 当前粘滞的播放器 AppId（避免暂停瞬间切到别的播放器会话）
$script:pinnedAppId = ''

# ---------------------------------------------------------------- output plumbing
$script:utf8 = New-Object System.Text.UTF8Encoding($false)
$script:outStream = [Console]::OpenStandardOutput()
$script:outWriter = New-Object System.IO.StreamWriter($script:outStream, $script:utf8)
$script:outWriter.AutoFlush = $true

function Write-Event {
  param([System.Collections.IDictionary]$Payload)
  try {
    $json = $Payload | ConvertTo-Json -Compress -Depth 5
    $script:outWriter.WriteLine($json)
    $script:outWriter.Flush()
  } catch {
    # never let a serialization problem kill the bridge
  }
}

$script:lastError = ''
$script:lastErrorAt = [datetime]::MinValue

function Emit-Error {
  param([object]$Message)
  try {
    $text = [string]$Message
    $idx = $text.IndexOf([char]10)
    if ($idx -ge 0) { $text = $text.Substring(0, $idx) }
    $text = $text.Trim()
    if ($text.Length -eq 0) { $text = 'unknown SMTC error' }
    if ($text.Length -gt 300) { $text = $text.Substring(0, 300) }
    $now = Get-Date
    if ($text -eq $script:lastError -and ($now - $script:lastErrorAt).TotalSeconds -lt 5) { return }
    $script:lastError = $text
    $script:lastErrorAt = $now
    Write-Event ([ordered]@{ type = 'error'; message = $text })
  } catch {
  }
}

# ------------------------------------------------------------------ WinRT bootstrap
$script:awaitMethod = $null
$script:asStreamForReadMethod = $null
$script:bootstrapOk = $false
$script:lastBootstrapAt = [datetime]::MinValue

function Initialize-Bootstrap {
  if ($script:bootstrapOk) { return $true }
  $now = Get-Date
  if (($now - $script:lastBootstrapAt).TotalSeconds -lt 10) { return $false }
  $script:lastBootstrapAt = $now
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $method = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    }) | Select-Object -First 1
    if ($null -eq $method) { throw 'AsTask(IAsyncOperation<T>) not found' }
    $script:awaitMethod = $method
    $script:asStreamForReadMethod = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsStreamForRead' -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IInputStream'
    }) | Select-Object -First 1
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
    $script:bootstrapOk = $true
    return $true
  } catch {
    $script:bootstrapOk = $false
    $script:awaitMethod = $null
    $script:asStreamForReadMethod = $null
    Emit-Error ("WinRT bootstrap failed: " + [string]$_)
    return $false
  }
}

function Await {
  param($Operation, [type]$ResultType)
  if ($null -eq $script:awaitMethod) { throw 'WinRT bootstrap is not ready' }
  $generic = $script:awaitMethod.MakeGenericMethod($ResultType)
  $task = $generic.Invoke($null, @($Operation))
  $task.Wait(-1) | Out-Null
  return $task.Result
}

# SMTC players expose the thumbnail differently:
#   - IRandomAccessStreamWithContentType (projected stream, e.g. Edge / most players)
#   - RandomAccessStreamReference (KuGou), whose OpenReadAsync() result is a bare
#     System.__ComObject: PowerShell's static binder cannot convert it to IInputStream,
#     but reflection Invoke performs the COM QI, so resolve AsStreamForRead reflectively.
function Convert-ToNetStream {
  param($RandomAccess)
  if ($null -ne $script:asStreamForReadMethod) {
    return $script:asStreamForReadMethod.Invoke($null, @($RandomAccess))
  }
  return [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($RandomAccess)
}

# ----------------------------------------------------------------- session manager
$script:manager = $null
$script:lastManagerAttempt = [datetime]::MinValue

function Get-Manager {
  if ($null -ne $script:manager) { return $script:manager }
  $now = Get-Date
  if (($now - $script:lastManagerAttempt).TotalSeconds -lt 3) { return $null }
  $script:lastManagerAttempt = $now
  if (-not (Initialize-Bootstrap)) { return $null }
  try {
    $requested = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $manager = Await $requested ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $script:manager = $manager
    return $manager
  } catch {
    $script:manager = $null
    Emit-Error ("RequestAsync failed: " + [string]$_)
    return $null
  }
}

function Convert-Status {
  param([string]$Raw)
  switch ($Raw) {
    'Playing' { return 'playing' }
    'Paused' { return 'paused' }
    default { return 'stopped' }
  }
}

function Get-Session {
  param($Manager)
  if ($null -eq $Manager) { return $null }
  $sessions = @($Manager.GetSessions())
  if ($sessions.Count -eq 0) {
    $script:pinnedAppId = ''
    return $null
  }

  if ($script:pinnedAppId) {
    foreach ($candidate in $sessions) {
      try {
        $appId = [string]$candidate.SourceAppUserModelId
        if ($appId -eq $script:pinnedAppId) {
          return $candidate
        }
      } catch {
      }
    }
    $script:pinnedAppId = ''
  }

  foreach ($candidate in $sessions) {
    try {
      $info = $candidate.GetPlaybackInfo()
      if ($null -ne $info) {
        if ([string]$info.PlaybackStatus -eq 'Playing') {
          try {
            $script:pinnedAppId = [string]$candidate.SourceAppUserModelId
          } catch {
          }
          return $candidate
        }
      }
    } catch {
    }
  }

  $fallback = $sessions[0]
  try {
    $script:pinnedAppId = [string]$fallback.SourceAppUserModelId
  } catch {
  }
  return $fallback
}

# ----------------------------------------------------------------------- artwork
# Some parents spawn this process with an empty TEMP (e.g. Electron on Windows).
# Fall back to .NET's temp path instead of creating a relative "nexus-dock" folder.
$tempRoot = [System.IO.Path]::GetTempPath()
$envTemp = [string]$env:TEMP
if (-not [string]::IsNullOrWhiteSpace($envTemp)) { $tempRoot = $envTemp }
$script:artDir = Join-Path $tempRoot 'nexus-dock'
$script:artDirReady = $false
$script:artDirAttemptAt = [datetime]::MinValue

function Ensure-ArtDir {
  if ($script:artDirReady) { return $true }
  # Retry at most once per 5s so a denied directory does not spam errors/logs.
  $now = Get-Date
  if (($now - $script:artDirAttemptAt).TotalSeconds -lt 5) { return $false }
  $script:artDirAttemptAt = $now
  try {
    if (-not (Test-Path -LiteralPath $script:artDir)) {
      New-Item -ItemType Directory -Path $script:artDir -Force | Out-Null
    }
    $script:artDirReady = $true
    return $true
  } catch {
    Emit-Error ("artwork directory failed: " + [string]$_)
    return $false
  }
}

# Copies the thumbnail stream to $env:TEMP\nexus-dock\art-<sha1-12>.png and returns the path.
# The hash covers title/artist/duration so the same cover is never rewritten.
function Get-ArtPath {
  param($Thumbnail, [string]$Title, [string]$Artist, [int]$DurationMs)
  if ($null -eq $Thumbnail) { return '' }
  if (-not (Ensure-ArtDir)) { return '' }
  try {
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
      $key = ('{0}|{1}|{2}' -f $Title, $Artist, $DurationMs)
      $digest = $sha1.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($key))
    } finally {
      $sha1.Dispose()
    }
    $hex = ([System.BitConverter]::ToString($digest) -replace '-', '').ToLowerInvariant()
    $final = Join-Path $script:artDir ('art-{0}.png' -f $hex.Substring(0, 12))
    if (Test-Path -LiteralPath $final) {
      try {
        if ((Get-Item -LiteralPath $final).Length -gt 0) { return $final }
      } catch {
      }
    }
    # SMTC reports Thumbnail as IRandomAccessStreamWithContentType, which already is a
    # stream (no OpenReadAsync). Tolerate stream-provider objects as well.
    $isRandomAccess = $false
    try {
      $isRandomAccess = $Thumbnail -is [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
    } catch {
      $isRandomAccess = $false
    }
    if ($isRandomAccess) {
      $randomAccess = $Thumbnail
    } else {
      $readOp = $Thumbnail.OpenReadAsync()
      $randomAccess = Await $readOp ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    }
    try {
      try { $randomAccess.Seek(0) } catch { }
      $stream = Convert-ToNetStream $randomAccess
      $tempFile = $final + '.' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.tmp'
      try {
        $fileStream = [System.IO.File]::Open($tempFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
          $stream.CopyTo($fileStream)
        } finally {
          $fileStream.Dispose()
        }
        $size = 0
        try { $size = (Get-Item -LiteralPath $tempFile).Length } catch { $size = 0 }
        if ($size -le 0) {
          Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
          return ''
        }
        Move-Item -LiteralPath $tempFile -Destination $final -Force
        return $final
      } finally {
        $stream.Dispose()
      }
    } finally {
      try { $randomAccess.Dispose() } catch { }
    }
  } catch {
    Emit-Error ("artwork extraction failed: " + [string]$_)
    return ''
  }
}

# ------------------------------------------------------------------- state snapshot
function Get-MediaSnapshot {
  $snapshot = [ordered]@{
    status     = 'stopped'
    title      = ''
    artist     = ''
    album      = ''
    durationMs = 0
    positionMs = 0
    canNext    = $false
    canPrev    = $false
    appId      = ''
    artPath    = ''
  }

  $manager = Get-Manager
  $session = $null
  if ($null -ne $manager) {
    try {
      $session = Get-Session $manager
    } catch {
      Emit-Error ("GetSessions failed: " + [string]$_)
      $session = $null
    }
  }
  if ($null -eq $session) { return $snapshot }

  try { $snapshot.appId = ([string]$session.SourceAppUserModelId).Trim() } catch { }

  try {
    $playback = $session.GetPlaybackInfo()
    if ($null -ne $playback) {
      $snapshot.status = Convert-Status ([string]$playback.PlaybackStatus)
      try {
        $controls = $playback.Controls
        if ($null -ne $controls) {
          if ($controls.IsNextEnabled -eq $true) { $snapshot.canNext = $true }
          if ($controls.IsPreviousEnabled -eq $true) { $snapshot.canPrev = $true }
        }
      } catch {
      }
    }
  } catch {
    Emit-Error ("GetPlaybackInfo failed: " + [string]$_)
  }

  try {
    $timeline = $session.GetTimelineProperties()
    if ($null -ne $timeline) {
      $position = [double]$timeline.Position.TotalMilliseconds
      $duration = [double]$timeline.EndTime.TotalMilliseconds
      if ($position -lt 0) { $position = 0 }
      if ($duration -lt 0) { $duration = 0 }
      # Players such as KuGou leave EndTime=0 and may report a stale/zero Position, but
      # LastUpdatedTime marks when that position was sampled. While playing, extrapolate:
      #   current = Position + (now - LastUpdatedTime)
      # LastUpdatedTime is a DateTimeOffset; its default value is year 1601, so ignore
      # anything before 2000 (otherwise the delta is tens of thousands of years).
      if ($snapshot.status -eq 'playing') {
        try {
          $lastUpdated = $timeline.LastUpdatedTime
          if ($null -ne $lastUpdated -and $lastUpdated.Year -ge 2000) {
            $drift = ([System.DateTimeOffset]::Now - $lastUpdated).TotalMilliseconds
            if ($drift -gt 0 -and $drift -lt 43200000) {
              $position += $drift
            }
          }
        } catch {
        }
      }
      # Known duration: never let progress pass the end. Unknown duration stays 0 (unknown).
      if ($duration -gt 0 -and $position -gt $duration) { $position = $duration }
      $snapshot.positionMs = [int][math]::Round($position)
      $snapshot.durationMs = [int][math]::Round($duration)
    }
  } catch {
  }

  $media = $null
  try {
    $mediaOp = $session.TryGetMediaPropertiesAsync()
    $media = Await $mediaOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  } catch {
    Emit-Error ("TryGetMediaPropertiesAsync failed: " + [string]$_)
  }

  if ($null -ne $media) {
    try { $snapshot.title = ([string]$media.Title).Trim() } catch { }
    try { $snapshot.artist = ([string]$media.Artist).Trim() } catch { }
    try { $snapshot.album = ([string]$media.AlbumTitle).Trim() } catch { }
    $thumbnail = $null
    try { $thumbnail = $media.Thumbnail } catch { }
    $snapshot.artPath = Get-ArtPath $thumbnail $snapshot.title $snapshot.artist $snapshot.durationMs
  }

  return $snapshot
}

# --------------------------------------------------------------- change detection
$script:lastFingerprint = ''
$script:lastArtPath = $null

function Get-Fingerprint {
  param([System.Collections.IDictionary]$State)
  $bucket = [int][math]::Floor([double]$State.positionMs / 900.0)
  return ('{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}|{9}' -f `
      $State.status, $State.title, $State.artist, $State.album, $State.durationMs, `
      $State.canNext, $State.canPrev, $State.appId, $State.artPath, $bucket)
}

function Emit-State {
  param([System.Collections.IDictionary]$State, [bool]$Force)
  $fingerprint = Get-Fingerprint $State
  if (-not $Force -and $fingerprint -eq $script:lastFingerprint) { return }
  $script:lastFingerprint = $fingerprint

  $payload = [ordered]@{
    type       = 'media'
    status     = $State.status
    title      = $State.title
    artist     = $State.artist
    album      = $State.album
    durationMs = $State.durationMs
    positionMs = $State.positionMs
    canNext    = $State.canNext
    canPrev    = $State.canPrev
    appId      = $State.appId
  }
  if ($null -eq $script:lastArtPath -or $script:lastArtPath -ne $State.artPath) {
    $payload.artPath = $State.artPath
    $script:lastArtPath = $State.artPath
  }
  Write-Event $payload
}

# ------------------------------------------------------------------------- stdin
$script:inputReader = $null
$script:inputTask = $null
$script:commands = New-Object 'System.Collections.Generic.Queue[string]'

function Initialize-Input {
  try {
    $stdin = [Console]::OpenStandardInput()
    $script:inputReader = New-Object System.IO.StreamReader($stdin, $script:utf8)
    $script:inputTask = $script:inputReader.ReadLineAsync()
  } catch {
    $script:inputReader = $null
    $script:inputTask = $null
  }
}

# Non-blocking stdin poll: a pending ReadLineAsync task is checked with IsCompleted,
# so the 700ms polling loop is never blocked by a silent stdin pipe.
function Poll-Input {
  $guard = 0
  while ($null -ne $script:inputTask -and $script:inputTask.IsCompleted -and $guard -lt 64) {
    $guard++
    $line = $null
    try { $line = $script:inputTask.Result } catch { $line = $null }
    if ($null -eq $line) {
      $script:inputTask = $null
      return
    }
    $script:commands.Enqueue($line)
    try {
      $script:inputTask = $script:inputReader.ReadLineAsync()
    } catch {
      $script:inputTask = $null
      return
    }
  }
}

# ---------------------------------------------------------------------- commands
function Invoke-Command {
  param([string]$Line)
  $text = $Line.Trim()
  if ($text.Length -eq 0) { return }

  $action = $text
  $argument = ''
  $colon = $text.IndexOf(':')
  if ($colon -ge 0) {
    $action = $text.Substring(0, $colon).Trim()
    $argument = $text.Substring($colon + 1).Trim()
  }
  $action = $action.ToLowerInvariant()

  $manager = Get-Manager
  $session = Get-Session $manager
  if ($null -eq $session) {
    Emit-Error 'no active media session for command'
    return
  }

  try {
    switch ($action) {
      'playpause' {
        $op = $session.TryTogglePlayPauseAsync()
        Await $op ([System.Boolean]) | Out-Null
      }
      'next' {
        $op = $session.TrySkipNextAsync()
        Await $op ([System.Boolean]) | Out-Null
      }
      'prev' {
        $op = $session.TrySkipPreviousAsync()
        Await $op ([System.Boolean]) | Out-Null
      }
      'seek' {
        $milliseconds = 0.0
        if (-not [double]::TryParse($argument, [ref]$milliseconds)) {
          Emit-Error ("invalid seek argument: " + $argument)
          return
        }
        $ticks = [long][math]::Round($milliseconds * 10000.0)
        if ($ticks -lt 0) { $ticks = 0 }
        $op = $session.TryChangePlaybackPositionAsync($ticks)
        Await $op ([System.Boolean]) | Out-Null
      }
      default {
        Emit-Error ("unknown command: " + $text)
      }
    }
  } catch {
    Emit-Error ("command failed (" + $action + "): " + [string]$_)
  }
}

# --------------------------------------------------------------------------- main
try {
  [Console]::OutputEncoding = $script:utf8
} catch {
}

Initialize-Input
Initialize-Bootstrap | Out-Null
Write-Event ([ordered]@{ type = 'ready' })

while ($true) {
  try {
    Poll-Input
    while ($script:commands.Count -gt 0) {
      $command = $script:commands.Dequeue()
      Invoke-Command $command
    }
  } catch {
    Emit-Error ("stdin handling failed: " + [string]$_)
  }

  try {
    $snapshot = Get-MediaSnapshot
    Emit-State $snapshot $false
  } catch {
    Emit-Error ("poll failed: " + [string]$_)
  }

  Start-Sleep -Milliseconds 700
}
