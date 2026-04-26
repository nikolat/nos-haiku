import type { RelayConnector } from '$lib/resource';
import type { Subscription } from 'rxjs';

let loginPubkey: string | undefined;
let rc: RelayConnector | undefined;
let sub: Subscription | undefined;
let deadRelays: string[] = [];

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

export const getSubscription = (): Subscription | undefined => {
	return sub;
};

export const setSubscription = (v: Subscription | undefined): void => {
	sub = v;
};

export const getDeadRelays = (): string[] => {
	return deadRelays;
};

export const setDeadRelays = (v: string[]): void => {
	deadRelays = v;
};
