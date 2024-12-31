<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: PageData } = $props();
	let currentPubkey: string | undefined = $state();
	const getPubkey = (urlId: string): string => {
		if (/^nprofile/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'nprofile') {
				return d.data.pubkey;
			} else {
				throw new TypeError(`"${urlId}" must be nprofile`);
			}
		} else {
			throw new TypeError(`"${urlId}" has no pubkey`);
		}
	};

	afterNavigate(() => {
		currentPubkey = getPubkey(data.params.id);
	});
</script>

<App {currentPubkey} />
