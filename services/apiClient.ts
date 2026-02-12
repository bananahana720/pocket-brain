let tokenGetter: (() => Promise<string | null>) | null = null;
const DEVICE_STORAGE_KEY = 'pb_device_id_v1';

function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getClientDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'server-render';
  }

  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) return existing;

  const next = generateDeviceId();
  window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}

export function configureApiClient(getter: (() => Promise<string | null>) | null): void {
  tokenGetter = getter;
}

export async function getAuthToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  try {
    return await tokenGetter();
  } catch {
    return null;
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = await getAuthToken();

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!headers.has('X-Device-Id')) {
    headers.set('X-Device-Id', getClientDeviceId());
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: init.credentials || 'include',
  });

  return response;
}
