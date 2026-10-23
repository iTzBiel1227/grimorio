(() => {
  const AUTH_KEY = 'grimorio_auth_token';
  function authHeaders(extra = {}) {
    const token = localStorage.getItem(AUTH_KEY);
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || (response.status === 404 ? 'Esta função não está disponível no servidor. Atualize o servidor do Grimório e tente novamente.' : 'Não foi possível concluir.'));
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
    return /^\/(?:amigos|campanha|ficha|magias|sugestoes|lobby|sessao)\.html(?:\?[^#]*)?$/.test(next) ? next : '';
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
      <button class="button button-secondary" type="button" data-register>Criar conta</button></form>`;
    document.body.append(loginDialog);
    const profileDialog = document.createElement('dialog');
    profileDialog.className = 'platform-auth account-editor panel';
    profileDialog.setAttribute('aria-labelledby', 'accountProfileTitle');
    profileDialog.innerHTML = `<button type="button" class="modal-close" data-profile-close aria-label="Fechar perfil">×</button>
      <span class="mini-label">SEU LUGAR NO GRIMÓRIO</span><h2 id="accountProfileTitle">Editar perfil</h2>
      <p class="account-intro">Como você aparece nas suas aventuras.</p>
      <form id="accountProfileForm">
        <div class="account-portrait"><div id="accountAvatarPreview" aria-label="Prévia da foto de perfil"></div>
        <div class="account-portrait-actions"><label for="accountAvatarInput">Foto de perfil</label>
        <input id="accountAvatarInput" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="accountAvatarHint">
        <small id="accountAvatarHint">PNG, JPG ou WEBP · até 3 MB</small>
        <button class="account-remove-photo" type="button" id="accountRemoveAvatar">Remover foto</button></div></div>
        <label for="accountDisplayName">Nome de exibição</label>
        <input id="accountDisplayName" type="text" maxlength="32" autocomplete="nickname" required placeholder="Como devemos chamar você?">
        <label for="accountProfileEmail">E-mail da conta</label><input id="accountProfileEmail" type="email" disabled>
        <label for="accountCode">Seu código de conta</label><input id="accountCode" readonly aria-describedby="accountCodeHint"><small id="accountCodeHint">Compartilhe estes 8 números para que seus amigos encontrem você.</small>
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
    const saveProfile = profileDialog.querySelector('#accountSaveProfile');
    const profileError = profileDialog.querySelector('#accountProfileError');
    let user = null;
    let pendingAvatar = '';
    let photoRevision = 0;
    let readingPhoto = false;
    let savingProfile = false;
    function renderAccount() {
      login.hidden = Boolean(user);
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
    }
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
    profileDialog.addEventListener('close', () => { photoRevision++; readingPhoto = false; });
    profileButton.onclick = () => {
      if (!user) return;
      pendingAvatar = user.avatarData || '';
      nameInput.value = user.displayName || '';
      nameInput.setCustomValidity('');
      profileDialog.querySelector('#accountProfileEmail').value = user.email || '';
      profileDialog.querySelector('#accountCode').value = user.accountCode || '';
      photoInput.value = '';
      profileError.textContent = '';
      status.textContent = '';
      saveProfile.disabled = false;
      renderPhoto();
      profileDialog.showModal();
      nameInput.focus();
    };
    nameInput.oninput = () => { nameInput.setCustomValidity(''); renderPhoto(); };
    removePhoto.onclick = () => {
      photoRevision++;
      pendingAvatar = '';
      photoInput.value = '';
      readingPhoto = false;
      saveProfile.disabled = false;
      profileError.textContent = '';
      renderPhoto();
    };
    photoInput.onchange = async () => {
      const file = photoInput.files[0];
      const revision = ++photoRevision;
      profileError.textContent = '';
      readingPhoto = false;
      saveProfile.disabled = false;
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        profileError.textContent = 'Escolha uma imagem PNG, JPG ou WEBP.';
        photoInput.value = '';
        return;
      }
      if (file.size > 2_999_000) {
        profileError.textContent = 'A imagem é muito grande. Escolha uma foto de até 3 MB.';
        photoInput.value = '';
        return;
      }
      readingPhoto = true;
      saveProfile.disabled = true;
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
        if (revision !== photoRevision) return;
        pendingAvatar = data;
        renderPhoto();
      } catch (error) {
        if (revision !== photoRevision) return;
        profileError.textContent = error.message;
        photoInput.value = '';
      } finally {
        if (revision === photoRevision) { readingPhoto = false; saveProfile.disabled = false; }
      }
    };
    profileForm.onsubmit = async event => {
      event.preventDefault();
      if (savingProfile || readingPhoto) return;
      nameInput.value = nameInput.value.trim();
      nameInput.setCustomValidity(nameInput.value ? '' : 'Informe seu nome de exibição.');
      if (!profileForm.reportValidity()) return;
      profileError.textContent = '';
      savingProfile = true;
      profileForm.setAttribute('aria-busy', 'true');
      const controls = [...profileDialog.querySelectorAll('button, input:not(#accountProfileEmail)')];
      controls.forEach(control => { control.disabled = true; });
      saveProfile.textContent = 'Salvando…';
      try {
        const result = await api('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: nameInput.value, avatarData: pendingAvatar }) });
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
        localStorage.setItem(AUTH_KEY, data.token);
        loginDialog.close();
        const destination = authDestination();
        if (destination) location.href = destination;
        else location.reload();
      } catch (error) { loginError.textContent = error.message; }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    }
    loginForm.onsubmit = event => { event.preventDefault(); authenticate('login'); };
    loginForm.querySelector('[data-register]').onclick = () => authenticate('register');
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
