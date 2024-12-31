<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import type { ChannelContent } from '$lib/utils';
	import Content from '$lib/components/Content.svelte';
	import * as nip19 from 'nostr-tools/nip19';

	const { channel, level = 0 }: { channel: ChannelContent; level?: number } = $props();

	const classNames: string[] = $derived.by(() => {
		const classNames: string[] = ['Card__body'];
		if (level > 0) {
			classNames.push('Quote');
		}
		if (level > 0 && level % 2 === 0) {
			classNames.push('Even');
		} else if (level % 2 === 1) {
			classNames.push('Odd');
		}
		return classNames;
	});
</script>

<div class={classNames.join(' ')}>
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
	.Quote.Odd {
		background-color: rgba(255, 127, 127, 0.1);
	}
	.Quote.Even {
		background-color: rgba(127, 127, 255, 0.1);
	}
</style>
