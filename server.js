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
if (!userColumns.includes("banner_data")) db.exec("ALTER TABLE users ADD COLUMN banner_data TEXT NOT NULL DEFAULT ''");
if (!userColumns.includes("bio")) db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
if (!userColumns.includes("role")) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
if (!userColumns.includes("account_code")) db.exec("ALTER TABLE users ADD COLUMN account_code TEXT");
if (!userColumns.includes("username")) db.exec("ALTER TABLE users ADD COLUMN username TEXT");
if (!userColumns.includes("birth_date")) db.exec("ALTER TABLE users ADD COLUMN birth_date TEXT");
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
  db.exec("UPDATE users SET username='jogador_' || account_code WHERE username IS NULL; CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(lower(username))");
})();

db.exec(`
  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY, sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
    CHECK (sender_user_id <> recipient_user_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_pending_friend_request ON friend_requests (
    min(sender_user_id,recipient_user_id), max(sender_user_id,recipient_user_id)
  ) WHERE status='pending';
  CREATE TABLE IF NOT EXISTS campaign_invitations (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_pending_campaign_invite ON campaign_invitations(campaign_id,recipient_user_id) WHERE status='pending';
  CREATE TABLE IF NOT EXISTS sheet_folders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES sheet_folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sheet_folders_owner ON sheet_folders(user_id,parent_id);
  CREATE TABLE IF NOT EXISTS campaign_rolls (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    result_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS campaign_rolls_history ON campaign_rolls(campaign_id,created_at DESC);
`);
const sheetColumns = db.prepare('PRAGMA table_info(character_sheets)').all().map(c => c.name);
const entryColumns = db.prepare('PRAGMA table_info(grimoire_entries)').all().map(c => c.name);
if (!entryColumns.includes('image_data')) db.exec("ALTER TABLE grimoire_entries ADD COLUMN image_data TEXT NOT NULL DEFAULT ''");
if (!sheetColumns.includes('folder_id')) db.exec('ALTER TABLE character_sheets ADD COLUMN folder_id TEXT REFERENCES sheet_folders(id) ON DELETE SET NULL');
if (!sheetColumns.includes('version')) db.exec('ALTER TABLE character_sheets ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
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
const findUserById = db.prepare("SELECT id, email, username, display_name AS displayName, avatar_data AS avatarData, banner_data AS bannerData, bio, account_code AS accountCode, role, created_at AS createdAt FROM users WHERE id = ?");
const updateUserProfile = db.prepare("UPDATE users SET display_name = ?, avatar_data = ?, banner_data = ?, bio = ? WHERE id = ?");
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
const listSheets = db.prepare("SELECT * FROM character_sheets WHERE user_id=? ORDER BY updated_at DESC");
const getSheet = db.prepare("SELECT * FROM character_sheets WHERE id=? AND user_id=?");
const updateSheet = db.prepare("UPDATE character_sheets SET name=?, data_json=?, updated_at=? WHERE id=? AND user_id=?");
const deleteSheet = db.prepare("DELETE FROM character_sheets WHERE id=? AND user_id=?");

const countCampaignMembers = db.prepare("SELECT COUNT(*) AS total FROM campaign_members WHERE campaign_id=?");
const listCampaignMembers = db.prepare(`SELECT u.id,u.username,u.account_code AS accountCode,u.display_name AS displayName,u.avatar_data AS avatarData,cm.player_name AS playerName,c.owner_user_id=u.id AS isMaster FROM campaign_members cm JOIN users u ON u.id=cm.user_id JOIN campaigns c ON c.id=cm.campaign_id WHERE cm.campaign_id=? ORDER BY isMaster DESC, cm.joined_at`);
const findUserByCode = db.prepare("SELECT id,username,display_name AS displayName,avatar_data AS avatarData,account_code AS accountCode FROM users WHERE account_code=?");
const listFriends = db.prepare(`SELECT u.id,u.username,u.display_name AS displayName,u.avatar_data AS avatarData,u.account_code AS accountCode,f.status FROM friendships f JOIN users u ON u.id=f.friend_user_id WHERE f.user_id=? AND f.status='accepted' ORDER BY u.display_name,u.account_code`);
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
  const state = JSON.parse(row.state_json);
  return { id: row.id, code: row.code, name: row.name, status: row.status || 'lobby', systemName: row.system_name, createdAt: row.created_at, state: { tokens: state.tokens || [], rolls: state.rolls || [] } };
}
function getCampaign(code) {
  if (typeof code !== "string") return null;
  const row = findByCode.get(code.trim().toUpperCase());
  return row ? publicCampaign(row) : null;
}
function saveState(code, state) { const old=JSON.parse(findByCode.get(code)?.state_json||'{}');updateState.run(JSON.stringify({...state,notes:state.notes??old.notes??''}), code); }
function publicPerson(id) {
  return db.prepare('SELECT id,username,display_name AS displayName,avatar_data AS avatarData,account_code AS accountCode FROM users WHERE id=?').get(id);
}
function sheetResponse(row) {
  return {id:row.id,userId:row.user_id,name:row.name,data:JSON.parse(row.data_json),folderId:row.folder_id,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at};
}
function campaignAccess(code, uid) {
  const row = findByCode.get(String(code).toUpperCase());
  if (!row || !findMembership.get(row.id, uid)) return null;
  return row;
}
function canAccessSheet(row, uid, campaign) {
  if (!row || !campaign || !findMembership.get(campaign.id, row.user_id)) return false;
  return row.user_id === uid || campaign.owner_user_id === uid || !!db.prepare('SELECT 1 FROM campaign_sheet_assignments WHERE campaign_id=? AND sheet_id=? AND assigned_user_id=?').get(campaign.id,row.id,uid);
}
function notifySheet(row) {
  for (const socket of io.sockets.sockets.values()) {
    const campaign = campaignAccess(socket.data.code, socket.data.userId);
    if (canAccessSheet(row, socket.data.userId, campaign)) socket.emit('sheet:updated', sheetResponse(row));
  }
}
function saveSheetRequest(req,res,row) {
  if (!row) return res.status(404).json({error:'Ficha não encontrada.'});
  const data=req.body?.data;
  if (!data || typeof data!=='object' || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 6*1024*1024) return res.status(400).json({error:'Ficha inválida ou muito grande.'});
  if (req.body.expectedVersion == null || Number(req.body.expectedVersion)!==row.version) return res.status(409).json({error:'Esta ficha foi alterada em outra janela. Confira as alterações antes de salvar novamente.'});
  const name=String(data.name||'Novo personagem').trim().slice(0,70)||'Novo personagem';
  db.prepare('UPDATE character_sheets SET name=?,data_json=?,updated_at=?,version=version+1 WHERE id=?').run(name,JSON.stringify(data),new Date().toISOString(),row.id);
  const saved=db.prepare('SELECT * FROM character_sheets WHERE id=?').get(row.id);notifySheet(saved);res.json(sheetResponse(saved));
}
function ownFolder(id, uid) { return !id || !!db.prepare('SELECT 1 FROM sheet_folders WHERE id=? AND user_id=?').get(id,uid); }

app.post("/api/auth/register", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const username = String(req.body?.username || '').trim().toLowerCase();
  const birthDate = String(req.body?.birthDate || '');
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({error:'Use de 3 a 24 letras, números ou _ no nome de usuário.'});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(Date.parse(birthDate)) || new Date(birthDate).toISOString().slice(0,10) !== birthDate || birthDate < '1900-01-01' || birthDate > new Date().toISOString().slice(0,10)) return res.status(400).json({error:'Informe uma data de nascimento válida.'});
  if (!validEmail(email)) return res.status(400).json({ error: "Digite um e-mail válido." });
  if (password.length < 8) return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
  if (findUserByEmail.get(email)) return res.status(409).json({ error: "Já existe uma conta com este e-mail." });
  if (db.prepare('SELECT 1 FROM users WHERE lower(username)=?').get(username)) return res.status(409).json({error:'Este nome de usuário já está em uso.'});
  const id = randomUUID();
  createUser.run(id, email, hashPassword(password), new Date().toISOString(), makeAccountCode());
  db.prepare('UPDATE users SET username=?,display_name=?,birth_date=? WHERE id=?').run(username,username,birthDate,id);
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
  const old = findUserById.get(req.auth.userId), body = req.body || {};
  const displayName = String(body.displayName ?? old.displayName).trim();
  const avatarData = String(body.avatarData ?? old.avatarData), bannerData = String(body.bannerData ?? old.bannerData), bio = String(body.bio ?? old.bio).trim();
  if (!displayName || displayName.length > 32 || bio.length > 280) return res.status(400).json({error:'Use um nome de até 32 caracteres e uma bio de até 280 caracteres.'});
  if (!validImageUpload(avatarData) || !validImageUpload(bannerData)) return res.status(400).json({ error: "Envie uma imagem PNG, JPG ou WEBP válida de até 3 MB." });
  updateUserProfile.run(displayName, avatarData, bannerData, bio, req.auth.userId);
  res.json({ user: findUserById.get(req.auth.userId) });
});


app.get("/api/sheets", requireAuth, (req,res) => {
  res.json({ sheets: listSheets.all(req.auth.userId).map(sheetResponse) });
});
app.post("/api/sheets", requireAuth, (req,res) => {
  const id=randomUUID(), now=new Date().toISOString();
  const data=req.body?.data && typeof req.body.data === "object" ? req.body.data : {};
  if (Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 6*1024*1024 || !ownFolder(req.body.folderId,req.auth.userId)) return res.status(400).json({error:'Ficha ou pasta inválida.'});
  const name=String(data.name || "Novo personagem").trim().slice(0,70) || "Novo personagem";
  createSheet.run(id,req.auth.userId,name,JSON.stringify(data),now,now);
  if (req.body.folderId) db.prepare('UPDATE character_sheets SET folder_id=? WHERE id=?').run(req.body.folderId,id);
  const row=getSheet.get(id,req.auth.userId);notifySheet(row);res.status(201).json(sheetResponse(row));
});
app.get("/api/sheets/:id", requireAuth, (req,res) => {
  const row=getSheet.get(req.params.id,req.auth.userId);
  if(!row) return res.status(404).json({error:"Ficha não encontrada."});
  res.json(sheetResponse(row));
});
app.put("/api/sheets/:id", requireAuth, (req,res) => {
  const row=getSheet.get(req.params.id,req.auth.userId);
  saveSheetRequest(req,res,row);
});
app.delete("/api/sheets/:id", requireAuth, (req,res) => { deleteSheet.run(req.params.id,req.auth.userId); res.status(204).end(); });

app.get('/api/sheet-folders',requireAuth,(req,res)=>res.json({folders:db.prepare('SELECT id,name,parent_id AS parentId,created_at AS createdAt FROM sheet_folders WHERE user_id=? ORDER BY name').all(req.auth.userId)}));
app.post('/api/sheet-folders',requireAuth,(req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,70),parentId=req.body.parentId||null;
  if(!name||!ownFolder(parentId,req.auth.userId))return res.status(400).json({error:'Informe o nome e uma pasta válida.'});
  const id=randomUUID();db.prepare('INSERT INTO sheet_folders(id,user_id,parent_id,name,created_at) VALUES(?,?,?,?,?)').run(id,req.auth.userId,parentId,name,new Date().toISOString());res.status(201).json({id,name,parentId});
});
app.put('/api/sheet-folders/:id',requireAuth,(req,res)=>{
  const folder=db.prepare('SELECT * FROM sheet_folders WHERE id=? AND user_id=?').get(req.params.id,req.auth.userId);
  if(!folder)return res.status(404).json({error:'Pasta não encontrada.'});
  const name=String(req.body.name??folder.name).trim().slice(0,70),parentId='parentId' in req.body?(req.body.parentId||null):folder.parent_id;
  if(!name||!ownFolder(parentId,req.auth.userId))return res.status(400).json({error:'Nome ou pasta inválida.'});
  let cursor=parentId;const seen=new Set([folder.id]);
  while(cursor){if(seen.has(cursor))return res.status(400).json({error:'Uma pasta não pode ficar dentro dela mesma.'});seen.add(cursor);cursor=db.prepare('SELECT parent_id FROM sheet_folders WHERE id=?').get(cursor)?.parent_id;}
  db.prepare('UPDATE sheet_folders SET name=?,parent_id=? WHERE id=?').run(name,parentId,folder.id);res.json({id:folder.id,name,parentId});
});
app.delete('/api/sheet-folders/:id',requireAuth,(req,res)=>{db.prepare('DELETE FROM sheet_folders WHERE id=? AND user_id=?').run(req.params.id,req.auth.userId);res.status(204).end();});
app.put('/api/sheets/:id/folder',requireAuth,(req,res)=>{
  const row=getSheet.get(req.params.id,req.auth.userId);if(!row)return res.status(404).json({error:'Ficha não encontrada.'});
  if(!ownFolder(req.body.folderId,req.auth.userId))return res.status(400).json({error:'Pasta inválida.'});
  db.prepare('UPDATE character_sheets SET folder_id=?,version=version+1,updated_at=? WHERE id=?').run(req.body.folderId||null,new Date().toISOString(),row.id);
  const saved=getSheet.get(row.id,req.auth.userId);notifySheet(saved);res.json(sheetResponse(saved));
});

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

app.get("/api/campaigns/:code/members", requireAuth, (req,res)=>{ const row=campaignAccess(req.params.code,req.auth.userId); if(!row)return res.status(403).json({error:"Entre na campanha para ver os participantes."}); res.json({members:listCampaignMembers.all(row.id),status:row.status||"lobby",maxPlayers:10}); });
app.post("/api/campaigns/:code/start", requireAuth, (req,res)=>{ const row=findByCode.get(String(req.params.code).toUpperCase()); if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode iniciar."}); db.prepare("UPDATE campaigns SET status='session' WHERE id=?").run(row.id); io.to(row.code).emit("campaign:started",{code:row.code}); res.json({ok:true}); });
app.post("/api/campaigns/:code/lobby", requireAuth, (req,res)=>{ const row=findByCode.get(String(req.params.code).toUpperCase()); if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:"Somente o mestre pode alterar o lobby."}); db.prepare("UPDATE campaigns SET status='lobby' WHERE id=?").run(row.id); res.json({ok:true}); });

app.get('/api/friends',requireAuth,(req,res)=>{
  const uid=req.auth.userId;
  const requests=db.prepare("SELECT * FROM friend_requests WHERE status='pending' AND (sender_user_id=? OR recipient_user_id=?) ORDER BY created_at DESC").all(uid,uid);
  const map=row=>({id:row.id,status:row.status,createdAt:row.created_at,person:publicPerson(row.sender_user_id===uid?row.recipient_user_id:row.sender_user_id)});
  res.json({friends:listFriends.all(uid),incomingRequests:requests.filter(r=>r.recipient_user_id===uid).map(map),outgoingRequests:requests.filter(r=>r.sender_user_id===uid).map(map)});
});
app.get('/api/users/search', requireAuth, (req,res) => {
  const query = String(req.query.q || '').trim().slice(0,80);
  if (query.length < 2) return res.json({users:[]});
  const code = /^\d{8}$/.test(query);
  const pattern = '%' + query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\\%_]/g,'\\$&') + '%';
  const users = db.prepare(`SELECT u.id,u.username,u.display_name AS displayName,u.avatar_data AS avatarData,u.account_code AS accountCode,
    EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=? AND f.friend_user_id=u.id AND f.status='accepted') AS isFriend
    FROM users u WHERE u.id<>? AND ${code ? 'u.account_code=?' : "(fold_name(u.display_name) LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')"}
    ORDER BY u.display_name,u.account_code LIMIT 20`).all(req.auth.userId,req.auth.userId,...(code?[query]:[pattern,pattern]));
  res.json({users:users.map(user => {
    const request=db.prepare("SELECT id,sender_user_id FROM friend_requests WHERE status='pending' AND ((sender_user_id=? AND recipient_user_id=?) OR (recipient_user_id=? AND sender_user_id=?))").get(req.auth.userId,user.id,req.auth.userId,user.id);
    return {...user,isFriend:!!user.isFriend,requestId:request?.id,requestStatus:request?(request.sender_user_id===req.auth.userId?'outgoing':'incoming'):null};
  })});
});
app.post('/api/friends', requireAuth, (req,res) => {
  const code=String(req.body?.accountCode || '').trim();
  if (!/^\d{8}$/.test(code)) return res.status(400).json({error:'Informe o código de 8 números ou busque um jogador pelo nome.'});
  const user=findUserByCode.get(code);
  if(!user) return res.status(404).json({error:'Nenhuma conta encontrada com esse código.'});
  if(user.id===req.auth.userId) return res.status(400).json({error:'Você não pode adicionar a si mesmo.'});
  if(db.prepare("SELECT 1 FROM friendships WHERE user_id=? AND friend_user_id=? AND status='accepted'").get(req.auth.userId,user.id))return res.status(409).json({error:'Vocês já são amigos.'});
  const existing=db.prepare("SELECT * FROM friend_requests WHERE status='pending' AND ((sender_user_id=? AND recipient_user_id=?) OR (recipient_user_id=? AND sender_user_id=?))").get(req.auth.userId,user.id,req.auth.userId,user.id);
  if(existing)return res.json({request:{id:existing.id,status:'pending',person:user}});
  const id=randomUUID();db.prepare('INSERT INTO friend_requests(id,sender_user_id,recipient_user_id,created_at) VALUES(?,?,?,?)').run(id,req.auth.userId,user.id,new Date().toISOString());
  res.json({request:{id,status:'pending',person:user}});
});
function respondFriend(req,res,action){
  const request=db.prepare("SELECT * FROM friend_requests WHERE id=? AND status='pending'").get(req.params.id);
  const uid=req.auth.userId;
  if(!request||(action==='cancel'?request.sender_user_id!==uid:request.recipient_user_id!==uid))return res.status(403).json({error:'Solicitação indisponível.'});
  db.transaction(()=>{
    if(action==='accept'){const now=new Date().toISOString();upsertFriend.run(request.sender_user_id,request.recipient_user_id,'accepted',now);upsertFriend.run(request.recipient_user_id,request.sender_user_id,'accepted',now);}
    db.prepare('UPDATE friend_requests SET status=? WHERE id=?').run(action==='accept'?'accepted':action==='decline'?'declined':'cancelled',request.id);
  })();res.json({ok:true});
}
app.post('/api/friend-requests/:id/accept',requireAuth,(req,res)=>respondFriend(req,res,'accept'));
app.post('/api/friend-requests/:id/decline',requireAuth,(req,res)=>respondFriend(req,res,'decline'));
app.delete('/api/friend-requests/:id',requireAuth,(req,res)=>respondFriend(req,res,'cancel'));
app.delete('/api/friends/:id',requireAuth,(req,res)=>{db.prepare('DELETE FROM friendships WHERE (user_id=? AND friend_user_id=?) OR (friend_user_id=? AND user_id=?)').run(req.auth.userId,req.params.id,req.auth.userId,req.params.id);res.json({ok:true});});
function inviteResponse(row){const campaign=findByCode.get(row.code)||db.prepare('SELECT * FROM campaigns WHERE id=?').get(row.campaign_id);return {id:row.id,status:row.status,createdAt:row.created_at,campaign:{id:campaign.id,code:campaign.code,name:campaign.name,systemName:campaign.system_name},inviter:publicPerson(row.inviter_user_id),person:publicPerson(row.recipient_user_id)};}
app.get('/api/campaign-invites',requireAuth,(req,res)=>res.json({invites:db.prepare("SELECT * FROM campaign_invitations WHERE recipient_user_id=? AND status='pending' ORDER BY created_at DESC").all(req.auth.userId).map(inviteResponse)}));
app.get('/api/campaigns/:code/invites',requireAuth,(req,res)=>{const row=campaignAccess(req.params.code,req.auth.userId);if(!row||row.owner_user_id!==req.auth.userId)return res.status(403).json({error:'Somente o mestre pode ver os convites.'});res.json({invites:db.prepare("SELECT * FROM campaign_invitations WHERE campaign_id=? AND status='pending'").all(row.id).map(inviteResponse)});});
app.post('/api/campaigns/:code/invites',requireAuth,(req,res)=>{
  const campaign=campaignAccess(req.params.code,req.auth.userId),uid=req.body.userId;
  if(!campaign||campaign.owner_user_id!==req.auth.userId)return res.status(403).json({error:'Somente o mestre pode convidar jogadores.'});
  if(!db.prepare("SELECT 1 FROM friendships WHERE user_id=? AND friend_user_id=? AND status='accepted'").get(req.auth.userId,uid))return res.status(400).json({error:'Escolha um amigo da sua lista.'});
  if(findMembership.get(campaign.id,uid))return res.status(409).json({error:'Este jogador já participa da campanha.'});
  let row=db.prepare("SELECT * FROM campaign_invitations WHERE campaign_id=? AND recipient_user_id=? AND status='pending'").get(campaign.id,uid);
  if(!row){const id=randomUUID();db.prepare('INSERT INTO campaign_invitations(id,campaign_id,inviter_user_id,recipient_user_id,created_at) VALUES(?,?,?,?,?)').run(id,campaign.id,req.auth.userId,uid,new Date().toISOString());row=db.prepare('SELECT * FROM campaign_invitations WHERE id=?').get(id);}
  res.json({invite:inviteResponse(row)});
});
app.post('/api/campaign-invites/:id/:action',requireAuth,(req,res)=>{
  const invite=db.prepare("SELECT * FROM campaign_invitations WHERE id=? AND recipient_user_id=? AND status='pending'").get(req.params.id,req.auth.userId),action=req.params.action;
  if(!invite||!['accept','decline'].includes(action))return res.status(403).json({error:'Convite indisponível.'});
  const campaign=db.prepare('SELECT * FROM campaigns WHERE id=?').get(invite.campaign_id);
  if(action==='accept'&&!findMembership.get(campaign.id,req.auth.userId)&&countCampaignMembers.get(campaign.id).total>=10)return res.status(409).json({error:'Esta campanha já tem 10 participantes.'});
  db.transaction(()=>{if(action==='accept')upsertMember.run(campaign.id,req.auth.userId,publicPerson(req.auth.userId).displayName.slice(0,24)||'Aventureiro',new Date().toISOString());db.prepare('UPDATE campaign_invitations SET status=? WHERE id=?').run(action==='accept'?'accepted':'declined',invite.id);})();
  io.to(campaign.code).emit('sheet:list-changed');io.to(campaign.code).emit('campaign:members-changed');res.json({ok:true,campaign:publicCampaign(campaign)});
});

function entryResponse(row) {
  return { id:row.id, kind:row.kind, name:row.name, description:row.description,
    damage:row.damage, imageData:row.image_data || '', isStandard:!!row.is_standard };
}
function entryValues(body = {}, previous = {}) {
  const values = { kind:body.kind ?? previous.kind ?? 'spell',
    name:String(body.name ?? previous.name ?? '').trim(),
    description:String(body.description ?? previous.description ?? '').trim(),
    damage:String(body.damage ?? previous.damage ?? '').trim(),
    imageData:String(body.imageData ?? previous.image_data ?? '') };
  if (!['spell','ability'].includes(values.kind) || !values.name || values.name.length > 80 || values.description.length > 5000 || values.damage.length > 120)
    throw new Error('Informe o tipo e nome (até 80 caracteres), descrição (até 5.000) e dano (até 120).');
  if (!validImageUpload(values.imageData)) throw new Error('Envie uma imagem PNG, JPG ou WebP de até 3 MB.');
  return values;
}
function createEntry(isPublic) {
  return (req,res) => {
    let values;
    try { values=entryValues(req.body); } catch(error) { return res.status(400).json({error:error.message}); }
    const id=randomUUID(), now=new Date().toISOString();
    db.prepare('INSERT INTO grimoire_entries(id,owner_user_id,kind,name,description,damage,image_data,is_standard,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id,req.auth.userId,values.kind,values.name,values.description,values.damage,values.imageData,isPublic?1:0,now,now);
    res.status(201).json({id});
  };
}
function changeEntry(isPublic) {
  return (req,res) => {
    const entry=getEntry.get(req.params.id);
    if(!entry || !!entry.is_standard!==isPublic || (!isPublic && entry.owner_user_id!==req.auth.userId))
      return res.status(404).json({error:'Magia ou habilidade não encontrada.'});
    if(req.method==='DELETE') { db.prepare('DELETE FROM grimoire_entries WHERE id=?').run(entry.id); return res.status(204).end(); }
    let values;
    try { values=entryValues(req.body,entry); } catch(error) { return res.status(400).json({error:error.message}); }
    db.prepare('UPDATE grimoire_entries SET kind=?,name=?,description=?,damage=?,image_data=?,updated_at=? WHERE id=?')
      .run(values.kind,values.name,values.description,values.damage,values.imageData,new Date().toISOString(),entry.id);
    res.json({ok:true});
  };
}
app.get('/api/grimoire',(req,res)=>{
  if(req.query.scope==='public') return res.json({entries:db.prepare('SELECT * FROM grimoire_entries WHERE is_standard=1 ORDER BY kind,name').all().map(entryResponse)});
  const auth=getAuth(req);
  if(!auth) return res.status(401).json({error:'Faça login para continuar.'});
  const rows=req.query.scope==='mine' ? db.prepare('SELECT * FROM grimoire_entries WHERE owner_user_id=? AND is_standard=0 ORDER BY kind,name').all(auth.userId) : listEntries.all(auth.userId);
  res.json({entries:rows.map(entryResponse)});
});
app.post('/api/grimoire',requireAuth,createEntry(false));
app.put('/api/grimoire/:id',requireAuth,changeEntry(false));
app.delete('/api/grimoire/:id',requireAuth,changeEntry(false));
app.get('/api/admin/grimoire',requireAuth,requireContentAdmin,(req,res)=>res.json({entries:db.prepare('SELECT * FROM grimoire_entries WHERE is_standard=1 ORDER BY kind,name').all().map(entryResponse)}));
app.post('/api/admin/grimoire',requireAuth,requireContentAdmin,createEntry(true));
app.put('/api/admin/grimoire/:id',requireAuth,requireContentAdmin,changeEntry(true));
app.delete('/api/admin/grimoire/:id',requireAuth,requireContentAdmin,changeEntry(true));

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
app.get('/api/site-content',(req,res)=>{const row=db.prepare("SELECT value FROM site_settings WHERE key='site_content'").get();res.json(row?JSON.parse(row.value):{});});
app.put('/api/site-content',requireAuth,requireContentAdmin,(req,res)=>{
  const limits={heroTitle:100,heroBody:600,aboutTitle:120,aboutBody:2000,supportText:1000,supportUrl:500},value={};
  for(const [key,limit]of Object.entries(limits))value[key]=String(req.body[key]||'').trim().slice(0,limit);
  if(!value.heroTitle||!value.aboutTitle||(value.supportUrl&&!/^https:\/\/[^\s/]+(?:[/?#][^\s]*)?$/i.test(value.supportUrl)))return res.status(400).json({error:'Preencha os títulos e use um link HTTPS válido.'});
  db.prepare("INSERT INTO site_settings(key,value) VALUES('site_content',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));res.json(value);
});
app.get('/api/admin/users',requireAuth,requireContentAdmin,(req,res)=>{const user=findUserByEmail.get(normalizeEmail(req.query.email));if(!user)return res.status(404).json({error:'Nenhuma conta cadastrada com esse e-mail.'});res.json({user:findUserById.get(user.id)});});
app.post('/api/admin/admins',requireAuth,requireContentAdmin,(req,res)=>{const user=findUserByEmail.get(normalizeEmail(req.body.email));if(!user||user.account_code!==req.body.accountCode)return res.status(400).json({error:'Confira o e-mail e o código da conta.'});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);res.json({user:findUserById.get(user.id)});});
app.get('/api/admin/suggestions',requireAuth,requireContentAdmin,(req,res)=>res.json({suggestions:db.prepare('SELECT * FROM suggestions ORDER BY created_at DESC LIMIT 100').all().map(row=>({id:row.id,body:row.body,createdAt:row.created_at,person:publicPerson(row.user_id)}))}));
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
app.put('/api/books/:id',requireAuth,requireContentAdmin,(req,res)=>{
  const old=db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Livro não encontrado.'});
  const title=String(req.body.title||'').trim().slice(0,120),cover=req.body.coverData??old.cover_data,pdf=req.body.pdfData||old.pdf_data;
  const bytes=decodeUpload(pdf,/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/,20*1024*1024);
  if(!title||!validImageUpload(cover)||!bytes||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))return res.status(400).json({error:'Confira o título, a imagem e o PDF enviado.'});
  db.prepare('UPDATE books SET title=?,description=?,cover_data=?,pdf_data=? WHERE id=?').run(title,String(req.body.description||'').trim().slice(0,1000),cover,pdf,old.id);res.json({id:old.id});
});
app.delete('/api/books/:id',requireAuth,requireContentAdmin,(req,res)=>{
  db.transaction(()=>{const feature=db.prepare("SELECT value FROM site_settings WHERE key='home_feature'").get();if(feature){const value=JSON.parse(feature.value);if(value.bookId===req.params.id){value.bookId='';db.prepare("UPDATE site_settings SET value=? WHERE key='home_feature'").run(JSON.stringify(value));}}db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);})();res.json({ok:true});
});
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


app.get('/api/campaigns/:code/sheets',requireAuth,(req,res)=>{
  const campaign=campaignAccess(req.params.code,req.auth.userId);if(!campaign)return res.status(403).json({error:'Entre nesta campanha para ver suas fichas.'});
  const sheets=db.prepare('SELECT cs.* FROM character_sheets cs JOIN campaign_members cm ON cm.user_id=cs.user_id WHERE cm.campaign_id=? ORDER BY cs.updated_at DESC').all(campaign.id);
  res.json({sheets:sheets.filter(row=>canAccessSheet(row,req.auth.userId,campaign)).map(row=>({...sheetResponse(row),ownerName:publicPerson(row.user_id)?.displayName,assignedUserId:db.prepare('SELECT assigned_user_id FROM campaign_sheet_assignments WHERE campaign_id=? AND sheet_id=?').get(campaign.id,row.id)?.assigned_user_id||null}))});
});
app.get('/api/campaigns/:code/sheets/:sheetId',requireAuth,(req,res)=>{
  const campaign=campaignAccess(req.params.code,req.auth.userId),row=db.prepare('SELECT * FROM character_sheets WHERE id=?').get(req.params.sheetId);
  if(!canAccessSheet(row,req.auth.userId,campaign))return res.status(403).json({error:'Esta ficha não está disponível para sua conta nesta campanha.'});res.json(sheetResponse(row));
});
app.put('/api/campaigns/:code/sheets/:sheetId',requireAuth,(req,res)=>{
  const campaign=campaignAccess(req.params.code,req.auth.userId),row=db.prepare('SELECT * FROM character_sheets WHERE id=?').get(req.params.sheetId);
  if(!canAccessSheet(row,req.auth.userId,campaign))return res.status(403).json({error:'Esta ficha não está disponível para sua conta nesta campanha.'});saveSheetRequest(req,res,row);
});
app.put('/api/campaigns/:code/sheets/:sheetId/assign',requireAuth,(req,res)=>{
  const campaign=campaignAccess(req.params.code,req.auth.userId),row=db.prepare('SELECT * FROM character_sheets WHERE id=?').get(req.params.sheetId);
  if(!campaign||campaign.owner_user_id!==req.auth.userId||!canAccessSheet(row,req.auth.userId,campaign))return res.status(403).json({error:'Somente o mestre pode atribuir fichas desta campanha.'});
  if(req.body.userId&&!findMembership.get(campaign.id,req.body.userId))return res.status(400).json({error:'Escolha um participante da campanha.'});
  db.prepare('INSERT INTO campaign_sheet_assignments(campaign_id,sheet_id,assigned_user_id) VALUES(?,?,?) ON CONFLICT(campaign_id,sheet_id) DO UPDATE SET assigned_user_id=excluded.assigned_user_id').run(campaign.id,row.id,req.body.userId||null);
  io.to(campaign.code).emit('sheet:list-changed');res.json({ok:true});
});
app.get('/api/campaigns/:code/rolls',requireAuth,(req,res)=>{
  const campaign=campaignAccess(req.params.code,req.auth.userId);if(!campaign)return res.status(403).json({error:'Entre na campanha para ver as rolagens.'});
  const before=String(req.query.before||''),beforeId=String(req.query.beforeId||'');
  const rows=before&&beforeId?db.prepare('SELECT result_json FROM campaign_rolls WHERE campaign_id=? AND (created_at<? OR(created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 200').all(campaign.id,before,before,beforeId):db.prepare('SELECT result_json FROM campaign_rolls WHERE campaign_id=? ORDER BY created_at DESC,id DESC LIMIT 200').all(campaign.id);
  res.json({rolls:rows.map(row=>JSON.parse(row.result_json))});
});

io.on("connection", socket => {
  socket.on("room:join", ({ code, token } = {}) => {
    const auth=getAuth({headers:{authorization:'Bearer '+(token||socket.handshake.auth?.token||'')}});
    if(!auth)return socket.emit('app:error','Entre na sua conta para abrir a mesa.');
    const row=campaignAccess(code,auth.userId);
    if(!row)return socket.emit('app:error','Entre nesta campanha antes de abrir a mesa.');
    if(socket.data.code){const previous=socket.data.code;socket.leave(previous);io.to(previous).emit('room:players',getRoomPlayers(previous));}
    const campaign = getCampaign(code);
    if (!campaign) return socket.emit("app:error", "Não encontramos essa sala. Confira o código.");
    const safeName = row.owner_user_id===auth.userId?'Mestre':findMembership.get(row.id,auth.userId).player_name;
    socket.data.userId=auth.userId;
    socket.join(campaign.code); socket.data.code = campaign.code; socket.data.playerName = safeName;
    socket.emit("room:state", { campaign: row.owner_user_id===auth.userId?{...campaign,state:{...campaign.state,notes:JSON.parse(row.state_json).notes||''}}:campaign, players: getRoomPlayers(campaign.code) });
    io.to(campaign.code).emit("room:players", getRoomPlayers(campaign.code));
    socket.to(campaign.code).emit("room:notice", `${safeName} entrou na mesa.`);
  });
  socket.on('room:leave',()=>{const code=socket.data.code;if(code){socket.leave(code);socket.data.code=null;io.to(code).emit('room:players',getRoomPlayers(code));}});
  socket.on("token:move", ({ tokenId, x, y } = {}) => {
    const code = socket.data.code; if (!code || typeof tokenId !== "string") return;
    if(!campaignAccess(code,socket.data.userId))return;
    const campaign = getCampaign(code); if (!campaign) return;
    const nx = Math.max(0, Math.min(29, Math.round(Number(x)))); const ny = Math.max(0, Math.min(19, Math.round(Number(y))));
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const token = campaign.state.tokens.find(t => t.id === tokenId); if (!token) return;
    token.x = nx; token.y = ny; saveState(code, campaign.state);
    io.to(code).emit("room:state", { campaign, players: getRoomPlayers(code) });
  });
  socket.on("dice:roll", ({ sides, modifier, label, characterName } = {}) => {
    const code = socket.data.code; if (!code) return;
    const row=campaignAccess(code,socket.data.userId);if(!row)return;
    const validSides = [4,6,8,10,12,20,100]; const die = Number(sides); const mod = Math.max(-100, Math.min(100, Math.trunc(Number(modifier) || 0)));
    if (!validSides.includes(die)) return;
    const value = randomInt(1,die+1),at=new Date().toISOString();
    const result = { id: randomUUID(), player: socket.data.playerName || "Aventureiro", characterName: String(characterName || "").trim().slice(0,70), label: String(label || "").trim().slice(0,60), sides: die, value, modifier: mod, total: value + mod, seed:randomInt(1,2147483647),at,createdAt:at };
    const campaign = getCampaign(code); if (!campaign) return;
    campaign.state.rolls.unshift(result); campaign.state.rolls = campaign.state.rolls.slice(0, 30);
    db.transaction(()=>{db.prepare('INSERT INTO campaign_rolls(id,campaign_id,result_json,created_at) VALUES(?,?,?,?)').run(result.id,row.id,JSON.stringify(result),at);saveState(code,campaign.state);})();
    io.to(code).emit("dice:result", result); io.to(code).emit("room:state", { campaign, players: getRoomPlayers(code) });
  });
  socket.on("master:save-notes", ({ notes, masterKey } = {}) => {
    const code = socket.data.code; if (!code || typeof notes !== "string") return;
    const row = findByCode.get(code);
    if (!row || row.owner_user_id!==socket.data.userId) return socket.emit("app:error", "Somente o mestre pode salvar as anotações.");
    const campaign = getCampaign(code); campaign.state.notes = notes.slice(0,10000); saveState(code, campaign.state);
    socket.emit("room:state", { campaign, players: getRoomPlayers(code) }); socket.emit("room:notice", "Anotações salvas.");
  });
  socket.on("session:chat", ({body,recipientSocketId}={})=>{ const code=socket.data.code; const text=String(body||'').trim().slice(0,1000); if(!code||!text||!campaignAccess(code,socket.data.userId))return; if(recipientSocketId&&!getRoomPlayers(code).some(player=>player.id===recipientSocketId))return socket.emit('app:error','Escolha alguém desta mesa.');const msg={id:randomUUID(),sender:socket.data.playerName||'Aventureiro',body:text,at:new Date().toISOString(),private:!!recipientSocketId}; if(recipientSocketId){socket.emit('session:message',msg);io.to(recipientSocketId).emit('session:message',msg)}else io.to(code).emit('session:message',msg); });
  socket.on("disconnect", () => { const code = socket.data.code; if (code) io.to(code).emit("room:players", getRoomPlayers(code)); });
});

function getRoomPlayers(code) {
  const unique=new Map();for(const id of io.sockets.adapter.rooms.get(code)||[]){const s=io.sockets.sockets.get(id);if(s&&s.data.userId&&!unique.has(s.data.userId))unique.set(s.data.userId,{id,userId:s.data.userId,name:s.data.playerName||'Aventureiro'});}return [...unique.values()];
}

app.get("*path", (req, res, next) => { if (req.path.startsWith("/api/")) return next(); res.sendFile(path.join(__dirname, "public", "index.html")); });
server.listen(PORT, () => console.log(`Grimório disponível em http://localhost:${PORT}`));
