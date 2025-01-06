<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: PageData } = $props();
	let currentAddressPointer: nip19.AddressPointer | undefined = $state();
	const getEvent = (urlId: string): nip19.AddressPointer => {
		if (/^naddr/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'naddr') {
				return d.data;
			} else {
				throw new TypeError(`"${urlId}" must be naddr`);
			}
		} else {
			throw new TypeError(`"${urlId}" has no channel id`);
		}
	};

	afterNavigate(() => {
		currentAddressPointer = getEvent(data.params.id);
	});
</script>

<App {currentAddressPointer} />
