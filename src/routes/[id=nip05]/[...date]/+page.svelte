<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';
	import * as nip19 from 'nostr-tools/nip19';
	import { queryProfile } from 'nostr-tools/nip05';

	let currentProfilePointer: nip19.ProfilePointer | undefined = $state();
	let isNIP05Fetching: boolean = $state(true);
	let date: Date | undefined = $state();

	afterNavigate(async () => {
		const nip05: string | undefined = page.params.id;
		const pp: nip19.ProfilePointer | null = await queryProfile(nip05 ?? '');
		if (pp === null) {
			throw new TypeError(`"${nip05 ?? ''}" is not nip05`);
		}
		currentProfilePointer = pp;
		if (page.params.date !== undefined) {
			date = new Date(encodeURI(page.params.date));
		}
		isNIP05Fetching = false;
	});
</script>

<App up={{ currentProfilePointer, date, isNIP05Fetching }} />
