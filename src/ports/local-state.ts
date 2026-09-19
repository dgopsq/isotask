/** Per-device, never synced (`app.saveLocalStorage`): the fired-reminder ledger must not travel with the vault. */
export interface LocalState {
	readonly get: (key: string) => unknown;
	readonly set: (key: string, value: unknown) => void;
}
