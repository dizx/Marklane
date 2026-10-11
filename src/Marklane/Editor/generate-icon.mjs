// Regenerate the multi-resolution Windows icons from the editable SVGs.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const name of ["Marklane", "MarklaneDocument"]) {
    const svg = await readFile(new URL(`../Assets/${name}.svg`, import.meta.url), "utf8");
    const images = [];
    for (const size of sizes) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${svg}`);
      images.push(await page.screenshot({ omitBackground: true }));
    }

    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); // ICO image type
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    for (let index = 0; index < sizes.length; index++) {
      const entry = 6 + index * 16;
      header[entry] = sizes[index] % 256;
      header[entry + 1] = sizes[index] % 256;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(images[index].length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += images[index].length;
    }
    await writeFile(new URL(`../Assets/${name}.ico`, import.meta.url), Buffer.concat([header, ...images]));
    console.log(`Generated ${name}.ico (${sizes.join(", ")} px).`);
  }
} finally {
  await browser.close();
}
