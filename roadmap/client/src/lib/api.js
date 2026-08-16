const JSON_HEADERS = { 'content-type': 'application/json' };

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? JSON_HEADERS : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network-level failure: the caller decides whether to fall back to cache
    // or queue the write.
    throw new ApiError('offline', 0);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

/* --------------------------------------------------------------------------
   Local cache + offline outbox.

   Roadmap content is static per deploy, so it is cached wholesale and read
   from cache the moment the network is unavailable. Progress writes are
   queued in the same store and replayed as a single bulk request when the
   connection returns.
   -------------------------------------------------------------------------- */
const CONTENT_KEY = 'roadmap.content';
const PROGRESS_KEY = 'roadmap.progress';
const OUTBOX_KEY = 'roadmap.outbox';
const USER_KEY = 'roadmap.user';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode). Offline support degrades; the
    // app itself keeps working online.
  }
}

export const cache = {
  getContent: () => read(CONTENT_KEY, null),
  setContent: (content) => write(CONTENT_KEY, content),
  /**
   * The last signed-in user. The session cookie outlives any single visit, but
   * it can only be *verified* against the server — so offline startup trusts
   * this copy to open the app, and the server re-checks the cookie on the next
   * successful request.
   */
  getUser: () => read(USER_KEY, null),
  setUser: (user) => write(USER_KEY, user),
  getProgress: () => read(PROGRESS_KEY, []),
  setProgress: (rows) => write(PROGRESS_KEY, rows),
  getOutbox: () => read(OUTBOX_KEY, []),
  setOutbox: (queue) => write(OUTBOX_KEY, queue),
  /** Queued writes collapse per step — only the latest state of a step matters. */
  queue(update) {
    const queue = read(OUTBOX_KEY, []).filter((item) => item.stepId !== update.stepId);
    queue.push({ ...update, queuedAt: new Date().toISOString() });
    write(OUTBOX_KEY, queue);
    return queue;
  },
  clearOutbox: () => write(OUTBOX_KEY, []),
};
