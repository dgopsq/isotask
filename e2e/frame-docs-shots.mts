import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

/** Post-processes `pnpm shots:docs`' raw captures in place: rounded corners, accent edge, soft glow, transparent padding. */

const ACCENT = "#8a5cf5";
const RADIUS = 20;
const STROKE_WIDTH = 4;
// Neutral band inside the edge so the purple always downsamples against the same neighbour (mobile is pure black, desktop grey).
const BEZEL = "#121212";
const BEZEL_WIDTH = 4;
// Opaque, not ACCENT at partial alpha: a blended edge shifts with each capture's own edge color.
const EDGE = "#5e429e";
const GLOW_BLUR_SIGMA = 28;
const GLOW_OPACITY = 0.12;
const PADDING = 64;

const targets = [
	fileURLToPath(new URL("../docs/assets/feed.png", import.meta.url)),
	fileURLToPath(new URL("../docs/assets/calendar.png", import.meta.url)),
	fileURLToPath(new URL("../docs/assets/feed-mobile.png", import.meta.url)),
	fileURLToPath(new URL("../docs/assets/calendar-mobile.png", import.meta.url)),
];

function roundedRectSvg(width: number, height: number, fill: string, opacity: number): Buffer {
	return Buffer.from(`<svg width="${String(width)}" height="${String(height)}"><rect width="${String(width)}" height="${String(height)}" rx="${String(RADIUS)}" ry="${String(RADIUS)}" fill="${fill}" fill-opacity="${String(opacity)}"/></svg>`);
}

function strokeRectSvg(width: number, height: number): Buffer {
	const ring = (inset: number, color: string, strokeWidth: number, radius: number): string =>
		`<rect x="${String(inset)}" y="${String(inset)}" width="${String(width - inset * 2)}" height="${String(height - inset * 2)}" rx="${String(radius)}" ry="${String(radius)}" fill="none" stroke="${color}" stroke-width="${String(strokeWidth)}"/>`;
	const bezelInset = STROKE_WIDTH + BEZEL_WIDTH / 2;
	return Buffer.from(
		`<svg width="${String(width)}" height="${String(height)}">${ring(bezelInset, BEZEL, BEZEL_WIDTH, RADIUS - STROKE_WIDTH)}${ring(STROKE_WIDTH / 2, EDGE, STROKE_WIDTH, RADIUS)}</svg>`,
	);
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
