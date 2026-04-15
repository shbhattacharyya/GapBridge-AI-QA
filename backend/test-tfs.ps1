param(
    [string]$ChangesetId = "402474"
)

$TFS_BASE = if ($env:TFS_BASE_URL) { $env:TFS_BASE_URL } else { "http://dev-tfs:8080/tfs/HylandCollection" }
$TFS_PAT  = $env:TFS_PAT   # Set TFS_PAT environment variable before running
$API_VER  = "api-version=1.0"

$b64     = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$TFS_PAT"))
$Headers = @{ Authorization = "Basic $b64"; Accept = "application/json" }

[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

Write-Host ""
Write-Host "=== TFS Connectivity Test ===" -ForegroundColor Cyan
Write-Host "Changeset : $ChangesetId"
Write-Host "Server    : $TFS_BASE"
Write-Host ""

Write-Host "[ 1/3 ] TCP reachability..." -ForegroundColor Yellow
try {
    $conn = Test-NetConnection -ComputerName "dev-tfs" -Port 8080 -WarningAction SilentlyContinue
    if ($conn.TcpTestSucceeded) {
        Write-Host "        OK - dev-tfs:8080 is reachable" -ForegroundColor Green
    } else {
        Write-Host "        FAIL - Cannot reach dev-tfs:8080. Are you on VPN?" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "        ERROR - $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[ 2/3 ] Fetching changeset metadata..." -ForegroundColor Yellow
$metaUrl = "$TFS_BASE/OnBase/_apis/tfvc/changesets/$($ChangesetId)?$API_VER"
Write-Host "        URL: $metaUrl"
try {
    $meta    = Invoke-RestMethod -Uri $metaUrl -Headers $Headers -TimeoutSec 15
    $author  = if ($meta.author.displayName)          { $meta.author.displayName }
               elseif ($meta.checkedInBy.displayName) { $meta.checkedInBy.displayName }
               else                                   { "(unknown)" }
    $date    = if ($meta.createdDate) { $meta.createdDate.Substring(0,10) } else { "(unknown)" }
    $comment = if ($meta.comment)     { $meta.comment } else { "(no comment)" }
    Write-Host "        OK" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Changeset : $ChangesetId" -ForegroundColor Cyan
    Write-Host "  Author    : $author"
    Write-Host "  Date      : $date"
    Write-Host "  Comment   : $comment"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host "        FAIL (HTTP $status) - $($_.Exception.Message)" -ForegroundColor Red
    if ($status -eq 401) { Write-Host "  --> Invalid PAT. Generate a new one in TFS User Settings." -ForegroundColor Yellow }
    if ($status -eq 404) { Write-Host "  --> Changeset not found, or wrong project name in URL." -ForegroundColor Yellow }
    exit 1
}

Write-Host ""
Write-Host "[ 3/3 ] Fetching changed files..." -ForegroundColor Yellow
$changesUrl = "$TFS_BASE/_apis/tfvc/changesets/$($ChangesetId)/changes?$API_VER"
Write-Host "        URL: $changesUrl"
try {
    $changes = Invoke-RestMethod -Uri $changesUrl -Headers $Headers -TimeoutSec 15
    $files   = $changes.value
    Write-Host "        OK - $($files.Count) file(s) found" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Changed Files:" -ForegroundColor Cyan
    foreach ($f in $files) {
        Write-Host "  [$($f.changeType)]  $($f.item.path)"
    }
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host "        FAIL (HTTP $status) - $($_.Exception.Message)" -ForegroundColor Red
    if ($status -eq 404) { Write-Host "  --> Try removing /OnBase/ from changes URL." -ForegroundColor Yellow }
    exit 1
}

Write-Host ""
Write-Host "=== All tests passed ===" -ForegroundColor Green
Write-Host ""
