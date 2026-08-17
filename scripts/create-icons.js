import fs from "fs";
import path from "path";

const ICON_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AARQEA3x9xVQAAAABJRU5ErkJggg==";
const buffer = Buffer.from(ICON_BASE64, "base64");
const dir = path.resolve("icons");
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), buffer);
}
console.log("Created placeholder icons at icons/icon16.png, icon48.png, icon128.png");
