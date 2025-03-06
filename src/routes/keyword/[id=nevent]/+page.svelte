<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: PageData } = $props();
	let currentChannelPointer: nip19.EventPointer | undefined = $state();
	const getChannelPointer = (urlId: string): nip19.EventPointer | undefined => {
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
			return { id: urlId };
		} else {
			throw new TypeError(`"${urlId}" has no channel id`);
		}
	};

	afterNavigate(() => {
		currentChannelPointer = getChannelPointer(data.params.id);
	});
</script>

<App {currentChannelPointer} />
