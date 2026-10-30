import crypto from "node:crypto";
export function seal(value, secret) {
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters");
  const key = crypto.createHash("sha256").update(secret).digest(),
    iv = crypto.randomBytes(12),
    c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
export function unseal(token, secret) {
  try {
    if (!secret) return null;
    const b = Buffer.from(token || "", "base64url");
    const d = crypto.createDecipheriv(
      "aes-256-gcm",
      crypto.createHash("sha256").update(secret).digest(),
      b.subarray(0, 12),
    );
    d.setAuthTag(b.subarray(12, 28));
    const v = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]));
    return v.exp > Date.now() ? v : null;
  } catch {
    return null;
  }
}
export function parseSource(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a GitHub repository or pull request URL.");
  }
  const match = url.pathname.match(
    /^\/([\w.-]+)\/([\w.-]+)(?:\/pull\/([1-9]\d*))?\/?$/,
  );
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    !match
  )
    throw new Error("Enter a GitHub repository or pull request URL.");
  const number = match[3] ? Number(match[3]) : null;
  if (number !== null && !Number.isSafeInteger(number))
    throw new Error("Invalid pull request number.");
  return { owner: match[1], repo: match[2], number };
}
