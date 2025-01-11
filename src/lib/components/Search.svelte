<script lang="ts">
	import type { ChannelContent, ProfileContentEvent } from '$lib/utils';
	import Header from '$lib/components/Header.svelte';
	import * as nip19 from 'nostr-tools/nip19';

	const {
		loginPubkey,
		query,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedWords,
		isEnabledRelativeTime,
		nowRealtime
	}: {
		loginPubkey: string | undefined;
		query: string;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedWords: string[];
		isEnabledRelativeTime: boolean;
		nowRealtime: number;
	} = $props();
	const channelMapSearched: Map<string, ChannelContent> = $derived.by(() => {
		const channelMapSearched = new Map<string, ChannelContent>();
		for (const [k, v] of channelMap) {
			if (v.name.toLowerCase().includes(query.toLowerCase())) {
				channelMapSearched.set(k, v);
			}
		}
		return channelMapSearched;
	});
</script>

<Header
	{loginPubkey}
	{profileMap}
	{mutedPubkeys}
	{mutedWords}
	{isEnabledRelativeTime}
	{nowRealtime}
	isEnabledScrollInfinitely={false}
/>
<main class="SearchView View">
	<div class="Layout">
		<div class="Column Column--main">
			<div class="Search__results">
				<div class="Search__head">
					<div class="Search__info">
						<span class="Search__title"
							><input type="search" placeholder="キーワード" value={query} />
							<span class="Search__leader"
								><i class="fa-fw fas fa-search"></i> お題を探す:
							</span></span
						>
					</div>
				</div>
				<div class="Search__body">
					<ul>
						{#each channelMapSearched as [k, v]}
							<li style="">
								<a href="/keyword/{nip19.neventEncode({ id: k })}" class=""> {v.name} </a>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>
	</div>
</main>
