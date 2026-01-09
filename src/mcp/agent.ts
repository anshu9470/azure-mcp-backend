import { AzureOpenAI } from "openai";
import { AzureMCPClient } from "./azure-mcp-client.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";

export interface AgentConfig {
  azureOpenAI: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion?: string;
  };
  azureMCP: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    subscriptionId: string;
    namespaces?: string[];
    readOnly?: boolean;
  };
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are an Azure assistant connected to an Azure MCP server.

Important rules:
- You already have access to the current Azure subscription via MCP tools.
- NEVER ask the user for subscription ID or subscription name.
- Assume all questions are for the currently configured subscription.
- If a list or count of Azure resources is requested, use Resource Graph or Resources APIs.
- If storage account internals are requested, use the Storage namespace.
- If an operation fails, explain what is missing in simple terms instead of asking for subscription details.
- Be concise and helpful in your responses.
- Format lists and technical information clearly.`;

export class AzureMCPAgent {
  private openai: AzureOpenAI;
  private mcpClient: AzureMCPClient;
  private systemPrompt: string;
  private deployment: string;
  private initialized = false;

  constructor(config: AgentConfig) {
    this.openai = new AzureOpenAI({
      endpoint: config.azureOpenAI.endpoint,
      apiKey: config.azureOpenAI.apiKey,
      apiVersion: config.azureOpenAI.apiVersion || "2024-08-01-preview",
    });

    this.deployment = config.azureOpenAI.deployment;
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    this.mcpClient = new AzureMCPClient({
      clientId: config.azureMCP.clientId,
      clientSecret: config.azureMCP.clientSecret,
      tenantId: config.azureMCP.tenantId,
      subscriptionId: config.azureMCP.subscriptionId,
      namespaces: config.azureMCP.namespaces,
      readOnly: config.azureMCP.readOnly ?? true,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.mcpClient.connect();
    this.initialized = true;
    console.log("[Agent] Initialized with MCP tools");
  }

  async *runStream(
    userMessage: string,
    conversationHistory: ChatCompletionMessageParam[] = []
  ): AsyncGenerator<string> {
    await this.initialize();

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemPrompt },
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    const tools = this.mcpClient.getOpenAITools();

    // Loop to handle tool calls
    while (true) {
      const stream = await this.openai.chat.completions.create({
        model: this.deployment,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
      });

      let currentContent = "";
      let toolCalls: Array<{
        id: string;
        function: { name: string; arguments: string };
      }> = [];
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        finishReason = chunk.choices[0]?.finish_reason;

        // Handle content streaming
        if (delta?.content) {
          currentContent += delta.content;
          yield delta.content;
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;

            if (!toolCalls[index]) {
              toolCalls[index] = {
                id: toolCall.id || "",
                function: { name: "", arguments: "" },
              };
            }

            if (toolCall.id) {
              toolCalls[index].id = toolCall.id;
            }
            if (toolCall.function?.name) {
              toolCalls[index].function.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              toolCalls[index].function.arguments +=
                toolCall.function.arguments;
            }
          }
        }
      }

      // If no tool calls, we're done
      if (finishReason !== "tool_calls" || toolCalls.length === 0) {
        break;
      }

      // Process tool calls
      yield "\n\n🔧 *Calling Azure tools...*\n\n";

      // Add assistant message with tool calls
      messages.push({
        role: "assistant",
        content: currentContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: tc.function,
        })),
      });

      // Execute each tool call and add results
      for (const toolCall of toolCalls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          console.log(
            `[Tool Call] ${toolCall.function.name}:`,
            JSON.stringify(args, null, 2)
          );

          const result = await this.mcpClient.callTool(
            toolCall.function.name,
            args
          );

          const toolMessage: ChatCompletionToolMessageParam = {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          };
          messages.push(toolMessage);
        } catch (error) {
          console.error(`[Tool Error] ${toolCall.function.name}:`, error);
          const toolMessage: ChatCompletionToolMessageParam = {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          };
          messages.push(toolMessage);
        }
      }

      // Reset for next iteration
      toolCalls = [];
    }
  }

  async run(userMessage: string): Promise<string> {
    let result = "";
    for await (const chunk of this.runStream(userMessage)) {
      result += chunk;
    }
    return result;
  }

  async disconnect(): Promise<void> {
    await this.mcpClient.disconnect();
    this.initialized = false;
  }
}
