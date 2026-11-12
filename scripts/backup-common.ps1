# Shared by backup.ps1 and restore.ps1 (db-backup-restore). Dot-source it; it defines functions only.

$script:DbUser = 'yuqiao'
$script:DbName = 'yuqiao'
$script:Root = Split-Path -Parent $PSScriptRoot

function Invoke-Native {
    # Run a native command; stop with its name when it fails (Windows PowerShell does not stop on exit codes).
    param([Parameter(Mandatory)][string]$What, [Parameter(Mandatory)][scriptblock]$Command)
    $output = & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What 失敗（結束代碼 $LASTEXITCODE）" }
    return $output
}

function Get-DbContainer {
    $id = docker compose -f (Join-Path $script:Root 'compose.yaml') ps -q db
    if ($LASTEXITCODE -ne 0 -or -not $id) { throw '找不到執行中的 db 容器：先執行 docker compose up -d db' }
    return ($id | Select-Object -First 1).Trim()
}

function Get-TableCounts {
    # Row count of every table in the public schema, as an ordered name -> count map.
    param([Parameter(Mandatory)][string]$Container)
    $sql = "SELECT c.relname || chr(9) || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text " +
           "FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;"
    $lines = Invoke-Native '計算資料表筆數' { $sql | docker exec -i $Container psql -U $script:DbUser -d $script:DbName -At -v ON_ERROR_STOP=1 }
    $counts = [ordered]@{}
    foreach ($line in @($lines)) {
        if (-not $line) { continue }
        $name, $n = $line -split "`t", 2
        $counts[$name] = [long]$n
    }
    return $counts
}

function Wait-Postgres {
    # TCP, not the socket: during first-start initialisation the temporary server listens on the socket only.
    param([Parameter(Mandatory)][string]$Container, [int]$Seconds = 90)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        docker exec $Container pg_isready -h 127.0.0.1 -U $script:DbUser -d $script:DbName *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 2
    }
    throw "資料庫 $Container 在 $Seconds 秒內沒有就緒"
}

function Restore-Dump {
    # Drop and recreate the database in $Container, then restore $DumpFile into it. Used by both the drill and a real restore.
    param([Parameter(Mandatory)][string]$Container, [Parameter(Mandatory)][string]$DumpFile)
    $inside = '/tmp/yuqiao-restore.dump'
    Invoke-Native '複製 dump 進容器' { docker cp $DumpFile "${Container}:$inside" } | Out-Null
    try {
        Invoke-Native '刪除舊資料庫' { docker exec $Container psql -U $script:DbUser -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $($script:DbName) WITH (FORCE)" } | Out-Null
        Invoke-Native '建立資料庫' { docker exec $Container psql -U $script:DbUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $($script:DbName) OWNER $($script:DbUser)" } | Out-Null
        Invoke-Native 'pg_restore 還原' { docker exec $Container pg_restore -U $script:DbUser -d $script:DbName --exit-on-error $inside } | Out-Null
    } finally {
        try { docker exec $Container rm -f $inside *> $null } catch { }
    }
}

function Compare-Counts {
    # Differences between the counts recorded in a manifest and the counts now in $Container; empty when they match.
    param([Parameter(Mandatory)][string]$Container, [Parameter(Mandatory)]$Manifest)
    $expected = @{}
    foreach ($p in $Manifest.tables.PSObject.Properties) { $expected[$p.Name] = [long]$p.Value }
    $actual = Get-TableCounts $Container
    $diffs = @()
    foreach ($name in (@($expected.Keys) + @($actual.Keys) | Sort-Object -Unique)) {
        $want = if ($expected.ContainsKey($name)) { $expected[$name] } else { '（沒有）' }
        $got = if ($actual.Contains($name)) { $actual[$name] } else { '（沒有）' }
        if ("$want" -ne "$got") { $diffs += "  $name：備份時 $want，還原後 $got" }
    }
    return ,$diffs
}

function Get-FileStats {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { return @{ files = 0; bytes = 0 } }
    $measure = Get-ChildItem -Path $Path -Recurse -File -Force | Measure-Object -Property Length -Sum
    return @{ files = [int]$measure.Count; bytes = [long]($measure.Sum) }
}
