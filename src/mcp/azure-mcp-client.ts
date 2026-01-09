import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class AzureMCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: MCPTool[] = [];
  private isConnected = false;

  constructor(
    private config: {
      clientId: string;
      clientSecret: string;
      tenantId: string;
      subscriptionId: string;
      namespaces?: string[];
      readOnly?: boolean;
    }
  ) {}

  async connect(): Promise<void> {
    if (this.isConnected) return;

    const args = ["-y", "@azure/mcp@latest", "server", "start"];

    // Add namespaces
    const namespaces = this.config.namespaces || [
      "storage",
      "resources",
      "resourcegraph",
    ];
    for (const ns of namespaces) {
      args.push("--namespace", ns);
    }

    if (this.config.readOnly) {
      args.push("--read-only");
    }

    // Create transport with command and args
    this.transport = new StdioClientTransport({
      command: "npx",
      args: args,
      env: {
        ...process.env,
        AZURE_CLIENT_ID: this.config.clientId,
        AZURE_CLIENT_SECRET: this.config.clientSecret,
        AZURE_TENANT_ID: this.config.tenantId,
        AZURE_SUBSCRIPTION_ID: this.config.subscriptionId,
        NODE_NO_WARNINGS: "1",
      } as Record<string, string>,
    });

    this.client = new Client(
      { name: "azure-mcp-agent", version: "1.0.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this.isConnected = true;

    // Fetch available tools
    const toolsResponse = await this.client.listTools();
    this.tools = toolsResponse.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));

    console.log(`[MCP] Connected with ${this.tools.length} tools available`);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw new Error("MCP client not connected");
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getOpenAITools(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return this.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
    this.client = null;
    this.transport = null;
    this.isConnected = false;
  }
}