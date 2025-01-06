<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import type { ChannelContent } from '$lib/utils';
	import Content from '$lib/components/Content.svelte';
	import * as nip19 from 'nostr-tools/nip19';

	const { channel }: { channel: ChannelContent } = $props();
</script>

<div class="Card__body">
	<a href={`/keyword/${nip19.neventEncode(channel)}`}>{channel.name}</a>
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

<style>
	.Card__body > a {
		color: var(--internal-link-color);
	}
</style>
