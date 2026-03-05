# Build Clapshot client locally

$CLIENT = "D:\Clapshot\client"
$PROTO_TS = "D:\Clapshot\protobuf\libs\typescript"

Write-Host "Build: protobuf typescript" -ForegroundColor Cyan
Set-Location $PROTO_TS
if (-not (Test-Path "node_modules")) { npm install }
npx tsc

Write-Host "Build: client" -ForegroundColor Cyan
Set-Location $CLIENT
if (-not (Test-Path "node_modules")) { npm install }
npm run build

Write-Host "Client dist at: $CLIENT\dist" -ForegroundColor Green
