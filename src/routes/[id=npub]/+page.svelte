<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';
	import { getLoginPubkey } from '$lib/resource.svelte';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: PageData } = $props();
	let currentProfilePointer: nip19.ProfilePointer | undefined = $state();
	const getProfilePointer = (urlId: string): nip19.ProfilePointer => {
		if (/^(nprofile1|npub1)/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'nprofile') {
				return d.data;
			} else if (d.type === 'npub') {
				return { pubkey: d.data };
			} else {
				throw new TypeError(`"${urlId}" must be nprofile or npub`);
			}
		} else {
			throw new TypeError(`"${urlId}" has no pubkey`);
		}
	};

	beforeNavigate(() => {
		const elToSend: HTMLTextAreaElement | null = document.querySelector('.Feed__composer textarea');
		if (elToSend !== null) {
			elToSend.value = '';
		}
	});
	afterNavigate(() => {
		currentProfilePointer = getProfilePointer(data.params.id);
		//メンションの雛形を投稿欄に入力
		if (currentProfilePointer !== undefined) {
			const elToSend: HTMLTextAreaElement | null = document.querySelector(
				'.Feed__composer textarea'
			);
			if (elToSend !== null) {
				const loginPubkey: string | undefined = getLoginPubkey();
				if (loginPubkey !== currentProfilePointer.pubkey) {
					elToSend.value = `nostr:${nip19.npubEncode(currentProfilePointer.pubkey)} `;
				}
			}
		}
	});
</script>

<App {currentProfilePointer} />
