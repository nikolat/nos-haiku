<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: PageData } = $props();
	let currentEventPointer: nip19.EventPointer | undefined = $state();
	const getEvent = (urlId: string): nip19.EventPointer => {
		if (/^(nevent|note)/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'nevent') {
				return d.data;
			} else if (d.type === 'note') {
				return { id: d.data };
			} else {
				throw new TypeError(`"${urlId}" must be nevent or note`);
			}
		} else if (urlId.length === 64) {
			try {
				const _ = nip19.noteEncode(urlId);
			} catch (_error) {
				throw new TypeError(`"${urlId}" is not hex id`);
			}
			return { id: urlId };
		} else {
			throw new TypeError(`"${urlId}" has no channel id`);
		}
	};

	afterNavigate(() => {
		currentEventPointer = getEvent(data.params.id);
	});
</script>

<App {currentEventPointer} />
