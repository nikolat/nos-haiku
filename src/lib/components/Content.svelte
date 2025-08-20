<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import {
		getName,
		urlLinkString,
		type ChannelContent,
		type ProfileContentEvent
	} from '$lib/utils';
	import type { RelayConnector } from '$lib/resource';
	import Entry from '$lib/components/Entry.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { normalizeURL } from 'nostr-tools/utils';
	import * as nip19 from 'nostr-tools/nip19';
	import { getTagValue } from 'applesauce-core/helpers';
	import { onMount } from 'svelte';

	let {
		rc,
		content,
		tags,
		channelMap = new Map<string, ChannelContent>(),
		profileMap = new Map<string, ProfileContentEvent>(),
		loginPubkey = undefined,
		mutedPubkeys = [],
		mutedChannelIds = [],
		mutedWords = [],
		mutedHashtags = [],
		followingPubkeys = [],
		eventFollowList,
		eventEmojiSetList,
		eventMuteList,
		eventsTimeline = [],
		eventsQuoted = [],
		eventsReaction = [],
		eventsBadge = [],
		eventsPoll = [],
		eventsEmojiSet = [],
		eventsChannelBookmark = [],
		getSeenOn = () => [],
		uploaderSelected = '',
		channelToPost = $bindable(),
		currentChannelId,
		level = 0,
		isPreview,
		callInsertText,
		baseEventToEdit = $bindable(),
		isAbout = false,
		enableAutoLink = true,
		isEnabledRelativeTime = true,
		isEnabledEventProtection = false,
		clientTag,
		nowRealtime = 0
	}: {
		rc?: RelayConnector | undefined;
		content: string;
		tags: string[][];
		channelMap?: Map<string, ChannelContent>;
		profileMap?: Map<string, ProfileContentEvent>;
		loginPubkey?: string | undefined;
		mutedPubkeys?: string[];
		mutedChannelIds?: string[];
		mutedWords?: string[];
		mutedHashtags?: string[];
		followingPubkeys?: string[];
		eventFollowList?: NostrEvent | undefined;
		eventEmojiSetList?: NostrEvent | undefined;
		eventMuteList?: NostrEvent | undefined;
		eventsTimeline?: NostrEvent[];
		eventsQuoted?: NostrEvent[];
		eventsReaction?: NostrEvent[];
		eventsBadge?: NostrEvent[];
		eventsPoll?: NostrEvent[];
		eventsEmojiSet?: NostrEvent[];
		eventsChannelBookmark?: NostrEvent[];
		getSeenOn?: (id: string, excludeWs: boolean) => string[];
		uploaderSelected?: string;
		channelToPost?: ChannelContent;
		currentChannelId?: string;
		level?: number;
		isPreview?: boolean;
		callInsertText?: (word: string) => void;
		baseEventToEdit?: NostrEvent | undefined;
		isAbout?: boolean;
		enableAutoLink?: boolean;
		isEnabledRelativeTime?: boolean;
		isEnabledEventProtection?: boolean;
		clientTag?: string[] | undefined;
		nowRealtime?: number;
	} = $props();

	type Token =
		| {
				type: 'text';
				value: string;
		  }
		| {
				type: 'link';
				href: string;
				value: string;
		  }
		| {
				type: 'relay';
				href: string;
				value: string;
		  }
		| {
				type: 'mention';
				decoded: nip19.DecodedResult;
				encoded: string;
				value: string;
		  }
		| {
				type: 'hashtag';
				hashtag: string;
				value: string;
		  }
		| {
				type: 'emoji';
				code: string;
				url: string;
		  };

	const getExpandTagsList = (content: string, tags: string[][]) => {
		const regMatchArray = [
			'https?://[\\w!?/=+\\-_~:;.,*&@#$%()[\\]]+',
			'wss?://[\\w!?/=+\\-_~:;.,*&@#$%()[\\]]+',
			'nostr:npub1[a-z\\d]{58}',
			'nostr:nprofile1[a-z\\d]+',
			'nostr:note1[a-z\\d]+',
			'nostr:nevent1[a-z\\d]+',
			'nostr:naddr1[a-z\\d]+',
			'#[^\\s#]+'
		];
		const emojiUrlMap: Map<string, string> = new Map<string, string>();
		for (const tag of tags) {
			if (tag.length >= 3 && tag[0] === 'emoji' && /\w+/.test(tag[1]) && URL.canParse(tag[2])) {
				emojiUrlMap.set(`:${tag[1]}:`, tag[2]);
			}
		}
		if (emojiUrlMap.size > 0) {
			regMatchArray.push(Array.from(emojiUrlMap.keys()).join('|'));
		}
		const regMatch = new RegExp(regMatchArray.map((v) => `(${v})`).join('|'), 'g');
		const regSplit = new RegExp(regMatchArray.join('|'));

		const plainTexts = content.split(regSplit);
		const matchesIterator = content.matchAll(regMatch);
		const children: [Token] = [
			{
				type: 'text',
				value: plainTexts[0]
			}
		];
		let i = 1;
		for (const m of matchesIterator) {
			const mLink = m.at(1);
			const mRelay = m.at(2);
			const mMention = m.at(3) ?? m.at(4) ?? m.at(5) ?? m.at(6) ?? m.at(7);
			const mHashTag = m.at(8);
			const mShortcode = m.at(9);
			const mMentionDecoded: nip19.DecodedResult | null =
				mMention === undefined ? null : nip19decode(mMention.replace(/nostr:/, ''));
			if (mLink !== undefined && /^https?:\/\/\S+/.test(mLink) && URL.canParse(mLink)) {
				children.push({
					type: 'link',
					href: new URL(mLink).toString(),
					value: mLink
				});
			} else if (mRelay !== undefined && /^wss?:\/\/\S+/.test(mRelay) && URL.canParse(mRelay)) {
				children.push({
					type: 'relay',
					href: normalizeURL(mRelay),
					value: mRelay
				});
			} else if (mMention !== undefined && mMentionDecoded !== null) {
				children.push({
					type: 'mention',
					decoded: mMentionDecoded,
					encoded: mMention.replace(/nostr:/, ''),
					value: mMention
				});
			} else if (mHashTag !== undefined) {
				children.push({
					type: 'hashtag',
					hashtag: mHashTag.replace('#', '').toLowerCase(),
					value: mHashTag
				});
			} else if (mShortcode !== undefined) {
				children.push({
					type: 'emoji',
					code: mShortcode,
					url: emojiUrlMap.get(mShortcode)!
				});
			} else {
				children.push({
					type: 'text',
					value: mLink ?? mMention ?? ''
				});
			}
			children.push({
				type: 'text',
				value: plainTexts[i]
			});
			i++;
		}
		return {
			type: 'root',
			event: undefined,
			children
		};
	};

	const eventsAll: NostrEvent[] = $derived.by(() => {
		const eventMap = new Map<string, NostrEvent>();
		for (const ev of [...eventsTimeline, ...eventsQuoted]) {
			eventMap.set(ev.id, ev);
		}
		return Array.from(eventMap.values());
	});

	const nip19decode = (text: string): nip19.DecodedResult | null => {
		try {
			return nip19.decode(text);
		} catch (_error) {
			return null;
		}
	};

	const ats = $derived(getExpandTagsList(content, tags));

	const appendRelay = (baseUrl: string, relayUrl: string): string => {
		const url = new URL(baseUrl);
		if (!url.searchParams.getAll('relay').includes(relayUrl)) {
			url.searchParams.append('relay', relayUrl);
		}
		return url.href;
	};

	let responseMap: Map<string, Response> | undefined = $state();
	onMount(async () => {
		const rMap = new Map<string, Response>();
		for (const ct of ats.children) {
			if (ct.type === 'link') {
				const [url, _rest] = urlLinkString(ct.value);
				let response: Response;
				try {
					response = await fetch(url, { method: 'HEAD' });
				} catch (_error) {
					continue;
				}
				rMap.set(url, response);
			}
		}
		responseMap = rMap;
	});
</script>

{#each ats.children as ct, i (i)}
	{#if ct.type === 'link'}
		{@const [url, rest] = urlLinkString(ct.value)}
		{@const ytb1 = url.match(/^https?:\/\/(www|m)\.youtube\.com\/watch\?v=([\w-]+)/i)}
		{@const ytb2 = url.match(/^https?:\/\/youtu\.be\/([\w-]+)(\?\w+)?/i)}
		{@const ytb3 = url.match(/^https?:\/\/(www\.)?youtube\.com\/(shorts|live)\/([\w-]+)(\?\w+)?/i)}
		{#if !enableAutoLink}
			{url}
		{:else if ytb1 ?? ytb2 ?? ytb3}
			{@const video_id = ytb1?.at(2) ?? ytb2?.at(1) ?? ytb3?.at(3)}
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
		{:else}
			{@const response = responseMap?.get(url)}
			{#if response === undefined}
				<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
			{:else if response.ok}
				{@const ctype = response.headers.get('content-type')}
				{#if ctype === null}
					<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
				{:else if ctype.startsWith('image/')}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<img
						alt=""
						class="Image"
						src={url}
						onclick={(e) => e.currentTarget.classList.toggle('expanded')}
					/>
				{:else if ctype.startsWith('video/')}
					<video controls preload="metadata">
						<track kind="captions" />
						<source src={url} />
					</video>
				{:else if ctype.startsWith('audio/')}
					<audio controls preload="metadata" src={url}></audio>
				{:else}
					<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
				{/if}
			{:else if response.status === 403}
				{#if /^https?:\/\/\S+\.(jpe?g|png|gif|webp|svg)/i.test(url)}
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
				{/if}
			{:else}
				<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
			{/if}
		{/if}{rest}
	{:else if ct.type === 'relay'}
		<a href={appendRelay(location.href, ct.href)}>{ct.value}</a>
	{:else if ct.type === 'mention'}
		{@const d = ct.decoded}
		{#if ['npub', 'nprofile'].includes(d.type)}
			{@const hex = d.type === 'npub' ? d.data : d.type === 'nprofile' ? d.data.pubkey : ''}
			{@const enc = ct.encoded}
			{@const prof = profileMap.get(hex)}
			{@const nameToShow = getName(hex, profileMap, eventFollowList, false, true)}
			<a href="/{enc}"
				><img
					src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(hex))}
					alt={nameToShow}
					title={nameToShow}
					class="Avatar"
				/>{nameToShow}</a
			>
		{:else if ['note', 'nevent', 'naddr'].includes(d.type)}
			{@const event =
				d.type === 'naddr'
					? eventsAll.find(
							(ev) =>
								ev.kind === d.data.kind &&
								ev.pubkey === d.data.pubkey &&
								(getTagValue(ev, 'd') ?? '') === d.data.identifier
						)
					: eventsAll.find(
							(ev) => ev.id === (d.type === 'note' ? d.data : d.type === 'nevent' ? d.data.id : '')
						)}
			{#if event !== undefined && level < 10}
				<Entry
					{event}
					{rc}
					{channelMap}
					{profileMap}
					{loginPubkey}
					{mutedPubkeys}
					{mutedChannelIds}
					{mutedWords}
					{mutedHashtags}
					{followingPubkeys}
					{eventFollowList}
					{eventEmojiSetList}
					{eventMuteList}
					{eventsTimeline}
					{eventsQuoted}
					{eventsReaction}
					{eventsBadge}
					{eventsPoll}
					{eventsEmojiSet}
					{eventsChannelBookmark}
					{getSeenOn}
					{uploaderSelected}
					bind:channelToPost
					{currentChannelId}
					{isEnabledRelativeTime}
					{isEnabledEventProtection}
					{clientTag}
					{nowRealtime}
					level={level + 1}
					isFullDisplayMode={false}
					isPreview={isPreview ?? false}
					callInsertText={callInsertText ?? (() => {})}
					bind:baseEventToEdit
				/>
			{:else}
				{@const enc = ct.encoded}
				<a href={`/entry/${enc}`}>{`nostr:${enc}`}</a>
			{/if}
		{/if}
	{:else if ct.type === 'hashtag'}
		{@const tTags = tags
			.filter((tag) => tag.length >= 2 && tag[0] === 't')
			.map((tag) => tag[1].toLowerCase())}
		{#if tTags.includes(ct.hashtag)}
			<a href="/hashtag/{encodeURI(ct.hashtag)}">{ct.value}</a>
		{:else}
			{ct.value}
		{/if}
	{:else if ct.type === 'emoji'}
		<img src={ct.url} alt={ct.code} title={ct.code} class={isAbout ? 'Avatar' : 'emoji'} />
	{:else if ct.type === 'text'}
		{ct.value}
	{/if}
{/each}

<style>
	.Avatar {
		width: 14px;
		height: 14px;
	}
	.emoji {
		height: 1.5em;
		vertical-align: top;
	}
</style>
