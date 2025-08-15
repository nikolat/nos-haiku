import { isNip05 } from 'nostr-tools/nip05';

export function match(param: string) {
	return isNip05(param);
}
