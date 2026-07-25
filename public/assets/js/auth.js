import { api, ensureCsrf, setCsrf } from './api.js';
import { $, $$, buttonLoading, hideLoader, hydrateIcons, toast } from './ui.js';
import { icon } from './icons.js';

hydrateIcons();
const isRegisterPath = location.pathname === '/register';

function switchTab(tab) {
  const register = tab === 'register';
  $$('[data-auth-tab]').forEach((button) => {
    const active = button.dataset.authTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#loginForm').classList.toggle('hidden', register);
  $('#registerForm').classList.toggle('hidden', !register);
  $('#authKicker').textContent = register ? 'NEW CREATOR WORKSPACE' : 'WELCOME BACK';
  $('#authTitle').textContent = register ? 'Build your command center' : 'Enter your workspace';
  $('#authSubtitle').textContent = register ? 'Create a secure account. Connect Google only when you’re ready.' : 'Securely continue your creator operations.';
  $('#authAlert').classList.add('hidden');
  const target = register ? '/register' : '/login';
  if (location.pathname !== target) history.replaceState({}, '', target);
}

$$('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.authTab)));
$$('.password-toggle').forEach((button) => button.addEventListener('click', () => {
  const input = button.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.innerHTML = icon(show ? 'eye' : 'lock');
  button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}));
$$('[data-toast]').forEach((button) => button.addEventListener('click', () => toast(button.dataset.toast, 'warning', 'Integration note')));

function showError(error, form) {
  const alert = $('#authAlert');
  alert.textContent = error.message;
  alert.classList.remove('hidden');
  $$('.field', form).forEach((field) => field.classList.remove('invalid'));
  (error.details || []).forEach((detail) => {
    const input = form.elements[detail.field];
    const field = input?.closest('.field');
    if (field) {
      field.classList.add('invalid');
      const line = field.querySelector('.field-error');
      if (line) line.textContent = detail.message;
    }
  });
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  $('#authAlert').classList.add('hidden');
  if (!form.reportValidity()) return;
  buttonLoading(submit, true, 'Authenticating...');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
    setCsrf(data.csrfToken);
    toast('Authentication complete. Loading your workspace.');
    setTimeout(() => location.assign('/dashboard'), 350);
  } catch (error) {
    showError(error, form);
    buttonLoading(submit, false);
  }
});

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  $('#authAlert').classList.add('hidden');
  if (!form.reportValidity()) return;
  if (!form.terms.checked) return showError(new Error('Accept the Terms and Privacy Policy to continue.'), form);
  buttonLoading(submit, true, 'Creating workspace...');
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: { name: form.name.value.trim(), email: form.email.value.trim(), password: form.password.value } });
    setCsrf(data.csrfToken);
    toast('Your secure workspace is ready.');
    setTimeout(() => location.assign('/dashboard'), 350);
  } catch (error) {
    showError(error, form);
    buttonLoading(submit, false);
  }
});

(async function init() {
  if (isRegisterPath) switchTab('register');
  try {
    await ensureCsrf();
    await api('/api/auth/me');
    location.assign('/dashboard');
  } catch {
    hideLoader(450);
  }
})();
