<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';
	import { getLoginPubkey } from '$lib/resource.svelte';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: PageData } = $props();
	let currentPubkey: string | undefined = $state();
	const getPubkey = (urlId: string): string => {
		if (/^npub/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'npub') {
				return d.data;
			} else {
				throw new TypeError(`"${urlId}" must be npub`);
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
		currentPubkey = getPubkey(data.params.id);
		//メンションの雛形を投稿欄に入力
		if (currentPubkey !== undefined) {
			const elToSend: HTMLTextAreaElement | null = document.querySelector(
				'.Feed__composer textarea'
			);
			if (elToSend !== null) {
				const loginPubkey: string | undefined = getLoginPubkey();
				if (loginPubkey !== currentPubkey) {
					elToSend.value = `nostr:${nip19.npubEncode(currentPubkey)} `;
				}
			}
		}
	});
</script>

<App {currentPubkey} />
