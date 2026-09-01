import assert from "node:assert/strict";
import test from "node:test";

import {
  preloadAndDecodeVnImage,
  type VnLoadableImage,
} from "./image-loader";

class FakeImage implements VnLoadableImage {
  src = "";
  decoding = "";
  complete = true;
  naturalWidth = 100;
  decodeCalls = 0;

  addEventListener(): void {}
  removeEventListener(): void {}

  async decode(): Promise<void> {
    this.decodeCalls += 1;
  }
}

test("scene images decode before the preload promise resolves", async () => {
  const image = new FakeImage();
  await preloadAndDecodeVnImage("scene.webp", () => image);

  assert.equal(image.src, "scene.webp");
  assert.equal(image.decoding, "async");
  assert.equal(image.decodeCalls, 1);
});

test("a failed cached image is rejected", async () => {
  const image = new FakeImage();
  image.naturalWidth = 0;

  await assert.rejects(
    preloadAndDecodeVnImage("broken.webp", () => image),
    /could not be loaded/,
  );
});

