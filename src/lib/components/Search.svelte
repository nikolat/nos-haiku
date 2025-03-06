<script lang="ts">
	import type { ChannelContent, ProfileContentEvent } from '$lib/utils';
	import Header from '$lib/components/Header.svelte';
	import * as nip19 from 'nostr-tools/nip19';
	import { _ } from 'svelte-i18n';

	const {
		loginPubkey,
		currentProfilePointer,
		query,
		urlSearchParams,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedWords,
		mutedHashTags,
		isEnabledRelativeTime,
		nowRealtime
	}: {
		loginPubkey: string | undefined;
		currentProfilePointer: nip19.ProfilePointer | undefined;
		query: string;
		urlSearchParams: URLSearchParams;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedWords: string[];
		mutedHashTags: string[];
		isEnabledRelativeTime: boolean;
		nowRealtime: number;
	} = $props();
	const channelMapSearched: Map<string, ChannelContent> = $derived.by(() => {
		const channelMapSearched = new Map<string, ChannelContent>();
		for (const [k, v] of channelMap) {
			if (v.name?.toLowerCase().includes(query.toLowerCase())) {
				channelMapSearched.set(k, v);
			}
		}
		return channelMapSearched;
	});
</script>

<Header
	{loginPubkey}
	{currentProfilePointer}
	{query}
	{urlSearchParams}
	{profileMap}
	{mutedPubkeys}
	{mutedWords}
	{mutedHashTags}
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
						<span class="Search__title">
							<span class="Search__leader">
								<i class="fa-fw fas fa-search"></i>
								{$_('Search.search-for')}:{query}
							</span>
						</span>
					</div>
				</div>
				<div class="Search__body">
					<ul>
						{#each channelMapSearched.values() as channel (channel.id)}
							<li>
								<a href="/keyword/{nip19.neventEncode(channel)}" class="">{channel.name}</a>
							</li>
						{:else}
							<li>{$_('Search.nothing-found-for').replace('{query}', query)}</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>
	</div>
</main>
