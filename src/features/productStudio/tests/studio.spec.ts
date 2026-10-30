// Product Studio's page without a finished generation (the `features` project, Comfy at a dead
// port): how it is reached, what the form asks for before anything is sent, and what an upload
// that is not an image is told.
import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";

test("the studio is a live tool on the home page and in the Image menu", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByRole("link", { name: /Product Studio/ }).first()).toHaveAttribute(
    "href",
    "/product-studio",
  );

  await open(page, "/product-studio");
  await expect(page.getByRole("heading", { level: 1, name: "Product Studio" })).toBeVisible();
  await expect(page.getByText("Your shots appear here")).toBeVisible();
  await expect(page.getByRole("banner").getByText(/\d+ renders?$/)).toBeVisible();
});

test("Generate asks for a photo, what it is and a shot before sending anything", async ({
  page,
}) => {
  let posted = false;

  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/product-shots")) {
      posted = true;
    }
  });

  await open(page, "/product-studio");
  await page.getByRole("checkbox", { name: /^Packshot/ }).uncheck();
  await expect(page.getByRole("button", { name: "Generate shots" })).toBeVisible();
  await page.getByRole("button", { name: "Generate shots" }).click();

  await expect(page.getByText("Upload a product photo first.")).toBeVisible();
  await expect(page.getByText("Say in a few words what the product is.")).toBeVisible();
  await expect(page.getByText("Pick at least one shot.")).toBeVisible();

  await page.getByRole("checkbox", { name: /^Lifestyle/ }).check();
  await page.getByRole("checkbox", { name: /^Advertising/ }).check();
  await expect(page.getByRole("button", { name: "Generate 2 shots" })).toBeVisible();
  expect(posted).toBe(false);
});

test("an upload that is not an image is refused with the server's reason", async ({ page }) => {
  await open(page, "/product-studio");
  await page.getByLabel("Product photo").setInputFiles({
    buffer: Buffer.from("not an image"),
    mimeType: "image/png",
    name: "product.png",
  });

  await expect(page.getByRole("alert")).toContainText("Upload a PNG, JPEG or WebP image.");
  await expect(page.getByRole("img", { name: "The uploaded product photo" })).toHaveCount(0);
});
