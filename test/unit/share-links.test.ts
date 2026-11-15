import { expect, test } from "vitest";
import { shareText, whatsappUrl, xUrl } from "../../web/player/share-links.ts";

const t = { title: 'Ação & "Reação"', artist: "Zé", shareUrl: "https://x.y/t/AbC123defG" };

test("share text joins title and artist", () => {
  expect(shareText(t)).toBe('Ação & "Reação" — Zé');
});

test("whatsapp text round-trips", () => {
  const u = whatsappUrl(t);
  expect(u.startsWith("https://wa.me/?text=")).toBe(true);
  const text = new URL(u).searchParams.get("text");
  expect(text).toBe('Ação & "Reação" — Zé\nhttps://x.y/t/AbC123defG');
  expect(decodeURIComponent(u.slice("https://wa.me/?text=".length))).toBe(text);
});

test("x intent carries text and url exactly", () => {
  const u = new URL(xUrl(t));
  expect(u.origin + u.pathname).toBe("https://x.com/intent/tweet");
  expect(u.searchParams.get("text")).toBe('Ação & "Reação" — Zé');
  expect(u.searchParams.get("url")).toBe(t.shareUrl);
});

test("a newline in a title survives", () => {
  const n = { ...t, title: "a\nb" };
  expect(new URL(xUrl(n)).searchParams.get("text")).toBe("a\nb — Zé");
  expect(new URL(whatsappUrl(n)).searchParams.get("text")).toBe("a\nb — Zé\nhttps://x.y/t/AbC123defG");
});
