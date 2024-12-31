export function match(param: string) {
	return /^npub\w{59}$/.test(param);
}
