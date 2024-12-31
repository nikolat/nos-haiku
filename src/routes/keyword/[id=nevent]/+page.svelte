<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: PageData } = $props();
	let currentChannelId: string | undefined = $state();
	const getChannelId = (urlId: string) => {
		if (/^(nevent|note)/.test(urlId)) {
			const d = nip19.decode(urlId);
			if (d.type === 'nevent') {
				return d.data.id;
			} else if (d.type === 'note') {
				return d.data;
			} else {
				throw new TypeError(`"${urlId}" must be nevent or note`);
			}
		} else if (urlId.length === 64) {
			return urlId;
		} else {
			throw new TypeError(`"${urlId}" has no channel id`);
		}
	};

	afterNavigate(() => {
		currentChannelId = getChannelId(data.params.id);
	});
</script>

<App {currentChannelId} />
