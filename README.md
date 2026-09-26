# Least-Privilege Sentinel

> An autonomous IAM access-review agent that investigates permissions, computes risk in a sandbox, and proposes least-privilege remediations - but **cannot revoke anything without human approval**.

Built on **TrueForge** for the *Agents That Act* hackathon (TrueFoundry x Polaris, 26 Sep 2026).

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Required Capabilities](#required-capabilities)
- [Architecture](#architecture)
- [The Approval Gate](#the-approval-gate)
- [The Demo](#the-demo)
- [Setup](#setup)
- [Repository Structure](#repository-structure)
- [Tech Stack](#tech-stack)
- [AI Tools Used](#ai-tools-used)
- [License](#license)

---

## The Problem

Organizations accumulate IAM permissions faster than they remove them. Every temporary project, every role assumption, every "just in case" policy grant leaves behind a residual permission that nobody owns and nobody remembers.

These dormant permissions are the primary attack surface for lateral movement in modern cloud breaches. An attacker does not need to exploit a vulnerability if they can simply assume a forgotten role with `AdministratorAccess` that has not been used in two years.

**The 2019 Capital One breach** - which exposed 100 million customer records - began with an over-privileged role that should not have existed.

The problem is not that security teams do not know this. The problem is that:

1. **Reviewing access at scale is tedious.** A human reviewing 500 roles cannot hold the full permission graph, inheritance chain, and 90-day usage history in their head.
2. **Automating it naively is dangerous.** An agent that revokes everything unused will eventually break a production cron job, a disaster recovery runbook, or a compliance reporting pipeline.

The industry needs agents that can *act*, not just *answer* - but can also **stop and ask** before doing something irreversible.

---

## The Solution

**Least-Privilege Sentinel** is a TrueForge agent that performs the investigation, analysis, and proposal work of an access review - then **stops and waits for a human signature** before any permission is actually revoked.

It makes the human's job faster, more informed, and safer, without removing the human from the decision.

### What the agent does

1. **Investigates** - reaches into a live IAM system via MCP and pulls every role, every attached policy, and 90 days of usage evidence.
2. **Computes** - writes a Python script and runs it in a Daytona sandbox to compute a risk score for each role.
3. **Proposes** - presents a structured findings table with evidence and a least-privilege remediation plan.
4. **Stops** - when it decides to revoke a role, the tool is gated. TrueForge pauses the turn and waits for a human to click Allow or Deny.

### What the agent does NOT do

- It does not revoke without approval.
- It does not run code on your machine or on the TrueForge server.
- It does not embed credentials in the agent definition.
- It does not make irreversible decisions on its own.

---

## Required Capabilities

The hackathon rules require three things. This project delivers all three.

| Requirement | How This Project Delivers It |
|---|---|
| **Reach a real system** | MCP server exposing IAM tools, deployed on Vercel |
| **Run code safely in a sandbox** | Daytona sandbox executes the risk-scoring Python script |
| **Stop before irreversible actions** | revoke_role gated by require_approval_for_tools in the agent manifest |

The approval gate is **structural, not prompt-based**. The agent is *unable* to execute `revoke_role` without approval - not merely instructed to ask. Even if the language model attempted to call the tool directly, TrueForge intercepts the call at the harness level and pauses.

---

## Architecture

    +-------------------------------------------------------------+
    |                     TrueForge Harness                        |
    |  Runs the agent loop. Enforces approval rules.               |
    |  Persists sessions. Streams events.                          |
    |                                                              |
    |   +-------------------------------------------------------+  |
    |   |  Agent: least-privilege-sentinel                      |  |
    |   |  Model: openai/gpt-5-4-mini                           |  |
    |   |  Gate: require_approval_for_tools = [revoke_role]     |  |
    |   +-------------------------------------------------------+  |
    |                            |                                 |
    |              +-------------+-------------+                   |
    |              v             v             v                   |
    |        +----------+  +----------+  +------------+            |
    |        |  MCP     |  | Sandbox  |  | Approval   |            |
    |        |  Tools   |  | (Daytona)|  |  Gate      |            |
    |        +----+-----+  +----------+  +------------+            |
    +-------------+------------------------------------------------+
                  v
       https://least-privilege-sentinel.vercel.app/api/index
       (MCP server exposing 4 IAM tools)

### Components

| Component | Purpose | Location |
|---|---|---|
| **TrueForge Harness** | Runs the agent loop, enforces approval rules, persists sessions | Local (http://localhost:8790) |
| **MCP Server** | Exposes IAM tools to the agent | Deployed on Vercel |
| **Daytona Sandbox** | Isolated environment for agent-generated code | Provisioned on demand |
| **Approval Gate** | Pauses the agent before revoke_role executes | Enforced by TrueForge |

### Tools exposed by the MCP server

| Tool | Annotation | Behavior |
|---|---|---|
| list_identities | readOnlyHint: true | Returns all IAM roles (name, ARN, created) |
| get_identity_policies | readOnlyHint: true | Returns managed + inline policies for a role |
| get_identity_usage | readOnlyHint: true | Returns last activity and 90-day call count |
| revoke_role | destructiveHint: true | **Gated by TrueForge approval** |

The annotations are how TrueForge distinguishes safe tools from dangerous ones. Read-only tools run autonomously. Destructive tools pause for human approval.

---

## The Approval Gate

### How it works

The gate is declared in `agent.json`:

    "mcp_servers": [
      {
        "name": "iam-sentinel",
        "enable_tools": ["@all"],
        "require_approval_for_tools": ["@destructive", "revoke_role"],
        "preload": false
      }
    ]

When the agent calls a tool matching that rule, TrueForge:

1. Intercepts the call **before it executes**
2. Pauses the turn
3. Displays the tool name and full arguments in the chat
4. Waits for the human to click **Allow** or **Deny**

### What the human sees

    Tool Approval Required for revoke_role (iam-sentinel)

    Request:
    {
      "role_name": "admin-backup-role",
      "reason": "User approved revocation after review: role has
                 AdministratorAccess, 0 calls in the last 90 days,
                 and 564 days since last activity; high-risk unused role."
    }

    [Allow] [Deny]

### What happens after

- **Deny** - the agent acknowledges the denial, records it in the audit trail, and moves on gracefully.
- **Allow** - the tool executes, the result is reported, and the decision is logged.

Every event is captured in TrueForge's **Sessions** view - a permanent audit trail of what the agent did, what it proposed, and what the human decided.

### Why the gate is structural

The requirement lives in the **agent manifest**, not in the system prompt.

- The agent is *unable* to bypass it - not merely instructed not to.
- Even if the model tried to call `revoke_role` directly, TrueForge would intercept.
- The gate is enforced at the harness level, not by the model's cooperation.

This is the difference between *"the agent chooses to ask permission"* and *"the agent cannot act without permission."*

---

## The Demo

### What you see when you run it

**Step 1 - Discovery**

The agent calls `list_identities` (ungated). It discovers 4 IAM roles.

**Step 2 - Investigation**

For each role, the agent calls `get_identity_policies` and `get_identity_usage` (ungated). It gathers policy documents and usage evidence.

**Step 3 - Sandboxed Computation**

The agent writes a Python script that:

- Parses each policy document to extract allowed actions
- Combines dormancy, permission breadth, and sensitivity into a risk score
- Produces a proposed least-privilege remediation

The script runs in the **Daytona sandbox** - isolated, disposable, no credentials.

**Step 4 - Evidence-Based Proposal**

The agent presents a findings table:

| Role | Last activity | Days dormant | Risk score | Proposed action |
|---|---|---|---|---|
| legacy-reporting-role | 2024-01-15 | 985 | 100 | Revoke (unused S3 full access) |
| ci-deploy-role | 2026-09-25 | 0 | 0 | Keep (active) |
| admin-backup-role | 2025-03-10 | 564 | 100 | Revoke (unused AdministratorAccess) |
| lambda-processor-role | 2026-09-26 | 0 | 20 | Keep (active) |

**Step 5 - The Gate**

The agent calls `revoke_role` for `admin-backup-role`.

**TrueForge pauses the turn.** The chat shows:

    Tool Approval Required for revoke_role (iam-sentinel)

    Request:
    {
      "role_name": "admin-backup-role",
      "reason": "User approved revocation after review: role has
                 AdministratorAccess, 0 calls in the last 90 days,
                 and 564 days since last activity; high-risk unused role."
    }

    [Allow] [Deny]

The agent **cannot proceed** until a human decides.

**Step 6 - Decision**

The human clicks **Deny** first to demonstrate rejection handling. The agent acknowledges gracefully and moves on.

Then the human replies *"Approved - revoke admin-backup-role"* and clicks **Allow**.

**Step 7 - Execution**

    admin-backup-role has been revoked.

    Details:
      Role: admin-backup-role
      ARN: arn:aws:iam::123456789012:role/admin-backup-role
      Reason: approved revocation after review; the role had AdministratorAccess,
              0 calls in the last 90 days, and 564 days since last activity
      Executed at: 2026-09-26T10:53:23.563Z
      Mode: mock

**Step 8 - Audit Trail**

Every tool call, approval request, human decision, and execution result is recorded in TrueForge's **Sessions** view. The event timeline shows:

- `tool.approval_required`
- the human's `allow` / `deny` decision
- the tool's `response`

This is the proof that the gate is real and enforced at the harness level.

---

## Setup

### Prerequisites

- **Node.js 22.14+**
- **Git**
- **TrueForge hackathon credits** - includes OpenAI API credits and Daytona sandbox access

### 1. Start TrueForge

    npx @truefoundry/trueforge@latest

Leave this terminal running. TrueForge serves the UI and API at http://localhost:8790.

### 2. Deploy the MCP server

The MCP server is already deployed on Vercel at:

    https://least-privilege-sentinel.vercel.app/api/index

To redeploy from source:

    cd mcp-server
    git push

Vercel auto-deploys on push to main.

### 3. Register providers in TrueForge UI

Open http://localhost:8790 and configure:

**Settings -> Models -> OpenAI**

- Paste your OpenAI API key
- Save

**Settings -> Connectors -> Add MCP Server**

- **Name:** iam-sentinel
- **URL:** https://least-privilege-sentinel.vercel.app/api/index
- **Auth:** None
- Save

**Settings -> Sandbox providers -> Daytona**

- Paste your Daytona API key
- Save

Verify all three are green:

    curl http://localhost:8790/api/v1/capabilities

Expected:

    {"data":{"sandbox":{"enabled":true}, ...}}

### 4. Register the agent

    curl -X POST http://localhost:8790/api/v1/agents \
      -H "Content-Type: application/json" \
      --data-binary "@agent-payload.json"

### 5. Run the demo

Open http://localhost:8790 -> **Agents** -> **least-privilege-sentinel** -> **Try**.

Paste this prompt:

    Review all IAM roles in my account. For each role, check its policies
    and last 90 days of usage. Compute a risk score. Propose a least-privilege
    remediation for any role scoring above 40. Before revoking anything,
    present your evidence and wait for my approval.

When the agent proposes revocation, reply:

    Yes, revoke admin-backup-role. Proceed.

Watch for the **Tool Approval Required** prompt. Click **Allow** or **Deny**.

---

## Repository Structure

    Least-Privilege-Sentinel/
    |-- README.md                    # This file
    |-- agent.json                   # TrueForge agent manifest (with approval gate)
    |-- agent-payload.json           # Wrapped payload for API registration
    |-- demo-script.md               # Demo walkthrough
    |-- setup.ps1                    # Optional registration script
    |-- .gitignore
    |-- mcp-server/
        |-- api/
        |   |-- index.js             # MCP server (Vercel serverless)
        |-- mock-data.json           # Simulated IAM data for demo
        |-- risk_scorer.py           # Reference sandbox script
        |-- package.json
        |-- package-lock.json

### What each file does

| File | Purpose |
|---|---|
| agent.json | Defines the agent's model, instructions, MCP server attachment, and the structural approval gate |
| mcp-server/api/index.js | The MCP server itself - exposes 4 IAM tools with proper protocol annotations |
| mcp-server/mock-data.json | 4 simulated IAM roles for the demo (no real AWS account required) |
| mcp-server/risk_scorer.py | Reference Python script that the agent writes in the sandbox |
| demo-script.md | Exact click-by-click walkthrough for the live demo |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Agent Harness** | TrueForge (open-source, MIT) |
| **Language Model** | OpenAI GPT-5.4-mini |
| **Tool Protocol** | Model Context Protocol (MCP) |
| **MCP Server Runtime** | Node.js + Express on Vercel serverless |
| **Sandbox** | Daytona (isolated code execution) |
| **Session Storage** | TrueForge SQLite (local) |

---

## Why This Matters

### The approval gate is structural

The requirement lives in `agent.json` under `require_approval_for_tools`, not in the system prompt. The agent is **unable** to bypass it - not merely instructed not to. Even if the model tried to call the tool directly, TrueForge intercepts and pauses.

This is what the hackathon means when it says *"stop before irreversible actions and wait for human approval."*

### The agent is genuinely useful

Without the agent, this review would take a security engineer hours of cross-referencing policy documents and usage logs. With the agent, it takes 30 seconds and produces a structured, evidence-backed proposal.

### The human stays in control

The agent's role is to make the human's decision **faster, more informed, and safer**. It does not remove the human from the loop. The final call - revoke or not - belongs to a person.

This is what it looks like to hand a real job to AI without handing over the risk.

---

## AI Tools Used

Per hackathon rules, the AI assistants used in this project are disclosed below:

- **Claude (Anthropic)** - architecture design, MCP server implementation, agent manifest, README, and demo documentation.

All code in this repository was written and understood by the team. No component was generated and shipped without review.

---

## License

MIT

---

**Built for the Agents That Act hackathon** - TrueFoundry x Polaris School of Technology, Bengaluru, 26 Sep 2026.