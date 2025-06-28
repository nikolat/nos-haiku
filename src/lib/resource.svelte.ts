import type { NostrEvent } from 'nostr-tools/pure';
import type { RelayConnector } from '$lib/resource';

let loginPubkey: string | undefined = $state();
let rc: RelayConnector | undefined = $state();
let eventsQuoted: NostrEvent[] = $state([]);
let deadRelays: string[] = $state([]);

export const getLoginPubkey = (): string | undefined => {
	return loginPubkey;
};

export const setLoginPubkey = (v: string | undefined): void => {
	loginPubkey = v;
};

export const getRelayConnector = (): RelayConnector | undefined => {
	return rc;
};

export const setRelayConnector = (v: RelayConnector | undefined): void => {
	rc = v;
};

export const getEventsQuoted = (): NostrEvent[] => {
	return eventsQuoted;
};

export const setEventsQuoted = (v: NostrEvent[]): void => {
	eventsQuoted = v;
};

export const getDeadRelays = (): string[] => {
	return deadRelays;
};

export const setDeadRelays = (v: string[]): void => {
	deadRelays = v;
};
