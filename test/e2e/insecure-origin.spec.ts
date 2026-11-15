import { expect, PASSWORD, test, USERNAME } from "./helpers.ts";

// This project's server has an https:// PUBLIC_URL, so it marks the session cookie
// Secure. The page is opened over plain http on a host name that is not loopback
// (mapped to 127.0.0.1 in playwright.config.ts), where the browser drops a Secure
// cookie: the password is right, yet the session never sticks.
test.use({ locale: "pt-BR" });

test("a session the browser did not keep is explained on the sign-in", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-sign-in]").click();
  await page.getByLabel("Usuário").fill(USERNAME);
  const password = page.getByLabel("Senha");
  await password.fill(PASSWORD);
  await password.press("Enter");

  const alert = page.locator("dialog[data-sign-in-dialog]").getByRole("alert");
  await expect(alert).toHaveText("O navegador não guardou a sessão. Abra o app pelo endereço definido em PUBLIC_URL.");
  await expect(alert).toHaveCSS("color", "rgb(255, 69, 58)"); // --danger
  await expect(page.locator("dialog[data-sign-in-dialog]").getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page.locator("[data-drop]")).toHaveCount(0);
  expect(await page.context().cookies()).toEqual([]);
});
