import { persisted } from 'svelte-persisted-store';
import { defaultKindsSelected, initialLocale, uploaderURLs } from '$lib/config';

export const preferences = persisted<
	{
		loginPubkey: string | undefined;
		lang: string;
		isEnabledDarkMode: boolean;
		isEnabledRelativeTime: boolean;
		isEnabledHideMutedEvents: boolean;
		isEnabledUseClientTag: boolean;
		isEnabledEventProtection: boolean;
		uploaderSelected: string;
		kindsSelected: number[];
	},
	{
		loginPubkey: string | undefined;
		lang: string;
		isEnabledDarkMode: boolean;
		isEnabledRelativeTime: boolean;
		isEnabledHideMutedEvents: boolean;
		isEnabledUseClientTag: boolean;
		isEnabledEventProtection: boolean;
		uploaderSelected: string;
		kindsSelected: number[];
	}
>('preferences', {
	loginPubkey: undefined,
	lang: initialLocale,
	isEnabledDarkMode: true,
	isEnabledRelativeTime: true,
	isEnabledHideMutedEvents: true,
	isEnabledUseClientTag: false,
	isEnabledEventProtection: false,
	uploaderSelected: uploaderURLs[0],
	kindsSelected: defaultKindsSelected
});
