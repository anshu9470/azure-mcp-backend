import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AzureMCPAgent } from "./mcp/index.js";

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "AZURE_SUBSCRIPTION_ID",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Create the agent instance
const agent = new AzureMCPAgent({
  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT!,
  },
  azureMCP: {
    clientId: process.env.AZURE_CLIENT_ID!,
    clientSecret: process.env.AZURE_CLIENT_SECRET!,
    tenantId: process.env.AZURE_TENANT_ID!,
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID!,
    namespaces: ["storage", "resources", "resourcegraph"],
    readOnly: true,
  },
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Chat endpoint with streaming
app.post("/chat", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    // Set headers for streaming
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Stream the response
    for await (const chunk of agent.runStream(message)) {
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    console.error("[Chat Error]:", error);

    // Check if headers already sent
    if (!res.headersSent) {
      res.status(500).json({
        error: "An error occurred while processing your request",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    } else {
      res.end("\n\n[Error: Something went wrong]");
    }
  }
});

// Chat endpoint without streaming (alternative)
app.post("/chat/sync", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const response = await agent.run(message);
    res.json({ response });
  } catch (error) {
    console.error("[Chat Sync Error]:", error);
    res.status(500).json({
      error: "An error occurred while processing your request",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  await agent.disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  await agent.disconnect();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 Chat endpoint: POST http://localhost:${PORT}/chat`);
});
