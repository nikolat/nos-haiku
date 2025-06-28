<script lang="ts">
	import { defaultReactionToShow, getRoboHashURL } from '$lib/config';
	import { isCustomEmoji, isValidEmoji } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import type { ProfileContent } from 'applesauce-core/helpers';

	let {
		reactionEvent,
		sendDeletion,
		profile,
		isAuthor
	}: {
		reactionEvent: NostrEvent;
		sendDeletion: (targetEvent: NostrEvent) => Promise<void>;
		profile: ProfileContent | undefined;
		isAuthor: boolean;
	} = $props();

	const npub: string = $derived(nip19.npubEncode(reactionEvent.pubkey));
	const name: string = $derived(profile?.name ?? '');
	const src: string = $derived(
		profile?.picture !== undefined && URL.canParse(profile.picture ?? '')
			? profile.picture
			: getRoboHashURL(reactionEvent.pubkey)
	);
</script>

<span
	class="reactionstar-reaction"
	data-nevent={nip19.neventEncode({
		...reactionEvent,
		author: reactionEvent.pubkey
	})}
	data-npub={nip19.npubEncode(reactionEvent.pubkey)}
	data-created-at={reactionEvent.created_at}
>
	<span class="reactionstar-content">
		{#if !isValidEmoji(reactionEvent)}
			<span class="warning-message">(invalid emoji)</span>
		{:else if isCustomEmoji(reactionEvent)}
			<img
				src={reactionEvent.tags.find((tag) => tag[0] === 'emoji')?.at(2)}
				alt={reactionEvent.content}
				title={reactionEvent.content}
			/>
		{:else}
			{reactionEvent.content.replace(/^\+$/, defaultReactionToShow).replace(/^-$/, '💔') ||
				defaultReactionToShow}
		{/if}
	</span><a class="reactionstar-link" href="/{npub}">
		<img class="reactionstar-profile-picture" {src} alt="id:{name}" title="id:{name}" />
	</a>{#if isAuthor}
		<button
			class="reactionstar-delete"
			title="delete the reaction"
			onclick={async () => {
				await sendDeletion(reactionEvent);
			}}
			aria-label="delete the reaction"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
				<path
					fill-rule="evenodd"
					d="M8,16 C3.581722,16 0,12.418278 0,8 C0,3.581722 3.581722,0 8,0 C12.418278,0 16,3.581722 16,8 C16,12.418278 12.418278,16 8,16 Z M8,14 C11.3137085,14 14,11.3137085 14,8 C14,4.6862915 11.3137085,2 8,2 C4.6862915,2 2,4.6862915 2,8 C2,11.3137085 4.6862915,14 8,14 Z M8,9.41421356 L5.70710678,11.7071068 L4.29289322,10.2928932 L6.58578644,8 L4.29289322,5.70710678 L5.70710678,4.29289322 L8,6.58578644 L10.2928932,4.29289322 L11.7071068,5.70710678 L9.41421356,8 L11.7071068,10.2928932 L10.2928932,11.7071068 L8,9.41421356 Z"
				/>
			</svg>
		</button>
	{/if}
</span>

<style>
	span.reactionstar-reaction a {
		text-decoration: none;
	}
	span.reactionstar-reaction {
		position: relative;
	}
	span.reactionstar-reaction > a.reactionstar-link {
		position: absolute;
		bottom: 16px;
		left: 0;
		visibility: hidden;
	}
	span.reactionstar-reaction:hover > a.reactionstar-link {
		visibility: visible;
	}
	span.reactionstar-reaction > button.reactionstar-delete {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
		background-color: rgba(127, 127, 127, 0.2);
		border-radius: 10%;
		position: absolute;
		left: 16px;
	}
	span.reactionstar-reaction > button.reactionstar-delete > svg {
		width: 16px;
		height: 16px;
		fill: gray;
		position: absolute;
		bottom: 16px;
		left: 0;
		visibility: hidden;
	}
	span.reactionstar-reaction:hover > button.reactionstar-delete > svg {
		visibility: visible;
	}
	span.reactionstar-reaction > button.reactionstar-delete:active > svg {
		fill: yellow;
	}
	span.reactionstar-reaction > span.reactionstar-content {
		display: inline-block;
		min-width: 16px;
		cursor: default;
		vertical-align: top;
	}
	span.reactionstar-reaction > span.reactionstar-content > img {
		height: 16px;
		vertical-align: top;
	}
	span.reactionstar-reaction > a.reactionstar-link > img {
		width: 16px;
		height: 16px;
		border-radius: 10%;
		object-fit: cover;
	}
	.warning-message {
		text-decoration-line: underline;
		text-decoration-color: red;
	}
</style>
