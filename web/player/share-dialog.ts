import type { TrackDTO } from "../../shared/types.ts";
import { openDialog } from "../shared/dialog.ts";
import { el, iconEl } from "../shared/dom.ts";
import type { IconName } from "../shared/icons.ts";
import { copyLink, copyText, mountToast, toast } from "../shared/toast.ts";
import type { LyricsView } from "./lyrics-view.ts";
import { qrCenterBox, qrSvg } from "./qr.ts";
import { shareText, whatsappUrl, xUrl } from "./share-links.ts";
import { makeStoryCard, type StoryData } from "./story-card.ts";

const COPY = {
  close: "Fechar",
  whatsapp: "WhatsApp",
  stories: "Stories",
  x: "X",
  copy: "Copiar link",
  more: "Mais…",
  qr: "QR code do link da música",
  shared: "Link copiado. Adicione o adesivo de link no Instagram.",
  saved: "Imagem salva. Poste nos Stories pelo celular.",
  cardFailed: "Não deu para gerar a imagem. Tente de novo.",
};

/** The QR as spec §5 draws it: 240 px, a 22% center box with a 6 px white margin. */
const QR = { size: 240, centerFraction: 0.22, centerMarginPx: 6 };
/** The Stories toasts are sentences: they stay longer than "Link copiado". */
const LONG_TOAST_MS = 4000;
/** Long enough for the browser to have read the blob into the download. */
const REVOKE_AFTER_MS = 60_000;

const isAbort = (err: unknown) => (err as Error | null)?.name === "AbortError";

function actionContent(name: IconName, label: string): HTMLElement[] {
  return [el("span", { class: "share-action-icon" }, iconEl(name)), el("span", { class: "share-action-label" }, label)];
}

function actionLink(action: string, name: IconName, label: string, href: string): HTMLAnchorElement {
  return el("a", { class: "share-action", href, target: "_blank", rel: "noopener", "data-share-action": action }, ...actionContent(name, label));
}

function actionButton(action: string, name: IconName, label: string): HTMLButtonElement {
  return el("button", { type: "button", class: "share-action", "data-share-action": action }, ...actionContent(name, label));
}

/** The white square with the dotted QR, and the cover (or a note tile) over its cleared center. */
function qrBlock(track: TrackDTO, coverUrl: string | null): HTMLDivElement {
  const code = el("div", { class: "share-qr-code" });
  code.innerHTML = qrSvg(track.shareUrl, QR); // our own markup: the URL is in the modules, never in text
  code.querySelector("svg")?.setAttribute("aria-label", COPY.qr);

  const box = qrCenterBox(QR.size, QR.centerFraction, QR.centerMarginPx);
  const center = coverUrl
    ? el("img", { class: "share-qr-center", src: coverUrl, alt: "", decoding: "async" })
    : el("span", { class: "share-qr-center share-qr-tile", "data-share-qr-tile": true }, iconEl("music-note"));
  const pct = (v: number) => `${(v / QR.size) * 100}%`;
  center.style.left = center.style.top = pct(box.x + QR.centerMarginPx);
  center.style.width = center.style.height = pct(box.width - 2 * QR.centerMarginPx);
  code.append(center);
  return el("div", { class: "share-qr", "data-share-qr": true }, code);
}

/**
 * The share button opens a modal dialog (spec §5): title and artist, the QR code, and
 * WhatsApp, Stories, X, "Copiar link" and, where Web Share exists, "Mais…".
 *
 * The Stories card is drawn at every open, for the verse active then: iOS opens the share
 * sheet only inside the tap that asked for it, so the file must be ready before the tap
 * and the tap must reach navigator.share() without awaiting anything.
 */
export function mountShareDialog(button: HTMLButtonElement, track: TrackDTO, view: Pick<LyricsView, "current">): void {
  const toastNode = mountToast(); // in the page early, so it is an existing live region when filled
  const target = { title: track.title, artist: track.artist, shareUrl: track.shareUrl };
  const fileName = `letra-${track.id}.png`;
  const coverUrl = track.hasCover ? `/media/${encodeURIComponent(track.id)}/cover.jpg` : null;
  const titleId = "share-title";
  const artistId = "share-artist";

  const close = el("button", { type: "button", class: "share-close", "aria-label": COPY.close, "data-share-close": true }, iconEl("x-circle"));
  const stories = actionButton("stories", "instagram-logo", COPY.stories);
  const copy = actionButton("copy", "link", COPY.copy);
  const more = typeof navigator.share === "function" ? actionButton("more", "dots-three", COPY.more) : null;
  const dialog = el(
    "dialog",
    { class: "share-dialog", "data-share-dialog": true, "aria-labelledby": titleId, "aria-describedby": artistId },
    el(
      "div",
      { class: "share-body" },
      el(
        "header",
        { class: "share-head" },
        close,
        el(
          "div",
          { class: "share-heading" },
          el("h2", { class: "share-title", id: titleId }, track.title),
          el("p", { class: "share-artist", id: artistId }, track.artist),
        ),
      ),
      qrBlock(track, coverUrl),
      el(
        "div",
        { class: "share-actions" },
        actionLink("whatsapp", "whatsapp-logo", COPY.whatsapp, whatsappUrl(target)),
        stories,
        actionLink("x", "x-logo", COPY.x, xUrl(target)),
        copy,
        more,
      ),
    ),
  );
  button.setAttribute("aria-haspopup", "dialog");

  // --- the Stories card -------------------------------------------------------------
  // aria-disabled rather than disabled, so a focused button keeps focus while it rebuilds.
  let storyData: StoryData | null = null; // what this open's card shows
  let card: File | null = null;
  let failed = false;
  let build = 0; // bumped by every build and by closing: only the latest build of an open dialog lands

  const setBusy = (busy: boolean) => {
    if (busy) {
      stories.setAttribute("aria-busy", "true");
      stories.setAttribute("aria-disabled", "true");
    } else {
      stories.removeAttribute("aria-busy");
      stories.removeAttribute("aria-disabled");
    }
  };

  const buildCard = (data: StoryData) => {
    const id = ++build;
    card = null;
    failed = false;
    setBusy(true);
    makeStoryCard(data, fileName).then(
      (file) => {
        if (id !== build) return;
        card = file;
        setBusy(false);
      },
      () => {
        if (id !== build) return;
        failed = true;
        setBusy(false);
      },
    );
  };

  const download = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = el("a", { href: url, download: file.name, hidden: true });
    dialog.append(a); // inside the modal: the rest of the page is inert
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    toast(COPY.saved, LONG_TOAST_MS);
  };

  // One share sheet at a time: a second tap meanwhile would be refused (InvalidStateError).
  let sharing = false;
  const share = (data: ShareData, refused: () => void, done?: () => void) => {
    sharing = true;
    navigator
      .share(data)
      .then(done, (err: unknown) => {
        if (!isAbort(err)) refused(); // a dismissed sheet shows nothing
      })
      .finally(() => {
        sharing = false;
      });
  };

  // Everything up to navigator.share() runs synchronously inside the click.
  const shareCard = (file: File) => {
    if (sharing) return;
    void copyText(track.shareUrl); // not awaited: an await would move share() out of the tap
    if (navigator.canShare?.({ files: [file] })) {
      share({ files: [file] }, () => download(file), () => toast(COPY.shared, LONG_TOAST_MS));
      return;
    }
    download(file);
  };

  stories.addEventListener("click", () => {
    if (card) shareCard(card);
    else if (failed && storyData) {
      toast(COPY.cardFailed, LONG_TOAST_MS);
      buildCard(storyData); // retry, for the verse of this open
    }
  });

  // --- the other actions ----------------------------------------------------------
  copy.addEventListener("click", () => void copyLink(track.shareUrl));
  more?.addEventListener("click", () => {
    if (!sharing) share({ title: track.title, text: shareText(target), url: track.shareUrl }, () => void copyLink(track.shareUrl));
  });

  // --- opening and closing -------------------------------------------------------------
  close.addEventListener("click", () => dialog.close());
  // A click on the backdrop (the dialog box itself, outside its padded body) closes it.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  button.addEventListener("click", () => {
    if (dialog.open) return;
    const { verse, translation } = view.current();
    storyData = { title: track.title, artist: track.artist, palette: track.palette, coverUrl, verse, translation };
    buildCard(storyData);
    // While the modal is open the page under it is inert, so toasts are shown from inside it.
    dialog.append(toastNode);
    void openDialog(dialog, close, () => button).then(() => {
      build++; // a build still running belongs to a closed dialog
      document.body.append(toastNode);
    });
  });
}
