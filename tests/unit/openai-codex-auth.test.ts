import { beforeEach, describe, expect, it, vi } from "vitest"
import {
    buildOpenAICodexProfileId,
    getOpenAICodexProfile,
    resolveOpenAICodexAuth,
    upsertOpenAICodexProfile,
} from "@/lib/openai-codex-auth"
import { STORAGE_KEYS } from "@/lib/storage"

const { getOAuthApiKeyMock } = vi.hoisted(() => ({
    getOAuthApiKeyMock: vi.fn(),
}))

vi.mock("@mariozechner/pi-ai/oauth", () => ({
    getOAuthApiKey: getOAuthApiKeyMock,
}))

function createJwt(payload: Record<string, unknown>): string {
    const encode = (value: Record<string, unknown>) =>
        btoa(JSON.stringify(value))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "")

    return `header.${encode(payload)}.signature`
}

describe("openai-codex auth store", () => {
    beforeEach(() => {
        localStorage.clear()
        getOAuthApiKeyMock.mockReset()
    })

    it("uses email claim to build profile id", () => {
        const access = createJwt({ email: "user@example.com" })
        const resolved = upsertOpenAICodexProfile({
            access,
            refresh: "refresh-token",
            expires: Date.now() + 60_000,
        })

        expect(resolved.profileId).toBe("openai-codex:user@example.com")
        expect(getOpenAICodexProfile(resolved.profileId)?.email).toBe(
            "user@example.com",
        )
    })

    it("refreshes expired credentials before returning bearer token", async () => {
        const expiredAccess = createJwt({ email: "user@example.com" })
        const refreshedAccess = createJwt({ email: "user@example.com" })

        localStorage.setItem(
            STORAGE_KEYS.authProfiles,
            JSON.stringify({
                version: 1,
                profiles: {
                    "openai-codex:user@example.com": {
                        type: "oauth",
                        provider: "openai-codex",
                        email: "user@example.com",
                        access: expiredAccess,
                        refresh: "refresh-token",
                        expires: Date.now() - 1_000,
                    },
                },
            }),
        )

        getOAuthApiKeyMock.mockResolvedValueOnce({
            apiKey: "fresh-bearer-token",
            newCredentials: {
                access: refreshedAccess,
                refresh: "refresh-token-2",
                expires: Date.now() + 120_000,
            },
        })

        const resolved = await resolveOpenAICodexAuth(
            "openai-codex:user@example.com",
        )

        expect(resolved.apiKey).toBe("fresh-bearer-token")
        expect(getOAuthApiKeyMock).toHaveBeenCalledWith("openai-codex", {
            "openai-codex": expect.objectContaining({
                refresh: "refresh-token",
            }),
        })
        expect(getOpenAICodexProfile(resolved.profileId)).toMatchObject({
            refresh: "refresh-token-2",
            access: refreshedAccess,
        })
    })

    it("throws when profile is missing", async () => {
        await expect(
            resolveOpenAICodexAuth(
                buildOpenAICodexProfileId("missing@example.com"),
            ),
        ).rejects.toThrow("未找到 OpenAI Codex OAuth 凭证")
    })
})
