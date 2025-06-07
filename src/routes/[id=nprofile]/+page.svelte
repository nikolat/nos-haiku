<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

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

	afterNavigate(() => {
		currentProfilePointer = getProfilePointer(page.params.id);
	});
</script>

<App up={{ currentProfilePointer }} />
