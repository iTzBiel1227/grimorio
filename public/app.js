const socket = io();
const homeView = document.querySelector("#homeView");
const roomView = document.querySelector("#roomView");
const toast = document.querySelector("#toast");
const board = document.querySelector("#board");
const state = { campaign: null, selectedToken: null, playerName: "", isMaster: false, masterKey: "", user: null, authMode: "login" };
const authTokenKey = "grimorio_auth_token";
let toastTimer;

function authHeaders(extra = {}) {
  const token = localStorage.getItem(authTokenKey);
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}
function notify(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove("hidden", "error");
  if (isError) toast.classList.add("error");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}
function showRoom() {
  homeView.classList.add("hidden");
  roomView.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function showHome() {
  roomView.classList.add("hidden");
  homeView.classList.remove("hidden");
  state.campaign = null;
  state.selectedToken = null;
  socket.disconnect();
  socket.connect();
}
function connectToRoom(code, playerName, masterKey = "") {
  state.playerName = playerName;
  state.masterKey = masterKey;
  state.isMaster = Boolean(masterKey);
  socket.emit("room:join", { code, playerName });
}
function enterCampaign(campaign, masterKey = "") {
  state.campaign = campaign;
  state.selectedToken = null;
  document.querySelector("#roomTitle").textContent = campaign.name;
  document.querySelector("#roomCodeLabel").textContent = campaign.code;
  document.querySelector("#masterKey").value = masterKey;
  document.querySelector("#masterNotes").value = campaign.state.notes || "";
  showRoom();
  renderBoard(campaign.state.tokens || []);
  renderRolls(campaign.state.rolls || []);
}
async function createCampaign(event) {
  event.preventDefault();
  if (!state.user) { openAuth("login"); notify("Entre na sua conta para criar uma campanha."); return; }
  const name = document.querySelector("#campaignName").value.trim();
  if (!name) return;
  try {
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível criar a campanha.");
    state.masterKey = data.masterKey;
    state.isMaster = true;
    state.playerName = "Mestre";
    enterCampaign(data.campaign, data.masterKey);
    connectToRoom(data.campaign.code, "Mestre", data.masterKey);
    notify("Campanha criada! Guarde sua chave de mestre.");
    document.querySelector("#campaignName").value = "";
    loadMyCampaigns();
  } catch (error) { notify(error.message, true); }
}
async function joinCampaign(event) {
  event.preventDefault();
  if (!state.user) { openAuth("login"); notify("Entre na sua conta para acessar a campanha."); return; }
  const code = document.querySelector("#roomCode").value.trim().toUpperCase();
  const playerName = document.querySelector("#playerName").value.trim();
  if (!code || !playerName) return;
  try {
    const response = await fetch(`/api/campaigns/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ playerName })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Sala não encontrada.");
    state.isMaster = data.role === "master";
    state.masterKey = data.masterKey || "";
    enterCampaign(data.campaign, state.masterKey);
    connectToRoom(code, data.playerName || playerName, state.masterKey);
    loadMyCampaigns();
  } catch (error) { notify(error.message, true); }
}
function renderBoard(tokens) {
  board.replaceChildren();
  const tokenAt = new Map(tokens.map(token => [`${token.x},${token.y}`, token]));
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 30; x++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "board-cell";
      cell.setAttribute("aria-label", `Mover para coluna ${x + 1}, linha ${y + 1}`);
      const token = tokenAt.get(`${x},${y}`);
      if (token) {
        const piece = document.createElement("span");
        piece.className = "token" + (state.selectedToken === token.id ? " selected" : "");
        piece.style.background = token.color || "#a78bfa";
        piece.textContent = token.name.slice(0, 1).toUpperCase();
        piece.title = token.name;
        cell.append(piece);
      }
      cell.addEventListener("click", () => {
        const here = tokenAt.get(`${x},${y}`);
        if (here) {
          state.selectedToken = here.id;
          renderBoard(tokens);
        } else if (state.selectedToken) {
          socket.emit("token:move", { tokenId: state.selectedToken, x, y });
          state.selectedToken = null;
        } else {
          notify("Selecione um token antes de movê-lo.");
        }
      });
      board.append(cell);
    }
  }
}
function renderRolls(rolls) {
  const container = document.querySelector("#rollHistory");
  container.replaceChildren();
  if (!rolls.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "As rolagens da mesa aparecerão aqui.";
    container.append(empty);
    return;
  }
  for (const roll of rolls.slice(0, 12)) {
    const item = document.createElement("div");
    item.className = "roll-item";
    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = roll.player;
    const detail = document.createElement("small");
    detail.textContent = `${roll.label ? roll.label + " · " : ""}D${roll.sides} (${roll.value}) ${roll.modifier >= 0 ? "+" : ""}${roll.modifier}`;
    left.append(name, detail);
    const total = document.createElement("span");
    total.className = "roll-total";
    total.textContent = String(roll.total);
    item.append(left, total);
    container.append(item);
  }
}
function renderPlayers(players = []) {
  const list = document.querySelector("#playersList");
  list.replaceChildren();
  document.querySelector("#playerCount").textContent = String(players.length);
  for (const player of players) {
    const item = document.createElement("li");
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = player.name.slice(0, 1).toUpperCase();
    const name = document.createElement("span");
    name.textContent = player.name + (player.name === "Mestre" ? " · Mestre" : "");
    item.append(avatar, name);
    list.append(item);
  }
}

const myCampaignsSection = document.querySelector("#myCampaigns");
const myCampaignsGrid = document.querySelector("#myCampaignsGrid");

async function loadMyCampaigns() {
  if (!state.user) {
    myCampaignsSection.classList.add("hidden");
    myCampaignsGrid.replaceChildren();
    return;
  }
  try {
    const response = await fetch("/api/my/campaigns", { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar suas campanhas.");
    myCampaignsSection.classList.remove("hidden");
    renderMyCampaigns(data.campaigns || []);
  } catch (error) {
    notify(error.message, true);
  }
}
function renderMyCampaigns(campaigns) {
  myCampaignsGrid.replaceChildren();
  if (!campaigns.length) {
    const empty = document.createElement("div");
    empty.className = "panel campaign-library-empty";
    empty.innerHTML = `<span class="mini-label">NENHUMA CAMPANHA AINDA</span><h3>Seu primeiro mundo começa acima.</h3><p>Crie uma campanha ou entre pelo convite de um amigo. Ela aparecerá aqui automaticamente.</p>`;
    myCampaignsGrid.append(empty);
    return;
  }
  campaigns.forEach(campaign => {
    const card = document.createElement("article");
    card.className = "panel campaign-library-card";
    const role = campaign.role === "master" ? "Mestre" : "Jogador";
    card.innerHTML = `<div class="campaign-card-top"><span class="mini-label">${role}</span><span class="campaign-code">${campaign.code}</span></div><h3></h3><p>${campaign.systemName || "Sistema próprio"}</p><div class="campaign-card-actions"><button class="button button-primary open-campaign" type="button">Abrir campanha <span>→</span></button><button class="button button-secondary copy-campaign" type="button">Convite</button></div>`;
    card.querySelector("h3").textContent = campaign.name;
    card.querySelector(".open-campaign").addEventListener("click", () => openSavedCampaign(campaign));
    card.querySelector(".copy-campaign").addEventListener("click", () => copyCampaignInvite(campaign));
    myCampaignsGrid.append(card);
  });
}
async function openSavedCampaign(campaign) {
  try {
    const response = await fetch(`/api/campaigns/${encodeURIComponent(campaign.code)}`, { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível abrir a campanha.");
    const masterKey = data.role === "master" ? (data.masterKey || "") : "";
    const playerName = data.role === "master" ? "Mestre" : (data.playerName || campaign.playerName || "Aventureiro");
    enterCampaign(data.campaign, masterKey);
    connectToRoom(campaign.code, playerName, masterKey);
  } catch (error) { notify(error.message, true); }
}
async function copyCampaignInvite(campaign) {
  const link = `${location.origin}/campanha.html?room=${campaign.code}`;
  const text = `Entre na minha campanha no Grimório!\nCampanha: ${campaign.name}\nCódigo: ${campaign.code}\nLink: ${link}`;
  try { await navigator.clipboard.writeText(text); notify("Link de convite copiado!"); }
  catch { notify(`Código da campanha: ${campaign.code}`); }
}

const authModal = document.querySelector("#authModal");
const openAuthButton = document.querySelector("#openAuth");
const accountButton = document.querySelector("#accountButton");
const accountMenu = document.querySelector("#accountMenu");
const profileModal = document.querySelector("#profileModal");
let pendingAvatarData = "";

function openAuth(mode = "login") {
  setAuthMode(mode);
  authModal.classList.remove("hidden");
  authModal.setAttribute("aria-hidden", "false");
  setTimeout(() => document.querySelector("#authEmail").focus(), 30);
}
function closeAuth() {
  authModal.classList.add("hidden");
  authModal.setAttribute("aria-hidden", "true");
}
function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === "register";
  document.querySelector("#loginTab").classList.toggle("active", !registering);
  document.querySelector("#registerTab").classList.toggle("active", registering);
  document.querySelector("#authTitle").textContent = registering ? "Crie seu Grimório." : "Entre no seu Grimório.";
  document.querySelector("#authSubtitle").textContent = registering ? "Você só precisa de e-mail e senha." : "Use seu e-mail e senha para continuar.";
  document.querySelector("#authSubmit").innerHTML = registering ? "Criar conta <span>→</span>" : "Entrar <span>→</span>";
  document.querySelector("#authPassword").autocomplete = registering ? "new-password" : "current-password";
}
function renderAccount() {
  const logged = Boolean(state.user);
  openAuthButton.classList.toggle("hidden", logged);
  accountButton.classList.toggle("hidden", !logged);
  if (logged) {
    const email = state.user.email || "";
    const name = state.user.displayName || email.split("@")[0] || "Aventureiro";
    const initial = name.slice(0, 1).toUpperCase();
    const accountInitial = document.querySelector("#accountInitial");
    accountInitial.textContent = initial;
    accountInitial.style.backgroundImage = state.user.avatarData ? `url(${state.user.avatarData})` : "";
    accountInitial.classList.toggle("has-avatar", Boolean(state.user.avatarData));
    document.querySelector("#accountEmail").textContent = name;
    document.querySelector("#menuEmail").textContent = email;
    document.querySelector("#menuDisplayName").textContent = name;
    const menuAvatar = document.querySelector("#menuAvatar");
    menuAvatar.textContent = initial;
    menuAvatar.style.backgroundImage = state.user.avatarData ? `url(${state.user.avatarData})` : "";
    menuAvatar.classList.toggle("has-avatar", Boolean(state.user.avatarData));
  } else accountMenu.classList.add("hidden");
  if (document.body.dataset.page === "campaign") loadMyCampaigns();
}
async function restoreSession() {
  const token = localStorage.getItem(authTokenKey);
  if (!token) return renderAccount();
  try {
    const response = await fetch("/api/auth/me", { headers: authHeaders() });
    if (!response.ok) throw new Error();
    const data = await response.json();
    state.user = data.user;
  } catch {
    localStorage.removeItem(authTokenKey);
    state.user = null;
  }
  renderAccount();
}
async function submitAuth(event) {
  event.preventDefault();
  const email = document.querySelector("#authEmail").value.trim();
  const password = document.querySelector("#authPassword").value;
  try {
    const response = await fetch(`/api/auth/${state.authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível acessar sua conta.");
    localStorage.setItem(authTokenKey, data.token);
    state.user = data.user;
    renderAccount(); closeAuth(); showHome();
    document.querySelector("#authForm").reset();
    notify(state.authMode === "register" ? "Conta criada. Bem-vindo ao Grimório!" : "Login realizado. Bem-vindo de volta!");
    const pendingRoom = new URLSearchParams(location.search).get("room");
    if (pendingRoom && document.body.dataset.page === "campaign") document.querySelector("#campaignAccess").scrollIntoView({ behavior: "smooth" });
  } catch (error) { notify(error.message, true); }
}
openAuthButton.addEventListener("click", () => openAuth("login"));
document.querySelector("#closeAuth").addEventListener("click", closeAuth);
document.querySelector("#loginTab").addEventListener("click", () => setAuthMode("login"));
document.querySelector("#registerTab").addEventListener("click", () => setAuthMode("register"));
document.querySelector("#authForm").addEventListener("submit", submitAuth);
authModal.addEventListener("click", event => { if (event.target === authModal) closeAuth(); });
accountButton.addEventListener("click", () => accountMenu.classList.toggle("hidden"));
function renderProfilePreview(data = pendingAvatarData || state.user?.avatarData || "") {
  const preview = document.querySelector("#profileAvatarPreview");
  const name = document.querySelector("#profileDisplayName").value || state.user?.displayName || state.user?.email || "?";
  preview.textContent = name.slice(0, 1).toUpperCase();
  preview.style.backgroundImage = data ? `url(${data})` : "";
  preview.classList.toggle("has-avatar", Boolean(data));
}
function openProfile() {
  if (!state.user) return openAuth("login");
  pendingAvatarData = state.user.avatarData || "";
  document.querySelector("#profileDisplayName").value = state.user.displayName || "";
  document.querySelector("#profileEmail").value = state.user.email || "";
  renderProfilePreview();
  accountMenu.classList.add("hidden");
  profileModal.classList.remove("hidden");
  profileModal.setAttribute("aria-hidden", "false");
}
function closeProfile() { profileModal.classList.add("hidden"); profileModal.setAttribute("aria-hidden", "true"); }
document.querySelector("#openProfile").addEventListener("click", openProfile);
document.querySelector("#closeProfile").addEventListener("click", closeProfile);
profileModal.addEventListener("click", event => { if (event.target === profileModal) closeProfile(); });
document.querySelector("#profileDisplayName").addEventListener("input", () => renderProfilePreview());
document.querySelector("#profileAvatarInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/image\/(png|jpeg|webp)/.test(file.type)) return notify("Escolha uma imagem PNG, JPG ou WEBP.", true);
  if (file.size > 3 * 1024 * 1024) return notify("A foto deve ter no máximo 3 MB.", true);
  const reader = new FileReader();
  reader.onload = () => { pendingAvatarData = String(reader.result || ""); renderProfilePreview(pendingAvatarData); };
  reader.readAsDataURL(file);
});
document.querySelector("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const response = await fetch("/api/profile", { method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ displayName: document.querySelector("#profileDisplayName").value, avatarData: pendingAvatarData }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível salvar o perfil.");
    state.user = data.user; renderAccount(); closeProfile(); notify("Perfil atualizado!");
  } catch (error) { notify(error.message, true); }
});
document.querySelector("#logoutButton").addEventListener("click", async () => {
  try { await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }); } catch {}
  localStorage.removeItem(authTokenKey); state.user = null; renderAccount(); showHome(); notify("Você saiu da sua conta.");
});
restoreSession();

document.querySelector("#createForm").addEventListener("submit", createCampaign);
document.querySelector("#joinForm").addEventListener("submit", joinCampaign);
document.querySelector("#backHome").addEventListener("click", showHome);
document.querySelector("#copyInvite").addEventListener("click", async () => {
  const link = `${location.origin}/campanha.html?room=${state.campaign?.code || ""}`;
  try {
    await navigator.clipboard.writeText(`Entre na minha campanha no Grimório!\nCampanha: ${state.campaign.name}\nCódigo: ${state.campaign.code}\nLink: ${link}`);
    notify("Convite copiado!");
  } catch {
    notify(`Código da sala: ${state.campaign.code}`);
  }
});
document.querySelector("#rollButton").addEventListener("click", () => {
  if (!state.campaign) return;
  socket.emit("dice:roll", {
    sides: Number(document.querySelector("#dieSides").value),
    modifier: Number(document.querySelector("#dieModifier").value)
  });
});
document.querySelector("#saveNotes").addEventListener("click", () => {
  socket.emit("master:save-notes", {
    notes: document.querySelector("#masterNotes").value,
    masterKey: document.querySelector("#masterKey").value
  });
});
socket.on("room:state", ({ campaign, players }) => {
  state.campaign = campaign;
  document.querySelector("#roomTitle").textContent = campaign.name;
  document.querySelector("#roomCodeLabel").textContent = campaign.code;
  renderBoard(campaign.state.tokens || []);
  renderRolls(campaign.state.rolls || []);
  if (players) renderPlayers(players);
});
socket.on("room:players", renderPlayers);
socket.on("room:notice", message => notify(message));
socket.on("app:error", message => notify(message, true));
socket.on("dice:result", result => {
  notify(`${result.player} rolou D${result.sides}: ${result.total}`);
});
const initialRoom = new URLSearchParams(location.search).get("room");
if (initialRoom) {
  document.querySelector("#roomCode").value = initialRoom;
  if (document.body.dataset.page === "campaign") setTimeout(() => document.querySelector("#campaignAccess").scrollIntoView({ behavior: "smooth" }), 250);
}

// Entrada suave das seções da página inicial.
const revealItems = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach(item => revealObserver.observe(item));
} else {
  revealItems.forEach(item => item.classList.add('visible'));
}
