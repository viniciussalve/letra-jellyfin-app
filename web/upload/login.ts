import { login } from "../shared/api.ts";
import { openDialog } from "../shared/dialog.ts";
import { el } from "../shared/dom.ts";
import { messageOf } from "./dialogs.ts";

const COPY = {
  title: "Entrar no Jellyfin",
  username: "Usuário",
  password: "Senha",
  enter: "Entrar",
};

/**
 * What to do once the credentials are accepted. Resolve with a message when the sign-in did not
 * stick (it shows inside the dialog, which stays open); otherwise the callback has switched
 * the page and the dialog closes.
 */
export type SignedIn = () => void | string | null | Promise<void | string | null>;

/**
 * The sign-in dialog (opened by the "Entrar" pill): username + password fields for Jellyfin auth.
 * Wrong credentials show an inline error in the dialog; Esc or a click outside closes it.
 */
export function openSignIn(onSignedIn: SignedIn): void {
  const usernameInput = el("input", {
    class: "field login-field",
    id: "username",
    type: "text",
    name: "username",
    autocomplete: "username",
    placeholder: COPY.username,
    "aria-describedby": "login-error",
  });
  const passwordInput = el("input", {
    class: "field login-field",
    id: "password",
    type: "password",
    name: "password",
    autocomplete: "current-password",
    placeholder: COPY.password,
    "aria-describedby": "login-error",
  });
  const error = el("p", { class: "error", id: "login-error", role: "alert", hidden: true });
  const submit = el("button", { type: "submit", class: "white-pill" }, COPY.enter);
  const form = el(
    "form",
    { class: "login-form", "data-login": true },
    el("label", { class: "sr-only", for: "username" }, COPY.username),
    usernameInput,
    el("label", { class: "sr-only", for: "password" }, COPY.password),
    passwordInput,
    error,
    submit,
  );
  const dialog = el(
    "dialog",
    { class: "dialog login", "aria-labelledby": "login-title", "data-sign-in-dialog": true },
    el("div", { class: "login-body" }, el("h2", { class: "login-title", id: "login-title" }, COPY.title), form),
  );
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  const fail = (message: string) => {
    error.textContent = message;
    error.hidden = false;
    passwordInput.focus();
    passwordInput.select();
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await login(usernameInput.value.trim(), passwordInput.value);
      const message = await onSignedIn();
      if (message) fail(message);
      else if (dialog.open) dialog.close();
    } catch (err) {
      fail(messageOf(err));
    } finally {
      submit.disabled = false;
    }
  });

  void openDialog(dialog, usernameInput);
}
