// mcp-server/api/index.js
// MCP server for Least-Privilege Sentinel — Vercel serverless version.
// Mock IAM data is inlined to avoid filesystem dependencies in serverless.

import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ---------- Mock IAM data (inlined) ----------
const mockData = {
  identities: [
    {
      name: "legacy-reporting-role",
      arn: "arn:aws:iam::123456789012:role/legacy-reporting-role",
      created: "2023-04-12T10:22:00Z",
      managed_policies: [
        {
          name: "AmazonS3FullAccess",
          document: {
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: "s3:*", Resource: "*" }],
          },
        },
      ],
      inline_policies: [],
      boundary: null,
      last_activity: "2024-01-15T08:30:00Z",
      call_count_last_90d: 0,
      actions_used: [],
    },
    {
      name: "ci-deploy-role",
      arn: "arn:aws:iam::123456789012:role/ci-deploy-role",
      created: "2024-06-01T14:00:00Z",
      managed_policies: [
        {
          name: "AmazonEC2ContainerRegistryPowerUser",
          document: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "ecr:GetAuthorizationToken",
                  "ecr:BatchCheckLayerAvailability",
                  "ecr:PutImage",
                ],
                Resource: "*",
              },
            ],
          },
        },
      ],
      inline_policies: [],
      boundary: null,
      last_activity: "2026-09-25T22:15:00Z",
      call_count_last_90d: 412,
      actions_used: ["ecr:PutImage", "ecr:GetAuthorizationToken"],
    },
    {
      name: "admin-backup-role",
      arn: "arn:aws:iam::123456789012:role/admin-backup-role",
      created: "2022-11-08T09:00:00Z",
      managed_policies: [
        {
          name: "AdministratorAccess",
          document: {
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }],
          },
        },
      ],
      inline_policies: [],
      boundary: null,
      last_activity: "2025-03-10T11:45:00Z",
      call_count_last_90d: 0,
      actions_used: [],
    },
    {
      name: "lambda-processor-role",
      arn: "arn:aws:iam::123456789012:role/lambda-processor-role",
      created: "2025-02-20T16:30:00Z",
      managed_policies: [
        {
          name: "AmazonDynamoDBFullAccess",
          document: {
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: "dynamodb:*", Resource: "*" }],
          },
        },
      ],
      inline_policies: [
        {
          name: "CloudWatchLogsWrite",
          document: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["logs:CreateLogGroup", "logs:PutLogEvents"],
                Resource: "*",
              },
            ],
          },
        },
      ],
      boundary: null,
      last_activity: "2026-09-26T05:10:00Z",
      call_count_last_90d: 1847,
      actions_used: ["dynamodb:PutItem", "dynamodb:GetItem", "logs:PutLogEvents"],
    },
  ],
};

// ---------- Tool implementations ----------

async function listIdentities() {
  return mockData.identities.map((i) => ({
    name: i.name,
    arn: i.arn,
    created: i.created,
  }));
}

async function getIdentityPolicies({ role_name }) {
  const identity = mockData.identities.find((i) => i.name === role_name);
  if (!identity) throw new Error(`Role not found: ${role_name}`);
  return {
    role_name,
    managed: identity.managed_policies,
    inline: identity.inline_policies,
    boundary: identity.boundary,
  };
}

async function getIdentityUsage({ role_name, days = 90 }) {
  const identity = mockData.identities.find((i) => i.name === role_name);
  if (!identity) throw new Error(`Role not found: ${role_name}`);

  let daysSinceLastActivity = null;
  if (identity.last_activity) {
    const last = new Date(identity.last_activity);
    const now = new Date();
    daysSinceLastActivity = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  }

  return {
    role_name,
    observation_window_days: days,
    last_activity: identity.last_activity,
    days_since_last_activity: daysSinceLastActivity,
    call_count: identity.call_count_last_90d,
    actions_used: identity.actions_used,
  };
}

async function revokeRole({ role_name, reason }) {
  return {
    status: "revoked",
    role_name,
    reason,
    executed_at: new Date().toISOString(),
    mode: "mock",
  };
}

// ---------- MCP server factory ----------

function createMcpServer() {
  const server = new Server(
    { name: "least-privilege-sentinel", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_identities",
        description: "List all IAM roles in the account.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "get_identity_policies",
        description: "Fetch all policies attached to an IAM role.",
        inputSchema: {
          type: "object",
          properties: {
            role_name: { type: "string", description: "IAM role name." },
          },
          required: ["role_name"],
        },
      },
      {
        name: "get_identity_usage",
        description: "Query usage evidence for an IAM role.",
        inputSchema: {
          type: "object",
          properties: {
            role_name: { type: "string" },
            days: { type: "number" },
          },
          required: ["role_name"],
        },
      },
      {
        name: "revoke_role",
        description:
          "Delete an IAM role. This is irreversible and requires human approval via the agent's approval gate.",
        inputSchema: {
          type: "object",
          properties: {
            role_name: { type: "string" },
            reason: { type: "string" },
          },
          required: ["role_name", "reason"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      let result;
      switch (name) {
        case "list_identities":
          result = await listIdentities();
          break;
        case "get_identity_policies":
          result = await getIdentityPolicies(args);
          break;
        case "get_identity_usage":
          result = await getIdentityUsage(args);
          break;
        case "revoke_role":
          result = await revokeRole(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: error.message }) },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ---------- HTTP transport ----------

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

// Export for Vercel
export default app;