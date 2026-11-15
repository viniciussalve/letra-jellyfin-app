export type ShareTarget = { title: string; artist: string; shareUrl: string };

export function shareText(t: ShareTarget): string {
  return `${t.title} — ${t.artist}`;
}

export function whatsappUrl(t: ShareTarget): string {
  return "https://wa.me/?text=" + encodeURIComponent(shareText(t) + "\n" + t.shareUrl);
}

export function xUrl(t: ShareTarget): string {
  return (
    "https://x.com/intent/tweet?text=" +
    encodeURIComponent(shareText(t)) +
    "&url=" +
    encodeURIComponent(t.shareUrl)
  );
}
