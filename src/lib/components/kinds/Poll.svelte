<script lang="ts">
	import { getEventsByKinds, sendPollResponse } from '$lib/resource.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { normalizeURL } from 'nostr-tools/utils';

	const {
		event,
		loginPubkey,
		nowRealtime
	}: {
		event: NostrEvent;
		loginPubkey: string | undefined;
		nowRealtime: number;
	} = $props();

	const getEndsAt = (event: NostrEvent): number =>
		parseInt(
			event.tags
				.find((tag) => tag.length >= 2 && tag[0] === 'endsAt' && /^\d+$/.test(tag[1]))
				?.at(1) ?? '0'
		);
	const oneVotePerPubkey = (event: NostrEvent): NostrEvent[] => {
		const events1018 = getEventsByKinds(new Set<number>([1018])).filter((ev) =>
			ev.tags.some((tag) => tag.length >= 2 && tag[0] === 'e' && tag[1] === event.id)
		);
		const eventMap: Map<string, NostrEvent> = new Map<string, NostrEvent>();
		const endsAt: number = getEndsAt(event);
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
	const endsAt = $derived(getEndsAt(event));
	let response: string | undefined = $state();

	const callSendPollResponse = async () => {
		if (response === undefined) {
			return;
		}
		const relaysToWrite: string[] = Array.from(
			new Set<string>(
				event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'relay' && URL.canParse(tag[1]))
					.map((tag) => normalizeURL(tag[1]))
			)
		);
		await sendPollResponse(event, [response], relaysToWrite.length > 0 ? relaysToWrite : undefined);
		response = undefined;
	};
</script>

<ol>
	{#each pollResultMap as [k, [v, n]] (k)}
		<li>
			<input
				type="radio"
				name="poll"
				value={k}
				disabled={loginPubkey === undefined || nowRealtime > 1000 * endsAt}
				bind:group={response}
			/>
			{v}: {n}
		</li>
	{/each}
</ol>
<button
	class="Button"
	disabled={loginPubkey === undefined || nowRealtime > 1000 * endsAt || response === undefined}
	onclick={callSendPollResponse}
>
	<span>poll</span>
</button>
<p>ends at: {new Date(1000 * endsAt).toLocaleString()}</p>

<style>
	input:disabled,
	button:disabled {
		cursor: not-allowed;
	}
</style>
