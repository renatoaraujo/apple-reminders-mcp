import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const SAFE = ["1", "true", "yes"].includes(String(process.env.REMINDERS_MCP_SAFE || "").toLowerCase());
let SAFE_MODE = SAFE;

function runJxa<T = unknown>(body: string, args: unknown = {}): Promise<T> {
  const env = { ...process.env, ARGS: JSON.stringify(args ?? {}) };
  const code = `
ObjC.import('stdlib');
const args = JSON.parse($.getenv('ARGS') || '{}');
function toObj(o) { return JSON.parse(JSON.stringify(o)); }
${body}
`;
  return new Promise((resolve, reject) => {
    const cp = new (await import("node:child_process")).spawn("osascript", ["-l", "JavaScript", "-e", code], { env });
    let out = ""; let err = "";
    cp.stdout.on("data", (d) => (out += d.toString()));
    cp.stderr.on("data", (d) => (err += d.toString()));
    cp.on("close", (code) => {
      if (code !== 0) return reject(new Error(err || `JXA exit ${code}`));
      try { resolve(out ? JSON.parse(out) : (undefined as any)); } catch (e) { reject(e); }
    });
  });
}

function ensureNotSafe(op: string) {
  if (SAFE_MODE) throw new Error(`Safe mode enabled; '${op}' is blocked`);
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

async function jxaListsEnsure(pathOrName: string) {
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

async function jxaListsDelete(nameOrId: string) {
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

async function jxaListsRename(idOrName: string, newName: string) {
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

async function jxaRemindersList(listKey?: string) {
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

async function jxaReminderGet(id: string) {
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

async function jxaReminderCreate(params: { listKey?: string; title: string; notes?: string; dueDate?: string; priority?: number; flagged?: boolean; }) {
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

async function jxaReminderUpdate(params: { id: string; title?: string; notes?: string; dueDate?: string | null; priority?: number; flagged?: boolean; }) {
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

async function jxaReminderComplete(id: string, completed: boolean) {
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

async function jxaReminderDelete(id: string) {
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

async function jxaReminderMove(id: string, destKey: string) {
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

async function jxaSearchReminders(query: string) {
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

function RO(desc: string): Tool["inputSchema"] { return { type: "object", properties: {}, additionalProperties: false, description: desc } as any; }

// Tools registration
server.registerTool("lists.list", {
  description: "List all reminder lists (id, name, account)",
  inputSchema: RO("No input"),
  async handler() { return { content: [{ type: "json", data: await jxaListsList() }] }; }
});

server.registerTool("lists.ensure", {
  description: "Ensure a list exists by name; create if missing",
  inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
  async handler({ name }) { ensureNotSafe("lists.ensure"); return { content: [{ type: "json", data: await jxaListsEnsure(name) }] }; }
});

server.registerTool("lists.delete", {
  description: "Delete a list by id or name (destructive)",
  inputSchema: { type: "object", required: ["key"], properties: { key: { type: "string" } } },
  async handler({ key }) { ensureNotSafe("lists.delete"); return { content: [{ type: "json", data: await jxaListsDelete(key) }] }; }
});

server.registerTool("lists.rename", {
  description: "Rename a list by id or name",
  inputSchema: { type: "object", required: ["key","newName"], properties: { key: { type: "string" }, newName: { type: "string" } } },
  async handler({ key, newName }) { ensureNotSafe("lists.rename"); return { content: [{ type: "json", data: await jxaListsRename(key, newName) }] }; }
});

server.registerTool("reminders.list", {
  description: "List reminders, optionally filtered by list id/name",
  inputSchema: { type: "object", properties: { listKey: { type: "string" } } },
  async handler({ listKey }) { return { content: [{ type: "json", data: await jxaRemindersList(listKey) }] }; }
});

server.registerTool("reminders.get", {
  description: "Get a reminder by id",
  inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  async handler({ id }) { return { content: [{ type: "json", data: await jxaReminderGet(id) }] }; }
});

server.registerTool("reminders.create", {
  description: "Create a reminder in a list (by id or name)",
  inputSchema: { type: "object", required: ["title"], properties: {
    listKey: { type: "string" }, title: { type: "string" }, notes: { type: "string" },
    dueDate: { type: "string", description: "ISO date or parseable date string" },
    priority: { type: "number" }, flagged: { type: "boolean" }
  } },
  async handler(input) { ensureNotSafe("reminders.create"); return { content: [{ type: "json", data: await jxaReminderCreate(input) }] }; }
});

server.registerTool("reminders.update", {
  description: "Update fields of a reminder by id",
  inputSchema: { type: "object", required: ["id"], properties: {
    id: { type: "string" }, title: { type: "string" }, notes: { type: "string" },
    dueDate: { oneOf: [{ type: "string" }, { type: "null" }] }, priority: { type: "number" }, flagged: { type: "boolean" }
  } },
  async handler(input) { ensureNotSafe("reminders.update"); return { content: [{ type: "json", data: await jxaReminderUpdate(input) }] }; }
});

server.registerTool("reminders.complete", {
  description: "Mark a reminder completed or not",
  inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, completed: { type: "boolean" } } },
  async handler({ id, completed = true }) { ensureNotSafe("reminders.complete"); return { content: [{ type: "json", data: await jxaReminderComplete(id, completed) }] }; }
});

server.registerTool("reminders.delete", {
  description: "Delete a reminder by id (destructive)",
  inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  async handler({ id }) { ensureNotSafe("reminders.delete"); return { content: [{ type: "json", data: await jxaReminderDelete(id) }] }; }
});

server.registerTool("reminders.move", {
  description: "Move a reminder to another list (dest by id or name)",
  inputSchema: { type: "object", required: ["id","destKey"], properties: { id: { type: "string" }, destKey: { type: "string" } } },
  async handler({ id, destKey }) { ensureNotSafe("reminders.move"); return { content: [{ type: "json", data: await jxaReminderMove(id, destKey) }] }; }
});

server.registerTool("reminders.search", {
  description: "Search reminders by title/notes",
  inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
  async handler({ query }) { return { content: [{ type: "json", data: await jxaSearchReminders(query) }] }; }
});

// Admin
server.registerTool("server.status", {
  description: "Get server status, including safe mode",
  inputSchema: RO("No input"),
  async handler() { return { content: [{ type: "json", data: { safeMode: SAFE_MODE, name: "apple-reminders-mcp", version: "0.1.0" } }] }; }
});

server.registerTool("server.set_safe_mode", {
  description: "Set safe (read-only) mode for this session",
  inputSchema: { type: "object", required: ["safe"], properties: { safe: { type: "boolean" } } },
  async handler({ safe }) { SAFE_MODE = !!safe; return { content: [{ type: "json", data: { safeMode: SAFE_MODE } }] }; }
});

// Start
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
