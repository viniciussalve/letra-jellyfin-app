import type { Language } from "../../shared/types.ts";
import { getTranslation } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { attachMenu } from "../shared/menu.ts";
import type { LyricsView } from "./lyrics-view.ts";

// Pure helpers first: this module is importable in node, so DOM access stays inside functions.

export type Prefs = { on: boolean; lang: string };

const PREFS_KEY = "letra:translation";
const FALLBACK_LANGUAGE = "pt-BR";

const COPY = {
  button: "Tradução",
  language: "Idioma da tradução",
  menu: "Idiomas",
  unavailable: "Tradução indisponível agora.",
  retry: "Tentar de novo",
  sameLanguage: (name: string) => `A música já está em ${name}`,
};

const primary = (tag: string) => tag.toLowerCase().split("-")[0]!;

/** The first browser language that is on the list (exact code, else same primary subtag), else pt-BR. */
export function defaultLanguage(navigatorLanguages: readonly string[], languages: Language[]): string {
  for (const tag of navigatorLanguages) {
    const exact = languages.find((l) => l.code.toLowerCase() === tag.toLowerCase());
    const found = exact ?? languages.find((l) => primary(l.code) === primary(tag));
    if (found) return found.code;
  }
  return FALLBACK_LANGUAGE;
}

export function loadPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<Prefs> | null;
    if (value && typeof value.on === "boolean" && typeof value.lang === "string") return { on: value.on, lang: value.lang };
  } catch {
    // storage blocked or corrupt: the page works without it
  }
  return null;
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked or full: the choice just won't persist
  }
}

// --- UI -----------------------------------------------------------------------------

export type TranslationElements = {
  /** The glass toggle button; hidden by the caller when no engine is configured. */
  button: HTMLButtonElement;
  /** The language pill; this module fills it and owns the menu around it. */
  pill: HTMLButtonElement;
  /** The lyrics column, where the failure message goes. */
  column: HTMLElement;
};

export type TranslationController = { toggle(): void };

export function mountTranslation(
  trackId: string,
  view: LyricsView,
  languages: Language[],
  enabled: boolean,
  { button, pill, column }: TranslationElements,
): TranslationController {
  if (!enabled || languages.length === 0) return { toggle() {} };

  const nameOf = (code: string) => languages.find((l) => l.code === code)?.name ?? code;
  const saved = loadPrefs();
  const known = (code: string | undefined) => languages.some((l) => l.code === code);
  let lang = saved && known(saved.lang) ? saved.lang : defaultLanguage(navigator.languages, languages);
  let on = saved?.on ?? false;
  let request = 0; // answers from older requests are ignored
  const cache = new Map<string, Awaited<ReturnType<typeof getTranslation>>>();

  const menu = el("div", { class: "language-menu", id: "language-menu", role: "menu", "aria-label": COPY.menu, hidden: true });
  const rows = new Map<string, HTMLButtonElement>();
  for (const l of languages) {
    const row = el("button", { type: "button", class: "menu-row", role: "menuitemradio", "data-code": l.code, lang: l.code }, el("span", {}, l.name), iconEl("check"));
    row.addEventListener("click", () => {
      languageMenu.close(true);
      choose(l.code);
    });
    rows.set(l.code, row);
    menu.append(row);
  }
  pill.after(menu);
  const languageMenu = attachMenu({ trigger: pill, menu, items: () => [...rows.values()], first: () => rows.get(lang) });

  const status = el("div", { class: "translation-error", role: "alert", hidden: true });
  const message = el("span", {}, COPY.unavailable);
  const retry = el("button", { type: "button", class: "glass-pill" }, COPY.retry);
  status.append(message, retry);
  column.append(status);

  function syncLanguage(): void {
    pill.textContent = nameOf(lang);
    pill.setAttribute("aria-label", `${COPY.language}: ${nameOf(lang)}`);
    for (const [code, row] of rows) row.setAttribute("aria-checked", String(code === lang));
  }

  async function apply(): Promise<void> {
    button.setAttribute("aria-pressed", String(on));
    pill.hidden = !on;
    status.hidden = true;
    const mine = ++request;
    if (!on) {
      languageMenu.close();
      view.setTranslations(null, null);
      return;
    }
    const wanted = lang;
    try {
      const dto = cache.get(wanted) ?? (await getTranslation(trackId, wanted));
      cache.set(wanted, dto);
      if (mine !== request) return;
      if (dto.sameLanguage) view.setTranslations(null, COPY.sameLanguage(nameOf(wanted)));
      else view.setTranslations(dto.lines, null, wanted);
    } catch {
      if (mine !== request) return;
      view.setTranslations(null, null);
      // Every failure reads the same to the listener; the lyrics keep playing.
      status.hidden = false;
    }
  }

  function choose(code: string): void {
    if (code === lang && on) return;
    lang = code;
    on = true;
    syncLanguage();
    savePrefs({ on, lang });
    void apply();
  }

  function toggle(): void {
    on = !on;
    savePrefs({ on, lang });
    void apply();
  }

  button.addEventListener("click", toggle);
  retry.addEventListener("click", () => void apply());

  syncLanguage();
  if (on) void apply();
  return { toggle };
}
