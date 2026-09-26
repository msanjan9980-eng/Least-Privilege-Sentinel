// MCP server for Least-Privilege Sentinel — Vercel serverless handler.
// No Express, no external SDK. Handles MCP JSON-RPC over POST, plus GET status.

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

const TOOLS = [
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
      properties: { role_name: { type: "string", description: "IAM role name." } },
      required: ["role_name"],
    },
  },
  {
    name: "get_identity_usage",
    description: "Query usage evidence for an IAM role.",
    inputSchema: {
      type: "object",
      properties: { role_name: { type: "string" }, days: { type: "number" } },
      required: ["role_name"],
    },
  },
  {
    name: "revoke_role",
    description: "Delete an IAM role. This is irreversible and requires human approval.",
    inputSchema: {
      type: "object",
      properties: { role_name: { type: "string" }, reason: { type: "string" } },
      required: ["role_name", "reason"],
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case "list_identities":
      return mockData.identities.map((i) => ({ name: i.name, arn: i.arn, created: i.created }));
    case "get_identity_policies": {
      const identity = mockData.identities.find((i) => i.name === args.role_name);
      if (!identity) throw new Error(`Role not found: ${args.role_name}`);
      return {
        role_name: args.role_name,
        managed: identity.managed_policies,
        inline: identity.inline_policies,
        boundary: identity.boundary,
      };
    }
    case "get_identity_usage": {
      const identity = mockData.identities.find((i) => i.name === args.role_name);
      if (!identity) throw new Error(`Role not found: ${args.role_name}`);
      const last = new Date(identity.last_activity);
      const daysSince = Math.floor((new Date() - last) / (1000 * 60 * 60 * 24));
      return {
        role_name: args.role_name,
        observation_window_days: args.days || 90,
        last_activity: identity.last_activity,
        days_since_last_activity: daysSince,
        call_count: identity.call_count_last_90d,
        actions_used: identity.actions_used,
      };
    }
    case "revoke_role":
      return {
        status: "revoked",
        role_name: args.role_name,
        reason: args.reason,
        executed_at: new Date().toISOString(),
        mode: "mock",
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      name: "Least-Privilege Sentinel MCP Server",
      version: "1.0.0",
      status: "running",
      tools: TOOLS.map((t) => t.name),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;
    const { method, params, id } = body;

    if (method === "tools/list") {
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      const result = await handleToolCall(name, args);
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    }

    return res.status(200).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (error) {
    return res.status(200).json({
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: { code: -32603, message: error.message },
    });
  }
}