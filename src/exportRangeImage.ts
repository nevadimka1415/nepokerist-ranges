import { toJpeg, toPng } from "html-to-image";

export async function exportElementAsImage(
  element: HTMLElement,
  filenameWithoutExt: string,
  format: "png" | "jpeg"
): Promise<void> {
  const pixelRatio = Math.max(2, window.devicePixelRatio || 1);

  const dataUrl =
    format === "png"
      ? await toPng(element, { cacheBust: true, pixelRatio })
      : await toJpeg(element, { cacheBust: true, pixelRatio, quality: 0.95 });

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${filenameWithoutExt}.${format === "jpeg" ? "jpg" : "png"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}