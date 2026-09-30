#!/usr/bin/env pwsh
# Prints the active spec; stdout is added to Claude's context (SessionStart hook)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root     = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$specsDir = Join-Path $root 'docs/specs'

# Metadata row "| **Status** | Active |" from feature-spec-template.md (or a legacy "status: active" line)
$activePattern = '^(\|\s*\*\*Status\*\*\s*\|\s*Active\b|status:\s*active\s*$)'

$spec = Get-ChildItem -Path $specsDir -Filter '*.md' -File |
    Where-Object Name -ne 'feature-spec-template.md' |
    Sort-Object Name |
    Where-Object { Select-String -Path $_.FullName -Pattern $activePattern -Quiet } |
    Select-Object -First 1

if ($spec) {
    $rel = [System.IO.Path]::GetRelativePath($root, $spec.FullName) -replace '\\', '/'
    Write-Output "Active spec ($rel):"
    Get-Content -Path $spec.FullName -Raw -Encoding UTF8
} else {
    Write-Output 'No active spec.'
}

exit 0
