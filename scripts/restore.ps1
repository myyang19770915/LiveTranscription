<#
.SYNOPSIS
  從 backup.ps1 的備份還原（db-backup-restore）。-Drill 只演練、不碰正式資料；正式還原必須加 -Force。

.DESCRIPTION
  -Drill：啟動一個暫時的同版本 Postgres 容器，把備份還原進去，逐表比對筆數與 manifest.json，並檢查備份裡 output
  的檔案數；最後移除暫時容器。正式資料庫、output/ 與 app 都不會被改動。

  -Force：先把目前狀態備份到 backups\pre-restore-<時間>\，停止 app，重建資料庫並還原，把備份的 output 複製回
  output/（只覆蓋與新增，不刪除之後新增的檔案），啟動 app，再比對筆數。

  兩種模式的資料庫還原用同一個函式（Restore-Dump）。

.EXAMPLE
  .\scripts\restore.ps1 -Backup .\backups\20261112-210913 -Drill
  .\scripts\restore.ps1 -Backup .\backups\20261112-210913 -Force
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Backup,
    [switch]$Drill,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-common.ps1')

function Read-Backup {
    param([string]$Path)
    $full = (Resolve-Path $Path).Path
    $dump = Join-Path $full 'yuqiao.dump'
    $manifestPath = Join-Path $full 'manifest.json'
    if (-not (Test-Path $dump) -or -not (Test-Path $manifestPath)) { throw "$full 不是 backup.ps1 產生的備份（缺 yuqiao.dump 或 manifest.json）" }
    $manifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    return @{ Path = $full; Dump = $dump; Manifest = $manifest; Output = (Join-Path $full 'output') }
}

function Write-Diffs {
    param($Diffs)
    Write-Host '資料表筆數與備份時不同：' -ForegroundColor Red
    $Diffs | ForEach-Object { Write-Host $_ }
}

try {
    if ($Drill -and $Force) { throw '-Drill 與 -Force 只能擇一' }
    $source = Read-Backup $Backup

    if ($Drill) {
        $db = Get-DbContainer
        $image = (docker inspect -f '{{.Config.Image}}' $db).Trim()
        $name = 'yuqiao-restore-drill-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        $password = [guid]::NewGuid().ToString('N')
        Write-Host "演練：以 $image 啟動暫時容器 $name（不開 port，結束後移除）"
        Invoke-Native '啟動演練容器' { docker run -d --rm --name $name -e "POSTGRES_USER=$($script:DbUser)" -e "POSTGRES_DB=$($script:DbName)" -e "POSTGRES_PASSWORD=$password" $image } | Out-Null
        try {
            Wait-Postgres $name
            Restore-Dump $name $source.Dump
            $diffs = Compare-Counts $name $source.Manifest
            $files = Get-FileStats $source.Output
            $problems = $diffs.Count
            if ($files.files -ne [int]$source.Manifest.output.files) {
                Write-Host ("output 檔案數不同：備份時 {0}，備份資料夾裡 {1}" -f $source.Manifest.output.files, $files.files) -ForegroundColor Red
                $problems++
            }
            if ($diffs.Count) { Write-Diffs $diffs }
            if ($problems) { Write-Host '演練失敗' -ForegroundColor Red; exit 1 }
            $tables = @($source.Manifest.tables.PSObject.Properties).Count
            Write-Host "演練成功：$tables 個資料表筆數一致，output $($files.files) 個檔案一致（$($source.Path)）" -ForegroundColor Green
            exit 0
        } finally {
            try { docker rm -f $name *> $null } catch { }  # gone already (--rm) is fine
        }
    }

    if (-not $Force) {
        Write-Host '沒有做任何改動。正式還原會：'
        Write-Host '  1. 先把目前的資料庫與 output 備份到 backups\pre-restore-<時間>\'
        Write-Host '  2. 停止 app（docker compose stop app）'
        Write-Host "  3. 刪除並重建資料庫 $($script:DbName)，以 $($source.Dump) 還原"
        Write-Host "  4. 把 $($source.Output) 複製回 output\（只覆蓋與新增，不刪除檔案）"
        Write-Host '  5. 比對資料表筆數，再啟動 app'
        Write-Host '確定要還原請加 -Force；只想確認備份可用請加 -Drill。'
        exit 1
    }

    $db = Get-DbContainer
    $compose = Join-Path $script:Root 'compose.yaml'
    Write-Host '1/5 備份目前狀態…'
    & (Join-Path $PSScriptRoot 'backup.ps1') -Label 'pre-restore'
    if ($LASTEXITCODE -ne 0) { throw '還原前的備份失敗，未做任何改動' }
    $safety = Get-ChildItem (Join-Path $script:Root 'backups') -Directory -Filter 'pre-restore-*' | Sort-Object Name | Select-Object -Last 1
    $databaseTouched = $false
    try {
        Write-Host '2/5 停止 app…'
        Invoke-Native '停止 app' { docker compose -f $compose stop app } | Out-Null
        Write-Host '3/5 重建資料庫並還原…'
        $databaseTouched = $true
        Restore-Dump $db $source.Dump
        Write-Host '4/5 複製 output…'
        if (Test-Path $source.Output) {
            robocopy $source.Output (Join-Path $script:Root 'output') /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "複製 output 失敗（robocopy 結束代碼 $LASTEXITCODE）" }
        }
    } catch {
        Write-Host "還原中途失敗：$($_.Exception.Message)" -ForegroundColor Red
        Write-Host "還原前的狀態在 $($safety.FullName)；回復：.\scripts\restore.ps1 -Backup `"$($safety.FullName)`" -Force" -ForegroundColor Yellow
        if ($databaseTouched) {
            # The database may be dropped or half restored: serving it would let people write into it.
            Write-Host 'app 保持停止：資料庫已被清除、可能只還原了一部分。先用上面的指令回復，回復時會自動啟動 app。' -ForegroundColor Yellow
        } else {
            try { docker compose -f $compose start app | Out-Null; Write-Host '資料庫沒有被改動，已重新啟動 app。' }
            catch { Write-Host "資料庫沒有被改動，但無法啟動 app：$($_.Exception.Message)；請執行 docker compose start app" -ForegroundColor Yellow }
        }
        exit 1
    }
    Write-Host '5/5 比對筆數並啟動 app…'
    # Compare before the app starts: once running it writes sessions and may apply newer migrations.
    $diffs = Compare-Counts $db $source.Manifest
    Invoke-Native '啟動 app' { docker compose -f $compose start app } | Out-Null
    if ($diffs.Count) { Write-Diffs $diffs; exit 1 }
    Write-Host "還原完成：$($source.Path)；還原前的狀態保存在 $($safety.FullName)" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "還原失敗：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
