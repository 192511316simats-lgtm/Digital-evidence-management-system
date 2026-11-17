const FALLBACK_SESSION_KEY = 'veritas_iframe_session_token';
let currentCsrfToken: string | null = null;
let fallbackSessionToken: string | null = null;

try {
  fallbackSessionToken = window.sessionStorage.getItem(FALLBACK_SESSION_KEY);
} catch {
  fallbackSessionToken = null;
}

export function setCsrfToken(token: string | null) {
  currentCsrfToken = token;
}

export function getCsrfToken(): string | null {
  return currentCsrfToken;
}

export function setFallbackSessionToken(token: string | null) {
  fallbackSessionToken = token;
  try {
    if (token) {
      window.sessionStorage.setItem(FALLBACK_SESSION_KEY, token);
    } else {
      window.sessionStorage.removeItem(FALLBACK_SESSION_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getFallbackSessionToken(): string | null {
  return fallbackSessionToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();

  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  if (method !== 'GET' && method !== 'HEAD' && currentCsrfToken) {
    headers.set('X-CSRF-Token', currentCsrfToken);
  }

  if (fallbackSessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${fallbackSessionToken}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && fallbackSessionToken) {
    setFallbackSessionToken(null);
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // keep fallback message
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  const headers = new Headers();
  if (fallbackSessionToken) {
    headers.set('Authorization', `Bearer ${fallbackSessionToken}`);
  }

  const res = await fetch(path, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Download failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') || '';
  const match = disp.match(/filename="?([^"]+)"?/i);
  const filename = match ? match[1] : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
