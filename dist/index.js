#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const SAFE = ["1", "true", "yes"].includes(String(process.env.REMINDERS_MCP_SAFE || "").toLowerCase());
let SAFE_MODE = SAFE;
function runJxa(body, args = {}) {
    const env = { ...process.env, ARGS: JSON.stringify(args ?? {}) };
    const code = `
ObjC.import('stdlib');
const args = JSON.parse($.getenv('ARGS') || '{}');
function toObj(o) { return JSON.parse(JSON.stringify(o)); }
${body}
`;
    return new Promise((resolve, reject) => {
        const cp = spawn("osascript", ["-l", "JavaScript", "-e", code], { env });
        let out = "";
        let err = "";
        cp.stdout.on("data", (d) => (out += d.toString()));
        cp.stderr.on("data", (d) => (err += d.toString()));
        cp.on("close", (code) => {
            if (code !== 0)
                return reject(new Error(err || `JXA exit ${code}`));
            try {
                resolve(out ? JSON.parse(out) : undefined);
            }
            catch (e) {
                reject(e);
            }
        });
    });
}
function ensureNotSafe(op) {
    if (SAFE_MODE)
        throw new Error(`Safe mode enabled; '${op}' is blocked`);
}
const server = new McpServer({ name: "apple-reminders-mcp", version: "0.1.0" });
async function jxaListsList() {
    const body = `
const Reminders = Application('Reminders');
const accs = Reminders.accounts();
const lists = [].concat(...accs.map(a => a.lists().map(l => ({
  id: l.id(), name: l.name(), account: a.name()
}))));
JSON.stringify(lists);
`;
    return runJxa(body);
}
async function jxaListsEnsure(pathOrName) {
    // For Reminders, lists are not hierarchical in UI; treat path as flat name.
    const name = pathOrName;
    const body = `
const Reminders = Application('Reminders');
const accs = Reminders.accounts();
let target = null;
for (const a of accs) {
  const found = a.lists().find(l => l.name() === args.name);
  if (found) { target = { id: found.id(), name: found.name(), account: a.name() }; break; }
}
if (!target) {
  // Create in the first account
  const a = accs[0];
  const l = Reminders.List({ name: args.name });
  a.lists.push(l);
  target = { id: l.id(), name: l.name(), account: a.name() };
}
JSON.stringify(target);
`;
    return runJxa(body, { name });
}
async function jxaListsDelete(nameOrId) {
    const body = `
const Reminders = Application('Reminders');
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    if (l.id() === args.key || l.name() === args.key) { l.delete(); JSON.stringify({ ok: true }); throw null; }
  }
}
JSON.stringify({ ok: false, error: 'List not found' });
`;
    return runJxa(body, { key: nameOrId });
}
async function jxaListsRename(idOrName, newName) {
    const body = `
const Reminders = Application('Reminders');
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    if (l.id() === args.key || l.name() === args.key) { l.name = args.newName; JSON.stringify({ id: l.id(), name: l.name(), account: a.name() }); throw null; }
  }
}
JSON.stringify({ error: 'List not found' });
`;
    return runJxa(body, { key: idOrName, newName });
}
async function jxaRemindersList(listKey) {
    const body = `
const Reminders = Application('Reminders');
function asObj(r, listName) {
  return {
    id: r.id(), title: r.name(), notes: r.body(), completed: r.completed(),
    flagged: r.flagged(), priority: r.priority(),
    dueDate: (r.dueDate()) ? r.dueDate().toString() : null,
    remindMeDate: (r.remindMeDate()) ? r.remindMeDate().toString() : null,
    list: listName
  };
}
let items = [];
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    if (!args.key || l.id() === args.key || l.name() === args.key) {
      items = items.concat(l.reminders().map(r => asObj(r, l.name())));
    }
  }
}
JSON.stringify(items);
`;
    return runJxa(body, { key: listKey ?? null });
}
async function jxaReminderGet(id) {
    const body = `
const Reminders = Application('Reminders');
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    const r = l.reminders().find(r => r.id() === args.id);
    if (r) {
      JSON.stringify({ id: r.id(), title: r.name(), notes: r.body(), completed: r.completed(), flagged: r.flagged(), priority: r.priority(), dueDate: r.dueDate() ? r.dueDate().toString() : null, remindMeDate: r.remindMeDate() ? r.remindMeDate().toString() : null, list: l.name() });
      throw null;
    }
  }
}
JSON.stringify({ error: 'Reminder not found' });
`;
    return runJxa(body, { id });
}
async function jxaReminderCreate(params) {
    const body = `
const Reminders = Application('Reminders');
const accs = Reminders.accounts();
let targetList = null;
for (const a of accs) {
  for (const l of a.lists()) {
    if (!args.listKey || l.id() === args.listKey || l.name() === args.listKey) { targetList = l; break; }
  }
  if (targetList) break;
}
if (!targetList) targetList = accs[0].lists()[0];
const r = Reminders.Reminder({ name: args.title });
if (args.notes) r.body = args.notes;
if (typeof args.priority === 'number') r.priority = args.priority;
if (typeof args.flagged === 'boolean') r.flagged = args.flagged;
if (args.dueDate) r.dueDate = new Date(args.dueDate);
(targetList.reminders as any).push(r);
JSON.stringify({ id: r.id(), title: r.name(), list: targetList.name(), notes: r.body(), completed: r.completed(), flagged: r.flagged(), priority: r.priority(), dueDate: r.dueDate() ? r.dueDate().toString() : null });
`;
    return runJxa(body, params);
}
async function jxaReminderUpdate(params) {
    const body = `
const Reminders = Application('Reminders');
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    const r = l.reminders().find(r => r.id() === args.id);
    if (r) {
      if (args.title !== undefined) r.name = args.title;
      if (args.notes !== undefined) r.body = args.notes;
      if (args.priority !== undefined) r.priority = args.priority;
      if (args.flagged !== undefined) r.flagged = args.flagged;
      if (args.dueDate === null) r.dueDate = null; else if (args.dueDate !== undefined) r.dueDate = new Date(args.dueDate);
      JSON.stringify({ id: r.id(), title: r.name(), notes: r.body(), completed: r.completed(), flagged: r.flagged(), priority: r.priority(), dueDate: r.dueDate() ? r.dueDate().toString() : null, list: l.name() });
      throw null;
    }
  }
}
JSON.stringify({ error: 'Reminder not found' });
`;
    return runJxa(body, params);
}
async function jxaReminderComplete(id, completed) {
    const body = `
const Reminders = Application('Reminders');
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    const r = l.reminders().find(r => r.id() === args.id);
    if (r) { r.completed = !!args.completed; JSON.stringify({ id: r.id(), completed: r.completed() }); throw null; }
  }
}
JSON.stringify({ error: 'Reminder not found' });
`;
    return runJxa(body, { id, completed });
}
async function jxaReminderDelete(id) {
    const body = `
const Reminders = Application('Reminders');
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    const r = l.reminders().find(r => r.id() === args.id);
    if (r) { r.delete(); JSON.stringify({ ok: true }); throw null; }
  }
}
JSON.stringify({ ok: false, error: 'Reminder not found' });
`;
    return runJxa(body, { id });
}
async function jxaReminderMove(id, destKey) {
    const body = `
const Reminders = Application('Reminders');
let target = null; let item = null; let src = null;
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    if (!target && (l.id() === args.dest || l.name() === args.dest)) target = l;
    const r = l.reminders().find(r => r.id() === args.id);
    if (r) { item = r; src = l; }
  }
}
if (!item) JSON.stringify({ error: 'Reminder not found' });
if (!target) JSON.stringify({ error: 'Destination list not found' });
(target.reminders as any).push(item);
JSON.stringify({ id: item.id(), from: src ? src.name() : null, to: target.name() });
`;
    return runJxa(body, { id, dest: destKey });
}
async function jxaSearchReminders(query) {
    const body = `
const Reminders = Application('Reminders');
const q = (args.query || '').toLowerCase();
let hits = [];
for (const a of Reminders.accounts()) {
  for (const l of a.lists()) {
    for (const r of l.reminders()) {
      const t = (r.name() || '').toLowerCase();
      const n = (r.body() || '').toLowerCase();
      if (t.includes(q) || n.includes(q)) {
        hits.push({ id: r.id(), title: r.name(), list: l.name(), notes: r.body(), completed: r.completed(), dueDate: r.dueDate() ? r.dueDate().toString() : null });
      }
    }
  }
}
JSON.stringify(hits);
`;
    return runJxa(body, { query });
}
function RO(_desc) { return z.object({}).optional(); }
// Tools registration
server.registerTool("lists.list", { title: "List Lists", description: "List all reminder lists (id, name, account)", inputSchema: RO("No input") }, async () => ({ content: [], structuredContent: { lists: await jxaListsList() } }));
server.registerTool("lists.ensure", { title: "Ensure List", description: "Ensure a list exists by name; create if missing", inputSchema: z.object({ name: z.string() }) }, async (args) => { ensureNotSafe("lists.ensure"); return { content: [], structuredContent: { list: await jxaListsEnsure(args.name) } }; });
server.registerTool("lists.delete", { title: "Delete List", description: "Delete a list by id or name (destructive)", inputSchema: z.object({ key: z.string() }) }, async (args) => { ensureNotSafe("lists.delete"); return { content: [], structuredContent: await jxaListsDelete(args.key) }; });
server.registerTool("lists.rename", { title: "Rename List", description: "Rename a list by id or name", inputSchema: z.object({ key: z.string(), newName: z.string() }) }, async (args) => { ensureNotSafe("lists.rename"); return { content: [], structuredContent: { list: await jxaListsRename(args.key, args.newName) } }; });
server.registerTool("reminders.list", { title: "List Reminders", description: "List reminders, optionally filtered by list id/name", inputSchema: z.object({ listKey: z.string().optional() }) }, async (args) => ({ content: [], structuredContent: { reminders: await jxaRemindersList(args.listKey) } }));
server.registerTool("reminders.get", { title: "Get Reminder", description: "Get a reminder by id", inputSchema: z.object({ id: z.string() }) }, async (args) => ({ content: [], structuredContent: { reminder: await jxaReminderGet(args.id) } }));
server.registerTool("reminders.create", { title: "Create Reminder", description: "Create a reminder in a list (by id or name)", inputSchema: z.object({ listKey: z.string().optional(), title: z.string(), notes: z.string().optional(), dueDate: z.string().optional(), priority: z.number().optional(), flagged: z.boolean().optional() }) }, async (input) => { ensureNotSafe("reminders.create"); return { content: [], structuredContent: { reminder: await jxaReminderCreate(input) } }; });
server.registerTool("reminders.update", { title: "Update Reminder", description: "Update fields of a reminder by id", inputSchema: z.object({ id: z.string(), title: z.string().optional(), notes: z.string().optional(), dueDate: z.union([z.string(), z.null()]).optional(), priority: z.number().optional(), flagged: z.boolean().optional() }) }, async (input) => { ensureNotSafe("reminders.update"); return { content: [], structuredContent: { reminder: await jxaReminderUpdate(input) } }; });
server.registerTool("reminders.complete", { title: "Complete Reminder", description: "Mark a reminder completed or not", inputSchema: z.object({ id: z.string(), completed: z.boolean().optional() }) }, async (args) => { ensureNotSafe("reminders.complete"); return { content: [], structuredContent: await jxaReminderComplete(args.id, args.completed ?? true) }; });
server.registerTool("reminders.delete", { title: "Delete Reminder", description: "Delete a reminder by id (destructive)", inputSchema: z.object({ id: z.string() }) }, async (args) => { ensureNotSafe("reminders.delete"); return { content: [], structuredContent: await jxaReminderDelete(args.id) }; });
server.registerTool("reminders.move", { title: "Move Reminder", description: "Move a reminder to another list (dest by id or name)", inputSchema: z.object({ id: z.string(), destKey: z.string() }) }, async (args) => { ensureNotSafe("reminders.move"); return { content: [], structuredContent: await jxaReminderMove(args.id, args.destKey) }; });
server.registerTool("reminders.search", { title: "Search Reminders", description: "Search reminders by title/notes", inputSchema: z.object({ query: z.string() }) }, async (args) => ({ content: [], structuredContent: { results: await jxaSearchReminders(args.query) } }));
// Admin
server.registerTool("server.status", { title: "Server Status", description: "Get server status, including safe mode", inputSchema: RO("No input") }, async () => ({ content: [], structuredContent: { safeMode: SAFE_MODE, name: "apple-reminders-mcp", version: "0.1.0" } }));
server.registerTool("server.set_safe_mode", { title: "Set Safe Mode", description: "Set safe (read-only) mode for this session", inputSchema: z.object({ safe: z.boolean() }) }, async (args) => { SAFE_MODE = !!args.safe; return { content: [], structuredContent: { safeMode: SAFE_MODE } }; });
// Start
// Lightweight CLI flags for CI/testing and users
try {
    const argv = process.argv.slice(2);
    if (argv.includes("--version")) {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
        console.log(String(pkg.version || "0.0.0"));
        process.exit(0);
    }
    if (argv.includes("--help")) {
        console.log("apple-reminders-mcp: start an MCP server over stdio.\nUsage: npx @rnto1/apple-reminders-mcp [--version] [--help]");
        process.exit(0);
    }
}
catch { }
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
});
