import type { OAuthCredentials, OAuthPrompt } from "@mariozechner/pi-ai/oauth"
import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { loginOpenAICodexOAuth } from "@/lib/openai-codex-oauth"

export const runtime = "nodejs"

type OAuthSessionStatus =
    | "starting"
    | "awaiting_browser"
    | "awaiting_manual_input"
    | "completed"
    | "error"

type OAuthSession = {
    id: string
    status: OAuthSessionStatus
    createdAt: number
    updatedAt: number
    authUrl?: string
    instructions?: string
    progress?: string
    prompt?: OAuthPrompt
    credentials?: OAuthCredentials
    error?: string
    manualInputResolver?: (input: string) => void
}

const SESSION_TTL_MS = 15 * 60 * 1000

function getSessionStore(): Map<string, OAuthSession> {
    const globalWithStore = globalThis as typeof globalThis & {
        __openaiCodexOAuthSessions?: Map<string, OAuthSession>
    }

    if (!globalWithStore.__openaiCodexOAuthSessions) {
        globalWithStore.__openaiCodexOAuthSessions = new Map()
    }

    return globalWithStore.__openaiCodexOAuthSessions
}

function cleanupExpiredSessions(): void {
    const sessions = getSessionStore()
    const now = Date.now()

    for (const [id, session] of sessions.entries()) {
        if (now - session.updatedAt > SESSION_TTL_MS) {
            sessions.delete(id)
        }
    }
}

function toPublicSession(session: OAuthSession) {
    return {
        sessionId: session.id,
        status: session.status,
        authUrl: session.authUrl,
        instructions: session.instructions,
        progress: session.progress,
        prompt: session.prompt,
        credentials:
            session.status === "completed" ? session.credentials : undefined,
        error: session.error,
    }
}

async function startSession(): Promise<OAuthSession> {
    cleanupExpiredSessions()

    const sessions = getSessionStore()
    const sessionId = randomUUID()
    const session: OAuthSession = {
        id: sessionId,
        status: "starting",
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }
    sessions.set(sessionId, session)

    let startResolve: (() => void) | undefined
    let startReject: ((error: Error) => void) | undefined
    const ready = new Promise<void>((resolve, reject) => {
        startResolve = resolve
        startReject = reject
    })

    const manualInputPromise = new Promise<string>((resolve) => {
        session.manualInputResolver = resolve
    })

    void loginOpenAICodexOAuth({
        onAuth: (info) => {
            session.status = "awaiting_browser"
            session.authUrl = info.url
            session.instructions = info.instructions
            session.updatedAt = Date.now()
            startResolve?.()
        },
        onPrompt: async (prompt) => {
            session.status = "awaiting_manual_input"
            session.prompt = prompt
            session.updatedAt = Date.now()
            startResolve?.()
            return await manualInputPromise
        },
        onProgress: (message) => {
            session.progress = message
            session.updatedAt = Date.now()
        },
    })
        .then((credentials) => {
            session.status = "completed"
            session.credentials = credentials
            session.updatedAt = Date.now()
        })
        .catch((error) => {
            session.status = "error"
            session.error =
                error instanceof Error ? error.message : String(error)
            session.updatedAt = Date.now()
            startReject?.(
                error instanceof Error ? error : new Error(String(error)),
            )
        })

    await ready
    return session
}

export async function GET(req: Request) {
    cleanupExpiredSessions()

    const sessionId = new URL(req.url).searchParams.get("sessionId")
    if (!sessionId) {
        return NextResponse.json(
            { error: "sessionId is required" },
            { status: 400 },
        )
    }

    const session = getSessionStore().get(sessionId)
    if (!session) {
        return NextResponse.json(
            { error: "OAuth session not found or expired" },
            { status: 404 },
        )
    }

    return NextResponse.json(toPublicSession(session))
}

export async function POST(req: Request) {
    cleanupExpiredSessions()

    const body = (await req.json().catch(() => ({}))) as {
        action?: "start" | "submit"
        sessionId?: string
        input?: string
    }

    if (body.action === "start") {
        try {
            const session = await startSession()
            return NextResponse.json(toPublicSession(session))
        } catch (error) {
            return NextResponse.json(
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                },
                { status: 500 },
            )
        }
    }

    if (body.action === "submit") {
        if (!body.sessionId || !body.input?.trim()) {
            return NextResponse.json(
                { error: "sessionId and input are required" },
                { status: 400 },
            )
        }

        const session = getSessionStore().get(body.sessionId)
        if (!session) {
            return NextResponse.json(
                { error: "OAuth session not found or expired" },
                { status: 404 },
            )
        }
        if (!session.manualInputResolver) {
            return NextResponse.json(
                { error: "OAuth session is not waiting for manual input" },
                { status: 409 },
            )
        }

        session.manualInputResolver(body.input.trim())
        session.manualInputResolver = undefined
        session.updatedAt = Date.now()

        return NextResponse.json(toPublicSession(session))
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
}
