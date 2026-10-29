(() => {
  const AUTH_KEY = 'grimorio_auth_token';
  function authHeaders(extra = {}) {
    const token = localStorage.getItem(AUTH_KEY);
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }
  async function api(url, options = {}) {
    if (window.GrimorioSupabase) return window.GrimorioSupabase.request(url, options);
    const response = await fetch(url, { ...options, headers: authHeaders({...(options.body ? {'Content-Type':'application/json'} : {}),...(options.headers || {})}) });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || (response.status === 404 ? 'Esta função não está disponível no servidor. Atualize o servidor do Grimório e tente novamente.' : 'Não foi possível concluir.'));
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function currentUser() {
    try { return (await api('/api/auth/me')).user; } catch { return null; }
  }
  function loginRedirect() {
    const next = location.pathname + location.search;
    location.href = '/?login=1&next=' + encodeURIComponent(next);
  }
  async function requireUser() {
    const user = await currentUser();
    if (!user) loginRedirect();
    return user;
  }
  function authDestination() {
    if (typeof location === 'undefined') return '';
    const next = new URLSearchParams(location.search).get('next') || '';
    return /^\/(?:amigos|campanha|campanha-hub|ficha|magias|sugestoes|lobby|sessao|admin)\.html(?:\?[^#]*)?$/.test(next) ? next : '';
  }
  function esc(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
  function avatar(user, size = '') {
    return user?.avatarData
      ? `<img class="avatar-img ${esc(size)}" src="${esc(user.avatarData)}" alt="">`
      : `<span class="avatar-fallback ${esc(size)}">${esc((user?.displayName || user?.email || '?')[0].toUpperCase())}</span>`;
  }
  window.Grimorio = { api, currentUser, requireUser, loginRedirect, authHeaders, esc, avatar, AUTH_KEY };

  // Keep contextual campaign navigation on physical lobby/table pages.
  const hubCode = typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  if (/^[A-F0-9]{6}$/.test(hubCode)) {
    document.querySelectorAll('[data-campaign-hub]').forEach(link => { link.href = '/campanha-hub.html?code=' + encodeURIComponent(hubCode); });
  }

  // A private scope keeps these helpers compatible with the character sheet.
  async function mountAccount() {
    const main = document.querySelector('.app-main');
    if (!main) return;
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/account.css';
    document.head.append(stylesheet);
    const header = document.createElement('header');
    header.className = 'platform-account-bar';
    header.innerHTML = `<span class="account-status" role="status"></span>
      <a class="button button-secondary" id="accountAdmin" href="/admin.html" hidden>Administração</a>
      <button type="button" class="button button-secondary" id="accountLogin">Fazer login</button>
      <button type="button" class="account-profile" id="accountProfile" aria-haspopup="dialog" hidden></button>
      <button type="button" class="button button-secondary" id="accountLogout" hidden>Sair</button>`;
    main.prepend(header);
    const loginDialog = document.createElement('dialog');
    loginDialog.className = 'platform-auth panel';
    loginDialog.setAttribute('aria-labelledby', 'platformAuthTitle');
    loginDialog.innerHTML = `<button type="button" class="modal-close" aria-label="Fechar login">×</button>
      <span class="mini-label">CONTA GRIMÓRIO</span><h2 id="platformAuthTitle">Entrar no Grimório</h2>
      <form><label for="accountEmailInput">E-mail</label><input id="accountEmailInput" type="email" autocomplete="email" required>
      <label for="accountPasswordInput">Senha</label><input id="accountPasswordInput" type="password" autocomplete="current-password" minlength="8" required>
      <p class="auth-error" role="alert"></p><button class="button button-primary" type="submit">Entrar</button>
      <a class="button button-secondary account-register-link" href="/cadastro.html" data-register>Criar conta</a></form>`;
    document.body.append(loginDialog);
    const profileDialog = document.createElement('dialog');
    profileDialog.className = 'platform-auth account-editor panel';
    profileDialog.setAttribute('aria-labelledby', 'accountProfileTitle');
    profileDialog.innerHTML = `<button type="button" class="modal-close" data-profile-close aria-label="Fechar perfil">×</button>
      <span class="mini-label">SEU LUGAR NO GRIMÓRIO</span><h2 id="accountProfileTitle">Editar perfil</h2>
      <p class="account-intro">Um espaço com a sua personalidade, dentro e fora da aventura.</p>
      <form id="accountProfileForm">
        <div class="account-customization"><aside class="account-preview-column"><span class="account-section-label">PRÉVIA DO PERFIL</span><div class="account-preview-card">
          <div id="accountBannerPreview" class="account-banner-preview" aria-label="Prévia do banner"><span aria-hidden="true">✦</span></div>
          <div class="account-preview-content"><div class="account-avatar-frame" data-frame=""><div id="accountAvatarPreview" aria-label="Prévia da foto de perfil"></div></div><strong id="accountPreviewName"></strong><span id="accountPreviewUsername"></span><div class="account-preview-about"><span class="account-section-label">SOBRE MIM</span><p id="accountPreviewBio"></p></div></div>
        </div><p class="account-preview-hint">Seu nome de exibição e sua apresentação podem mudar. Sua identidade continua sendo única.</p></aside>
        <div class="account-profile-fields"><div class="account-image-fields"><div class="account-portrait-actions"><label for="accountAvatarInput">Foto de perfil</label>
        <input id="accountAvatarInput" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="accountAvatarHint">
        <small id="accountAvatarHint">PNG, JPG ou WEBP · até 3 MB</small>
        <button class="account-remove-photo" type="button" id="accountRemoveAvatar">Remover foto</button></div><div class="account-portrait-actions"><label for="accountBannerInput">Banner do perfil</label><input id="accountBannerInput" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="accountBannerHint"><small id="accountBannerHint">PNG, JPG ou WEBP · até 3 MB. Prefira uma imagem horizontal.</small><button class="account-remove-photo" type="button" id="accountRemoveBanner">Remover banner</button></div></div>
        <label for="accountDisplayName">Nome de exibição</label>
        <input id="accountDisplayName" type="text" maxlength="32" autocomplete="nickname" required placeholder="Como devemos chamar você?">
        <div class="account-bio-label"><label for="accountBio">Sobre mim</label><span id="accountBioCount">0 / 280</span></div><textarea id="accountBio" maxlength="280" rows="3" placeholder="Conte um pouco sobre você ou deixe sua frase favorita." aria-describedby="accountBioCount"></textarea>
        <div class="account-identity"><span class="mini-label">SEU NOME DE USUÁRIO</span><strong id="accountUsername"></strong><small>Este nome é único no Grimório e não pode ser alterado.</small></div>
        <div class="account-email"><span>E-mail da conta</span><strong id="accountProfileEmail"></strong></div>
        <div class="account-code-block"><div><span class="mini-label">CÓDIGO DA CONTA</span><strong id="accountCode"></strong></div><button type="button" class="button button-secondary" id="accountCopyCode" aria-label="Copiar código da conta">Copiar código</button></div><small id="accountCodeHint">Compartilhe estes 8 números para receber solicitações de amizade.</small>
        </div></div>
        <p class="auth-error" role="alert" id="accountProfileError"></p>
        <div class="account-editor-actions"><button type="button" class="button button-secondary" data-profile-cancel>Cancelar</button>
        <button type="submit" class="button button-primary" id="accountSaveProfile">Salvar alterações</button></div>
      </form>`;
    document.body.append(profileDialog);
    const login = header.querySelector('#accountLogin');
    const logout = header.querySelector('#accountLogout');
    const profileButton = header.querySelector('#accountProfile');
    const status = header.querySelector('.account-status');
    const loginForm = loginDialog.querySelector('form');
    const loginError = loginDialog.querySelector('.auth-error');
    const profileForm = profileDialog.querySelector('form');
    const nameInput = profileDialog.querySelector('#accountDisplayName');
    const photoInput = profileDialog.querySelector('#accountAvatarInput');
    const photoPreview = profileDialog.querySelector('#accountAvatarPreview');
    const removePhoto = profileDialog.querySelector('#accountRemoveAvatar');
    const bannerInput = profileDialog.querySelector('#accountBannerInput');
    const bannerPreview = profileDialog.querySelector('#accountBannerPreview');
    const removeBanner = profileDialog.querySelector('#accountRemoveBanner');
    const bioInput = profileDialog.querySelector('#accountBio');
    const saveProfile = profileDialog.querySelector('#accountSaveProfile');
    const profileError = profileDialog.querySelector('#accountProfileError');
    let user = null;
    let pendingAvatar = '';
    let pendingBanner = '';
    const imageRevision = { avatar: 0, banner: 0 };
    const readingImages = { avatar: false, banner: false };
    let savingProfile = false;
    function renderAccount() {
      login.hidden = Boolean(user);
      header.querySelector('#accountAdmin').hidden = user?.role !== 'admin';
      logout.hidden = !user;
      profileButton.hidden = !user;
      if (user) {
        const name = user.displayName || user.email;
        profileButton.innerHTML = `${avatar(user)}<span class="account-profile-copy"><strong>${esc(name)}</strong><small>Editar perfil</small></span><span class="account-profile-arrow" aria-hidden="true">⌄</span>`;
        profileButton.setAttribute('aria-label', `Editar perfil de ${name}`);
      }
    }
    function renderPhoto() {
      photoPreview.innerHTML = avatar({ ...user, displayName: nameInput.value.trim(), avatarData: pendingAvatar });
      removePhoto.hidden = !pendingAvatar;
      removeBanner.hidden = !pendingBanner;
      bannerPreview.innerHTML = pendingBanner ? `<img src="${esc(pendingBanner)}" alt="">` : '<span aria-hidden="true">✦</span>';
      profileDialog.querySelector('#accountPreviewName').textContent = nameInput.value.trim() || 'Seu nome de exibição';
      profileDialog.querySelector('#accountPreviewUsername').textContent = '@' + (user?.username || user?.accountCode || 'aventureiro');
      profileDialog.querySelector('#accountPreviewBio').textContent = bioInput.value.trim() || 'Uma nova história está prestes a começar.';
      profileDialog.querySelector('#accountBioCount').textContent = `${bioInput.value.length} / 280`;
    }
    function syncSaveState() { saveProfile.disabled = savingProfile || readingImages.avatar || readingImages.banner; }
    function closeProfile() { if (!savingProfile) profileDialog.close(); }
    function closeOnBackdrop(dialog, close) {
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      });
    }
    login.onclick = () => { loginError.textContent = ''; loginDialog.showModal(); };
    loginDialog.querySelector('.modal-close').onclick = () => loginDialog.close();
    closeOnBackdrop(loginDialog, () => loginDialog.close());
    closeOnBackdrop(profileDialog, closeProfile);
    profileDialog.querySelector('[data-profile-close]').onclick = closeProfile;
    profileDialog.querySelector('[data-profile-cancel]').onclick = closeProfile;
    profileDialog.addEventListener('cancel', event => { if (savingProfile) event.preventDefault(); });
    profileDialog.addEventListener('close', () => { for (const kind of ['avatar', 'banner']) { imageRevision[kind]++; readingImages[kind] = false; } });
    profileButton.onclick = () => {
      if (!user) return;
      pendingAvatar = user.avatarData || '';
      pendingBanner = user.bannerData || '';
      nameInput.value = user.displayName || '';
      bioInput.value = user.bio || '';
      nameInput.setCustomValidity('');
      profileDialog.querySelector('#accountUsername').textContent = '@' + (user.username || user.accountCode || 'aventureiro');
      profileDialog.querySelector('#accountProfileEmail').textContent = user.email || '';
      profileDialog.querySelector('#accountCode').textContent = user.accountCode || '';
      profileDialog.querySelector('#accountCopyCode').textContent = 'Copiar código';
      photoInput.value = '';
      bannerInput.value = '';
      profileError.textContent = '';
      status.textContent = '';
      saveProfile.disabled = false;
      renderPhoto();
      profileDialog.showModal();
      nameInput.focus();
    };
    profileDialog.querySelector('#accountCopyCode').onclick = async () => {
      try {
        await navigator.clipboard.writeText(user.accountCode);
        profileDialog.querySelector('#accountCopyCode').textContent = 'Copiado ✓';
      } catch { profileError.textContent = 'Não foi possível copiar. Selecione o código acima para copiá-lo.'; }
    };
    nameInput.oninput = () => { nameInput.setCustomValidity(''); renderPhoto(); };
    bioInput.oninput = renderPhoto;
    const removeImage = kind => {
      imageRevision[kind]++;
      if (kind === 'avatar') { pendingAvatar = ''; photoInput.value = ''; }
      else { pendingBanner = ''; bannerInput.value = ''; }
      readingImages[kind] = false;
      syncSaveState();
      profileError.textContent = '';
      renderPhoto();
    };
    removePhoto.onclick = () => removeImage('avatar');
    removeBanner.onclick = () => removeImage('banner');
    const readImage = async kind => {
      const input = kind === 'avatar' ? photoInput : bannerInput;
      const file = input.files[0];
      const revision = ++imageRevision[kind];
      profileError.textContent = '';
      readingImages[kind] = false;
      syncSaveState();
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        profileError.textContent = 'Escolha uma imagem PNG, JPG ou WEBP.';
        input.value = '';
        return;
      }
      if (file.size > 3 * 1024 * 1024) {
        profileError.textContent = 'A imagem é muito grande. Escolha uma imagem de até 3 MB.';
        input.value = '';
        return;
      }
      readingImages[kind] = true;
      syncSaveState();
      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Não foi possível ler a imagem. Tente novamente.'));
          reader.readAsDataURL(file);
        });
        await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = resolve;
          image.onerror = () => reject(new Error('Este arquivo não contém uma imagem válida.'));
          image.src = data;
        });
        if (revision !== imageRevision[kind]) return;
        if (kind === 'avatar') pendingAvatar = data;
        else pendingBanner = data;
        renderPhoto();
      } catch (error) {
        if (revision !== imageRevision[kind]) return;
        profileError.textContent = error.message;
        input.value = '';
      } finally {
        if (revision === imageRevision[kind]) { readingImages[kind] = false; syncSaveState(); }
      }
    };
    photoInput.onchange = () => readImage('avatar');
    bannerInput.onchange = () => readImage('banner');
    profileForm.onsubmit = async event => {
      event.preventDefault();
      if (savingProfile || readingImages.avatar || readingImages.banner) return;
      nameInput.value = nameInput.value.trim();
      bioInput.value = bioInput.value.trim();
      nameInput.setCustomValidity(nameInput.value ? '' : 'Informe seu nome de exibição.');
      if (!profileForm.reportValidity()) return;
      profileError.textContent = '';
      savingProfile = true;
      profileForm.setAttribute('aria-busy', 'true');
      const controls = [...profileDialog.querySelectorAll('button, input:not(#accountProfileEmail), textarea')];
      controls.forEach(control => { control.disabled = true; });
      saveProfile.textContent = 'Salvando…';
      try {
        const result = await api('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: nameInput.value, avatarData: pendingAvatar, bannerData: pendingBanner, bio: bioInput.value }) });
        user = result.user;
        renderAccount();
        profileDialog.close();
        status.textContent = 'Perfil atualizado.';
        window.dispatchEvent(new CustomEvent('grimorio:profile-updated', { detail: { user } }));
      } catch (error) { profileError.textContent = error.message; }
      finally {
        savingProfile = false;
        profileForm.removeAttribute('aria-busy');
        controls.forEach(control => { control.disabled = false; });
        saveProfile.textContent = 'Salvar alterações';
      }
    };
    async function authenticate(mode) {
      if (!loginForm.reportValidity()) return;
      const buttons = [...loginForm.querySelectorAll('button')];
      buttons.forEach(button => { button.disabled = true; });
      loginError.textContent = '';
      try {
        const data = await api('/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: loginForm.querySelector('input[type=email]').value.trim(), password: loginForm.querySelector('input[type=password]').value }) });
        if (data.token) localStorage.setItem(AUTH_KEY, data.token);
        loginDialog.close();
        const destination = authDestination();
        if (destination) location.href = destination;
        else location.reload();
      } catch (error) { loginError.textContent = error.message; }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    }
    loginForm.onsubmit = event => { event.preventDefault(); authenticate('login'); };
    logout.onclick = async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); }
      catch (error) { if (localStorage.getItem(AUTH_KEY)) console.warn(error.message); }
      localStorage.removeItem(AUTH_KEY);
      location.href = '/';
    };
    user = await currentUser();
    renderAccount();
    if (!user && typeof location !== 'undefined' && new URLSearchParams(location.search).get('login') === '1') login.onclick();
  }
  mountAccount();
})();
