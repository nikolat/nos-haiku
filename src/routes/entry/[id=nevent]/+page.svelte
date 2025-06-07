<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

	let currentEventPointer: nip19.EventPointer | undefined = $state();
	const getEventPointer = (urlId: string): nip19.EventPointer => {
		if (/^(nevent1|note1)/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'nevent') {
				return d.data;
			} else if (d.type === 'note') {
				return { id: d.data };
			} else {
				throw new TypeError(`"${urlId}" must be nevent`);
			}
		} else {
			throw new TypeError(`"${urlId}" must be nevent`);
		}
	};

	afterNavigate(() => {
		currentEventPointer = getEventPointer(page.params.id);
	});
</script>

<App up={{ currentEventPointer }} />
