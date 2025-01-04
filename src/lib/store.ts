import { persisted } from 'svelte-persisted-store';
import { defaultRelays, uploaderURLs } from '$lib/config';
import type { RelayRecord } from 'nostr-tools/relay';

export const preferences = persisted<
	{
		loginPubkey: string | undefined;
		isEnabledDarkMode: boolean;
		isEnabledSkipKind1: boolean;
		isEnabledUseClientTag: boolean;
		relaysSelected: string;
		uploaderSelected: string;
		relaysToUse: RelayRecord;
	},
	{
		loginPubkey: string | undefined;
		isEnabledDarkMode: boolean;
		isEnabledSkipKind1: boolean;
		isEnabledUseClientTag: boolean;
		relaysSelected: string;
		uploaderSelected: string;
		relaysToUse: RelayRecord;
	}
>('preferences', {
	loginPubkey: undefined,
	isEnabledDarkMode: true,
	isEnabledSkipKind1: false,
	isEnabledUseClientTag: false,
	relaysSelected: 'default',
	uploaderSelected: uploaderURLs[0],
	relaysToUse: defaultRelays
});
