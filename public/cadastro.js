(async () => {
  'use strict';
  const { api, currentUser, AUTH_KEY } = Grimorio;
  const el = id => document.getElementById(id);
  const form = el('registrationForm');
  const username = el('registrationUsername');
  const birthDate = el('registrationBirthDate');
  const password = el('registrationPassword');
  const feedback = el('registrationError');
  const button = el('registrationSubmit');
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  birthDate.max = todayString;
  birthDate.min = '1900-01-01';
  for (const input of [username, birthDate]) input.addEventListener('input', () => input.setCustomValidity(''));
  el('registrationShowPassword').onclick = () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    const toggle = el('registrationShowPassword');
    toggle.textContent = show ? 'Ocultar' : 'Mostrar';
    toggle.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    toggle.setAttribute('aria-pressed', String(show));
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (button.disabled) return;
    username.value = username.value.trim().toLowerCase();
    username.setCustomValidity(/^[a-z0-9_]{3,24}$/.test(username.value) ? '' : 'Use de 3 a 24 letras, números ou sublinhados.');
    birthDate.setCustomValidity(birthDate.value && birthDate.value <= todayString && birthDate.value >= '1900-01-01' ? '' : 'Informe uma data de nascimento válida.');
    if (!form.reportValidity()) return;
    feedback.textContent = '';
    button.disabled = true;
    button.textContent = 'Criando sua conta…';
    form.setAttribute('aria-busy', 'true');
    try {
      const result = await api('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.value, email: el('registrationEmail').value.trim(), password: password.value, birthDate: birthDate.value })
      });
      if (result.token) localStorage.setItem(AUTH_KEY, result.token);
      if (result.requiresConfirmation) {
        form.hidden = true;
        el('registrationSuccess').hidden = false;
        el('registrationSuccessEmail').textContent = result.email || el('registrationEmail').value.trim();
        el('registrationSuccess').focus();
        return;
      }
      if (!result.user) throw Error('Não foi possível concluir o acesso à conta. Tente fazer login.');
      location.href = '/';
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Criar conta e começar →'; form.removeAttribute('aria-busy'); }
  };
  if (await currentUser()) location.href = '/';
})();
