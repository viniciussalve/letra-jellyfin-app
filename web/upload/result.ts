import { UNKNOWN_ARTIST } from "../../shared/copy.ts";
import type { TrackDTO } from "../../shared/types.ts";
import { saveLyricsFile, searchLyrics, updateTrack } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { lyricsState } from "../shared/lyrics-state.ts";
import { copyText, editLyrics, messageOf, toast, type Hooks } from "./dialogs.ts";

const COPY = {
  edit: "Editar",
  title: "Título",
  artist: "Artista",
  save: "Salvar",
  cancel: "Cancelar",
  saved: "Informações salvas",
  badge: { synced: "Letra sincronizada", unsynced: "Letra sem sincronia", instrumental: "Instrumental" },
  missing: "Não achamos a letra.",
  paste: "Colar letra",
  sendLrc: "Enviar .lrc",
  searchAgain: "Buscar de novo",
  searching: "Procurando a letra…",
  nothingNew: "Nenhuma letra nova encontrada",
  lyricsSaved: "Letra salva",
  link: "Link",
  copy: "Copiar link",
  copied: "Link copiado",
  open: "Abrir",
};

const COPIED_MS = 2000;

export type Result = {
  element: HTMLElement;
  /** Shows a just-uploaded track; `focus` moves keyboard focus to its title. */
  show(track: TrackDTO, focus: boolean): void;
  /** A track changed elsewhere (list, dialogs): redraw if it is the one shown. */
  update(track: TrackDTO): void;
  /** A track was deleted: hide the result if it is the one shown. */
  removed(id: string): void;
};

/** A small cover (img, or a music-note tile when the track has none). */
export function coverEl(track: TrackDTO, className: string): HTMLElement {
  return el(
    "span",
    { class: `cover ${className}`, "data-cover": true },
    track.hasCover
      ? el("img", { src: `/media/${encodeURIComponent(track.id)}/cover.jpg`, alt: "", decoding: "async", loading: "lazy" })
      : el("span", { class: "cover-tile" }, iconEl("music-note")),
  );
}

/**
 * The result panel after an upload: cover, title and artist with "Editar", the lyrics
 * status (a badge, or "Não achamos a letra." with ways to add them), and the link.
 */
export function createResult(hooks: Hooks): Result {
  const section = el("section", { class: "panel result", "aria-labelledby": "result-title", "data-result": true, hidden: true });
  let track: TrackDTO | null = null;
  let editing = false;
  let cover: { id: string; node: HTMLElement } | null = null;

  // --- pieces ---

  const title = () => el("h2", { class: "result-title", id: "result-title", tabindex: -1 }, track!.title);

  function badge(): HTMLElement | null {
    const state = lyricsState(track!);
    return state === "none" ? null : el("p", { class: "badge", "data-lyrics-badge": true }, COPY.badge[state]);
  }

  function editForm(values: { title: string; artist: string }): HTMLFormElement {
    const field = (label: string, name: string, value: string) => {
      const input = el("input", { class: "field", type: "text", name, autocomplete: "off", maxlength: 200 });
      input.value = value;
      return el("label", { class: "field-label" }, el("span", {}, label), input);
    };
    const error = el("p", { class: "error", role: "alert", hidden: true });
    const cancel = el("button", { type: "button", class: "glass-pill" }, COPY.cancel);
    const save = el("button", { type: "submit", class: "white-pill" }, COPY.save);
    const form = el(
      "form",
      { class: "edit-form", "data-edit-form": true },
      el("div", { class: "edit-fields" }, field(COPY.title, "title", values.title), field(COPY.artist, "artist", values.artist)),
      error,
      el("div", { class: "pill-row end" }, cancel, save),
    );
    cancel.addEventListener("click", () => {
      editing = false;
      render("edit");
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      save.disabled = true;
      try {
        const updated = await updateTrack(track!.id, { title: String(data.get("title")), artist: String(data.get("artist")) });
        editing = false;
        hooks.changed(updated); // redraws through update()
        toast(COPY.saved);
        section.querySelector<HTMLElement>("[data-edit]")?.focus();
      } catch (err) {
        if (hooks.signedOut(err)) return;
        error.textContent = messageOf(err);
        error.hidden = false;
      } finally {
        save.disabled = false;
      }
    });
    return form;
  }

  function missingLyrics(): HTMLElement {
    const paste = el("button", { type: "button", class: "glass-pill" }, COPY.paste);
    const send = el("button", { type: "button", class: "glass-pill" }, COPY.sendLrc);
    const again = el("button", { type: "button", class: "glass-pill" }, COPY.searchAgain);
    const lrcInput = el("input", { type: "file", accept: ".lrc,.txt,text/plain", hidden: true, "data-lrc-input": true });

    paste.addEventListener("click", async () => {
      const saved = await editLyrics(track!, COPY.paste, () => section.querySelector<HTMLElement>("#result-title"));
      if (saved) hooks.changed(saved);
    });
    send.addEventListener("click", () => lrcInput.click());
    lrcInput.addEventListener("change", async () => {
      const file = lrcInput.files?.[0];
      lrcInput.value = "";
      if (!file) return;
      try {
        const saved = await saveLyricsFile(track!.id, file);
        hooks.changed(saved);
        toast(COPY.lyricsSaved);
      } catch (err) {
        if (!hooks.signedOut(err)) toast(messageOf(err));
      }
    });
    again.addEventListener("click", async () => {
      const before = track!;
      again.disabled = true;
      again.textContent = COPY.searching;
      try {
        const after = await searchLyrics(before.id);
        if (JSON.stringify(after.lyrics) === JSON.stringify(before.lyrics)) toast(COPY.nothingNew);
        else hooks.changed(after);
      } catch (err) {
        if (!hooks.signedOut(err)) toast(messageOf(err));
      } finally {
        again.disabled = false;
        again.textContent = COPY.searchAgain;
      }
    });

    return el("div", { class: "result-missing" }, el("p", { class: "missing-text" }, COPY.missing), el("div", { class: "pill-row" }, paste, send, again, lrcInput));
  }

  function linkBlock(): HTMLElement {
    const field = el("input", { class: "field link-field", type: "text", readonly: true, "aria-label": COPY.link });
    field.value = track!.shareUrl;
    field.addEventListener("focus", () => field.select());
    const label = el("span", { "aria-live": "polite" }, COPY.copy);
    const copy = el("button", { type: "button", class: "white-pill", "data-copy": true }, label);
    let timer = 0;
    copy.addEventListener("click", async () => {
      if (!(await copyText(field.value))) {
        field.focus(); // clipboard blocked: the link is selected for copying by hand
        return;
      }
      label.textContent = COPY.copied;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (label.textContent = COPY.copy), COPIED_MS);
    });
    const open = el("a", { class: "glass-pill", href: track!.shareUrl, target: "_blank", rel: "noopener" }, COPY.open);
    return el("div", { class: "link-block" }, field, el("div", { class: "pill-row" }, copy, open));
  }

  // --- drawing ---

  /** Redraws the panel. Focus that was inside and got removed goes to `focusAfter` (or the title). */
  function render(focusAfter: "title" | "edit" | "field" | null = null): void {
    if (!track) return;
    const hadFocus = section.contains(document.activeElement);
    // Unsaved typing survives a redraw of the same track only; a different track's form
    // starts from that track's own title and artist.
    const sameTrack = section.dataset.id === track.id;
    const typed = editing && sameTrack ? section.querySelector<HTMLFormElement>("[data-edit-form]") : null;
    const values = typed
      ? { title: String(new FormData(typed).get("title")), artist: String(new FormData(typed).get("artist")) }
      : { title: track.title, artist: track.artist };

    if (cover?.id !== track.id) cover = { id: track.id, node: coverEl(track, "result-cover") };
    const edit = el("button", { type: "button", class: "glass-pill small", "data-edit": true, hidden: editing }, COPY.edit);
    edit.addEventListener("click", () => {
      editing = true;
      render("field");
    });
    const meta = el("div", { class: "result-meta" }, title(), el("p", { class: "result-artist" }, track.artist), badge(), edit);

    section.dataset.id = track.id;
    const parts = [
      el("div", { class: "result-head" }, cover.node, meta),
      editing ? editForm(values) : null,
      lyricsState(track) === "none" ? missingLyrics() : null,
      linkBlock(),
    ];
    section.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));

    const lost = hadFocus && !section.contains(document.activeElement);
    const target =
      focusAfter === "field" ? section.querySelector<HTMLElement>("[data-edit-form] input")
      : focusAfter === "edit" ? edit
      : focusAfter === "title" || lost ? section.querySelector<HTMLElement>("#result-title")
      : null;
    target?.focus();
  }

  return {
    element: section,
    show(next, focus) {
      track = next;
      // No tags: the title and artist came from the file name, so offer them for editing.
      editing = next.artist === UNKNOWN_ARTIST;
      section.hidden = false;
      render(focus ? "title" : null);
    },
    update(next) {
      if (track?.id !== next.id) return;
      track = next;
      render();
    },
    removed(id) {
      if (track?.id !== id) return;
      track = null;
      editing = false;
      section.hidden = true;
      section.replaceChildren();
    },
  };
}
