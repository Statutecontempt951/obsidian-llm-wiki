# weekly-review.ps1 -- Sunday 03:00 dogfood rollup.
# Reads .dogfood.log, tallies op counts for the past 7 days,
# appends a dated block to .dogfood.weekly.md (gitignored).
#
# Registered via: schtasks /Create /TN obsidian-llm-wiki-weekly /SC WEEKLY /D SUN /ST 03:00 ...

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Log  = Join-Path $Root '.dogfood.log'
$Out  = Join-Path $Root '.dogfood.weekly.md'

if (-not (Test-Path $Log)) {
    "dogfood log missing: $Log" | Write-Error
    exit 1
}

$cutoff = (Get-Date).ToUniversalTime().AddDays(-7)
$week   = Get-Date -Format "yyyy-'W'ww"
$stamp  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$records = Get-Content -LiteralPath $Log -Encoding UTF8 |
    Where-Object { $_ -and -not $_.StartsWith('#') } |
    ForEach-Object {
        $parts = $_ -split "`t"
        if ($parts.Length -ge 3) {
            [pscustomobject]@{
                ts   = $parts[0]
                tool = $parts[1]
                op   = $parts[2]
            }
        }
    } |
    Where-Object {
        try { [datetime]::Parse($_.ts).ToUniversalTime() -ge $cutoff } catch { $false }
    }

$total = ($records | Measure-Object).Count
$tally = $records | Group-Object op | Sort-Object Count -Descending

$lines = @()
$lines += "## $week (generated $stamp)"
$lines += ""
$lines += "- total records (last 7d): $total"
if ($total -gt 0) {
    $lines += "- top ops:"
    foreach ($g in $tally) {
        $lines += "  - $($g.Name): $($g.Count)"
    }
} else {
    $lines += "- (no records in window)"
}
$lines += ""

Add-Content -LiteralPath $Out -Value $lines -Encoding UTF8
Write-Output "wrote $total records to $Out"
