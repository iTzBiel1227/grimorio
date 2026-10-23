import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { Server } from "socket.io";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "grimorio.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_data TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    system_name TEXT NOT NULL DEFAULT 'Sistema próprio',
    master_key TEXT NOT NULL,
    owner_user_id TEXT,
    created_at TEXT NOT NULL,
    state_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS character_sheets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Novo personagem',
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaign_members (
    campaign_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (campaign_id, user_id),
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL, friend_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
    PRIMARY KEY(user_id, friend_user_id)
  );
  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover_data TEXT NOT NULL DEFAULT '', pdf_data TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grimoire_entries (
    id TEXT PRIMARY KEY, owner_user_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', damage TEXT NOT NULL DEFAULT '', is_standard INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaign_sheet_assignments (
    campaign_id TEXT NOT NULL, sheet_id TEXT NOT NULL, assigned_user_id TEXT, PRIMARY KEY(campaign_id, sheet_id)
  );
  CREATE TABLE IF NOT EXISTS campaign_messages (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, sender_user_id TEXT NOT NULL, recipient_user_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
`);

// Migrações leves para bancos criados por versões anteriores.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes("display_name")) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
if (!userColumns.includes("avatar_data")) db.exec("ALTER TABLE users ADD COLUMN avatar_data TEXT NOT NULL DEFAULT ''");
if (!userColumns.includes("role")) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
if (!userColumns.includes("account_code")) db.exec("ALTER TABLE users ADD COLUMN account_code TEXT");
function makeAccountCode() {
  let code;
  do { code = String(randomInt(0, 100000000)).padStart(8, '0'); }
  while (db.prepare('SELECT 1 FROM users WHERE account_code=?').get(code));
  return code;
}
db.transaction(() => {
  for (const user of db.prepare('SELECT id FROM users WHERE account_code IS NULL').all()) {
    db.prepare('UPDATE users SET account_code=? WHERE id=?').run(makeAccountCode(), user.id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_account_code_unique ON users(account_code)');
})();
db.function('fold_name', value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
const campaignColumns = db.prepare("PRAGMA table_info(campaigns)").all().map(c => c.name);
if (!campaignColumns.includes("owner_user_id")) db.exec("ALTER TABLE campaigns ADD COLUMN owner_user_id TEXT");
if (!campaignColumns.includes("status")) db.exec("ALTER TABLE campaigns ADD COLUMN status TEXT NOT NULL DEFAULT 'lobby'");

db.exec("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
// ADMIN_EMAIL can also designate an account that already exists.
if (process.env.ADMIN_EMAIL) db.prepare("UPDATE users SET role='admin' WHERE email=?").run(process.env.ADMIN_EMAIL.trim().toLowerCase());

app.use(express.json({ limit: "34mb" }));
app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({error: 'Arquivo muito grande. Use PDF de até 20 MB e imagem de até 3 MB.'});
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({error: 'Dados inválidos.'});
  next(error);
});
app.use(express.static(path.join(__dirname, "public")));

const createUser = db.prepare("INSERT INTO users (id, email, password_hash, created_at, account_code) VALUES (?, ?, ?, ?, ?)");
const findUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const findUserById = db.prepare("SELECT id, email, display_name AS displayName, avatar_data AS avatarData, account_code AS accountCode, role, created_at AS createdAt FROM users WHERE id = ?");
const updateUserProfile = db.prepare("UPDATE users SET display_name = ?, avatar_data = ? WHERE id = ?");
const createSession = db.prepare("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)");
const findSession = db.prepare(`SELECT s.*, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`);
const deleteSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const createCampaign = db.prepare(`INSERT INTO campaigns (id, code, name, system_name, master_key, owner_user_id, created_at, state_json) VALUES (@id, @code, @name, @system_name, @master_key, @owner_user_id, @created_at, @state_json)`);
const findByCode = db.prepare("SELECT * FROM campaigns WHERE code = ?");
const updateState = db.prepare("UPDATE campaigns SET state_json = ? WHERE code = ?");
const listOwnedCampaigns = db.prepare("SELECT * FROM campaigns WHERE owner_user_id = ? ORDER BY created_at DESC");
const upsertMember = db.prepare(`INSERT INTO campaign_members (campaign_id, user_id, player_name, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(campaign_id, user_id) DO UPDATE SET player_name = excluded.player_name`);
const listUserCampaigns = db.prepare(`
  SELECT c.*, CASE WHEN c.owner_user_id = ? THEN 'master' ELSE 'player' END AS role, cm.player_name
  FROM campaigns c
  LEFT JOIN campaign_members cm ON cm.campaign_id = c.id AND cm.user_id = ?
  WHERE c.owner_user_id = ? OR cm.user_id = ?
  ORDER BY c.created_at DESC
`);
const findMembership = db.prepare("SELECT * FROM campaign_members WHERE campaign_id = ? AND user_id = ?");
const createSheet = db.prepare("INSERT INTO character_sheets (id,user_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)");
const listSheets = db.prepare("SELECT id,name,data_json AS dataJson,created_at AS createdAt,updated_at AS updatedAt FROM character_sheets WHERE user_id=? ORDER BY updated_at DESC");
const getSheet = db.prepare("SELECT * FROM character_sheets WHERE id=? AND user_id=?");
const updateSheet = db.prepare("UPDATE character_sheets SET name=?, data_json=?, updated_at=? WHERE id=? AND user_id=?");
const deleteSheet = db.prepare("DELETE FROM character_sheets WHERE id=? AND user_id=?");

const countCampaignMembers = db.prepare("SELECT COUNT(*) AS total FROM campaign_members WHERE campaign_id=?");
const listCampaignMembers = db.prepare(`SELECT u.id,u.email,u.display_name AS displayName,u.avatar_data AS avatarData,cm.player_name AS playerName,c.owner_user_id=u.id AS isMaster FROM campaign_members cm JOIN users u ON u.id=cm.user_id JOIN campaigns c ON c.id=cm.campaign_id WHERE cm.campaign_id=? ORDER BY isMaster DESC, cm.joined_at`);
const findUserByCode = db.prepare("SELECT id,display_name AS displayName,avatar_data AS avatarData,account_code AS accountCode FROM users WHERE account_code=?");
const listFriends = db.prepare(`SELECT u.id,u.display_name AS displayName,u.avatar_data AS avatarData,u.account_code AS accountCode,f.status FROM friendships f JOIN users u ON u.id=f.friend_user_id WHERE f.user_id=? ORDER BY u.display_name,u.account_code`);
const upsertFriend = db.prepare("INSERT INTO friendships(user_id,friend_user_id,status,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,friend_user_id) DO UPDATE SET status=excluded.status");
const listEntries = db.prepare("SELECT * FROM grimoire_entries WHERE is_standard=1 OR owner_user_id=? ORDER BY is_standard DESC, kind, name");
const getEntry = db.prepare("SELECT * FROM grimoire_entries WHERE id=?");
const listBooks = db.prepare("SELECT id,title,description,cover_data AS coverData,created_at AS createdAt FROM books ORDER BY created_at DESC");
function normalizeEmail(value) { return String(value || "").trim().toLowerCase().slice(0, 254); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function hashPassword(password, salt = randomBytes(16).toString("hex")) { return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
function verifyPassword(password, stored) {
  const [salt, keyHex] = String(stored).split(":");
  if (!salt || !keyHex) return false;
  const derived = scryptSync(password, salt, 64);
  const storedKey = Buffer.from(keyHex, "hex");
  return storedKey.length === derived.length && timingSafeEqual(storedKey, derived);
}
function tokenHash(token) { return createHash("sha256").update(token).digest("hex"); }
function issueSession(userId) {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  createSession.run(randomUUID(), userId, tokenHash(token), now.toISOString(), expires.toISOString());
  return token;
}
function getAuth(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const session = findSession.get(tokenHash(token), new Date().toISOString());
  return session ? { userId: session.user_id, email: session.email, token } : null;
}
function requireAuth(req, res, next) {
  const auth = getAuth(req);
  if (!auth) return res.status(401).json({ error: "Faça login para continuar." });
  req.auth = auth;
  next();
}
function makeCode() { return randomBytes(3).toString("hex").toUpperCase(); }
function publicCampaign(row) {
  return { id: row.id, code: row.code, name: row.name, status: row.status || 'lobby', systemName: row.system_name, createdAt: row.created_at, state: JSON.parse(row.state_json) };
}
function getCampaign(code) {
  if (typeof code !== "string") return null;
  const row = findByCode.get(code.trim().toUpperCase());
  return row ? publicCampaign(row) : null;
}
function saveState(code, state) { updateState.run(JSON.stringify(state), code); }

app.post("/api/auth/register", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!validEmail(email)) return res.status(400).json({ error: "Digite um e-mail válido." });
  if (password.length < 8) return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
  if (findUserByEmail.get(email)) return res.status(409).json({ error: "Já existe uma conta com este e-mail." });
  const id = randomUUID();
  createUser.run(id, email, hashPassword(password), new Date().toISOString(), makeAccountCode());
  if (process.env.ADMIN_EMAIL && email === normalizeEmail(process.env.ADMIN_EMAIL)) db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
  const token = issueSession(id);
  res.status(201).json({ token, user: findUserById.get(id) });
});

app.post("/api/auth/login", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const user = findUserByEmail.get(email);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: "E-mail ou senha incorretos." });
  const token = issueSession(user.id);
  res.json({ token, user: findUserById.get(user.id) });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: findUserById.get(req.auth.userId) }));
app.post("/api/auth/logout", requireAuth, (req, res) => { deleteSession.run(tokenHash(req.auth.token)); res.status(204).end(); });

app.put("/api/profile", requireAuth, (req, res) => {
  const displayName = String(req.body?.displayName || "").trim().slice(0, 32);
  const avatarData = String(req.body?.avatarData || "");
  if (!validImageUpload(avatarData)) return res.status(400).json({ error: "Envie uma imagem PNG, JPG ou WEBP válida de até 3 MB." });
  updateUserProfile.run(displayName, avatarData, req.auth.userId);
  res.json({ user: findUserById.get(req.auth.userId) });
});


app.get("/api/sheets", requireAuth, (req,res) => {
  res.json({ sheets: listSheets.all(req.auth.userId).map(r => ({...r, data: JSON.parse(r.dataJson)})) });
});
app.post("/api/sheets", requireAuth, (req,res) => {
  const id=randomUUID(), now=new Date().toISOString();
  const data=req.body?.data && typeof req.body.data === "object" ? req.body.data : {};
  const name=String(data.name || "Novo personagem").trim().slice(0,70) || "Novo personagem";
  createSheet.run(id,req.auth.userId,name,JSON.stringify(data),now,now);
  res.status(201).json({id,name,data,createdAt:now,updatedAt:now});
});
app.get("/api/sheets/:id", requireAuth, (req,res) => {
  const row=getSheet.get(req.params.id,req.auth.userId);
  if(!row) return res.status(404).json({error:"Ficha não encontrada."});
  res.json({id:row.id,name:row.name,data:JSON.parse(row.data_json),createdAt:row.created_at,updatedAt:row.updated_at});
});
app.put("/api/sheets/:id", requireAuth, (req,res) => {
  const row=getSheet.get(req.params.id,req.auth.userId);
  if(!row) return res.status(404).json({error:"Ficha não encontrada."});
  const data=req.body?.data && typeof req.body.data === "object" ? req.body.data : {};
  const name=String(data.name || "Novo personagem").trim().slice(0,70) || "Novo personagem";
  const now=new Date().toISOString(); updateSheet.run(name,JSON.stringify(data),now,req.params.id,req.auth.userId);
  res.json({id:req.params.id,name,data,updatedAt:now});
});
app.delete("/api/sheets/:id", requireAuth, (req,res) => { deleteSheet.run(req.params.id,req.auth.userId); res.status(204).end(); });

app.get("/api/my/campaigns", requireAuth, (req, res) => {
  const uid = req.auth.userId;
  const campaigns = listUserCampaigns.all(uid, uid, uid, uid).map(row => ({ ...publicCampaign(row), role: row.role, playerName: row.player_name || (row.role === "master" ? "Mestre" : "Aventureiro") }));
  res.json({ campaigns });
});

app.post("/api/campaigns", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 70);
  if (!name) return res.status(400).json({ error: "Digite um nome para a campanha." });
  let code; do { code = makeCode(); } while (findByCode.get(code));
  const masterKey = randomBytes(24).toString("hex");
  const campaign = {
    id: randomUUID(), code, name, system_name: "Sistema próprio", master_key: masterKey,
    owner_user_id: req.auth.userId, created_at: new Date().toISOString(),
    state_json: JSON.stringify({ tokens: [
      { id: randomUUID(), name: "Herói 1", x: 3, y: 3, color: "#a78bfa" },
      { id: randomUUID(), name: "Herói 2", x: 5, y: 3, color: "#60a5fa" }
    ], rolls: [], notes: "" })
  };
  createCampaign.run(campaign);
  upsertMember.run(campaign.id, req.auth.userId, "Mestre", new Date().toISOString());
  res.status(201).json({ campaign: publicCampaign(campaign), masterKey });
});

app.get("/api/campaigns/:code", requireAuth, (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const row = findByCode.get(code);
  if (!row) return res.status(404).json({ error: "Sala não encontrada." });
  const membership = findMembership.get(row.id, req.auth.userId);
  const isOwner = row.owner_user_id === req.auth.userId;
  res.json({ campaign: publicCampaign(row), role: isOwner ? "master" : (membership ? "player" : "guest"), playerName: membership?.player_name || "", masterKey: isOwner ? row.master_key : undefined });
});

app.post("/api/campaigns/:code/join", requireAuth, (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const row = findByCode.get(code);
  if (!row) return res.status(404).json({ error: "Campanha não encontrada." });
  if (row.owner_user_id === req.auth.userId) return res.json({ campaign: publicCampaign(row), role: "master", playerName: "Mestre", masterKey: row.master_key });
  const playerName = String(req.body?.playerName || "Aventureiro").trim().slice(0, 24) || "Aventureiro";
  const existing = findMembership.get(row.id, req.auth.userId);
  if (!existing && countCampaignMembers.get(row.id).total >= 10) return res.status(409).json({error:"Esta campanha já atingiu o limite de 10 participantes."});
  upsertMember.run(row.id, req.auth.userId, playerName, new Date().toISOString());
  res.json({ campaign: publicCampaign(row), role: "player", playerName });
});

app.get("/api/campaigns/:code/members", requireAuth, (req,res)=>{ const row=findByCode.get(String(req.params.code).toUpperCase()); if(!row)return res.status(404).json({error:"Campanha não encontrada."}); res.json({members:listCampaignMembers.all(row.id),status:row.status||"lobby",maxPlayers:10}); });
app.post("/api/campaigns/:code/start", requireAuth, (req,res)=>{ const row=findByCode.get(String(req.params.code).toUpperCase()); if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode iniciar."}); db.prepare("UPDATE campaigns SET status='session' WHERE id=?").run(row.id); io.to(row.code).emit("campaign:started",{code:row.code}); res.json({ok:true}); });
app.post("/api/campaigns/:code/lobby", requireAuth, (req,res)=>{ const row=findByCode.get(String(req.params.code).toUpperCase()); if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode alterar o lobby."}); db.prepare("UPDATE campaigns SET status='lobby' WHERE id=?").run(row.id); res.json({ok:true}); });

app.get("/api/friends", requireAuth,(req,res)=>res.json({friends:listFriends.all(req.auth.userId)}));
app.get('/api/users/search', requireAuth, (req,res) => {
  const query = String(req.query.q || '').trim().slice(0,80);
  if (query.length < 2) return res.json({users:[]});
  const code = /^\d{8}$/.test(query);
  const pattern = '%' + query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\\%_]/g,'\\$&') + '%';
  const users = db.prepare(`SELECT u.id,u.display_name AS displayName,u.avatar_data AS avatarData,u.account_code AS accountCode,
    EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=? AND f.friend_user_id=u.id) AS isFriend
    FROM users u WHERE u.id<>? AND ${code ? 'u.account_code=?' : "fold_name(u.display_name) LIKE ? ESCAPE '\\'"}
    ORDER BY u.display_name,u.account_code LIMIT 20`).all(req.auth.userId,req.auth.userId,code ? query : pattern);
  res.json({users:users.map(user => ({...user,isFriend:!!user.isFriend}))});
});
app.post('/api/friends', requireAuth, (req,res) => {
  const code=String(req.body?.accountCode || '').trim();
  if (!/^\d{8}$/.test(code)) return res.status(400).json({error:'Informe o código de 8 números ou busque um jogador pelo nome.'});
  const user=findUserByCode.get(code);
  if(!user) return res.status(404).json({error:'Nenhuma conta encontrada com esse código.'});
  if(user.id===req.auth.userId) return res.status(400).json({error:'Você não pode adicionar a si mesmo.'});
  db.transaction(() => {
    const now=new Date().toISOString();
    upsertFriend.run(req.auth.userId,user.id,'accepted',now);
    upsertFriend.run(user.id,req.auth.userId,'accepted',now);
  })();
  res.json({friend:user});
});

app.get("/api/grimoire", requireAuth,(req,res)=>res.json({entries:listEntries.all(req.auth.userId).map(r=>({id:r.id,kind:r.kind,name:r.name,description:r.description,damage:r.damage,isStandard:!!r.is_standard}))}));
app.post("/api/grimoire", requireAuth,(req,res)=>{const kind=['spell','ability'].includes(req.body?.kind)?req.body.kind:'spell';const id=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO grimoire_entries(id,owner_user_id,kind,name,description,damage,is_standard,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,req.auth.userId,kind,String(req.body?.name||'Sem nome').slice(0,80),String(req.body?.description||'').slice(0,5000),String(req.body?.damage||'').slice(0,120),0,now,now);res.status(201).json({id});});
app.put("/api/grimoire/:id", requireAuth,(req,res)=>{const e=getEntry.get(req.params.id);if(!e||e.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Sem permissão."});db.prepare("UPDATE grimoire_entries SET name=?,description=?,damage=?,updated_at=? WHERE id=?").run(String(req.body?.name||e.name).slice(0,80),String(req.body?.description||e.description).slice(0,5000),String(req.body?.damage||e.damage).slice(0,120),new Date().toISOString(),e.id);res.json({ok:true});});
app.delete("/api/grimoire/:id", requireAuth,(req,res)=>{const e=getEntry.get(req.params.id);if(!e||e.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Sem permissão."});db.prepare("DELETE FROM grimoire_entries WHERE id=?").run(e.id);res.status(204).end();});

﻿function requireContentAdmin(req, res, next) {
  if (findUserById.get(req.auth.userId)?.role !== 'admin') return res.status(403).json({error:'Somente administradores podem alterar o catálogo e o anúncio.'});
  next();
}
function decodeUpload(value, pattern, maxBytes) {
  if (typeof value !== 'string') return null;
  const match = value.match(pattern);
  if (!match || match[1].length > Math.ceil(maxBytes / 3) * 4) return null;
  const bytes = Buffer.from(match[1], 'base64');
  return bytes.length && bytes.length <= maxBytes && bytes.toString('base64') === match[1] ? bytes : null;
}
function validImageUpload(value) {
  if (!value) return true;
  const bytes = decodeUpload(value, /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/, 3 * 1024 * 1024);
  if (!bytes) return false;
  if (value.startsWith('data:image/png;')) return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (value.startsWith('data:image/jpeg;')) return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
}
app.get('/api/content/permissions', (req,res) => {
  const auth = getAuth(req);
  res.json({canManageContent: !!auth && findUserById.get(auth.userId)?.role === 'admin'});
});
app.get('/api/home-feature', (req,res) => {
  const saved = db.prepare("SELECT value FROM site_settings WHERE key='home_feature'").get();
  res.json(saved ? JSON.parse(saved.value) : {imageData:'/assets/grimorio-book.png',bookId:''});
});
app.put('/api/home-feature', requireAuth, requireContentAdmin, (req,res) => {
  const imageData = req.body?.imageData;
  const bookId = String(req.body?.bookId || '');
  if (!imageData || (imageData !== '/assets/grimorio-book.png' && !validImageUpload(imageData))) return res.status(400).json({error:'Envie uma imagem PNG, JPG ou WEBP de até 3 MB.'});
  if (bookId && !db.prepare('SELECT id FROM books WHERE id=?').get(bookId)) return res.status(400).json({error:'Escolha um livro existente no catálogo.'});
  const feature = {imageData,bookId};
  db.prepare("INSERT INTO site_settings(key,value) VALUES('home_feature',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(feature));
  res.json(feature);
});
app.get('/api/books', (req,res) => res.json({books:listBooks.all()}));
app.get('/api/books/:id/pdf', (req,res) => {
  const row=db.prepare('SELECT title,pdf_data FROM books WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Livro não encontrado.'});
  const match=String(row.pdf_data).match(/^data:application\/pdf;base64,(.+)$/);
  if(!match) return res.status(500).json({error:'O PDF deste livro está indisponível.'});
  const filename=encodeURIComponent(row.title.replace(/[\r\n]/g,'')+'.pdf');
  res.set('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="livro.pdf"; filename*=UTF-8''${filename}`);
  res.set('X-Content-Type-Options','nosniff').type('pdf').send(Buffer.from(match[1],'base64'));
});
app.post('/api/books', requireAuth, requireContentAdmin, (req,res) => {
  const title=String(req.body?.title || '').trim().slice(0,120);
  if(!title) return res.status(400).json({error:'Informe o título do livro.'});
  const pdf=req.body?.pdfData;
  const bytes=decodeUpload(pdf,/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/,20*1024*1024);
  if(!bytes || bytes.toString('ascii',0,5)!=='%PDF-') return res.status(400).json({error:'Envie um PDF válido de até 20 MB.'});
  const cover=String(req.body?.coverData || '');
  if(!validImageUpload(cover)) return res.status(400).json({error:'Envie uma capa PNG, JPG ou WEBP de até 3 MB.'});
  const id=randomUUID();
  db.prepare('INSERT INTO books(id,title,description,cover_data,pdf_data,created_at) VALUES(?,?,?,?,?,?)').run(id,title,String(req.body?.description||'').trim().slice(0,1000),cover,pdf,new Date().toISOString());
  res.status(201).json({id});
});

app.post("/api/suggestions", requireAuth,(req,res)=>{const body=String(req.body?.body||'').trim().slice(0,5000);if(!body)return res.status(400).json({error:"Escreva sua sugestão."});db.prepare("INSERT INTO suggestions(id,user_id,body,created_at) VALUES(?,?,?,?)").run(randomUUID(),req.auth.userId,body,new Date().toISOString());res.status(201).json({ok:true});});

app.get("/api/campaigns/:code/sheets", requireAuth,(req,res)=>{const row=findByCode.get(String(req.params.code).toUpperCase());if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode ver todas as fichas."});const sheets=db.prepare(`SELECT cs.id,cs.name,cs.data_json AS dataJson,u.display_name AS ownerName,u.email AS ownerEmail,a.assigned_user_id AS assignedUserId FROM campaign_members cm JOIN character_sheets cs ON cs.user_id=cm.user_id JOIN users u ON u.id=cs.user_id LEFT JOIN campaign_sheet_assignments a ON a.campaign_id=cm.campaign_id AND a.sheet_id=cs.id WHERE cm.campaign_id=?`).all(row.id).map(x=>({...x,data:JSON.parse(x.dataJson)}));res.json({sheets});});
app.get("/api/campaigns/:code/sheets/:sheetId", requireAuth,(req,res)=>{const row=findByCode.get(String(req.params.code).toUpperCase());if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode acessar esta ficha."});const sh=db.prepare("SELECT * FROM character_sheets WHERE id=?").get(req.params.sheetId);if(!sh)return res.status(404).json({error:"Ficha não encontrada."});res.json({id:sh.id,name:sh.name,data:JSON.parse(sh.data_json),createdAt:sh.created_at,updatedAt:sh.updated_at});});
app.put("/api/campaigns/:code/sheets/:sheetId", requireAuth,(req,res)=>{const row=findByCode.get(String(req.params.code).toUpperCase());if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode editar esta ficha."});const data=req.body?.data&&typeof req.body.data==='object'?req.body.data:{};db.prepare("UPDATE character_sheets SET name=?,data_json=?,updated_at=? WHERE id=?").run(String(data.name||'Novo personagem').slice(0,70),JSON.stringify(data),new Date().toISOString(),req.params.sheetId);res.json({ok:true});});
app.put("/api/campaigns/:code/sheets/:sheetId/assign", requireAuth,(req,res)=>{const row=findByCode.get(String(req.params.code).toUpperCase());if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode atribuir fichas."});db.prepare("INSERT INTO campaign_sheet_assignments(campaign_id,sheet_id,assigned_user_id) VALUES(?,?,?) ON CONFLICT(campaign_id,sheet_id) DO UPDATE SET assigned_user_id=excluded.assigned_user_id").run(row.id,req.params.sheetId,req.body?.userId||null);res.json({ok:true});});

io.on("connection", socket => {
  socket.on("room:join", ({ code, playerName } = {}) => {
    const campaign = getCampaign(code);
    if (!campaign) return socket.emit("app:error", "Não encontramos essa sala. Confira o código.");
    const safeName = String(playerName || "Aventureiro").trim().slice(0, 24) || "Aventureiro";
    socket.join(campaign.code); socket.data.code = campaign.code; socket.data.playerName = safeName;
    socket.emit("room:state", { campaign, players: getRoomPlayers(campaign.code) });
    io.to(campaign.code).emit("room:players", getRoomPlayers(campaign.code));
    socket.to(campaign.code).emit("room:notice", `${safeName} entrou na mesa.`);
  });
  socket.on("token:move", ({ tokenId, x, y } = {}) => {
    const code = socket.data.code; if (!code || typeof tokenId !== "string") return;
    const campaign = getCampaign(code); if (!campaign) return;
    const nx = Math.max(0, Math.min(29, Math.round(Number(x)))); const ny = Math.max(0, Math.min(19, Math.round(Number(y))));
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const token = campaign.state.tokens.find(t => t.id === tokenId); if (!token) return;
    token.x = nx; token.y = ny; saveState(code, campaign.state);
    io.to(code).emit("room:state", { campaign, players: getRoomPlayers(code) });
  });
  socket.on("dice:roll", ({ sides, modifier, label, characterName } = {}) => {
    const code = socket.data.code; if (!code) return;
    const validSides = [4,6,8,10,12,20,100]; const die = Number(sides); const mod = Math.max(-100, Math.min(100, Math.trunc(Number(modifier) || 0)));
    if (!validSides.includes(die)) return;
    const value = 1 + Math.floor(Math.random() * die);
    const result = { id: randomUUID(), player: socket.data.playerName || "Aventureiro", characterName: String(characterName || "").trim().slice(0,70), label: String(label || "").trim().slice(0,60), sides: die, value, modifier: mod, total: value + mod, at: new Date().toISOString() };
    const campaign = getCampaign(code); if (!campaign) return;
    campaign.state.rolls.unshift(result); campaign.state.rolls = campaign.state.rolls.slice(0, 30); saveState(code, campaign.state);
    io.to(code).emit("dice:result", result); io.to(code).emit("room:state", { campaign, players: getRoomPlayers(code) });
  });
  socket.on("master:save-notes", ({ notes, masterKey } = {}) => {
    const code = socket.data.code; if (!code || typeof notes !== "string") return;
    const row = findByCode.get(code);
    if (!row || !masterKey || masterKey !== row.master_key) return socket.emit("app:error", "Somente o mestre pode salvar as anotações.");
    const campaign = getCampaign(code); campaign.state.notes = notes.slice(0,10000); saveState(code, campaign.state);
    socket.emit("room:state", { campaign, players: getRoomPlayers(code) }); socket.emit("room:notice", "Anotações salvas.");
  });
  socket.on("session:chat", ({body,recipientSocketId}={})=>{ const code=socket.data.code; const text=String(body||'').trim().slice(0,1000); if(!code||!text)return; const msg={id:randomUUID(),sender:socket.data.playerName||'Aventureiro',body:text,at:new Date().toISOString(),private:!!recipientSocketId}; if(recipientSocketId){socket.emit('session:message',msg);io.to(recipientSocketId).emit('session:message',msg)}else io.to(code).emit('session:message',msg); });
  socket.on("disconnect", () => { const code = socket.data.code; if (code) io.to(code).emit("room:players", getRoomPlayers(code)); });
});

function getRoomPlayers(code) {
  return [...io.sockets.adapter.rooms.get(code) || []].map(id => { const s = io.sockets.sockets.get(id); return s ? { id, name: s.data.playerName || "Aventureiro" } : null; }).filter(Boolean);
}

app.get("*path", (req, res, next) => { if (req.path.startsWith("/api/")) return next(); res.sendFile(path.join(__dirname, "public", "index.html")); });
server.listen(PORT, () => console.log(`Grimório disponível em http://localhost:${PORT}`));
