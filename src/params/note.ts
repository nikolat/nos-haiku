export function match(param: string) {
	return /^note\w{59}$/.test(param);
}
