<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import type { ChannelContent } from '$lib/utils';
	import Content from '$lib/components/Content.svelte';
	import * as nip19 from 'nostr-tools/nip19';

	const { channel }: { channel: ChannelContent } = $props();
</script>

<div class="Card__body">
	<div class="Entry__content">
		<h3><a href={`/keyword/${nip19.neventEncode(channel)}`}>{channel.name}</a></h3>
		{#if channel.categories.length > 0}
			<div class="categories">
				{#each channel.categories as category (category)}
					<a class="category" href="/category/{encodeURI(category)}">#{category}</a>
				{/each}
			</div>
		{/if}
		<img
			alt=""
			src={URL.canParse(channel.picture ?? '')
				? channel.picture
				: getRoboHashURL(nip19.neventEncode({ id: channel.id }))}
		/>
		<p>
			<Content content={channel.about ?? ''} tags={[]} isAbout={true} />
		</p>
	</div>
</div>

<style>
	.Card__body > .Entry__content {
		display: unset;
	}
	.Card__body > .Entry__content > h3 > a {
		color: var(--internal-link-color);
	}
	.categories .category {
		margin-right: 0.5em;
	}
</style>
