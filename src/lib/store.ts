import { persisted } from 'svelte-persisted-store';
import { defaultKindsSelected, initialLocale, uploaderURLsNip96 } from '$lib/config';

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
		uploaderType: 'nip96' | 'blossom';
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
		uploaderType: 'nip96' | 'blossom';
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
	uploaderSelected: uploaderURLsNip96[0],
	uploaderType: 'nip96',
	kindsSelected: defaultKindsSelected
});
