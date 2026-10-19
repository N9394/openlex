Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 4
schtasks /Create /TN llama-server /TR "C:\lexvault-test\llama\llama-server.exe -m C:\lexvault-test\models\lotus-2-reasoning-q4km.gguf --host 0.0.0.0 --port 18080 --api-prefix /api --ctx-size 8192 --parallel 1 -ngl 32 --reasoning-budget 120 --log-file C:\lexvault-test\llama-serve.log" /SC ONSTART /RU SYSTEM /F | Out-Null
schtasks /Run /TN llama-server | Out-Null
Start-Sleep -Seconds 18
Write-Output ("prod task → lotus-2: " + (Get-Process llama-server -ErrorAction SilentlyContinue | Measure-Object).Count)
