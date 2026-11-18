// Local storage for projects, tours, screenshots and follow-up chats.
// Everything lives under ~/.codesurf (or CODESURF_HOME), never in the repo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const home = () => process.env.CODESURF_HOME || path.join(os.homedir(), ".codesurf");
const projectsDir = () => path.join(home(), "projects");
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file + ".tmp", typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
};
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tour";
const SAFE = /^[A-Za-z0-9._-]+$/;

export function gitRoot(dir) {
  let current = fs.realpathSync(dir);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return fs.realpathSync(dir);
    current = parent;
  }
}

export function ensureProject(dir, { exact = false } = {}) {
  const root = exact ? fs.realpathSync(dir) : gitRoot(dir);
  const id = slug(path.basename(root)) + "-" + crypto.createHash("sha256").update(root).digest("hex").slice(0, 8);
  const file = path.join(projectsDir(), id, "project.json");
  if (!fs.existsSync(file)) write(file, { id, root, name: path.basename(root), created: new Date().toISOString() });
  return read(file);
}

export function getProject(id) {
  if (!SAFE.test(id || "")) throw new Error("Unknown project.");
  const project = read(path.join(projectsDir(), id, "project.json"));
  if (!project) throw new Error("Unknown project.");
  return project;
}

export function listProjects() {
  if (!fs.existsSync(projectsDir())) return [];
  return fs.readdirSync(projectsDir()).map((id) => read(path.join(projectsDir(), id, "project.json"))).filter(Boolean);
}

export function saveTour(project, tour, assets = new Map(), { parent } = {}) {
  const dir = path.join(projectsDir(), project.id);
  // Opening the same tour twice reuses it instead of piling up copies.
  const text = JSON.stringify(tour);
  const existing = listTours(project).find((t) => !parent && !t.parent && JSON.stringify(getTour(project, t.id).tour) === text);
  if (existing) return existing.id;
  const id = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + slug(tour.title);
  for (const [name, source] of assets) {
    const target = path.join(dir, "assets", name);
    if (!fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
  }
  write(path.join(dir, "tours", id + ".json"), { id, created: new Date().toISOString(), ...(parent ? { parent } : {}), tour });
  return id;
}

export function listTours(project) {
  const dir = path.join(projectsDir(), project.id, "tours");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse().map((f) => {
    const saved = read(path.join(dir, f));
    return saved && { id: saved.id, created: saved.created, title: saved.tour.title, question: saved.tour.question || "", parent: saved.parent };
  }).filter(Boolean);
}

export function getTour(project, id) {
  if (!SAFE.test(id || "")) throw new Error("Unknown tour.");
  const saved = read(path.join(projectsDir(), project.id, "tours", id + ".json"));
  if (!saved) throw new Error("Unknown tour.");
  return saved;
}

export function assetPath(project, name) {
  if (!SAFE.test(name || "")) throw new Error("Unknown asset.");
  return path.join(projectsDir(), project.id, "assets", name);
}

export function getChat(project, tourId) {
  if (!SAFE.test(tourId || "")) throw new Error("Unknown tour.");
  return read(path.join(projectsDir(), project.id, "chats", tourId + ".json"), { sessionId: null, messages: [] });
}
export function saveChat(project, tourId, chat) {
  write(path.join(projectsDir(), project.id, "chats", tourId + ".json"), chat);
}

export const serverFile = () => path.join(home(), "server.json");
export const readServer = () => read(serverFile(), null);
export const writeServer = (info) => write(serverFile(), info);
