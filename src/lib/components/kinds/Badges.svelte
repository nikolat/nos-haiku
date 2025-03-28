<script lang="ts">
	import { getEventByAddressPointer, getEventById } from '$lib/resource.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';

	const {
		currentPubkey,
		badgeEvent
	}: {
		currentPubkey: string;
		badgeEvent: NostrEvent | undefined;
	} = $props();

	const validBadgeAwards: [NostrEvent, NostrEvent][] = $derived.by(() => {
		if (badgeEvent === undefined) {
			return [];
		}
		const aIds: string[] = badgeEvent.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'a')
			.map((tag) => tag[1]);
		const eIds: string[] = badgeEvent.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'e')
			.map((tag) => tag[1]);
		const kind8Events: NostrEvent[] = eIds
			.map((id) => getEventById(id))
			.filter((ev) => ev !== undefined)
			.filter((ev) => ev.kind === 8);
		const validEventSets: [NostrEvent, NostrEvent][] = [];
		for (const aId30008 of new Set<string>(aIds)) {
			let kind8Event: NostrEvent | undefined;
			const sp = aId30008.split(':');
			const ap: nip19.AddressPointer = { identifier: sp[2], pubkey: sp[1], kind: parseInt(sp[0]) };
			const kind30009Event = getEventByAddressPointer(ap);
			if (kind30009Event === undefined) {
				continue;
			}
			for (const ev8 of kind8Events) {
				const aId8: string | undefined = ev8.tags
					.find((tag) => tag.length >= 2 && tag[0] === 'a')
					?.at(1);
				const pTags8: string[] = ev8.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'p')
					.map((tag) => tag[1]);
				if (
					aId8 === aId30008 &&
					ev8.pubkey === kind30009Event.pubkey &&
					pTags8.includes(currentPubkey)
				) {
					kind8Event = ev8;
					break;
				}
			}
			if (kind8Event !== undefined) {
				validEventSets.push([kind30009Event, kind8Event]);
			}
		}
		return validEventSets;
	});
</script>

<div class="badges">
	{#each validBadgeAwards as [ev30009, ev8] (ev30009.id)}
		{@const tagMap = (ev: NostrEvent) =>
			new Map<string, string>(ev.tags.map((tag) => [tag[0], tag[1]]))}
		{@const title = tagMap(ev30009).get('name') ?? ''}
		{@const image = tagMap(ev30009).get('image') ?? ''}
		{#if URL.canParse(image)}
			<a href={`/entry/${nip19.neventEncode({ ...ev8, author: ev8.pubkey })}`}>
				<img alt={title} {title} src={image} class="badge" />
			</a>
		{/if}
	{/each}
</div>

<style>
	.badge {
		width: 32px;
		height: 32px;
	}
</style>
