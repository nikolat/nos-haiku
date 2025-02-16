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

	const validBadges: NostrEvent[] = $derived.by(() => {
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
		const validKind30009Events: NostrEvent[] = [];
		for (const aId30008 of new Set<string>(aIds)) {
			let isValid = false;
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
					isValid = true;
					break;
				}
			}
			if (isValid) {
				validKind30009Events.push(kind30009Event);
			}
		}
		return validKind30009Events;
	});
</script>

<div class="badges">
	{#each validBadges as ev (ev.id)}
		{@const tagMap = new Map<string, string>(ev.tags.map((tag) => [tag[0], tag[1]]))}
		{@const title = tagMap.get('name') ?? ''}
		{#if URL.canParse(tagMap.get('image') ?? '')}
			<a
				href={`/entry/${nip19.naddrEncode({ identifier: tagMap.get('d') ?? '', pubkey: ev.pubkey, kind: ev.kind })}`}
			>
				<img alt={title} {title} src={tagMap.get('image')} class="badge" />
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
