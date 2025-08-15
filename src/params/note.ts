import { NostrTypeGuard } from 'nostr-tools/nip19';

export function match(param: string) {
	return NostrTypeGuard.isNote(param);
}
