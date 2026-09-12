import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

/** Composes the two landing-page hero images from the four framed docs screenshots. */

const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1350;

const ACCENT = "#8a5cf5";
const BG_FROM = "#0c0b14";
const BG_TO = "#17102b";

const GLOW_CX = 1150;
const GLOW_CY = 700;
const GLOW_RADIUS = 1100;
const GLOW_OPACITY = 0.6;
const GLOW_BLUR_SIGMA = 120;

const DOT_SPACING = 48;
const DOT_RADIUS = 1;
const DOT_OPACITY = 0.09;

const FONT_STACK = "Inter, -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const HEADLINE_X = 120;
const HEADLINE_Y = 250;
const HEADLINE_SIZE = 150;
const HEADLINE_WEIGHT = 700;
const HEADLINE_LETTER_SPACING = -4;

const DESKTOP_WIDTH = 1900;
const DESKTOP_LEFT = 140;
const DESKTOP_TOP = 360;

const MOBILE_WIDTH = 480;
const MOBILE_LEFT = 1840;
const MOBILE_TOP = 540;

// Matches PADDING in frame-docs-shots.mts: the transparent margin around each framed body.
const FRAME_PADDING = 64;
const SHADOW_RADIUS = 36;
const SHADOW_OPACITY = 0.55;
const SHADOW_OFFSET_X = 0;
const SHADOW_OFFSET_Y = 30;
const SHADOW_BLUR_SIGMA = 40;

// Plain object instead of sharp's own OverlayOptions: the default import doesn't carry sharp's
// namespace types under this project's module settings, and this shape is all composite() needs.
interface ComposeEntry {
	readonly input: Buffer;
	readonly left: number;
	readonly top: number;
}

interface Hero {
	readonly word: string;
	readonly desktopSource: string;
	readonly mobileSource: string;
	readonly outputName: string;
}

const heroes: readonly Hero[] = [
	{ word: "Feed", desktopSource: "feed.png", mobileSource: "feed-mobile.png", outputName: "hero-feed.png" },
	{ word: "Calendar", desktopSource: "calendar.png", mobileSource: "calendar-mobile.png", outputName: "hero-calendar.png" },
];

function assetPath(name: string): string {
	return fileURLToPath(new URL(`../docs/assets/${name}`, import.meta.url));
}

// The hero composes framed captures (rounded, padded, transparent-cornered); an unframed input would blow up the layout math below.
async function assertFramed(input: Buffer, path: string): Promise<void> {
	const { data } = await sharp(input).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
	const alpha = data[3];
	if (alpha === undefined || alpha === 255) {
		throw new Error(`${path}: top-left pixel is opaque, doesn't look framed yet — run frame-docs-shots.mts first`);
	}
}

function backgroundGradientSvg(width: number, height: number): Buffer {
	return Buffer.from(
		`<svg width="${String(width)}" height="${String(height)}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${BG_FROM}"/><stop offset="100%" stop-color="${BG_TO}"/></linearGradient></defs><rect width="${String(width)}" height="${String(height)}" fill="url(#bg)"/></svg>`,
	);
}

function glowSvg(width: number, height: number): Buffer {
	return Buffer.from(
		`<svg width="${String(width)}" height="${String(height)}"><defs><radialGradient id="glow" cx="${String(GLOW_CX)}" cy="${String(GLOW_CY)}" r="${String(GLOW_RADIUS)}" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${ACCENT}" stop-opacity="${String(GLOW_OPACITY)}"/><stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient></defs><rect width="${String(width)}" height="${String(height)}" fill="url(#glow)"/></svg>`,
	);
}

function dotGridSvg(width: number, height: number): Buffer {
	return Buffer.from(
		`<svg width="${String(width)}" height="${String(height)}"><defs><pattern id="dots" width="${String(DOT_SPACING)}" height="${String(DOT_SPACING)}" patternUnits="userSpaceOnUse"><circle cx="${String(DOT_SPACING / 2)}" cy="${String(DOT_SPACING / 2)}" r="${String(DOT_RADIUS)}" fill="#ffffff" fill-opacity="${String(DOT_OPACITY)}"/></pattern></defs><rect width="${String(width)}" height="${String(height)}" fill="url(#dots)"/></svg>`,
	);
}

function verticalFadeSvg(width: number, height: number): Buffer {
	return Buffer.from(
		`<svg width="${String(width)}" height="${String(height)}"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="1"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs><rect width="${String(width)}" height="${String(height)}" fill="url(#fade)"/></svg>`,
	);
}

function headlineSvg(word: string, width: number, height: number): Buffer {
	return Buffer.from(
		`<svg width="${String(width)}" height="${String(height)}"><text x="${String(HEADLINE_X)}" y="${String(HEADLINE_Y)}" font-family="${FONT_STACK}" font-size="${String(HEADLINE_SIZE)}" font-weight="${String(HEADLINE_WEIGHT)}" letter-spacing="${String(HEADLINE_LETTER_SPACING)}" fill="#ffffff">${word}</text></svg>`,
	);
}

async function buildBackground(word: string): Promise<Buffer> {
	const glowRaster = await sharp(glowSvg(CANVAS_WIDTH, CANVAS_HEIGHT)).png().toBuffer();
	const glow = await sharp(glowRaster).blur(GLOW_BLUR_SIGMA).toBuffer();

	const dotsRaster = await sharp(dotGridSvg(CANVAS_WIDTH, CANVAS_HEIGHT)).png().toBuffer();
	const fadedDots = await sharp(dotsRaster)
		.composite([{ input: verticalFadeSvg(CANVAS_WIDTH, CANVAS_HEIGHT), blend: "dest-in" }])
		.png()
		.toBuffer();

	return sharp(backgroundGradientSvg(CANVAS_WIDTH, CANVAS_HEIGHT))
		.composite([
			{ input: glow, left: 0, top: 0 },
			{ input: fadedDots, left: 0, top: 0 },
			{ input: headlineSvg(word, CANVAS_WIDTH, CANVAS_HEIGHT), left: 0, top: 0 },
		])
		.png()
		.toBuffer();
}

// sharp's composite throws if an overlay extends past the base — crop the bleeding part first.
async function placeClipped(overlay: Buffer, left: number, top: number): Promise<ComposeEntry> {
	const { width, height } = await sharp(overlay).metadata();
	if (width === undefined || height === undefined) {
		throw new Error("placeClipped: could not read overlay dimensions");
	}

	const visibleLeft = Math.max(left, 0);
	const visibleTop = Math.max(top, 0);
	const visibleRight = Math.min(left + width, CANVAS_WIDTH);
	const visibleBottom = Math.min(top + height, CANVAS_HEIGHT);
	const visibleWidth = visibleRight - visibleLeft;
	const visibleHeight = visibleBottom - visibleTop;
	if (visibleWidth <= 0 || visibleHeight <= 0) {
		throw new Error("placeClipped: overlay falls entirely outside the canvas");
	}
	if (visibleLeft === left && visibleTop === top && visibleWidth === width && visibleHeight === height) {
		return { input: overlay, left, top };
	}

	const cropped = await sharp(overlay)
		.extract({ left: visibleLeft - left, top: visibleTop - top, width: visibleWidth, height: visibleHeight })
		.toBuffer();
	return { input: cropped, left: visibleLeft, top: visibleTop };
}

// Shadow matches the scaled frame's rounded body (inside its transparent padding), not the whole padded/glowing frame image.
async function buildMobileShadow(mobileFramedWidth: number, mobileFramedHeight: number): Promise<ComposeEntry> {
	const scale = MOBILE_WIDTH / mobileFramedWidth;
	const scaledPadding = FRAME_PADDING * scale;
	const bodyWidth = MOBILE_WIDTH - scaledPadding * 2;
	const bodyHeight = mobileFramedHeight * scale - scaledPadding * 2;

	// Extra margin around the shape so the blur tail isn't clipped at the shadow layer's own edge.
	const margin = SHADOW_BLUR_SIGMA * 4;
	const layerWidth = Math.ceil(bodyWidth) + margin * 2;
	const layerHeight = Math.ceil(bodyHeight) + margin * 2;
	const shapeSvg = Buffer.from(
		`<svg width="${String(layerWidth)}" height="${String(layerHeight)}"><rect x="${String(margin)}" y="${String(margin)}" width="${String(bodyWidth)}" height="${String(bodyHeight)}" rx="${String(SHADOW_RADIUS)}" ry="${String(SHADOW_RADIUS)}" fill="#000000" fill-opacity="${String(SHADOW_OPACITY)}"/></svg>`,
	);
	const shape = await sharp(shapeSvg).png().toBuffer();
	const shadow = await sharp(shape).blur(SHADOW_BLUR_SIGMA).toBuffer();

	const left = Math.round(MOBILE_LEFT + scaledPadding + SHADOW_OFFSET_X - margin);
	const top = Math.round(MOBILE_TOP + scaledPadding + SHADOW_OFFSET_Y - margin);
	return placeClipped(shadow, left, top);
}

async function composeHero(hero: Hero): Promise<void> {
	const desktopPath = assetPath(hero.desktopSource);
	const mobilePath = assetPath(hero.mobileSource);
	const [desktopInput, mobileInput] = await Promise.all([readFile(desktopPath), readFile(mobilePath)]);
	await Promise.all([assertFramed(desktopInput, desktopPath), assertFramed(mobileInput, mobilePath)]);

	const mobileMeta = await sharp(mobileInput).metadata();
	if (mobileMeta.width === undefined || mobileMeta.height === undefined) {
		throw new Error(`${mobilePath}: could not read image dimensions`);
	}

	const background = await buildBackground(hero.word);

	const desktopResized = await sharp(desktopInput).resize({ width: DESKTOP_WIDTH, kernel: "lanczos3" }).toBuffer();
	const mobileResized = await sharp(mobileInput).resize({ width: MOBILE_WIDTH, kernel: "lanczos3" }).toBuffer();

	const [desktopEntry, shadowEntry, mobileEntry] = await Promise.all([
		placeClipped(desktopResized, DESKTOP_LEFT, DESKTOP_TOP),
		buildMobileShadow(mobileMeta.width, mobileMeta.height),
		placeClipped(mobileResized, MOBILE_LEFT, MOBILE_TOP),
	]);

	const composed = await sharp(background)
		.composite([desktopEntry, shadowEntry, mobileEntry])
		.png({ compressionLevel: 9 })
		.toBuffer();

	const outputPath = assetPath(hero.outputName);
	await writeFile(outputPath, composed);
	console.log(`[compose-hero] wrote ${outputPath} -> ${String(CANVAS_WIDTH)}x${String(CANVAS_HEIGHT)} (${String(composed.length)} bytes)`);
}

async function main(): Promise<void> {
	for (const hero of heroes) {
		await composeHero(hero);
	}
}

await main();
