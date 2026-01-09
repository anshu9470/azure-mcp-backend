# Azure MCP Agent Backend

A Node.js/TypeScript backend for the Azure MCP Agent chatbot. This service connects to Azure resources via the Model Context Protocol (MCP) and provides a streaming chat API.

## Features

- 🔧 Azure MCP integration for managing Azure resources
- 🤖 Azure OpenAI for natural language processing
- 📡 Streaming responses via Server-Sent Events
- 🐳 Docker support for containerized deployment
- ☁️ Ready for Azure App Service deployment

## Prerequisites

- Node.js 20+
- Azure subscription
- Azure OpenAI resource with a deployed model
- Azure Service Principal with appropriate permissions

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your Azure credentials:

```env
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o

AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
AZURE_SUBSCRIPTION_ID=your-subscription-id

PORT=3000
FRONTEND_URL=http://localhost:5173
```

### 3. Run Development Server

```bash
npm run dev
```

The server will start at `http://localhost:3000`.

## API Endpoints

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Chat (Streaming)

```
POST /chat
Content-Type: application/json

{
  "message": "List all storage accounts"
}
```

Response: Streaming text/plain

### Chat (Synchronous)

```
POST /chat/sync
Content-Type: application/json

{
  "message": "List all storage accounts"
}
```

Response:
```json
{
  "response": "Here are your storage accounts..."
}
```

## Azure Deployment

### Option 1: Using the Deployment Script

```bash
chmod +x scripts/deploy-azure.sh
./scripts/deploy-azure.sh
```

### Option 2: Manual Deployment

1. **Create Azure Resources:**

```bash
# Login to Azure
az login

# Create resource group
az group create --name rg-mcp-agent --location australiaeast

# Create Container Registry
az acr create --resource-group rg-mcp-agent --name acrmcpagent --sku Basic --admin-enabled true

# Create App Service Plan
az appservice plan create --name asp-mcp-agent --resource-group rg-mcp-agent --is-linux --sku B1

# Create Web App
az webapp create --resource-group rg-mcp-agent --plan asp-mcp-agent --name app-mcp-agent-backend --deployment-container-image-name mcr.microsoft.com/appsvc/staticsite:latest
```

2. **Build and Push Docker Image:**

```bash
# Build and push using ACR
az acr build --registry acrmcpagent --image mcp-agent-backend:latest --file Dockerfile .
```

3. **Configure Web App:**

```bash
# Get ACR credentials
ACR_LOGIN_SERVER=$(az acr show --name acrmcpagent --query loginServer -o tsv)
ACR_USERNAME=$(az acr credential show --name acrmcpagent --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name acrmcpagent --query "passwords[0].value" -o tsv)

# Configure container
az webapp config container set \
    --name app-mcp-agent-backend \
    --resource-group rg-mcp-agent \
    --docker-custom-image-name "$ACR_LOGIN_SERVER/mcp-agent-backend:latest" \
    --docker-registry-server-url "https://$ACR_LOGIN_SERVER" \
    --docker-registry-server-user $ACR_USERNAME \
    --docker-registry-server-password $ACR_PASSWORD
```

4. **Set Environment Variables:**

```bash
az webapp config appsettings set \
    --resource-group rg-mcp-agent \
    --name app-mcp-agent-backend \
    --settings \
    AZURE_OPENAI_ENDPOINT="your-endpoint" \
    AZURE_OPENAI_API_KEY="your-api-key" \
    AZURE_OPENAI_DEPLOYMENT="gpt-4o" \
    AZURE_CLIENT_ID="your-client-id" \
    AZURE_CLIENT_SECRET="your-client-secret" \
    AZURE_TENANT_ID="your-tenant-id" \
    AZURE_SUBSCRIPTION_ID="your-subscription-id" \
    FRONTEND_URL="https://your-frontend-url.com"
```

### Option 3: GitHub Actions CI/CD

1. Create an Azure Service Principal:

```bash
az ad sp create-for-rbac --name "github-actions-sp" --role contributor \
    --scopes /subscriptions/{subscription-id}/resourceGroups/rg-mcp-agent \
    --sdk-auth
```

2. Add the JSON output as a GitHub secret named `AZURE_CREDENTIALS`.

3. Push to the `main` branch to trigger deployment.

## Azure Service Principal Permissions

The service principal used for MCP needs the following permissions:

- **Reader** role on the subscription (for listing resources)
- **Storage Blob Data Reader** (for storage operations)
- **Resource Graph Reader** (for resource graph queries)

```bash
# Assign Reader role
az role assignment create \
    --assignee <client-id> \
    --role "Reader" \
    --scope /subscriptions/<subscription-id>

# Assign Storage Blob Data Reader
az role assignment create \
    --assignee <client-id> \
    --role "Storage Blob Data Reader" \
    --scope /subscriptions/<subscription-id>
```

## Project Structure

```
backend/
├── src/
│   ├── app.ts              # Express server entry point
│   └── mcp/
│       ├── index.ts        # Module exports
│       ├── agent.ts        # Azure MCP Agent with OpenAI
│       └── azure-mcp-client.ts  # MCP client wrapper
├── scripts/
│   └── deploy-azure.sh     # Azure deployment script
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions workflow
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### MCP Connection Issues

- Ensure Node.js 20+ is installed
- Check that the service principal has correct permissions
- Verify all environment variables are set correctly

### Container Startup Issues

View logs in Azure Portal or via CLI:

```bash
az webapp log tail --name app-mcp-agent-backend --resource-group rg-mcp-agent
```

### CORS Issues

Update `FRONTEND_URL` environment variable to match your frontend's domain.

## License

MIT
