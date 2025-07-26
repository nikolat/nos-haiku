<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

	let currentAddressPointer: nip19.AddressPointer | undefined = $state();
	const getAddressPointer = (urlId: string | undefined): nip19.AddressPointer => {
		if (urlId === undefined) {
			throw new TypeError('urlId is undefined');
		}
		if (/^naddr1/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'naddr') {
				return d.data;
			} else {
				throw new TypeError(`"${urlId}" must be naddr`);
			}
		} else {
			throw new TypeError(`"${urlId}" must be naddr`);
		}
	};

	afterNavigate(() => {
		currentAddressPointer = getAddressPointer(page.params.id);
	});
</script>

<App up={{ currentAddressPointer }} />
