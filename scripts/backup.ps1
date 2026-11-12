<#
.SYNOPSIS
  備份會議資料庫與 output/ 到 backups\<時間>\（db-backup-restore）。

.DESCRIPTION
  資料庫以 pg_dump -Fc 在 db 容器內匯出再 docker cp 取出（不經 PowerShell 管線，避免破壞二進位資料），
  並以 pg_restore --list 確認可讀；output/ 以 robocopy 複製（不含 output\backups）；manifest.json 記錄各資料表筆數、
  檔案數與 git commit，供 restore.ps1 比對。資料庫不需停機，但請在沒有進行中會議時執行，筆數才會與 dump 一致。

.EXAMPLE
  .\scripts\backup.ps1
  .\scripts\backup.ps1 -Destination D:\yuqiao-backups
#>
[CmdletBinding()]
param(
    [string]$Destination = '',
    [string]$Label = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-common.ps1')

try {
    $db = Get-DbContainer
    if (-not $Destination) { $Destination = Join-Path $script:Root 'backups' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $name = if ($Label) { "$Label-$stamp" } else { $stamp }
    $dir = Join-Path $Destination $name
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    $inside = '/tmp/yuqiao-backup.dump'
    Invoke-Native 'pg_dump 匯出' { docker exec $db pg_dump -U $script:DbUser -d $script:DbName -Fc -f $inside } | Out-Null
    try {
        Invoke-Native '檢查 dump 可讀（pg_restore --list）' { docker exec $db pg_restore --list $inside } | Out-Null
        Invoke-Native '取出 dump' { docker cp "${db}:$inside" (Join-Path $dir 'yuqiao.dump') } | Out-Null
    } finally {
        try { docker exec $db rm -f $inside *> $null } catch { }
    }
    $tables = Get-TableCounts $db

    $source = Join-Path $script:Root 'output'
    $copy = Join-Path $dir 'output'
    if (Test-Path $source) {
        robocopy $source $copy /E /XD (Join-Path $source 'backups') /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "複製 output 失敗（robocopy 結束代碼 $LASTEXITCODE）" }
    }
    $files = Get-FileStats $copy

    $commit = ''
    try { $commit = git -C $script:Root rev-parse HEAD 2>$null } catch { }  # informational only; never fails the backup
    $manifest = [ordered]@{
        created = (Get-Date).ToString('o')
        commit  = "$commit".Trim()
        image   = (docker inspect -f '{{.Config.Image}}' $db).Trim()
        tables  = $tables
        output  = $files
    }
    $json = $manifest | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText((Join-Path $dir 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding $false))

    $dumpBytes = (Get-Item (Join-Path $dir 'yuqiao.dump')).Length
    Write-Host "備份完成：$dir"
    Write-Host ("  資料庫 dump：{0:N0} bytes，{1} 個資料表，共 {2:N0} 筆" -f $dumpBytes, $tables.Count, (($tables.Values | Measure-Object -Sum).Sum))
    Write-Host ("  output：{0} 個檔案，{1:N0} bytes" -f $files.files, $files.bytes)
    exit 0
} catch {
    Write-Host "備份失敗：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
