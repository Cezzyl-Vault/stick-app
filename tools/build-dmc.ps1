# Erzeugt data/dmc.js aus der CSV "DMC Cotton Floss converted to RGB Values.csv"
# (Quelle: github.com/adrianj/CrossStitchCreator), mit den Korrekturen aus
# github.com/sharlagelfand/dmc (data-raw/floss.R).
#
# Aufruf: powershell -File tools/build-dmc.ps1 -Csv <pfad-zur-csv>
param([Parameter(Mandatory = $true)][string]$Csv)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'data\dmc.js'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

# Korrekturen (Hex-Codes, die Excel zerstört hat, bzw. RGB passte nicht zum Hex)
$fix = @{
  '221' = '883E43'; '910' = '187E56'; '699' = '056517'; '869' = '835E39'; '310' = '000000'; '434' = '985E33'
  '309' = 'BA4A4A'; '3609' = 'F4AED5'; '225' = 'FFDFD5'; '210' = 'C39FC3'; '3755' = '93B4CE'
  '3849' = '52B3AE'; '3848' = '419392'; '890' = '174923'; '3830' = 'B95544'
}

$rows = Import-Csv $Csv
$seen = @{}
$lines = New-Object System.Collections.Generic.List[string]
foreach ($r in $rows) {
  $code = $r.'Floss#'.Trim()
  if ($seen.ContainsKey($code)) { Write-Warning "Doppelt: $code"; continue }
  $seen[$code] = $true
  $hex = $r.'RGB code'.Trim().ToUpper()
  if ($fix.ContainsKey($code)) { $hex = $fix[$code] }
  elseif ($hex -notmatch '^[0-9A-F]{6}$') {
    $hex = '{0:X2}{1:X2}{2:X2}' -f [int]$r.Red, [int]$r.Green, [int]$r.Blue
  }
  $name = $r.Description.Trim().Replace('\', '\\').Replace('"', '\"')
  $lines.Add("  [""$code"",""$name"",""$hex""]")
}

$header = @"
// DMC-Stickgarne: [Nummer, Name, Hex-Farbe]
// Automatisch erzeugt von tools/build-dmc.ps1 – nicht von Hand bearbeiten.
// Farbwerte sind Näherungen; echte Garne können am Bildschirm anders wirken.
export const DMC = [
"@
$body = ($lines -join ",`n")
$text = $header + "`n" + $body + "`n];`n"
[IO.File]::WriteAllText($out, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "$($lines.Count) Farben nach $out geschrieben"
