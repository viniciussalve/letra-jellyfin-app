import "../shared/tokens.css";
import "../shared/base.css";
import "./styles.css";
import { ApiClientError, getSession, listTracks, logout } from "../shared/api.ts";
import { mountBackground } from "../shared/background.ts";
import { el } from "../shared/dom.ts";
import { enableActiveStates } from "../shared/motion.ts";
import { navBar } from "../shared/nav.ts";
import { messageOf, mountToast, toast, type Hooks } from "./dialogs.ts";
import { createList } from "./list.ts";
import { renderHome } from "./home.ts";
import { openSignIn } from "./login.ts";
import { renderSavedPage } from "./saved-page.ts";
import { createResult } from "./result.ts";
import { mountUploader, type Uploader } from "./uploader.ts";

const COPY = {
  signIn: "Entrar",
  logout: "Sair",
  // The password was right but the session check right after says signed out: the
  // browser dropped the cookie (a Secure one, PUBLIC_URL https://, over plain http).
  sessionNotKept: "O navegador não guardou a sessão. Abra o app pelo endereço definido em PUBLIC_URL.",
};

const app = document.getElementById("app")!;
let uploader: Uploader | null = null;

/**
 * Whether this browser last showed the owner view: then the page waits for the session check
 * rather than flash the listener home first. Blocked storage counts as no hint.
 */
const OWNER_HINT = "letra.owner.v1";
const ownerHint = {
  get(): boolean {
    try {
      return localStorage.getItem(OWNER_HINT) !== null;
    } catch {
      return false;
    }
  },
  set(on: boolean): void {
    try {
      if (on) localStorage.setItem(OWNER_HINT, "1");
      else localStorage.removeItem(OWNER_HINT);
    } catch {
      // storage blocked: the next load draws the listener home first, as with no hint
    }
  },
};

const closeDialogs = () => {
  for (const dialog of document.querySelectorAll("dialog[open]")) (dialog as HTMLDialogElement).close();
};

/** The listener view: the sign-in is a dialog opened from it. */
function showHome(): void {
  uploader?.dispose();
  uploader = null;
  closeDialogs();
  renderHome(app, { onSignedIn: enterOwner });
}

/**
 * After a correct password: check the session and switch to the owner view in place. Returns the
 * message for the sign-in dialog when the session did not stick.
 */
async function enterOwner(): Promise<string | null> {
  const session = await getSession();
  if (!session.owner) return COPY.sessionNotKept;
  closeDialogs();
  showApp(session.maxUploadBytes, true);
  return null;
}

/** A 401 means the session ended (cookie expired or cleared): back to the sign-in. */
function signedOut(err: unknown): boolean {
  if (!(err instanceof ApiClientError && err.status === 401)) return false;
  ownerHint.set(false);
  showHome();
  return true;
}

function showApp(maxBytes: number, focusPanel: boolean): void {
  ownerHint.set(true);
  uploader?.dispose(); // a previous owner view's window drop listeners must not upload too
  const hooks: Hooks = {
    changed(track) {
      list.update(track);
      result.update(track);
    },
    removed(id) {
      list.remove(id);
      result.removed(id);
    },
    signedOut,
  };
  const list = createList(hooks);
  const result = createResult(hooks);
  uploader = mountUploader({
    maxBytes,
    uploaded(track, hadFocus) {
      list.add(track);
      result.show(track, hadFocus);
    },
    handled: signedOut,
  });

  const leave = el("button", { type: "button", class: "glass-pill" }, COPY.logout);
  leave.addEventListener("click", async () => {
    try {
      await logout();
      ownerHint.set(false);
      showHome();
    } catch (err) {
      toast(messageOf(err));
    }
  });

  app.className = "upload";
  app.replaceChildren(
    navBar({ current: "home", actions: [leave], heading: true }),
    el("div", { class: "page" }, el("div", { class: "upload-col" }, uploader.element, result.element), list.element),
  );
  if (focusPanel) uploader.element.querySelector<HTMLElement>(".white-pill")?.focus();

  listTracks().then(
    (tracks) => list.set(tracks),
    (err: unknown) => {
      if (!signedOut(err)) toast(messageOf(err));
    },
  );
}

/**
 * /salvas, with the account action in the bar: "Entrar" for a listener, "Sair" for the owner.
 * Signing in or out stays on this page. Until the session check answers, an invisible "Entrar"
 * holds the action's place, so the bar does not change when the answer lands.
 */
function showSavedPage(): void {
  const account = el("div", { class: "nav-account", "data-pending": true });
  const signIn = el("button", { type: "button", class: "glass-pill", "data-sign-in": true }, COPY.signIn);
  const leave = el("button", { type: "button", class: "glass-pill" }, COPY.logout);
  const show = (owner: boolean, focus: boolean) => {
    account.removeAttribute("data-pending");
    const action = owner ? leave : signIn;
    account.replaceChildren(action);
    if (focus) action.focus();
  };
  account.append(signIn);

  signIn.addEventListener("click", () =>
    openSignIn(async () => {
      const session = await getSession();
      if (!session.owner) return COPY.sessionNotKept;
      ownerHint.set(true);
      closeDialogs();
      show(true, true);
      return null;
    }),
  );
  leave.addEventListener("click", async () => {
    try {
      await logout();
      ownerHint.set(false);
      show(false, true);
    } catch (err) {
      toast(messageOf(err));
    }
  });

  renderSavedPage(app, { actions: [account] });
  // No session answer (offline): the listener's "Entrar", with no message; the lines need none.
  getSession().then(
    (session) => {
      ownerHint.set(session.owner);
      if (account.hasAttribute("data-pending")) show(session.owner, false);
    },
    () => {
      if (account.hasAttribute("data-pending")) show(false, false);
    },
  );
}

/**
 * The first view. Without the owner hint the listener home is drawn at once, before the
 * session check (the page's first frame waits only for this module, not for the network), and
 * the check switches to the owner view if it says so. With the hint the page draws only the bar
 * (its account action's place held by an invisible "Entrar", as on /salvas) and waits for the
 * check, so the owner never sees the listener home first.
 */
async function boot(): Promise<void> {
  if (/^\/salvas\/?$/.test(location.pathname)) {
    showSavedPage();
    return;
  }
  const waitForSession = ownerHint.get();
  if (!waitForSession) showHome();
  else {
    const pending = el("div", { class: "nav-account", "data-pending": true }, el("button", { type: "button", class: "glass-pill" }, COPY.signIn));
    app.className = "upload";
    app.replaceChildren(navBar({ current: "home", heading: true, actions: [pending] }));
  }
  const home = app.querySelector("[data-home-view]");
  // The listener may sign in from the dialog meanwhile: then that sign-in decides, not this answer.
  const stillFirstView = () => waitForSession || (home?.isConnected ?? false);
  try {
    const session = await getSession();
    if (!stillFirstView()) return;
    if (session.owner) {
      closeDialogs();
      showApp(session.maxUploadBytes, false);
      return;
    }
    ownerHint.set(false);
  } catch (err) {
    if (waitForSession) showHome();
    toast(messageOf(err));
    return;
  }
  if (waitForSession) showHome();
}

// Signed out there is no drop target: keep the browser from opening a dropped file
// in place of the page. (Signed in, the uploader takes drops.)
const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
for (const type of ["dragover", "drop"] as const) {
  window.addEventListener(type, (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });
}

mountBackground(document.body);
enableActiveStates();
mountToast();
void boot();
