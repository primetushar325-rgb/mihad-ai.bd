let csrfToken = '';

export async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  const payload = await response.json();
  csrfToken = payload.data?.csrfToken || '';
  return csrfToken;
}

export function setCsrf(value) { csrfToken = value || ''; }

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-csrf-token', await ensureCsrf());
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, method, headers, body, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({ ok: false, error: { message: 'The server returned an unreadable response.' } }));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error?.message || 'Request failed.');
    error.status = response.status;
    error.code = payload.error?.code;
    error.details = payload.error?.details;
    throw error;
  }
  return payload.data;
}

export async function uploadForm(path, formData, onProgress) {
  const token = await ensureCsrf();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-csrf-token', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 90));
    };
    xhr.onload = () => {
      let payload;
      try { payload = JSON.parse(xhr.responseText); } catch { payload = { error: { message: 'Unreadable server response.' } }; }
      if (xhr.status >= 200 && xhr.status < 300 && payload.ok !== false) resolve(payload.data);
      else {
        const error = new Error(payload.error?.message || 'Upload failed.');
        error.status = xhr.status; error.code = payload.error?.code; error.details = payload.error?.details;
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error('Network connection interrupted.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(formData);
  });
}
