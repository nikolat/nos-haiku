import { persisted } from 'svelte-persisted-store';
import { initialLocale, uploaderURLs } from '$lib/config';

export const preferences = persisted<
	{
		loginPubkey: string | undefined;
		lang: string;
		isEnabledDarkMode: boolean;
		isEnabledRelativeTime: boolean;
		isEnabledUseClientTag: boolean;
		isEnabledEventProtection: boolean;
		uploaderSelected: string;
	},
	{
		loginPubkey: string | undefined;
		lang: string;
		isEnabledDarkMode: boolean;
		isEnabledRelativeTime: boolean;
		isEnabledUseClientTag: boolean;
		isEnabledEventProtection: boolean;
		uploaderSelected: string;
	}
>('preferences', {
	loginPubkey: undefined,
	lang: initialLocale,
	isEnabledDarkMode: true,
	isEnabledRelativeTime: true,
	isEnabledUseClientTag: false,
	isEnabledEventProtection: false,
	uploaderSelected: uploaderURLs[0]
});
