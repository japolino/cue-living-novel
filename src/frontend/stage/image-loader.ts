export interface VnLoadableImage {
  src: string;
  decoding?: string;
  complete: boolean;
  naturalWidth: number;
  addEventListener(
    type: "load" | "error",
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(type: "load" | "error", listener: EventListener): void;
  decode?: () => Promise<void>;
}

export type VnImageFactory = () => VnLoadableImage;

const waitForImageLoad = (image: VnLoadableImage): Promise<void> => {
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error("The scene image could not be loaded."));
  }

  return new Promise((resolve, reject) => {
    const onLoad: EventListener = () => {
      cleanup();
      resolve();
    };
    const onError: EventListener = () => {
      cleanup();
      reject(new Error("The scene image could not be loaded."));
    };
    const cleanup = () => {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };

    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
  });
};

/** Loads and decodes an image before the visible scene points at its URL. */
export const preloadAndDecodeVnImage = async (
  url: string,
  createImage: VnImageFactory = () => new Image(),
): Promise<void> => {
  if (!url.trim()) throw new Error("A scene image URL is required.");

  const image = createImage();
  image.decoding = "async";
  image.src = url;
  await waitForImageLoad(image);
  await image.decode?.();
};

