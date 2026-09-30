#!/usr/bin/env pwsh
# Blocks "done" while the active spec or feature docs lag behind the code (Stop hook).
# Exit 2 + stderr sends Claude back to work. With -Base <ref> it checks <ref>...HEAD instead
# of the working tree, so CI can run the same check on a PR.
param([string]$Base)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root          = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$featuresRoot  = 'src/Api/Features'
$testPattern   = '(?i)(^|/)(tests?|__tests__)/|\.(test|spec)\.[^/]+$|tests?\.cs$'
$activePattern = '^(\|\s*\*\*Status\*\*\s*\|\s*Active\b|status:\s*active\s*$)'

if (-not $Base -and [Console]::IsInputRedirected) {
    try { $hookInput = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { $hookInput = $null }
    # Claude already went back to work once because of this hook; don't loop.
    if ($hookInput.stop_hook_active) { exit 0 }
}

$changed = @(
    if ($Base) {
        git -C $root diff --name-only "$Base...HEAD" 2>$null
    } else {
        git -C $root diff --name-only HEAD 2>$null
        git -C $root ls-files --others --exclude-standard 2>$null
    }
) | Where-Object { $_ } | Sort-Object -Unique
$changed = @($changed)

# Code = anything that isn't Markdown or tooling/docs.
$code = @($changed | Where-Object { $_ -notmatch '\.md$' -and $_ -notmatch '^(docs|\.claude|\.github)/' })
$problems = @()

# 1. Feature code changed (not only tests) without a README update.
$featureDirs = $code | Where-Object { $_ -notmatch $testPattern } |
    ForEach-Object { if ($_ -match "^$([regex]::Escape($featuresRoot))/[^/]+(?=/)") { $Matches[0] } } |
    Sort-Object -Unique
foreach ($dir in $featureDirs) {
    if (Test-Path (Join-Path $root $dir)) {
        if ($changed -notcontains "$dir/README.md") {
            $problems += "Feature code in $dir changed but its README.md didn't - run the document-feature skill."
        }
    } elseif ($changed -notcontains 'docs/features.md') {
        $problems += "Feature $dir was removed but docs/features.md wasn't updated - run the document-feature skill."
    }
}

# 2. Code changed while a spec is active, but the spec wasn't touched.
$spec = Get-ChildItem -Path (Join-Path $root 'docs/specs') -Filter '*.md' -File |
    Where-Object Name -ne 'feature-spec-template.md' |
    Sort-Object Name |
    Where-Object { Select-String -Path $_.FullName -Pattern $activePattern -Quiet } |
    Select-Object -First 1
if ($spec -and $code) {
    $specRel = [System.IO.Path]::GetRelativePath($root, $spec.FullName) -replace '\\', '/'
    if ($changed -notcontains $specRel) {
        $problems += "Code changed but the active spec $specRel wasn't updated (acceptance criteria, section 14) - run the ship skill."
    }
}

if ($problems) {
    $message = @('Not done yet:') + ($problems | ForEach-Object { "- $_" }) +
        'Fix these, or tell the user why no update is needed.'
    [Console]::Error.WriteLine($message -join "`n")
    exit 2
}

exit 0
