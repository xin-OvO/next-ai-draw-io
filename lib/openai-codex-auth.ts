import {
    getOAuthApiKey,
    type OAuthCredentials,
} from "@mariozechner/pi-ai/oauth"
import { STORAGE_KEYS } from "@/lib/storage"

export type OpenAICodexOAuthProfile = OAuthCredentials & {
    type: "oauth"
    provider: "openai-codex"
    email?: string
}

type AuthProfileStore = {
    version: 1
    profiles: Record<string, OpenAICodexOAuthProfile>
}

export type ResolvedOpenAICodexAuth = {
    apiKey: string
    profileId: string
    profile: OpenAICodexOAuthProfile
}

const EMPTY_STORE: AuthProfileStore = {
    version: 1,
    profiles: {},
}

function isBrowser(): boolean {
    return typeof window !== "undefined"
}

function loadStore(): AuthProfileStore {
    if (!isBrowser()) return EMPTY_STORE

    const raw = localStorage.getItem(STORAGE_KEYS.authProfiles)
    if (!raw) return EMPTY_STORE

    try {
        const parsed = JSON.parse(raw) as Partial<AuthProfileStore>
        return {
            version: 1,
            profiles: parsed.profiles || {},
        }
    } catch {
        return EMPTY_STORE
    }
}

function saveStore(store: AuthProfileStore): void {
    if (!isBrowser()) return
    localStorage.setItem(STORAGE_KEYS.authProfiles, JSON.stringify(store))
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const [, payload] = token.split(".")
        if (!payload) return null

        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
        const padding = "=".repeat((4 - (base64.length % 4)) % 4)
        const decoded = atob(`${base64}${padding}`)
        return JSON.parse(decoded) as Record<string, unknown>
    } catch {
        return null
    }
}

function extractEmailFromAccessToken(accessToken: string): string | undefined {
    const payload = decodeJwtPayload(accessToken)
    if (!payload) return undefined

    const candidates = [payload.email, payload.preferred_username, payload.upn]

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim()
        }
    }

    return undefined
}

function normalizeEmail(email?: string): string {
    return email?.trim() || "default"
}

export function buildOpenAICodexProfileId(email?: string): string {
    return `openai-codex:${normalizeEmail(email)}`
}

export function getOpenAICodexProfile(
    profileId?: string | null,
): OpenAICodexOAuthProfile | null {
    if (!profileId) return null
    return loadStore().profiles[profileId] || null
}

export function removeOpenAICodexProfile(profileId?: string | null): void {
    if (!profileId) return
    const store = loadStore()
    if (!store.profiles[profileId]) return
    delete store.profiles[profileId]
    saveStore(store)
}

export function upsertOpenAICodexProfile(
    credentials: OAuthCredentials & { email?: string },
): ResolvedOpenAICodexAuth {
    const email =
        credentials.email?.trim() ||
        extractEmailFromAccessToken(credentials.access) ||
        "default"
    const profileId = buildOpenAICodexProfileId(email)

    const profile: OpenAICodexOAuthProfile = {
        type: "oauth",
        provider: "openai-codex",
        ...credentials,
        email,
    }

    const store = loadStore()
    store.profiles[profileId] = profile
    saveStore(store)

    return {
        apiKey: profile.access,
        profileId,
        profile,
    }
}

export async function resolveOpenAICodexAuth(
    profileId: string,
): Promise<ResolvedOpenAICodexAuth> {
    const store = loadStore()
    const current = store.profiles[profileId]

    if (
        !current ||
        current.type !== "oauth" ||
        current.provider !== "openai-codex"
    ) {
        throw new Error("未找到 OpenAI Codex OAuth 凭证，请重新连接。")
    }

    if (Date.now() < current.expires) {
        return {
            apiKey: current.access,
            profileId,
            profile: current,
        }
    }

    const result = await getOAuthApiKey("openai-codex", {
        "openai-codex": current,
    })

    if (!result) {
        throw new Error("OpenAI Codex OAuth 凭证不可用，请重新连接。")
    }

    const nextEmail =
        current.email ||
        extractEmailFromAccessToken(result.newCredentials.access) ||
        "default"
    const nextProfileId = buildOpenAICodexProfileId(nextEmail)
    const nextProfile: OpenAICodexOAuthProfile = {
        ...current,
        ...result.newCredentials,
        type: "oauth",
        provider: "openai-codex",
        email: nextEmail,
    }

    if (nextProfileId !== profileId) {
        delete store.profiles[profileId]
    }
    store.profiles[nextProfileId] = nextProfile
    saveStore(store)

    return {
        apiKey: result.apiKey,
        profileId: nextProfileId,
        profile: nextProfile,
    }
}
