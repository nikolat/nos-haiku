<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ChannelContent } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';

	let {
		channelIds,
		loginPubkey,
		channelMap,
		channelToPost = $bindable(),
		baseEventToEdit = $bindable()
	}: {
		channelIds: string[];
		loginPubkey: string | undefined;
		channelMap: Map<string, ChannelContent>;
		channelToPost: ChannelContent | undefined;
		baseEventToEdit: NostrEvent | undefined;
	} = $props();
</script>

<ul class="KeywordList__list">
	{#each channelIds as channelId (channelId)}
		{@const channel = channelMap.get(channelId)}
		{#if channel !== undefined}
			<li class="KeywordItem">
				<a href={resolve(`/keyword/${nip19.neventEncode(channel)}`)} class="KeywordItem__title"
					>{channel.name}</a
				>
				<span class="post-channel">
					<button
						aria-label="Post to this keyword"
						class="post-chennel"
						disabled={loginPubkey === undefined}
						title="Post to this keyword"
						onclick={() => {
							channelToPost = channel;
							baseEventToEdit = undefined;
							window.scroll({
								top: 0,
								behavior: 'smooth'
							});
						}}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
							<path
								fill-rule="evenodd"
								d="M12,21.2037682 L1.48140774,12 L12,2.79623177 L12,8.02302014 C18.5486628,8.33140969 22,11.7344566 22,18 L22,20.4142136 L20.2928932,18.7071068 C18.0460687,16.4602823 15.3097943,15.5189215 12,15.8718462 L12,21.2037682 Z M10,7.20376823 L4.51859226,12 L10,16.7962318 L10,14.1528729 L10.835601,14.0136061 C14.2501827,13.4445091 17.255572,14.0145027 19.7987459,15.7165365 C19.0504666,11.8510227 16.2006399,10 11,10 L10,10 L10,7.20376823 Z"
							/>
						</svg>
					</button>
				</span>
			</li>
		{/if}
	{/each}
</ul>

<style>
	.KeywordItem span {
		font-size: 12px;
		margin-right: 3px;
	}
	.KeywordItem span > button {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
		vertical-align: text-bottom;
	}
	.KeywordItem span > button:disabled {
		cursor: not-allowed;
	}
	.KeywordItem span > button > svg {
		width: 16px;
		height: 16px;
		fill: var(--secondary-text-color);
	}
	.KeywordItem span > button:active > svg {
		fill: yellow;
	}
</style>
