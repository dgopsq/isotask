import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

/** Post-processes `pnpm shots:docs`' raw captures in place: rounded corners, accent edge, soft glow, transparent padding. */

const ACCENT = "#8a5cf5";
const RADIUS = 20;
const STROKE_WIDTH = 2;
const STROKE_OPACITY = 0.55;
const GLOW_BLUR_SIGMA = 40;
const GLOW_OPACITY = 0.22;
const PADDING = 64;

const targets = [
	fileURLToPath(new URL("../docs/assets/feed.png", import.meta.url)),
	fileURLToPath(new URL("../docs/assets/calendar.png", import.meta.url)),
];

function roundedRectSvg(width: number, height: number, fill: string, opacity: number): Buffer {
	return Buffer.from(`<svg width="${String(width)}" height="${String(height)}"><rect width="${String(width)}" height="${String(height)}" rx="${String(RADIUS)}" ry="${String(RADIUS)}" fill="${fill}" fill-opacity="${String(opacity)}"/></svg>`);
}

function strokeRectSvg(width: number, height: number): Buffer {
	const inset = STROKE_WIDTH / 2;
	const w = width - STROKE_WIDTH;
	const h = height - STROKE_WIDTH;
	return Buffer.from(`<svg width="${String(width)}" height="${String(height)}"><rect x="${String(inset)}" y="${String(inset)}" width="${String(w)}" height="${String(h)}" rx="${String(RADIUS)}" ry="${String(RADIUS)}" fill="none" stroke="${ACCENT}" stroke-opacity="${String(STROKE_OPACITY)}" stroke-width="${String(STROKE_WIDTH)}"/></svg>`);
}

// A re-run would frame an already-framed (padded, transparent-cornered) image; the corner alpha is the tell.
async function assertNotAlreadyFramed(input: Buffer, path: string): Promise<void> {
	const { data } = await sharp(input).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
	const alpha = data[3];
	if (alpha !== undefined && alpha < 255) {
		throw new Error(`${path}: top-left pixel is already transparent, looks framed already — refusing to double-frame`);
	}
}

async function frame(path: string): Promise<void> {
	const input = await readFile(path);
	await assertNotAlreadyFramed(input, path);

	const { width, height } = await sharp(input).metadata();
	if (width === undefined || height === undefined) {
		throw new Error(`${path}: could not read image dimensions`);
	}

	const outWidth = width + PADDING * 2;
	const outHeight = height + PADDING * 2;
	const transparentCanvas = { create: { width: outWidth, height: outHeight, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 0 } } };

	// Blur on the full padded canvas, not the image-sized rect, so the glow tail isn't clipped at the image edge.
	const glowSource = await sharp(transparentCanvas)
		.composite([{ input: roundedRectSvg(width, height, ACCENT, GLOW_OPACITY), left: PADDING, top: PADDING }])
		.png()
		.toBuffer();
	const glow = await sharp(glowSource).blur(GLOW_BLUR_SIGMA).toBuffer();

	const clippedImage = await sharp(input)
		.ensureAlpha()
		.composite([{ input: roundedRectSvg(width, height, "#ffffff", 1), blend: "dest-in" }])
		.png()
		.toBuffer();

	const framed = await sharp(transparentCanvas)
		.composite([
			{ input: glow, left: 0, top: 0 },
			{ input: clippedImage, left: PADDING, top: PADDING },
			{ input: strokeRectSvg(width, height), left: PADDING, top: PADDING },
		])
		.png()
		.toBuffer();

	await writeFile(path, framed);
	console.log(`[frame-docs-shots] framed ${path} -> ${String(outWidth)}x${String(outHeight)}`);
}

async function main(): Promise<void> {
	for (const path of targets) {
		await frame(path);
	}
}

await main();
