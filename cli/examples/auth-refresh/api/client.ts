import { send } from "../transport/http";
import { getAccessToken, setAccessToken } from "../session/tokens";

export async function request(path: string) {
  try {
    return await send(path, getAccessToken());
  } catch (error) {
    if ((error as { status?: number }).status !== 401) throw error;
    await refreshSession();
    return send(path, getAccessToken());
  }
}

async function refreshSession() {
  const session = await send("/sessions/refresh", null);
  setAccessToken(session.access_token);
}
