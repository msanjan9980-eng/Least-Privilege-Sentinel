# risk_scorer.py
# Reference script the agent will generate in the TrueForge sandbox.
# Computes a risk score for each IAM role from its permissions + usage.

import json
from datetime import datetime, timezone

SENSITIVE_ACTIONS = ["iam:*", "s3:Delete*", "*:*", "dynamodb:Delete*", "kms:*"]
DORMANCY_THRESHOLD_DAYS = 90

def risk_score(role, reference_date=None):
    """Return (score 0-100, verdict) for an IAM role dict."""
    if reference_date is None:
        reference_date = datetime.now(timezone.utc)

    # --- Dormancy component (0-40) ---
    last = role.get("last_activity")
    if last:
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        days_dormant = (reference_date - last_dt).days
    else:
        days_dormant = 9999

    if days_dormant >= 365:
        dormancy = 40
    elif days_dormant >= DORMANCY_THRESHOLD_DAYS:
        dormancy = 25
    elif days_dormant >= 30:
        dormancy = 10
    else:
        dormancy = 0

    # --- Permission breadth (0-30) ---
    all_actions = set()
    for pol in role.get("managed_policies", []):
        for stmt in pol["document"].get("Statement", []):
            act = stmt.get("Action")
            if isinstance(act, list):
                all_actions.update(act)
            elif act:
                all_actions.add(act)
    for pol in role.get("inline_policies", []):
        for stmt in pol["document"].get("Statement", []):
            act = stmt.get("Action")
            if isinstance(act, list):
                all_actions.update(act)
            elif act:
                all_actions.add(act)

    if any(a in ("*", "*:*") for a in all_actions):
        breadth = 30
    elif any(a.startswith("iam:") for a in all_actions):
        breadth = 25
    elif len(all_actions) > 20:
        breadth = 20
    elif len(all_actions) > 5:
        breadth = 10
    else:
        breadth = 5

    # --- Sensitivity bonus (0-30) ---
    sensitivity = 0
    for a in all_actions:
        for s in SENSITIVE_ACTIONS:
            if a == s or (s.endswith("*") and a.startswith(s[:-1])):
                sensitivity += 10
                break
    sensitivity = min(sensitivity, 30)

    score = dormancy + breadth + sensitivity

    if score >= 70:
        verdict = "REVOKE_CANDIDATE"
    elif score >= 40:
        verdict = "REVIEW_REQUIRED"
    else:
        verdict = "SAFE"

    return {
        "name": role["name"],
        "score": score,
        "dormancy_component": dormancy,
        "breadth_component": breadth,
        "sensitivity_component": sensitivity,
        "days_dormant": days_dormant,
        "verdict": verdict,
    }


if __name__ == "__main__":
    with open("mock-data.json") as f:
        data = json.load(f)

    results = [risk_score(r) for r in data["identities"]]
    results.sort(key=lambda x: x["score"], reverse=True)

    print(json.dumps(results, indent=2))