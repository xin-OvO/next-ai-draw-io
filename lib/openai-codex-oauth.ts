import {
    loginOpenAICodex,
    type OAuthCredentials,
    type OAuthPrompt,
} from "@mariozechner/pi-ai/oauth"

export async function loginOpenAICodexOAuth(params: {
    onAuth: (info: { url: string; instructions?: string }) => void
    onPrompt: (prompt: OAuthPrompt) => Promise<string>
    onProgress?: (message: string) => void
}): Promise<OAuthCredentials> {
    return await loginOpenAICodex({
        onAuth: params.onAuth,
        onPrompt: params.onPrompt,
        onProgress: params.onProgress,
    })
}
