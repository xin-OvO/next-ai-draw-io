import { describe, expect, it } from "vitest"
import {
    buildOpenAICodexHeaders,
    extractOpenAICodexAccountId,
} from "@/lib/openai-codex-protocol"

function createJwt(payload: Record<string, unknown>): string {
    const encode = (value: Record<string, unknown>) =>
        Buffer.from(JSON.stringify(value)).toString("base64url")

    return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`
}

describe("openai-codex protocol", () => {
    it("extracts the ChatGPT account id from the OAuth access token", () => {
        const token = createJwt({
            "https://api.openai.com/auth": {
                chatgpt_account_id: "acct_123",
            },
        })

        expect(extractOpenAICodexAccountId(token)).toBe("acct_123")
    })

    it("builds the required Codex headers for requests", () => {
        const token = createJwt({
            "https://api.openai.com/auth": {
                chatgpt_account_id: "acct_123",
            },
        })

        expect(buildOpenAICodexHeaders(token)).toEqual({
            "chatgpt-account-id": "acct_123",
            "OpenAI-Beta": "responses=experimental",
            originator: "pi",
        })
    })
})
