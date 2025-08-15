<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';
	import * as nip19 from 'nostr-tools/nip19';

	let currentProfilePointer: nip19.ProfilePointer | undefined = $state();
	let date: Date | undefined = $state();
	const getProfilePointer = (urlId: string | undefined): nip19.ProfilePointer => {
		if (urlId === undefined) {
			throw new TypeError('urlId is undefined');
		}
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

	afterNavigate(() => {
		currentProfilePointer = getProfilePointer(page.params.id);
		if (page.params.date !== undefined) {
			date = new Date(encodeURI(page.params.date));
		}
	});
</script>

<App up={{ currentProfilePointer, date }} />
