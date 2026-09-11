import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { addDays, format, startOfWeek } from "date-fns";

import { noteContent } from "./fixtures.ts";
import { PLUGIN_ID } from "@/plugin-id";

/** Human-looking demo vault (`e2e/vault/DocsDemo/`), separate from `generate-fixtures.mts`'s generic-titled `Tasks/` set. */

const docsDemoDir = fileURLToPath(new URL("./vault/DocsDemo/", import.meta.url));
const pluginDataPath = join(fileURLToPath(new URL("./vault/.obsidian/plugins/", import.meta.url)), PLUGIN_ID, "data.json");

function iso(now: Date, offsetDays: number): string {
	return format(addDays(now, offsetDays), "yyyy-MM-dd");
}

interface DemoNote {
	readonly filename: string;
	readonly frontmatter: Readonly<Record<string, string>>;
	readonly body: string;
}

function projectNotes(): readonly DemoNote[] {
	return [
		{ filename: "Acme Redesign.md", frontmatter: { type: "project", color: "blue" }, body: "Demo project for e2e docs screenshots." },
		{ filename: "Personal.md", frontmatter: { type: "project", color: "orange" }, body: "Demo project for e2e docs screenshots." },
	];
}

function taskNotes(now: Date): readonly DemoNote[] {
	const today = iso(now, 0);
	// Monday-anchored so Tue/Fri land in the same week as `today`, whatever weekday the suite runs on.
	const monday = startOfWeek(now, { weekStartsOn: 1 });
	const tuesday = format(addDays(monday, 1), "yyyy-MM-dd");
	const friday = format(addDays(monday, 4), "yyyy-MM-dd");
	return [
		{
			filename: "Renew passport.md",
			frontmatter: { type: "task", status: "todo", due: iso(now, -6), priority: "high", project: "Personal", tags: "[errands]" },
			body: "Expires next month — book the appointment.",
		},
		{
			filename: "Pay invoice 241.md",
			frontmatter: { type: "task", status: "todo", due: iso(now, -2), project: "Acme Redesign", tags: "[finance]" },
			body: "Overdue by a couple of days.",
		},
		{
			filename: "Buy birthday gift.md",
			// Done kind: excluded by the base's `status != "done"` filter, kept to show the two-state model in note data.
			frontmatter: { type: "task", status: "done", due: iso(now, -3), project: "Personal" },
			body: "Already wrapped.",
		},
		{
			filename: "Weekly review.md",
			frontmatter: { type: "task", status: "todo", due: today, tags: "[planning]" },
			body: "Go through last week's notes and plan the next one.",
		},
		{
			filename: "Take out recycling.md",
			frontmatter: { type: "task", status: "todo", due: today, repeat: "FREQ=WEEKLY", tags: "[chores]" },
			body: "Every week, before the truck comes by.",
		},
		{
			filename: "Team standup.md",
			frontmatter: { type: "task", status: "todo", scheduled: `${today}T09:00`, duration: "15", project: "Acme Redesign" },
			body: "Quick daily sync.",
		},
		{
			filename: "Client call.md",
			frontmatter: { type: "task", status: "todo", scheduled: `${today}T14:00`, duration: "60", priority: "high", project: "Acme Redesign" },
			body: "Walk through the latest mockups.",
		},
		{
			filename: "Dentist.md",
			frontmatter: { type: "task", status: "todo", scheduled: `${tuesday}T11:00`, duration: "45" },
			body: "Checkup.",
		},
		{
			filename: "1:1 with Sam.md",
			frontmatter: { type: "task", status: "todo", scheduled: `${friday}T14:00`, duration: "30", project: "Acme Redesign" },
			body: "Weekly catch-up.",
		},
		{
			filename: "Ship v0.1.md",
			frontmatter: { type: "task", status: "todo", due: iso(now, 3), priority: "urgent", project: "Acme Redesign", tags: "[release, code]" },
			body: "First public build.",
		},
		{
			filename: "Draft blog post.md",
			frontmatter: { type: "task", status: "todo", due: iso(now, 6), project: "Personal", tags: "[writing]" },
			body: "Announcing the redesign.",
		},
		{
			filename: "Quarterly planning.md",
			frontmatter: { type: "task", status: "todo", due: iso(now, 10), project: "Acme Redesign" },
			body: "Set goals for next quarter.",
		},
		{
			filename: "Plan offsite.md",
			frontmatter: { type: "task", status: "todo", due: iso(now, 27), project: "Personal", tags: "[team]" },
			body: "Find a venue and a date.",
		},
		{
			filename: "Read Deep Work.md",
			frontmatter: { type: "task", status: "todo", tags: "[reading]" },
			body: "Recommended by a colleague.",
		},
	];
}

/** Mirrors (not imports — not exported) generate-fixtures.mts's writePluginData, so the task panel doesn't auto-open and perturb screenshots. */
async function writePluginData(): Promise<void> {
	const desired = `${JSON.stringify({ taskPanelIntroduced: true }, undefined, "\t")}\n`;
	await mkdir(join(pluginDataPath, ".."), { recursive: true });
	await writeFile(pluginDataPath, desired, "utf8");
}

async function main(): Promise<void> {
	await writePluginData();

	// Regenerated fresh every run (unlike Tasks/'s idempotent diff) — this only runs for occasional shots:docs calls.
	await rm(docsDemoDir, { recursive: true, force: true });
	await mkdir(docsDemoDir, { recursive: true });

	const now = new Date();
	const notes = [...projectNotes(), ...taskNotes(now)];
	await Promise.all(
		notes.map((note) => writeFile(join(docsDemoDir, note.filename), noteContent(note.frontmatter, note.body), "utf8")),
	);

	console.log(`[generate-docs-fixtures] wrote ${String(notes.length)} note(s) to ${docsDemoDir}`);
}

await main();
