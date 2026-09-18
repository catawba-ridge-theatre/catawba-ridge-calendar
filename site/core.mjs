export const SUPABASE_URL = "https://onejynhbuesebccwssuz.supabase.co";
export const SUPABASE_KEY = "sb_publishable_fuNq9rUAf_spgYttzXsJHg_C8NOggf2";
export const SESSION_KEY = "crhs-fundraiser-session";
export const LUDUS_URL = "https://crhstheatre.ludus.com/";

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

export function safeColor(value) {
  return /^#[a-f\d]{6}$/i.test(String(value)) ? value : "#123d2c";
}

export function activeRound(person, reservations) {
  const highest = Math.max(1, ...reservations.map(item => Number(item.round) || 1));
  const daysByRound = new Map();
  for (const item of reservations) {
    const round = Number(item.round) || 1;
    if (!daysByRound.has(round)) daysByRound.set(round, new Set());
    daysByRound.get(round).add(Number(item.day));
  }
  // Reopened dates in earlier rounds must remain available to supporters.
  let round = 1;
  while (round <= highest && daysByRound.get(round)?.size === 30) round++;
  const goalRound = Math.min(100, Math.max(highest, round));
  const raised = reservations.reduce((sum, item) => sum + Number(item.amount ?? item.day), 0);
  return {...person, round: Math.min(round, 100), full: round > 100,
    raised, goal: Math.max(Number(person.goal) || 465, goalRound * 465),
    sponsored: [...(daysByRound.get(Math.min(round, 100)) || [])]};
}

export function calendarIdentity(name, userId) {
  name = name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || /[<>\x00-\x1f]/.test(name)) {
    throw new Error("Enter a name between 1 and 80 characters, without < or >.");
  }
  const stem = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fundraiser";
  return {name, initials: name.split(" ").map(part => Array.from(part)[0]).slice(0, 2).join("").toUpperCase(),
    slug: `${stem}-${userId}`};
}

export class ApiError extends Error {
  constructor(message, status = 0, code = "") { super(message); this.status = status; this.code = code; }
}

export function createApi({storage, fetcher = globalThis.fetch, now = Date.now, onExpired = () => {}}) {
  let refreshPromise;
  let generation = 0;
  function clearSession() { generation++; storage.removeItem(SESSION_KEY); }
  function getSession() {
    try {
      const session = JSON.parse(storage.getItem(SESSION_KEY) || "null");
      if (!session) return null;
      if (!session.access_token || !session.refresh_token || !/^[a-f\d-]{36}$/i.test(session.user?.id || "")) {
        clearSession(); return null;
      }
      return session;
    } catch { clearSession(); return null; }
  }
  function saveSession(session) {
    storage.setItem(SESSION_KEY, JSON.stringify({...session,
      expires_at: session.expires_at || Math.floor(now() / 1000) + (session.expires_in || 3600)}));
  }
  async function send(path, options = {}, session = null) {
    let response;
    try {
      response = await fetcher(`${SUPABASE_URL}/${path}`, {...options,
        signal: options.signal || AbortSignal.timeout(20000),
        headers: {apikey: SUPABASE_KEY, "Content-Type": "application/json", ...options.headers,
          ...(session ? {Authorization: `Bearer ${session.access_token}`} : {})}});
    } catch { throw new ApiError("Connection interrupted. Refresh to check whether your change saved before trying again."); }
    const raw = await response.text();
    let data = null;
    if (raw.trim()) {
      try { data = JSON.parse(raw); }
      catch { throw new ApiError("We couldn’t read the response. Refresh to check the latest status.", response.status); }
    }
    if (!response.ok) {
      let message = "Something went wrong. Please refresh and try again.";
      if (response.status === 409) message = "That date or calendar was just taken. Refresh to see the latest availability.";
      else if (response.status === 429) message = "Too many attempts. Please wait a minute before trying again.";
      else if (response.status === 401 || data?.code === "invalid_credentials") message = "Please check your email and password, or sign in again.";
      else if (response.status === 403 || data?.code === "42501") message = "Your account doesn’t have permission for this action.";
      else if (data?.code === "P0001") message = "This calendar’s availability changed. Refresh before choosing another date.";
      else if (data?.code === "23514") message = "Please check the details you entered and try again.";
      else if (data?.code === "weak_password") message = "Please choose a stronger password.";
      else if (data?.code === "email_not_confirmed") message = "Please confirm your email before signing in.";
      throw new ApiError(message, response.status, data?.code || "");
    }
    return data;
  }
  async function refreshSession() {
    if (!refreshPromise) {
      const gen = generation;
      refreshPromise = (async () => {
        const session = getSession();
        if (!session) throw new ApiError("Please sign in again.", 401);
        try {
          const data = await send("auth/v1/token?grant_type=refresh_token", {
            method: "POST", body: JSON.stringify({refresh_token: session.refresh_token})});
          if (generation !== gen) throw new ApiError("Please sign in again.", 401);
          saveSession(data);
          return data;
        } catch (error) {
          if ([400, 401, 403].includes(error.status)) { clearSession(); onExpired(); }
          throw error;
        }
      })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }
  async function request(path, options = {}, authenticated = false) {
    let session = authenticated ? getSession() : null;
    if (authenticated && !session) { onExpired(); throw new ApiError("Please sign in again.", 401); }
    if (session && (!session.expires_at || session.expires_at < now() / 1000 + 60)) session = await refreshSession();
    try { return await send(path, options, session); }
    catch (error) {
      // A 401 is rejected before mutation; do not retry ambiguous network failures.
      if (!authenticated || error.status !== 401) throw error;
      session = await refreshSession();
      return send(path, options, session);
    }
  }
  async function list(path, authenticated = false) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await request(`${path}&limit=500&offset=${offset}`, {}, authenticated);
      if (!Array.isArray(batch)) throw new ApiError("Unable to load the calendars. Please refresh.");
      rows.push(...batch);
      if (batch.length < 500) return rows;
    }
  }
  return {request, list, getSession, saveSession, clearSession};
}
