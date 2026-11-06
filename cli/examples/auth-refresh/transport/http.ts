// Illustrative source for visualization; CodeSurf does not execute this request.
export async function send(path: string, token: string | null) {
  const response = await fetch(`https://example.invalid${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw Object.assign(new Error("Request failed"), {
      status: response.status,
    });
  }
  return response.json();
}
