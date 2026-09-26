$TRUEFORGE_URL = "http://localhost:8790"

$OPENAI_KEY = $env:OPENAI_API_KEY
if (-not $OPENAI_KEY) {
    Write-Host "ERROR: Set OPENAI_API_KEY first."
    Write-Host "  `$env:OPENAI_API_KEY = 'sk-...'"
    exit 1
}

Write-Host "1/3 Registering OpenAI model provider..."
$modelBody = @{
    name = "openai"
    type = "openai"
    api_key = $OPENAI_KEY
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$TRUEFORGE_URL/api/v1/settings/model-providers" `
        -Method Post -ContentType "application/json" -Body $modelBody | Out-Null
    Write-Host "    OpenAI registered."
} catch {
    Write-Host "    OpenAI may already be registered: $($_.Exception.Message)"
}

Write-Host "2/3 Registering iam-sentinel MCP server..."
$mcpBody = @{
    name = "iam-sentinel"
    url = "http://127.0.0.1:8000/mcp"
    auth = @{ type = "none" }
} | ConvertTo-Json -Depth 5

try {
    Invoke-RestMethod -Uri "$TRUEFORGE_URL/api/v1/settings/mcp-servers" `
        -Method Post -ContentType "application/json" -Body $mcpBody | Out-Null
    Write-Host "    MCP server registered."
} catch {
    Write-Host "    MCP server may already be registered: $($_.Exception.Message)"
}

Write-Host "3/3 Registering least-privilege-sentinel agent..."
$agentBody = Get-Content "agent.json" -Raw
$agentWrapper = @{
    name = "least-privilege-sentinel"
    description = "Autonomous IAM access review agent. Investigates roles, computes risk in a sandbox, and proposes least-privilege remediations with human approval before any revocation."
    manifest = ($agentBody | ConvertFrom-Json)
} | ConvertTo-Json -Depth 20

try {
    Invoke-RestMethod -Uri "$TRUEFORGE_URL/api/v1/agents" `
        -Method Post -ContentType "application/json" -Body $agentWrapper | Out-Null
    Write-Host "    Agent registered."
} catch {
    Write-Host "    Agent may already be registered: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "Open $TRUEFORGE_URL -> Agents -> least-privilege-sentinel"