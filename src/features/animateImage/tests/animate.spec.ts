// `/animate` against the server whose Comfy is a dead port (the `features` Playwright project):
// what needs no finished render. The navigation reaches it, `?character=` preselects a library
// character, malformed search members are dropped, and an upload that is no image is refused.
import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import { characterListSchema } from "../../characters/index.ts";
import { animateImageHref } from "../index.ts";

test("the main navigation's Video › Animate image opens the page", async ({ page }) => {
  await open(page, "/");

  const navigation = page.getByRole("navigation", { name: "Main" });

  await navigation.getByRole("button", { exact: true, name: "Video" }).click();
  await page.getByRole("menuitem", { name: /Animate image/ }).click();
  await expect(page).toHaveURL(/\/animate$/);
  await expect(page.getByRole("heading", { level: 1, name: "Animate an image" })).toBeVisible();
});

test("?character= preselects a library character, and malformed members are dropped", async ({
  page,
}) => {
  const library = characterListSchema.parse(
    await (await page.request.get("/api/characters")).json(),
  );

  const maya = library.characters.find(({ title }) => title === "Maya");

  expect(maya).toBeDefined();

  await open(page, animateImageHref({ characterId: maya?.id ?? "" }));
  await expect(page.getByRole("img", { name: "Image to animate: Maya" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Animate Maya" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A 768×1344 sample renders at 480×848.
  await expect(page.getByText("480×848, 5.1 s at 16 fps, MP4.")).toBeVisible();

  await open(page, "/animate?generation=not-a-uuid&output=Bad%20Name&take=nope");
  await expect(page.getByText("No image picked yet")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your animation" })).toHaveCount(0);
});

test("an upload that is not an image is refused and nothing is picked", async ({ page }) => {
  await open(page, "/animate");
  await page.getByLabel("Image to animate").setInputFiles("tests/fixtures/fake-output.txt");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("No image picked yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Animate", exact: true })).toBeDisabled();
});
