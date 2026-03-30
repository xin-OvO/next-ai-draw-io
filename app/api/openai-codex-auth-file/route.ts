import { NextResponse } from "next/server"
import { importOpenAICodexAuthFromFile } from "@/lib/openai-codex-server-auth"

export const runtime = "nodejs"

type ImportAuthFileRequest = {
    action?: "detect" | "load"
    path?: string
}

export async function POST(req: Request) {
    try {
        const body = (await req
            .json()
            .catch(() => ({}))) as ImportAuthFileRequest

        if (body.action !== "detect" && body.action !== "load") {
            return NextResponse.json(
                { error: "action 必须是 detect 或 load" },
                { status: 400 },
            )
        }

        if (body.action === "load" && !body.path?.trim()) {
            return NextResponse.json(
                { error: "path 不能为空" },
                { status: 400 },
            )
        }

        const result = await importOpenAICodexAuthFromFile(body.path)

        return NextResponse.json({
            path: result.path,
            credentials: result.credentials,
            email: result.email,
        })
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        )
    }
}
