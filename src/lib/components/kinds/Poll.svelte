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
		const events1018: NostrEvent[] = oneVotePerPubkey(event);
		const isSingleChoice: boolean = !event.tags.some(
			(tag) => tag.length >= 2 && tag[0] === 'polltype' && tag[1] === 'multiplechoice'
		);
		const rMap = new Map<string, number>();
		for (const ev of events1018) {
			const responses = ev.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'response')
				.map((tag) => tag[1]);
			for (const response of responses) {
				rMap.set(response, (rMap.get(response) ?? 0) + 1);
				if (isSingleChoice) {
					break;
				}
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
	const endsAt: number = $derived(getEndsAt(event));
	const pollType: string | undefined = $derived(
		event.tags.find((tag) => tag.length >= 2 && tag[0] === 'polltype')?.at(1)
	);
	let responseRadio: string | undefined = $state();
	let responseCheckbox: boolean[] = $state([]);

	const callSendPollResponse = async () => {
		let responses: string[];
		if (pollType === 'multiplechoice') {
			responses = [];
			const pollResultArray: [string, [string, number]][] = Array.from(pollResultMap.entries());
			for (let i = 0; i < responseCheckbox.length; i++) {
				if (responseCheckbox[i]) {
					responses.push(pollResultArray[i][0]);
				}
			}
		} else {
			if (responseRadio === undefined) {
				return;
			}
			responses = [responseRadio];
		}
		if (responses.length === 0) {
			return;
		}
		const relaysToWrite: string[] = Array.from(
			new Set<string>(
				event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'relay' && URL.canParse(tag[1]))
					.map((tag) => normalizeURL(tag[1]))
			)
		);
		await sendPollResponse(event, responses, relaysToWrite.length > 0 ? relaysToWrite : undefined);
		responseRadio = undefined;
		responseCheckbox = [];
	};
</script>

<ol>
	{#each pollResultMap as [k, [v, n]], i (k)}
		<li>
			{#if pollType === 'multiplechoice'}
				<input
					type="checkbox"
					name="poll"
					disabled={loginPubkey === undefined || nowRealtime > 1000 * endsAt}
					bind:checked={responseCheckbox[i]}
				/>
				<span>{v}: {n}</span>
			{:else}
				<input
					type="radio"
					name="poll"
					value={k}
					disabled={loginPubkey === undefined || nowRealtime > 1000 * endsAt}
					bind:group={responseRadio}
				/>
				<span>{v}: {n}</span>
			{/if}
		</li>
	{/each}
</ol>
<button
	class="Button"
	disabled={loginPubkey === undefined ||
		nowRealtime > 1000 * endsAt ||
		(pollType === 'multiplechoice' && responseCheckbox.every((b) => !b)) ||
		(pollType !== 'multiplechoice' && responseRadio === undefined)}
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
