<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import { urlLinkString, type ChannelContent, type ProfileContentEvent } from '$lib/utils';
	import { getEventById, getEventByAddressPointer, getProfileName } from '$lib/resource.svelte';
	import Entry from '$lib/components/Entry.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';

	let {
		content,
		tags,
		channelMap = new Map<string, ChannelContent>(),
		profileMap = new Map<string, ProfileContentEvent>(),
		loginPubkey = undefined,
		mutedPubkeys = [],
		mutedChannelIds = [],
		mutedWords = [],
		mutedHashTags = [],
		eventsTimeline = [],
		eventsReaction = [],
		uploaderSelected = '',
		channelToPost = $bindable(),
		currentChannelId,
		level = 0,
		isAbout = false,
		enableAutoLink = true,
		isEnabledRelativeTime = true,
		nowRealtime = 0
	}: {
		content: string;
		tags: string[][];
		channelMap?: Map<string, ChannelContent>;
		profileMap?: Map<string, ProfileContentEvent>;
		loginPubkey?: string | undefined;
		mutedPubkeys?: string[];
		mutedChannelIds?: string[];
		mutedWords?: string[];
		mutedHashTags?: string[];
		eventsTimeline?: NostrEvent[];
		eventsReaction?: NostrEvent[];
		uploaderSelected?: string;
		channelToPost?: ChannelContent;
		currentChannelId?: string;
		level?: number;
		isAbout?: boolean;
		enableAutoLink?: boolean;
		isEnabledRelativeTime?: boolean;
		nowRealtime?: number;
	} = $props();

	const getExpandTagsList = (
		content: string,
		tags: string[][]
	): [IterableIterator<RegExpMatchArray>, string[], { [key: string]: string }] => {
		const regMatchArray = [
			'https?://[\\w!?/=+\\-_~:;.,*&@#$%()[\\]]+',
			'nostr:npub1\\w{58}',
			'nostr:nprofile1\\w+',
			'nostr:note1\\w{58}',
			'nostr:nevent1\\w+',
			'nostr:naddr1\\w+',
			'#[^\\s#]+'
		];
		const emojiUrls: { [key: string]: string } = {};
		const emojiRegs = [];
		for (const tag of tags) {
			if (tag.length >= 3 && tag[0] === 'emoji' && /\w+/.test(tag[1]) && URL.canParse(tag[2])) {
				emojiRegs.push(`:${tag[1]}:`);
				emojiUrls[`:${tag[1]}:`] = tag[2];
			}
		}
		if (emojiRegs.length > 0) {
			regMatchArray.push(emojiRegs.join('|'));
		}
		const regMatch = new RegExp(regMatchArray.map((v) => '(' + v + ')').join('|'), 'g');
		const regSplit = new RegExp(regMatchArray.join('|'));
		const plainTexts = content.split(regSplit);
		const matchesIterator = content.matchAll(regMatch);
		return [matchesIterator, plainTexts, emojiUrls];
	};

	const [matchesIterator, plainTexts, emojiUrls] = $derived(getExpandTagsList(content, tags));

	const nip19decode = (text: string): nip19.DecodeResult | null => {
		try {
			return nip19.decode(text);
		} catch (_error) {
			return null;
		}
	};
</script>

{plainTexts.shift()}{#each Array.from(matchesIterator) as match}
	{#if /^https?:\/\/\S+/.test(match[1]) && URL.canParse(match[1])}
		{@const [url, rest] = urlLinkString(match[1])}
		{@const ytb1 = url.match(/^https?:\/\/(www|m)\.youtube\.com\/watch\?v=([\w-]+)/i)}
		{@const ytb2 = url.match(/^https?:\/\/youtu\.be\/([\w-]+)(\?\w+)?/i)}
		{@const ytb3 = url.match(/^https?:\/\/youtube\.com\/shorts\/([\w-]+)(\?\w+)?/i)}
		{#if !enableAutoLink}
			{url}
		{:else if ytb1 ?? ytb2 ?? ytb3}
			{@const video_id = ytb1?.at(2) ?? ytb2?.at(1) ?? ytb3?.at(1)}
			{#if video_id !== undefined}
				<iframe
					class="youtube"
					loading="lazy"
					title="YouTube"
					src={`https://www.youtube-nocookie.com/embed/${video_id}?origin=${encodeURIComponent(location.origin)}`}
				></iframe>
			{:else}
				<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
			{/if}
		{:else if /^https?:\/\/\S+\.(jpe?g|png|gif|webp)/i.test(url)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<img
				alt=""
				class="Image"
				src={url}
				onclick={(e) => e.currentTarget.classList.toggle('expanded')}
			/>
		{:else if /^https?:\/\/\S+\.(mp4|mov)/i.test(url)}
			<video controls preload="metadata">
				<track kind="captions" />
				<source src={url} />
			</video>
		{:else if /^https?:\/\/\S+\.(mp3|m4a|wav|ogg|aac)/i.test(url)}
			<audio controls preload="metadata" src={url}></audio>
		{:else}
			<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
		{/if}{rest}
	{:else if /nostr:npub1\w{58}/.test(match[2])}
		{@const matchedText = match[2]}
		{@const npubText = matchedText.replace(/nostr:/, '')}
		{@const d = nip19decode(npubText)}
		{#if d?.type === 'npub'}
			{@const prof = profileMap.get(d.data)}
			<a href="/{npubText}"
				><img
					src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(d.data))}
					alt={getProfileName(prof)}
					title={getProfileName(prof)}
					class="Avatar"
				/>{getProfileName(prof)}</a
			>
		{:else}{matchedText}
		{/if}
	{:else if /nostr:nprofile1\w+/.test(match[3])}
		{@const matchedText = match[3]}
		{@const nprofileText = matchedText.replace(/nostr:/, '')}
		{@const d = nip19decode(nprofileText)}
		{#if d?.type === 'nprofile'}
			{@const prof = profileMap.get(d.data.pubkey)}
			<a href="/{nprofileText}"
				><img
					src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(d.data.pubkey))}
					alt={getProfileName(prof)}
					title={getProfileName(prof)}
					class="Avatar"
				/>{getProfileName(prof)}</a
			>
		{:else}{matchedText}
		{/if}
	{:else if /nostr:note1\w{58}/.test(match[4])}
		{@const matchedText = match[4]}
		{@const d = nip19decode(matchedText.replace(/nostr:/, ''))}
		{#if d?.type === 'note'}
			{@const eventId = d.data}
			{@const event = getEventById(eventId)}
			{#if event !== undefined}
				<Entry
					{event}
					{channelMap}
					{profileMap}
					{loginPubkey}
					{mutedPubkeys}
					{mutedChannelIds}
					{mutedWords}
					{mutedHashTags}
					{eventsTimeline}
					{eventsReaction}
					{uploaderSelected}
					bind:channelToPost
					{currentChannelId}
					{isEnabledRelativeTime}
					{nowRealtime}
					level={level + 1}
				/>
			{:else}{matchedText}
			{/if}
		{:else}{matchedText}
		{/if}
	{:else if /nostr:nevent1\w+/.test(match[5])}
		{@const matchedText = match[5]}
		{@const d = nip19decode(matchedText.replace(/nostr:/, ''))}
		{#if d?.type === 'nevent'}
			{@const eventId = d.data.id}
			{@const event = getEventById(eventId)}
			{#if event !== undefined}
				<Entry
					{event}
					{channelMap}
					{profileMap}
					{loginPubkey}
					{mutedPubkeys}
					{mutedChannelIds}
					{mutedWords}
					{mutedHashTags}
					{eventsTimeline}
					{eventsReaction}
					{uploaderSelected}
					bind:channelToPost
					{currentChannelId}
					{isEnabledRelativeTime}
					{nowRealtime}
					level={level + 1}
				/>
			{:else}{matchedText}
			{/if}
		{:else}{matchedText}
		{/if}
	{:else if /nostr:naddr1\w+/.test(match[6])}
		{@const matchedText = match[6]}
		{@const d = nip19decode(matchedText.replace(/nostr:/, ''))}
		{#if d?.type === 'naddr'}
			{@const event = getEventByAddressPointer(d.data)}
			{#if event !== undefined}
				<Entry
					{event}
					{channelMap}
					{profileMap}
					{loginPubkey}
					{mutedPubkeys}
					{mutedChannelIds}
					{mutedWords}
					{mutedHashTags}
					{eventsTimeline}
					{eventsReaction}
					{uploaderSelected}
					bind:channelToPost
					{currentChannelId}
					{isEnabledRelativeTime}
					{nowRealtime}
					level={level + 1}
				/>
			{:else}{matchedText}
			{/if}
		{:else}{matchedText}
		{/if}
	{:else if /#\S+/.test(match[7])}
		{@const matchedText = match[7]}
		{@const hashTagText = matchedText.replace('#', '').toLowerCase()}
		{@const tTags = tags
			.filter((tag) => tag.length >= 2 && tag[0] === 't')
			.map((tag) => tag[1].toLowerCase())}
		{#if tTags.includes(hashTagText)}
			<a href="/hashtag/{encodeURI(hashTagText.toLowerCase())}">{matchedText}</a>
		{:else}
			{matchedText}
		{/if}
	{:else if match[8]}
		{@const matchedText = match[8]}
		<img
			src={emojiUrls[matchedText]}
			alt={matchedText}
			title={matchedText}
			class={isAbout ? 'Avatar' : 'emoji'}
		/>
	{/if}{plainTexts.shift()}
{/each}

<style>
	.Avatar {
		width: 14px;
		height: 14px;
	}
	.emoji {
		height: 32px;
		vertical-align: top;
	}
</style>
