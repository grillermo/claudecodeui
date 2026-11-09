export type NtfyConfig = { url: string; topic: string; token?: string };
export type NtfyPayload = { title: string; body: string; data?: { sessionId?: string | null } };

export function readNtfyConfig(env: Record<string, string | undefined> = process.env): NtfyConfig | null {
  const url = env.NTFY_URL?.replace(/\/$/, '');
  const topic = env.NTFY_TOPIC;
  if (!url || !topic) return null;
  return { url, topic, token: env.NTFY_TOKEN || undefined };
}

export async function sendNtfyNotification(
  config: NtfyConfig,
  payload: NtfyPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const sessionId = payload.data?.sessionId;
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        topic: config.topic,
        title: payload.title,
        message: payload.body,
        ...(sessionId ? { click: `cloudcli://session/${encodeURIComponent(sessionId)}` } : {}),
      }),
    });
    if (!response.ok) console.warn(`ntfy publish failed: ${response.status}`);
  } catch (error) {
    console.warn('ntfy publish failed:', error);
  }
}
