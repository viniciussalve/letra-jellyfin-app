import type { TrackDTO } from "../../shared/types.ts";
import { deleteLyrics } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { formatTime } from "../shared/format.ts";
import type { IconName } from "../shared/icons.ts";
import { confirmDelete, copyLink, editLyrics, messageOf, toast, type Hooks } from "./dialogs.ts";
import { coverEl } from "./result.ts";

const COPY = {
  heading: "Músicas",
  empty: "Nenhuma música encontrada no Jellyfin.",
  share: "Compartilhar",
  more: "Mais opções",
  copyLink: "Copiar link",
  open: "Abrir",
  editLyrics: "Editar letra",
  remove: "Apagar letra",
  removed: "Letra apagada",
};

export type List = {
  element: HTMLElement;
  set(tracks: TrackDTO[]): void;
  /** A just-uploaded track: first, highlighted until reload. */
  add(track: TrackDTO): void;
  update(track: TrackDTO): void;
  remove(id: string): void;
};

/** Web Share where there is a share sheet, else copy the link with the toast. */
async function share(track: TrackDTO): Promise<void> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: track.title, url: track.shareUrl });
      return;
    } catch (err) {
      if ((err as Error | null)?.name === "AbortError") return; // the owner closed the sheet
    }
  }
  await copyLink(track.shareUrl);
}

/** The "Enviadas" song list: 56 px rows with cover, title over artist, duration, share and ⋯. */
export function createList(hooks: Hooks): List {
  const heading = el("h2", { class: "section-title", id: "list-title", tabindex: -1 }, COPY.heading);
  const list = el("ul", { class: "rows", "aria-labelledby": "list-title", "data-list": true });
  const empty = el("p", { class: "list-empty", hidden: true }, COPY.empty);
  const section = el("section", { class: "list-col", "aria-labelledby": "list-title" }, heading, list, empty);
  const rows = new Map<string, { li: HTMLLIElement; track: TrackDTO }>();
  let closeMenu: ((focusButton: boolean) => void) | null = null;

  const syncEmpty = () => {
    empty.hidden = rows.size > 0;
  };

  function fill(li: HTMLLIElement, track: TrackDTO): void {
    const titleId = `row-title-${track.id}`;
    const main = el(
      "a",
      { class: "row-main", href: track.shareUrl, target: "_blank", rel: "noopener", "aria-label": `${track.title} — ${track.artist}` },
      coverEl(track, "row-cover"),
      el(
        "span",
        { class: "row-text" },
        el("span", { class: "row-title", id: titleId, "data-row-title": true }, track.title),
        el("span", { class: "row-artist", "data-row-artist": true }, track.artist),
      ),
    );
    const duration = el("span", { class: "row-duration", "data-row-duration": true }, formatTime(track.durationMs));
    const shareBtn = el("button", { type: "button", class: "glass-btn row-btn", "aria-label": COPY.share, "aria-describedby": titleId }, iconEl("share"));
    const more = el(
      "button",
      { type: "button", class: "glass-btn row-btn", "aria-label": COPY.more, "aria-describedby": titleId, "aria-haspopup": "menu", "aria-expanded": "false" },
      iconEl("dots-three"),
    );
    shareBtn.addEventListener("click", () => void share(rows.get(track.id)?.track ?? track));
    more.addEventListener("click", () => (more.getAttribute("aria-expanded") === "true" ? closeMenu?.(true) : openMenu(li, more)));
    more.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (more.getAttribute("aria-expanded") !== "true") openMenu(li, more);
    });
    li.replaceChildren(main, duration, shareBtn, el("div", { class: "row-more" }, more));
  }

  function row(track: TrackDTO, isNew: boolean): HTMLLIElement {
    const li = el("li", { class: "row", "data-row": true, "data-id": track.id, "data-new": isNew });
    fill(li, track);
    rows.set(track.id, { li, track });
    return li;
  }

  // --- ⋯ menu ---

  function openMenu(li: HTMLLIElement, button: HTMLButtonElement): void {
    closeMenu?.(false);
    const entry = rows.get(li.dataset.id ?? "");
    if (!entry) return;
    const { track } = entry;
    const item = (name: IconName, label: string, extra: Record<string, string> = {}) =>
      el("button", { type: "button", class: "menu-row", role: "menuitem", tabindex: -1, ...extra }, el("span", {}, label), iconEl(name));
    const copy = item("link", COPY.copyLink);
    const open = el(
      "a",
      { class: "menu-row", role: "menuitem", tabindex: -1, href: track.shareUrl, target: "_blank", rel: "noopener" },
      el("span", {}, COPY.open),
      iconEl("open-external"),
    );
    const lyrics = item("pencil", COPY.editLyrics);
    const remove = item("trash", COPY.remove, { class: "menu-row is-danger" });
    const items: HTMLElement[] = [copy, open, lyrics, remove];
    const menuId = `menu-${track.id}`;
    const menu = el("div", { class: "menu", role: "menu", id: menuId, "aria-label": COPY.more }, ...items);
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", menuId);
    button.after(menu);
    // Opens upward when there is no room below.
    if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) menu.classList.add("is-up");
    items[0]!.focus();

    let pressing = false;
    const onPointerDown = (e: PointerEvent) => {
      const inside = e.target instanceof Node && (menu.contains(e.target) || button.contains(e.target));
      if (inside) pressing = true;
      else close(false);
    };
    const onPointerUp = () => (pressing = false);
    const close = (focusButton: boolean) => {
      if (closeMenu !== close) return;
      closeMenu = null;
      menu.remove();
      button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-controls");
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      if (focusButton && button.isConnected) button.focus();
    };
    closeMenu = close;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);

    menu.addEventListener("keydown", (e) => {
      const at = items.indexOf(document.activeElement as HTMLElement);
      const go = (i: number) => {
        e.preventDefault();
        items[(i + items.length) % items.length]!.focus();
      };
      switch (e.key) {
        case "ArrowDown": go(at + 1); break;
        case "ArrowUp": go(at - 1); break;
        case "Home": go(0); break;
        case "End": go(items.length - 1); break;
        case "Escape":
          e.preventDefault();
          close(true);
          break;
        case "Tab":
          close(true); // focus then moves on from the ⋯ button
          break;
        case " ":
          if (document.activeElement === open) {
            e.preventDefault();
            open.click();
          }
          break;
      }
    });
    // Focus leaving the menu (not into its button) closes it; a press inside is not leaving.
    menu.addEventListener("focusout", (e) => {
      if (pressing) return;
      const to = e.relatedTarget;
      if (!(to instanceof Node && (menu.contains(to) || button.contains(to)))) close(false);
    });

    copy.addEventListener("click", () => {
      close(true);
      void copyLink(track.shareUrl);
    });
    open.addEventListener("click", () => close(true));
    lyrics.addEventListener("click", async () => {
      close(true);
      const saved = await editLyrics(rows.get(track.id)?.track ?? track, COPY.editLyrics, () => focusNear(track.id));
      if (saved) hooks.changed(saved);
    });
    remove.addEventListener("click", async () => {
      close(true);
      const current = rows.get(track.id)?.track ?? track;
      if (!(await confirmDelete(current.title, () => focusNear(track.id)))) return;
      try {
        await deleteLyrics(current.id);
        hooks.changed({ ...current, lyrics: null, lyricsSource: "none", lyricsLang: null });
        toast(COPY.removed);
      } catch (err) {
        if (!hooks.signedOut(err)) toast(messageOf(err));
      }
    });
  }

  /** The ⋯ button of a track's row, or of its neighbour when that row is gone, or the heading. */
  function focusNear(id: string): HTMLElement {
    const own = rows.get(id)?.li.querySelector<HTMLElement>("[aria-haspopup]");
    return own ?? heading;
  }

  return {
    element: section,
    set(tracks) {
      closeMenu?.(false);
      // An upload can finish before the first list arrives: keep it, still highlighted.
      const added = [...rows.values()].filter((r) => r.li.hasAttribute("data-new")).map((r) => r.track);
      const addedIds = new Set(added.map((t) => t.id));
      const missing = added.filter((t) => !tracks.some((x) => x.id === t.id));
      rows.clear();
      list.replaceChildren(...[...missing, ...tracks].map((t) => row(t, addedIds.has(t.id))));
      syncEmpty();
    },
    add(track) {
      rows.get(track.id)?.li.remove();
      list.prepend(row(track, true));
      syncEmpty();
    },
    update(track) {
      const entry = rows.get(track.id);
      if (!entry) return;
      const hadFocus = entry.li.contains(document.activeElement);
      if (hadFocus || entry.li.querySelector(".menu")) closeMenu?.(false);
      entry.track = track;
      fill(entry.li, track);
      if (hadFocus) entry.li.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    },
    remove(id) {
      const entry = rows.get(id);
      if (!entry) return;
      const hadFocus = entry.li.contains(document.activeElement);
      const next = (entry.li.nextElementSibling ?? entry.li.previousElementSibling) as HTMLElement | null;
      if (entry.li.querySelector(".menu")) closeMenu?.(false);
      entry.li.remove();
      rows.delete(id);
      syncEmpty();
      if (hadFocus) (next?.querySelector<HTMLElement>("[aria-haspopup]") ?? heading).focus();
    },
  };
}
