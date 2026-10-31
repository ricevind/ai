# Jev via the local Cloudflare AI Gateway

How to call TypeSafe's **Jev** (`typesafe/jev`, currently `jev-1.13.0`) through
Cloudflare instead of TypeSafe's own API. Verified working in this environment
(2026-09-19 session) via the account's AI Gateway `pi-mk`. Cloudflare proxies
the request to TypeSafe and adds its own envelope, logging, and rate limiting.

## Credentials (this machine)

- API token: stored in the macOS keychain, service `pi-cloudflare-token`
  (pi resolves it via `security find-generic-password -s pi-cloudflare-token -w`;
  the pi auth entry `cloudflare-ai-gateway` in `~/.pi/agent/auth.json` wires it up).
- Account ID: `264a4cc972d1bc6de16bebd8f1412c75`
- Gateway ID (AI Gateway slug): `pi-mk`

Load the token without printing it:

```bash
TOKEN=$(security find-generic-password -s pi-cloudflare-token -w)
[ -n "$TOKEN" ] && echo "token loaded" || echo "token missing"
```

## Endpoint

```
POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run
```

Headers:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer $TOKEN` |
| `Content-Type` | `application/json` |
| `cf-aig-gateway-id` | `pi-mk` (routes through the AI Gateway; omit to hit Workers AI directly) |

Request body: Cloudflare's Workers AI shape, with the TypeSafe payload under `input`:

```json
{
  "model": "typesafe/jev",
  "input": {
    "state": "... or structured object/array ...",
    "questions": {
      "<your-question-id>": { "type": "noul" | "choice" | "score", "instructions": "...", "criteria": ... }
    }
  }
}
```

The three primitives and their `criteria` shapes are exactly the TypeSafe API ones:
Noul (`criteria: {true, false}` optional), Choice (`criteria: {option: rubric, ...}`),
Score (`criteria: [level0, level1, ...]`, ≥2 levels). See the skill's live-docs
table for the primitive pages.

## Response shape (Cloudflare wrapper)

Cloudflare wraps the TypeSafe result — answers live at `result.result.answers`:

```json
{
  "result": {
    "state": "Completed",
    "result": {
      "model": "jev-1.13.0",
      "answers": { "<question-id>": { ... } },
      "usage": { "input_tokens": 441, "output_tokens": 73 }
    },
    "gatewayMetadata": { "keySource": "Unified" }
  },
  "success": true,
  "errors": [],
  "messages": []
}
```

Answer types (same as TypeSafe):

- **Noul**: `{ "type": "noul", "noul": 0.0–1.0 }` — no separate `confidence` field.
- **Choice**: `{ "type": "choice", "choice": "<option>", "probabilities": {option: float}, "confidence": 0–1 }`.
- **Score**: `{ "type": "score", "score": <float, can land between levels>, "legend": {level: desc}, "probabilities": {level: float}, "confidence": 0–1 }`.

Check `success == true` and `result.state == "Completed"` before reading answers.
`result.result.model` reports the concrete model version (e.g. `jev-1.13.0`).

## Minimal call

```bash
TOKEN=$(security find-generic-password -s pi-cloudflare-token -w)
ACCOUNT=264a4cc972d1bc6de16bebd8f1412c75

curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/ai/run" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "cf-aig-gateway-id: pi-mk" \
  -d '{
    "model": "typesafe/jev",
    "input": {
      "state": "Help! My payouts have been failing for 3 days.",
      "questions": {
        "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" }
      }
    }
  }'
```

## Verified examples (this session)

1. Structured refund review — two Nouls over structured state:

```json
"refund_requested":       { "type": "noul", "noul": 0.99 }
"policy_supports_refund": { "type": "noul", "noul": 0.98 }
```

2. All three primitives in one parallel pass, state
   `"Help! My payouts have been failing for 3 days. I'm losing sales every hour. This is the second time this month."`:

```json
"is_urgent":   { "type": "noul",   "noul": 0.98 }
"department":  { "type": "choice", "choice": "billing", "probabilities": {"billing": 0.84, "technical": 0.16, "sales": 0}, "confidence": 0.76 }
"frustration": { "type": "score",  "score": 1.64, "legend": {"0": "Calm", "1": "Frustrated", "2": "Very angry"},
                 "probabilities": {"0": 0, "1": 0.36, "2": 0.64}, "confidence": 0.46 }
```

Observed performance: HTTP 200, ~0.33 s end-to-end (TTFB), 441 input / 73 output
tokens. Identical answers with and without the `cf-aig-gateway-id` header.

## Notes & gotchas

- **Gate to `result.result`**, not the top level: the Cloudflare envelope adds one
  nesting level versus the TypeSafe API. `answers` is under `result.result.answers`.
- **Same pricing/limits as TypeSafe**: input ~$0.042/MTok, output free. Model page:
  `https://dash.cloudflare.com/264a4cc972d1bc6de16bebd8f1412c75/ai/models/typesafe/jev`
  (context window 32,000 tokens).
- **Observability**: requests tagged `cf-aig-gateway-id: pi-mk` show up under the
  gateway in the Cloudflare dashboard (logging, caching, rate limiting).
- **Noul has no confidence**; a noul near 0.5 means "yes and no are equally
  probable", not "medium intensity". Choice/Score confidence summarizes distribution
  concentration only.
- **Token hygiene**: never print the keychain token into transcripts; use the
  `security find-generic-password` lookup inside the command (as above).
- **Not a chat model**: Jev returns decisions only — no text generation — so it
  cannot serve as a pi chat/model backend; use it as a decision API from code.