# Least-Privilege Sentinel — Demo Script

## Prompt to paste in TrueForge

> Review all IAM roles in my AWS account. For each role, check its policies and last 90 days of usage. Compute a risk score in the sandbox. Propose a least-privilege remediation for any role scoring above 40. Before revoking anything, present your evidence and wait for my approval.

## What the judges will see

1. Discovery — agent calls list_identities (ungated)
2. Investigation — agent calls get_identity_policies and get_identity_usage (ungated)
3. Sandbox — agent writes Python risk scorer and runs it in the sandbox
4. Proposal — agent presents findings per role
5. The Gate — agent calls revoke_role. TrueForge pauses. UI shows proposed call with arguments.
6. Decision — click Deny first. Agent handles it. Then Approve the next one.
7. Verification — agent confirms the action and logs the audit trail.

## Key points to say

- The approval gate is structural, defined in agent.json under require_approval_for_tools — not in the prompt.
- The agent cannot bypass the gate.
- Risk scoring runs in the sandbox, not on the host.
- Every event is captured in the TrueForge session trace.