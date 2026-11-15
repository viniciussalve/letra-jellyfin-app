import { expect, test } from "./helpers.ts";

test("the self-check page plays encrypted audio through its service worker and seeks", async ({ page }) => {
  await page.goto("/teste");
  await expect(page).toHaveURL(/\/teste\/$/);
  await page.getByRole("button", { name: "Preparar" }).click();
  await expect(page.locator("#o-audio")).toContainText("Agora dê play", { timeout: 30_000 });
  await page.locator("#audio").evaluate((a: HTMLAudioElement) => { a.muted = true; return a.play(); });
  await expect(page.locator("#o-audio")).toContainText("Começou a tocar");
  await page.getByRole("button", { name: "Pular para 2:00" }).click();
  await expect(page.locator("#o-audio")).toContainText("Pulou para 120 s");
  await expect.poll(() => page.locator("#audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(120);
  expect(await page.locator("#audio").evaluate((a: HTMLAudioElement) => a.error)).toBeNull();
});

test("the self-check page gets the same secret twice from a passkey with PRF", async ({ page, context, baseURL }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  // WebAuthn refuses an IP address as the site's identity, so this test uses the host name.
  await page.goto(new URL("/teste/", baseURL).href.replace("127.0.0.1", "localhost"));
  await page.getByRole("button", { name: "Ativar digital" }).click();
  await expect(page.locator("#o-passkey")).toContainText("Chave criada");
  await page.getByRole("button", { name: "Entrar com a digital" }).click();
  await expect(page.locator("#o-passkey")).toContainText("o mesmo segredo nas duas vezes");
});

test("the self-check page measures key derivation", async ({ page }) => {
  await page.goto("/teste/");
  await page.getByRole("button", { name: "Medir" }).click();
  await expect(page.locator("#o-derive")).toContainText(/Pronto em \d+ ms/, { timeout: 30_000 });
});
