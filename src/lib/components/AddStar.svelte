<script lang="ts">
	import { expansionThreshold } from '$lib/config';
	import { getEmoji, isValidEmoji } from '$lib/utils';
	import { getEventEmojiSet, sendReaction } from '$lib/resource.svelte';
	import Reaction from '$lib/components/Reaction.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import type { ProfileContent } from 'applesauce-core/helpers';

	const {
		event,
		loginPubkey,
		profileMap,
		eventsReactionToTheEvent
	}: {
		event: NostrEvent;
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContent>;
		eventsReactionToTheEvent: NostrEvent[];
	} = $props();

	const reactionValidEvents = $derived(
		[...eventsReactionToTheEvent.filter((ev) => isValidEmoji(ev))].reverse()
	);
	const reactionFirst = $derived(reactionValidEvents.at(0)!);
	const reactionLast = $derived(reactionValidEvents.at(-1)!);

	let isAllowedExpand: boolean = $state(false);

	const eventEmojiSet: NostrEvent[] = $derived(getEventEmojiSet());
	const emojiMap: Map<string, string> = $derived.by(() => {
		const r = new Map<string, string>();
		for (const ev of eventEmojiSet) {
			const emojiTags: string[][] = ev.tags.filter(
				(tag) =>
					tag.length >= 3 && tag[0] === 'emoji' && /^\w+$/.test(tag[1]) && URL.canParse(tag[2])
			);
			for (const emojiTag of emojiTags) {
				r.set(emojiTag[1], emojiTag[2]);
			}
		}
		return r;
	});

	let emojiPickerContainer: HTMLElement | undefined = $state();
	const callSendEmoji = async (event: NostrEvent) => {
		if (emojiPickerContainer === undefined) {
			return;
		}
		const r = await getEmoji(emojiPickerContainer, $state.snapshot(emojiMap));
		if (r === null) {
			return;
		}
		sendReaction(event, r.emojiStr, r.emojiUrl);
	};
</script>

<span class="reactionstar-container">
	<button
		class="reactionstar-send"
		title="add a star"
		disabled={loginPubkey === undefined}
		onclick={() => {
			sendReaction(event);
		}}
		aria-label="add a star"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
			<path
				fill-rule="evenodd"
				d="M3.58169903,14.7981322 L4.42551943,9.87828177 L0.851038858,6.39402435 L5.79084952,5.67622784 L8,1.20000005 L10.2091505,5.67622784 L15.1489611,6.39402435 L11.5744806,9.87828177 L12.418301,14.7981322 L8,12.4752939 L3.58169903,14.7981322 Z M8,10.2157425 L9.76203892,11.1421011 L9.42551943,9.18004197 L10.8510389,7.79050395 L8.88101946,7.50424338 L8,5.71910297 L7.11898054,7.50424338 L5.14896114,7.79050395 L6.57448057,9.18004197 L6.23796108,11.1421011 L8,10.2157425 Z"
			/>
		</svg>
	</button>
	<button
		class="reactionstar-send"
		title="add an emoji"
		disabled={loginPubkey === undefined}
		onclick={() => {
			callSendEmoji(event);
		}}
		aria-label="add an emoji"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
			<path
				fill-rule="evenodd"
				d="M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z M12,21 C16.9705627,21 21,16.9705627 21,12 C21,7.02943725 16.9705627,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 Z M15.2746538,14.2978292 L16.9105622,15.4483958 C15.7945475,17.0351773 13.9775544,18 12,18 C10.0224456,18 8.20545254,17.0351773 7.08943782,15.4483958 L8.72534624,14.2978292 C9.4707028,15.3575983 10.6804996,16 12,16 C13.3195004,16 14.5292972,15.3575983 15.2746538,14.2978292 Z M14,11 L14,9 L16,9 L16,11 L14,11 Z M8,11 L8,9 L10,9 L10,11 L8,11 Z"
			/>
		</svg>
	</button>
	{#if reactionValidEvents.length <= expansionThreshold || isAllowedExpand}
		{#each reactionValidEvents as reactionEvent (reactionEvent.id)}<Reaction
				{reactionEvent}
				profile={profileMap.get(reactionEvent.pubkey)}
				isAuthor={reactionEvent.pubkey === loginPubkey}
			/>{/each}
	{:else}
		<Reaction
			reactionEvent={reactionFirst}
			profile={profileMap.get(reactionFirst.pubkey)}
			isAuthor={reactionFirst.pubkey === loginPubkey}
		/><button
			class="reactionstar-expand"
			onclick={() => {
				isAllowedExpand = true;
			}}>{reactionValidEvents.length}</button
		><Reaction
			reactionEvent={reactionLast}
			profile={profileMap.get(reactionLast.pubkey)}
			isAuthor={reactionLast.pubkey === loginPubkey}
		/>
	{/if}
</span>
<div class="emoji-picker-container" bind:this={emojiPickerContainer}></div>

<style>
	span.reactionstar-container {
		font-size: 12px;
	}
	span.reactionstar-container > button {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
	}
	span.reactionstar-container > button:disabled {
		cursor: not-allowed;
	}
	span.reactionstar-container > button.reactionstar-send {
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
	}
	span.reactionstar-container > button.reactionstar-send > svg {
		width: 16px;
		height: 16px;
		fill: var(--secondary-text-color);
	}
	span.reactionstar-container > button.reactionstar-send:active > svg {
		fill: yellow;
	}
	span.reactionstar-container > button.reactionstar-expand {
		background-color: transparent;
	}
	.emoji-picker-container {
		position: absolute;
		top: 2em;
		left: -3em;
		z-index: 2;
	}
</style>
