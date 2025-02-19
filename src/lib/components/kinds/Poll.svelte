<script lang="ts">
	import { getEventsByKinds } from '$lib/resource.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';

	const {
		event
	}: {
		event: NostrEvent;
	} = $props();

	const oneVotePerPubkey = (event: NostrEvent): NostrEvent[] => {
		const events1018 = getEventsByKinds(new Set<number>([1018])).filter((ev) =>
			ev.tags.some((tag) => tag.length >= 2 && tag[0] === 'e' && tag[1] === event.id)
		);
		const eventMap: Map<string, NostrEvent> = new Map<string, NostrEvent>();
		const endsAt: number = parseInt(
			event.tags
				.find((tag) => tag.length >= 2 && tag[0] === 'endsAt' && /^\d+$/.test(tag[1]))
				?.at(1) ?? '0'
		);
		for (const ev of events1018) {
			if (!eventMap.has(ev.pubkey) || ev.created_at > eventMap.get(ev.pubkey)!.created_at) {
				if (ev.created_at <= endsAt) {
					eventMap.set(ev.pubkey, ev);
				}
			}
		}
		return Array.from(eventMap.values());
	};
	const getPollResult = (event: NostrEvent): Map<string, [string, number]> => {
		const events1018 = oneVotePerPubkey(event);
		const rMap = new Map<string, number>();
		for (const ev of events1018) {
			const response = ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'response')?.at(1);
			if (response !== undefined) {
				rMap.set(response, (rMap.get(response) ?? 0) + 1);
			}
		}
		const nameMap: Map<string, [string, number]> = new Map<string, [string, number]>(
			event.tags
				.filter((tag) => tag.length >= 3 && tag[0] === 'option')
				.map((tag) => [tag[1], [tag[2], rMap.get(tag[1]) ?? 0]])
		);
		return nameMap;
	};

	const pollResultMap: Map<string, [string, number]> = $derived(getPollResult(event));
</script>

<ol>
	{#each pollResultMap as [k, [v, n]] (k)}
		<li>{`(${k})${v}`}: {n}</li>
	{/each}
</ol>
