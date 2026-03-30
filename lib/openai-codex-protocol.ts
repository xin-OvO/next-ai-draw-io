const OPENAI_CODEX_AUTH_CLAIM = "https://api.openai.com/auth"

// AI SDK appends `/responses`, so this must resolve to
// `https://chatgpt.com/backend-api/codex/responses`.
export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
export const OPENAI_CODEX_DEFAULT_INSTRUCTIONS =
    "You are a concise assistant. Follow the user's instruction exactly."

const OPENAI_CODEX_REASONING_INCLUDE = "reasoning.encrypted_content"

type OpenAICodexRequestBody = Record<string, unknown>

export function resolveOpenAICodexResponsesUrl(baseUrl?: string): string {
    const raw =
        baseUrl && baseUrl.trim().length > 0 ? baseUrl : OPENAI_CODEX_BASE_URL
    const normalized = raw.replace(/\/+$/, "")

    if (normalized.endsWith("/codex/responses")) {
        return normalized
    }

    if (normalized.endsWith("/codex")) {
        return `${normalized}/responses`
    }

    return `${normalized}/codex/responses`
}

function decodeBase64Url(value: string): string {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    const padding = "=".repeat((4 - (base64.length % 4)) % 4)
    const normalized = `${base64}${padding}`

    if (typeof atob === "function") {
        return atob(normalized)
    }

    return Buffer.from(normalized, "base64").toString("utf8")
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const [, payload] = token.split(".")
        if (!payload) return null
        return JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>
    } catch {
        return null
    }
}

export function extractOpenAICodexAccountId(
    accessToken: string,
): string | null {
    const payload = decodeJwtPayload(accessToken)
    if (!payload) return null

    const authClaim = payload[OPENAI_CODEX_AUTH_CLAIM]
    if (!authClaim || typeof authClaim !== "object") {
        return null
    }

    const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id
    if (typeof accountId !== "string" || !accountId.trim()) {
        return null
    }

    return accountId.trim()
}

export function buildOpenAICodexHeaders(
    accessToken: string,
): Record<string, string> {
    const accountId = extractOpenAICodexAccountId(accessToken)

    if (!accountId) {
        throw new Error("无法从 OpenAI Codex OAuth token 中解析 accountId。")
    }

    return {
        "chatgpt-account-id": accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "pi",
    }
}

export function normalizeOpenAICodexRequestBody(
    body: OpenAICodexRequestBody,
    fallbackInstructions = OPENAI_CODEX_DEFAULT_INSTRUCTIONS,
): OpenAICodexRequestBody {
    const {
        max_output_tokens: _maxOutputTokens,
        max_tokens: _maxTokens,
        max_completion_tokens: _maxCompletionTokens,
        ...rest
    } = body

    const include = Array.isArray(body.include)
        ? body.include.filter(
              (value): value is string => typeof value === "string",
          )
        : []

    if (!include.includes(OPENAI_CODEX_REASONING_INCLUDE)) {
        include.push(OPENAI_CODEX_REASONING_INCLUDE)
    }

    const text =
        body.text && typeof body.text === "object"
            ? {
                  ...(body.text as Record<string, unknown>),
                  verbosity:
                      (body.text as Record<string, unknown>).verbosity ||
                      "medium",
              }
            : { verbosity: "medium" }

    const instructions =
        typeof body.instructions === "string" && body.instructions.trim()
            ? body.instructions.trim()
            : fallbackInstructions

    return {
        ...rest,
        store: false,
        instructions,
        text,
        include,
        tool_choice: rest.tool_choice || "auto",
        parallel_tool_calls: true,
    }
}

export function createOpenAICodexFetch(
    fallbackInstructions = OPENAI_CODEX_DEFAULT_INSTRUCTIONS,
): typeof fetch {
    return async (input, init) => {
        if (typeof init?.body !== "string") {
            return fetch(input, init)
        }

        try {
            const parsed = JSON.parse(init.body) as OpenAICodexRequestBody
            const normalized = normalizeOpenAICodexRequestBody(
                parsed,
                fallbackInstructions,
            )
            return fetch(input, {
                ...init,
                body: JSON.stringify(normalized),
            })
        } catch {
            return fetch(input, init)
        }
    }
}
