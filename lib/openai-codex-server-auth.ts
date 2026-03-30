import "server-only"

import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import {
    type OAuthCredentials,
    refreshOpenAICodexToken,
} from "@mariozechner/pi-ai/oauth"

type CodexAuthFile = {
    auth_mode?: string
    OPENAI_API_KEY?: string | null
    tokens?: {
        id_token?: string
        access_token?: string
        refresh_token?: string
        account_id?: string
    }
    last_refresh?: string
}

const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json")
const REFRESH_SKEW_MS = 60 * 1000

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const [, payload] = token.split(".")
        if (!payload) return null
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
        const padding = "=".repeat((4 - (normalized.length % 4)) % 4)
        const decoded = Buffer.from(
            `${normalized}${padding}`,
            "base64",
        ).toString("utf8")
        return JSON.parse(decoded) as Record<string, unknown>
    } catch {
        return null
    }
}

function getTokenExpiry(accessToken: string): number | null {
    const payload = decodeJwtPayload(accessToken)
    const exp = payload?.exp
    if (typeof exp !== "number") return null
    return exp * 1000
}

async function loadCodexAuthFile(): Promise<CodexAuthFile> {
    return await loadCodexAuthFileFromPath(CODEX_AUTH_PATH)
}

async function loadCodexAuthFileFromPath(
    filePath: string,
): Promise<CodexAuthFile> {
    try {
        const raw = await readFile(filePath, "utf8")
        return JSON.parse(raw) as CodexAuthFile
    } catch {
        throw new Error(
            `未找到认证文件：${filePath}。请先使用 Codex/ChatGPT 完成登录，或在页面里连接 OpenAI Codex OAuth。`,
        )
    }
}

async function saveCodexAuthFileToPath(
    filePath: string,
    auth: CodexAuthFile,
): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(auth, null, 2)}\n`, "utf8")
}

function resolveAuthFilePath(filePath?: string): string {
    if (!filePath?.trim()) return CODEX_AUTH_PATH
    return isAbsolute(filePath) ? filePath : resolve(filePath)
}

function extractEmail(accessToken: string): string | undefined {
    const payload = decodeJwtPayload(accessToken)
    const email = payload?.email

    if (typeof email === "string" && email.trim()) {
        return email.trim()
    }

    const preferredUsername = payload?.preferred_username
    if (typeof preferredUsername === "string" && preferredUsername.trim()) {
        return preferredUsername.trim()
    }

    return undefined
}

function buildOAuthCredentials(auth: CodexAuthFile): OAuthCredentials {
    const accessToken = auth.tokens?.access_token
    const refreshToken = auth.tokens?.refresh_token

    if (!accessToken || !refreshToken) {
        throw new Error(
            "认证文件里缺少 access_token 或 refresh_token，无法导入 OpenAI Codex 登录态。",
        )
    }

    const expires = getTokenExpiry(accessToken)
    if (!expires) {
        throw new Error("认证文件里的 access_token 缺少有效过期时间。")
    }

    return {
        access: accessToken,
        refresh: refreshToken,
        expires,
        accountId:
            typeof auth.tokens?.account_id === "string"
                ? auth.tokens.account_id
                : undefined,
    }
}

async function refreshIfNeeded(params: {
    auth: CodexAuthFile
    filePath: string
}): Promise<{
    auth: CodexAuthFile
    credentials: OAuthCredentials
}> {
    const credentials = buildOAuthCredentials(params.auth)

    if (Date.now() < credentials.expires - REFRESH_SKEW_MS) {
        return {
            auth: params.auth,
            credentials,
        }
    }

    const refreshed = await refreshOpenAICodexToken(credentials.refresh)
    const nextAccountId =
        typeof refreshed.accountId === "string"
            ? refreshed.accountId
            : undefined
    const nextAuth: CodexAuthFile = {
        ...params.auth,
        auth_mode: params.auth.auth_mode || "chatgpt",
        tokens: {
            ...params.auth.tokens,
            access_token: refreshed.access,
            refresh_token: refreshed.refresh,
            account_id: nextAccountId,
        },
        last_refresh: new Date().toISOString(),
    }

    await saveCodexAuthFileToPath(params.filePath, nextAuth)

    return {
        auth: nextAuth,
        credentials: {
            access: refreshed.access,
            refresh: refreshed.refresh,
            expires: refreshed.expires,
            accountId: nextAccountId,
        },
    }
}

export async function importOpenAICodexAuthFromFile(
    filePath?: string,
): Promise<{
    path: string
    credentials: OAuthCredentials
    email?: string
}> {
    const resolvedPath = resolveAuthFilePath(filePath)
    const auth = await loadCodexAuthFileFromPath(resolvedPath)
    const refreshed = await refreshIfNeeded({
        auth,
        filePath: resolvedPath,
    })

    return {
        path: resolvedPath,
        credentials: refreshed.credentials,
        email: extractEmail(refreshed.credentials.access),
    }
}

export async function resolveServerOpenAICodexAuth(): Promise<{
    apiKey: string
    source: "codex-auth-file"
    path: string
}> {
    const auth = await loadCodexAuthFile()
    const refreshed = await refreshIfNeeded({
        auth,
        filePath: CODEX_AUTH_PATH,
    })

    return {
        apiKey: refreshed.credentials.access,
        source: "codex-auth-file",
        path: CODEX_AUTH_PATH,
    }
}
