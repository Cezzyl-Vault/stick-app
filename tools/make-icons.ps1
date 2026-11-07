# Erzeugt die App-Icons (Herz aus Kreuzstichen) als PNG und SVG in icons/.
# Aufruf: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $dir | Out-Null

$BG = '#9C2F4A'
$FG = '#FFF4E6'
$heart = @(
  '.XX...XX.',
  'XXXX.XXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXX...',
  '....X....'
)
$cols = 9; $rows = 8

function Get-Layout([double]$size, [double]$scale) {
  $cell = $size * $scale / $cols
  return @{ cell = $cell; ox = ($size - $cols * $cell) / 2; oy = ($size - $rows * $cell) / 2 + $cell * 0.15 }
}

function New-Png([int]$size, [string]$name, [bool]$rounded, [double]$scale) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($BG))
  if ($rounded) {
    $r = $size * 0.22; $d = $r * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
  } else {
    $g.FillRectangle($brush, 0, 0, $size, $size)
  }
  $L = Get-Layout $size $scale
  $c = $L.cell
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($FG)), ([single]($c * 0.22))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $inset = $c * 0.2
  for ($y = 0; $y -lt $rows; $y++) {
    for ($x = 0; $x -lt $cols; $x++) {
      if ($heart[$y][$x] -ne 'X') { continue }
      $x0 = $L.ox + $x * $c + $inset; $y0 = $L.oy + $y * $c + $inset
      $x1 = $L.ox + ($x + 1) * $c - $inset; $y1 = $L.oy + ($y + 1) * $c - $inset
      $g.DrawLine($pen, [single]$x0, [single]$y0, [single]$x1, [single]$y1)
      $g.DrawLine($pen, [single]$x1, [single]$y0, [single]$x0, [single]$y1)
    }
  }
  $g.Dispose()
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "icons/$name"
}

New-Png 192 'icon-192.png' $true 0.62
New-Png 512 'icon-512.png' $true 0.62
New-Png 512 'icon-maskable-512.png' $false 0.5
New-Png 180 'apple-touch-icon.png' $false 0.58

# SVG (Favicon und Logo)
$L = Get-Layout 512 0.62
$c = $L.cell; $inset = $c * 0.2
$lines = New-Object System.Collections.Generic.List[string]
for ($y = 0; $y -lt $rows; $y++) {
  for ($x = 0; $x -lt $cols; $x++) {
    if ($heart[$y][$x] -ne 'X') { continue }
    $x0 = [math]::Round($L.ox + $x * $c + $inset, 1); $y0 = [math]::Round($L.oy + $y * $c + $inset, 1)
    $x1 = [math]::Round($L.ox + ($x + 1) * $c - $inset, 1); $y1 = [math]::Round($L.oy + ($y + 1) * $c - $inset, 1)
    $lines.Add("M$x0 ${y0}L$x1 ${y1}M$x1 ${y0}L$x0 $y1")
  }
}
$inv = [Globalization.CultureInfo]::InvariantCulture
$sw = ($c * 0.22).ToString('0.#', $inv)
$d = ($lines -join '') -replace ',', '.'
$svg = "<svg xmlns=""http://www.w3.org/2000/svg"" viewBox=""0 0 512 512""><rect width=""512"" height=""512"" rx=""112"" fill=""$BG""/><path d=""$d"" stroke=""$FG"" stroke-width=""$sw"" stroke-linecap=""round"" fill=""none""/></svg>"
[IO.File]::WriteAllText((Join-Path $dir 'icon.svg'), $svg, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'icons/icon.svg'
