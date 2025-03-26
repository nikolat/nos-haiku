<script lang="ts">
	import { getClientURL, getRoboHashURL } from '$lib/config';
	import {
		getAbsoluteTime,
		getAddressPointerFromAId,
		getEvent9734,
		getRelativeTime,
		getRelaysToUseFromKind10002Event,
		splitNip51ListPublic,
		zap,
		type ChannelContent,
		type ProfileContentEvent
	} from '$lib/utils';
	import {
		bookmarkBadge,
		bookmarkEmojiSets,
		getChannelBookmarkMap,
		getEventByAddressPointer,
		getEventById,
		getEventsReplying,
		getProfileId,
		getProfileName,
		getRelaysToUse,
		getSeenOn,
		sendDeletion,
		sendEvent,
		sendRepost,
		unbookmarkBadge,
		unbookmarkEmojiSets
	} from '$lib/resource.svelte';
	import Profile from '$lib/components/kinds/Profile.svelte';
	import DirectMessage from '$lib/components/kinds/DirectMessage.svelte';
	import Reaction from '$lib/components/kinds/Reaction.svelte';
	import ChannelMeta from '$lib/components/kinds/ChannelMeta.svelte';
	import MuteList from '$lib/components/kinds/MuteList.svelte';
	import RelayList from '$lib/components/kinds/RelayList.svelte';
	import ChannelList from '$lib/components/kinds/ChannelList.svelte';
	import Badges from '$lib/components/kinds/Badges.svelte';
	import Poll from '$lib/components/kinds/Poll.svelte';
	import AddStar from '$lib/components/AddStar.svelte';
	import Content from '$lib/components/Content.svelte';
	import Entry from '$lib/components/Entry.svelte';
	import CreateEntry from '$lib/components/CreateEntry.svelte';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { getEventHash, type NostrEvent, type UnsignedEvent } from 'nostr-tools/pure';
	import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
	import * as nip19 from 'nostr-tools/nip19';
	import { decode } from 'light-bolt11-decoder';
	import { _ } from 'svelte-i18n';

	let {
		event,
		channelMap,
		profileMap,
		loginPubkey,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		mutedHashTags,
		followingPubkeys,
		eventsTimeline,
		eventsReaction,
		eventsEmojiSet,
		uploaderSelected,
		channelToPost = $bindable(),
		currentChannelId,
		isEnabledRelativeTime,
		nowRealtime,
		level,
		isPreview,
		callInsertText,
		baseEventToEdit = $bindable()
	}: {
		event: NostrEvent;
		channelMap: Map<string, ChannelContent>;
		profileMap: Map<string, ProfileContentEvent>;
		loginPubkey: string | undefined;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashTags: string[];
		followingPubkeys: string[];
		eventsTimeline: NostrEvent[];
		eventsReaction: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		uploaderSelected: string;
		channelToPost: ChannelContent | undefined;
		currentChannelId: string | undefined;
		isEnabledRelativeTime: boolean;
		nowRealtime: number;
		level: number;
		isPreview: boolean;
		callInsertText: (word: string, enableNewline?: boolean) => void;
		baseEventToEdit: NostrEvent | undefined;
	} = $props();

	let previewEvent: UnsignedEvent | undefined = $state();

	const getRootId = (event: NostrEvent | undefined): string | undefined => {
		if (event === undefined) {
			return undefined;
		}
		const rootIds: string[] = event.tags
			.filter((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
			.map((tag) => tag.at(1))
			.filter((id) => id !== undefined);
		if (rootIds.length !== 1) {
			return undefined;
		}
		const rootId = rootIds[0];
		try {
			nip19.neventEncode({ id: rootId });
		} catch (_error) {
			return undefined;
		}
		return rootId;
	};
	const channelId: string | undefined = $derived(event.kind === 42 ? getRootId(event) : undefined);
	const channel: ChannelContent | undefined = $derived(channelMap.get(channelId ?? ''));
	const eventsReactionToTheEvent: NostrEvent[] = $derived(
		eventsReaction.filter((ev) => {
			const a = ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1);
			if (a !== undefined) {
				const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
				return a === `${event.kind}:${event.pubkey}:${d}`;
			} else {
				return (
					ev.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 'e')
						.at(-1)
						?.at(1) === event.id && !mutedPubkeys.includes(event.pubkey)
				);
			}
		})
	);
	const isMutedPubkey: boolean = $derived(mutedPubkeys.includes(event.pubkey));
	const isMutedChannel: boolean = $derived(mutedChannelIds.includes(channelId ?? ''));
	const isMutedContent: boolean = $derived(
		mutedWords.some((word) => event.content.toLowerCase().includes(word))
	);
	const isMutedHashTag: boolean = $derived(
		event.kind !== 10000 &&
			mutedHashTags.some(
				(t) =>
					event.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 't')
						.map((tag) => tag[1].toLowerCase())
						.includes(t) ||
					(channel !== undefined && channel.categories.includes(t))
			)
	);
	const getUrlViaProxy = (
		event: NostrEvent,
		protocol: string,
		validate: boolean = true
	): string | undefined => {
		const url = event.tags
			.find((tag) => tag.length >= 3 && tag[0] === 'proxy' && tag[2] === protocol)
			?.at(1)
			?.replace(/#.*$/, '');
		if (validate) {
			return URL.canParse(url ?? '') ? url : undefined;
		} else {
			return url;
		}
	};
	const urlViaAP: string | undefined = $derived(getUrlViaProxy(event, 'activitypub'));
	const urlViaRSS: string | undefined = $derived(getUrlViaProxy(event, 'rss'));
	const urlViaWeb: string | undefined = $derived(getUrlViaProxy(event, 'web'));
	const urlViaATP: string | undefined = $derived.by(() => {
		const uri = getUrlViaProxy(event, 'atproto', false);
		if (uri === undefined) {
			return undefined;
		}
		const m = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
		if (m === null) {
			return undefined;
		}
		const url = `https://bsky.app/profile/${m[1]}/post/${m[2]}`;
		return url;
	});
	const clientInfo: { name: string; url: string } | undefined = $derived.by(() => {
		const tag = event.tags.find((tag) => tag.length >= 3 && tag[0] === 'client');
		const aId = tag?.at(2);
		if (tag === undefined || aId === undefined) {
			return undefined;
		}
		const ap: nip19.AddressPointer | null = getAddressPointerFromAId(aId);
		if (ap === null) {
			return undefined;
		}
		const relayHint = URL.canParse(tag.at(3) ?? '') ? tag[3] : null;
		if (relayHint !== null) {
			ap.relays = [relayHint];
		}
		const naddr = nip19.naddrEncode(ap);
		const url = getClientURL(naddr);
		const name = tag[1];
		return { name, url };
	});
	const contentWarningReason: string | null = $derived.by(() => {
		const cwTag: string[] | undefined = event.tags.find((tag) => tag[0] === 'content-warning');
		if (cwTag === undefined) {
			return null;
		}
		if (cwTag[1] === undefined) {
			return '';
		}
		return cwTag[1];
	});
	const pubkeysMentioningTo: string[] = $derived(
		Array.from(
			new Set<string>(
				event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1])
			)
		)
	);
	const classNames: string[] = $derived.by(() => {
		const classNames: string[] = ['Entry'];
		if (level > 0) {
			classNames.push('Quote');
		}
		if (level > 0 && level % 2 === 0) {
			classNames.push('Even');
		} else if (level % 2 === 1) {
			classNames.push('Odd');
		}
		if (isMutedPubkey) {
			classNames.push('Muted-pubkey');
		}
		if (isMutedChannel) {
			classNames.push('Muted-channel');
		}
		if (isMutedContent) {
			classNames.push('Muted-content');
		}
		if (isMutedHashTag) {
			classNames.push('Muted-hashtag');
		}
		if (contentWarningReason !== null) {
			classNames.push('ContentWarning');
		}
		if (loginPubkey !== undefined && pubkeysMentioningTo.includes(loginPubkey)) {
			classNames.push('mentioning');
		}
		if (nowRealtime < event.created_at - 5) {
			classNames.push('future');
		}
		return classNames;
	});
	let showCW: boolean = $state(false);
	let showMutedPubkey: boolean = $state(false);
	let showMutedChannel: boolean = $state(false);
	let showMutedContent: boolean = $state(false);
	let showMutedHashTag: boolean = $state(false);
	let showReplies: boolean = $state(false);

	const prof: ProfileContentEvent | undefined = $derived(profileMap.get(event.pubkey));
	const idReplyTo: string | undefined = $derived.by(() => {
		const getId = (marker: string) =>
			event.tags.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === marker)?.at(1);
		if (event.kind === 1) {
			return getId('reply') ?? getId('root') ?? undefined;
		} else if (event.kind === 42) {
			return getId('reply');
		} else if (event.kind === 1111) {
			return event.tags.find((tag) => tag.length >= 4 && tag[0] === 'e')?.at(1);
		}
		return undefined;
	});
	const addressReplyTo: nip19.AddressPointer | undefined = $derived.by(() => {
		if (event.kind !== 1111) {
			return undefined;
		}
		const aId = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1);
		if (aId === undefined) {
			return undefined;
		}
		const ap: nip19.AddressPointer | null = getAddressPointerFromAId(aId);
		if (ap === null) {
			return undefined;
		}
		return ap;
	});
	const textAndUrlReplyTo: [string, string] | undefined = $derived.by(() => {
		if (event.kind !== 1111) {
			return undefined;
		}
		const i = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'i')?.at(1);
		const k = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'k')?.at(1);
		const iAlt = event.tags.find((tag) => tag.length >= 3 && tag[0] === 'i')?.at(2);
		if (i !== undefined && k !== undefined && URL.canParse(i) && URL.canParse(k)) {
			return [i, i];
		} else if (i !== undefined && iAlt !== undefined && URL.canParse(iAlt)) {
			return [i, iAlt];
		} else {
			return undefined;
		}
	});
	const pubkeyReplyTo: string | undefined = $derived(
		getEventById(idReplyTo ?? '')?.pubkey ?? addressReplyTo?.pubkey
	);
	const profReplyTo: ProfileContentEvent | undefined = $derived(
		pubkeyReplyTo === undefined ? undefined : profileMap.get(pubkeyReplyTo)
	);
	const eventReplyTo: NostrEvent | undefined = $derived.by(() => {
		if (idReplyTo !== undefined) {
			return getEventById(idReplyTo);
		} else if (addressReplyTo !== undefined) {
			return getEventByAddressPointer(addressReplyTo);
		}
		return undefined;
	});

	let showForm: boolean = $state(false);
	let showJson: boolean = $state(false);
	let showRepost: boolean = $state(false);

	const repostedEventId: string | undefined = $derived(
		event.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1)
	);
	const repostedEvent: NostrEvent | undefined = $derived(getEventById(repostedEventId ?? ''));

	let zapWindowContainer: HTMLElement | undefined = $state();

	type HandlerInformation = {
		name?: string;
		display_name?: string;
		nip05?: string;
		picture?: string;
		banner?: string;
		about?: string;
		lud16?: string;
		website?: string;
	};

	const getHandlerInformation = (content: string): HandlerInformation | null => {
		let obj: HandlerInformation;
		try {
			obj = JSON.parse(content);
		} catch (error) {
			console.warn(error);
			return null;
		}
		return obj;
	};

	const getEncode = (event: NostrEvent, relays?: string[]): string => {
		const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
		return isReplaceableKind(event.kind) || isAddressableKind(event.kind)
			? nip19.naddrEncode({ identifier: d, pubkey: event.pubkey, kind: event.kind, relays })
			: nip19.neventEncode({ ...event, author: event.pubkey, relays });
	};

	const eventsReplying = $derived(getEventsReplying(event));

	let isEmojiPickerOpened: boolean = $state(false);

	const handlerRepost = (ev: MouseEvent): void => {
		const target: HTMLElement | null = ev.target as HTMLElement | null;
		if (!target?.closest('.repost')) {
			showRepost = false;
		}
	};

	onMount(() => {
		document.addEventListener('click', handlerRepost);
	});
	beforeNavigate(() => {
		document.removeEventListener('click', handlerRepost);
	});
	afterNavigate(() => {
		document.addEventListener('click', handlerRepost);
	});
</script>

<article
	class={classNames.join(' ')}
	data-nevent={nip19.neventEncode({ ...event, author: event.pubkey })}
	data-npub={nip19.npubEncode(event.pubkey)}
>
	{#if (!isMutedPubkey || showMutedPubkey) && (!isMutedChannel || showMutedChannel) && (!isMutedContent || showMutedContent) && (!isMutedHashTag || showMutedHashTag)}
		{#if !isPreview && event.kind === 42 && (channelId === undefined || channel === undefined || channel.name === undefined)}
			<details>
				<summary>
					{#if channelId === undefined}
						{$_('Entry.kind42-event-without-valid-channel-id')}
					{:else if channel === undefined}
						{$_('Entry.kind42-event-of-unknown-channel')}
					{:else if channel.name === undefined}
						{$_('Entry.kind42-event-with-unnamed-channel')}
					{/if}
				</summary>
				<div class="Entry__json">
					<pre class="json-view"><code>{JSON.stringify(event, undefined, 2)}</code></pre>
				</div>
			</details>
		{:else}
			<div class="Entry__main">
				<div class="Entry__profile">
					<div>
						<a href="/{nip19.npubEncode(event.pubkey)}">
							<img
								src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(event.pubkey))}
								alt={getProfileName(event.pubkey)}
								class="Avatar"
							/>
						</a>
					</div>
				</div>
				<div class={isEmojiPickerOpened ? 'Post emoji-picker-opened' : 'Post'}>
					<div class="Entry__head">
						<h3 class="Entry__keyword">
							{#if event.kind === 42}
								{#if channel === undefined}
									Channel Message
								{:else}
									<a href="/keyword/{nip19.neventEncode(channel)}">{channel.name}</a>
									{#if currentChannelId === undefined}
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
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="24"
													height="24"
													viewBox="0 0 24 24"
												>
													<path
														fill-rule="evenodd"
														d="M12,21.2037682 L1.48140774,12 L12,2.79623177 L12,8.02302014 C18.5486628,8.33140969 22,11.7344566 22,18 L22,20.4142136 L20.2928932,18.7071068 C18.0460687,16.4602823 15.3097943,15.5189215 12,15.8718462 L12,21.2037682 Z M10,7.20376823 L4.51859226,12 L10,16.7962318 L10,14.1528729 L10.835601,14.0136061 C14.2501827,13.4445091 17.255572,14.0145027 19.7987459,15.7165365 C19.0504666,11.8510227 16.2006399,10 11,10 L10,10 L10,7.20376823 Z"
													/>
												</svg>
											</button>
										</span>
									{/if}
								{/if}
							{:else if event.kind === 0}
								User Metadata
							{:else if event.kind === 1}
								<a href="/{nip19.npubEncode(event.pubkey)}">{getProfileId(prof)}</a>
							{:else if event.kind === 3}
								Follows
							{:else if [6, 16].includes(event.kind)}
								<span title={`kind:${event.kind} repost`}>🔁</span>
								{#if event.kind === 6}
									<a href="/{nip19.npubEncode(event.pubkey)}">id:{prof?.name ?? 'none'}</a>
								{:else if event.kind === 16 && event.tags.some((tag) => tag.length >= 2 && tag[0] === 'k' && tag[1] === '42')}
									{@const channelIdReposted = getRootId(repostedEvent)}
									{@const repostedChannel = channelMap.get(channelIdReposted ?? '')}
									{#if channelIdReposted === undefined}
										invalid channel
									{:else if repostedChannel !== undefined}
										<a href="/keyword/{nip19.neventEncode(repostedChannel)}"
											>{repostedChannel.name ?? 'unknown'}</a
										>
									{:else}
										<a href="/keyword/{nip19.neventEncode({ id: channelIdReposted })}">unknown</a>
									{/if}
								{/if}
							{:else if [7, 17].includes(event.kind)}
								Reaction <Reaction reactionEvent={event} profile={undefined} isAuthor={false} />
							{:else if event.kind === 4}
								Encrypted Direct Messages
							{:else if event.kind === 8}
								Badge Award
							{:else if event.kind === 20}
								Picture
							{:else if event.kind === 40}
								Channel
							{:else if event.kind === 1018}
								Poll Response
							{:else if event.kind === 1068}
								Poll
							{:else if event.kind === 1111}
								Comment
							{:else if event.kind === 9734}
								{@const sats =
									parseInt(
										event.tags
											.find((tag) => tag.length >= 2 && tag[0] === 'amount' && /^\d+$/.test(tag[1]))
											?.at(1) ?? '-1'
									) / 1000}
								Zap Request {#if sats > 0}{`⚡${sats}`}{/if}
							{:else if event.kind === 9735}
								{@const invoice = decode(
									event.tags.find((tag) => tag.length >= 2 && tag[0] === 'bolt11')?.at(1) ?? ''
								)}
								{@const sats =
									parseInt(
										invoice.sections.find((section) => section.name === 'amount')?.value ?? '-1'
									) / 1000}
								Zap {#if sats > 0}{`⚡${sats}`}{/if}
							{:else if event.kind === 10000}
								Mute list
							{:else if event.kind === 10001}
								Pinned notes
							{:else if event.kind === 10002}
								Relay list
							{:else if event.kind === 10003}
								Bookmarks
							{:else if event.kind === 10005}
								Public chats list
							{:else if event.kind === 10030}
								User emoji list
							{:else if event.kind === 30003}
								Bookmark sets
							{:else if event.kind === 30008}
								Profile Badges
							{:else if event.kind === 30009}
								Badge Definition
							{:else if event.kind === 30023}
								Long-form Content
							{:else if event.kind === 30030}
								Emoji set
							{:else if event.kind === 31990}
								Handler information
							{:else}
								{`unsupported kind:${event.kind} event`}
							{/if}
							{#if isPreview}
								(Preview Mode)
							{/if}
						</h3>
						{#if !isPreview}
							<AddStar
								{event}
								{loginPubkey}
								{profileMap}
								{eventsReactionToTheEvent}
								{eventsEmojiSet}
								{mutedWords}
								bind:isEmojiPickerOpened
							/>
						{/if}
					</div>
					<div class="Entry__body">
						{#if !isPreview && pubkeysMentioningTo.length > 0}
							<span class="Mention">
								To:
								{#each pubkeysMentioningTo.slice(0, 10) as p (p)}
									{@const prof = profileMap.get(p)}
									<a href="/{nip19.npubEncode(p)}">
										<img
											src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(p))}
											alt={getProfileName(p)}
											class="Avatar Avatar--sm"
										/>
									</a>
								{/each}
								{#if pubkeysMentioningTo.length > 10}...{/if}
							</span>
						{/if}
						{#if idReplyTo !== undefined || addressReplyTo !== undefined}
							{@const link =
								idReplyTo !== undefined
									? nip19.neventEncode({ id: idReplyTo, author: pubkeyReplyTo })
									: addressReplyTo !== undefined
										? nip19.naddrEncode(addressReplyTo)
										: undefined}
							<div class="Entry__parentmarker">
								<a href="/entry/{link}">
									<i class="fa-fw fas fa-arrow-alt-from-right"></i>
									<span class="Mention">
										{#if pubkeyReplyTo !== undefined}
											<img
												src={profReplyTo?.picture ??
													getRoboHashURL(nip19.npubEncode(pubkeyReplyTo))}
												alt={getProfileName(pubkeyReplyTo)}
												class="Avatar Avatar--sm"
											/>
										{/if}
										{#if eventReplyTo !== undefined}
											<Content
												content={eventReplyTo.content.split('\n')[0]}
												tags={eventReplyTo.tags}
												{profileMap}
												enableAutoLink={false}
											/>
										{/if}
									</span>
								</a>
							</div>
						{/if}
						<div class="Entry__content">
							{#if contentWarningReason === null || showCW}
								{#if [6, 16].includes(event.kind)}
									{#if repostedEvent !== undefined}
										{#if (event.kind === 6 && repostedEvent.kind === 1) || (event.kind === 16 && repostedEvent.kind !== 1)}
											<Entry
												event={repostedEvent}
												{channelMap}
												{profileMap}
												{loginPubkey}
												{mutedPubkeys}
												{mutedChannelIds}
												{mutedWords}
												{mutedHashTags}
												{followingPubkeys}
												{eventsTimeline}
												{eventsReaction}
												{eventsEmojiSet}
												{uploaderSelected}
												bind:channelToPost
												{currentChannelId}
												{isEnabledRelativeTime}
												{nowRealtime}
												level={level + 1}
												isPreview={false}
												{callInsertText}
												bind:baseEventToEdit
											/>
										{:else}
											<p class="warning-message">
												{$_('Entry.invalid-repost')
													.replace('{repostedEvent-kind}', `${repostedEvent.kind}`)
													.replace('{event-kind}', `${event.kind}`)}
											</p>
										{/if}
									{:else if repostedEventId !== undefined}
										{`nostr:${nip19.neventEncode({ id: repostedEventId })}`}
									{/if}
								{:else if event.kind === 0}
									<Profile
										{loginPubkey}
										currentPubkey={event.pubkey}
										{profileMap}
										{channelMap}
										{eventsTimeline}
										{eventsReaction}
										{eventsEmojiSet}
										{mutedPubkeys}
										{mutedChannelIds}
										{mutedWords}
										{mutedHashTags}
										{followingPubkeys}
									/>
								{:else if event.kind === 3}
									{@const pubkeys = Array.from(
										new Set<string>(
											event.tags
												.filter((tag) => tag.length >= 2 && tag[0] === 'p')
												.map((tag) => tag[1])
										)
									)}
									{`Followees: ${pubkeys.length}`}
								{:else if event.kind === 4}
									{@const pubkeyToSend = event.tags
										.find((tag) => tag.length >= 2 && tag[0] === 'p')
										?.at(1)}
									<DirectMessage
										content={event.content}
										currentPubkey={event.pubkey}
										{loginPubkey}
										{pubkeyToSend}
									/>
								{:else if event.kind === 7}
									{@const eId = event.tags
										.findLast((tag) => tag.length >= 2 && tag[0] === 'e')
										?.at(1)}
									{@const aId = event.tags
										.findLast((tag) => tag.length >= 2 && tag[0] === 'a')
										?.at(1)}
									{@const ap = getAddressPointerFromAId(aId ?? '')}
									{@const reactedEvent =
										ap !== null ? getEventByAddressPointer(ap) : getEventById(eId ?? '')}
									{#if reactedEvent !== undefined}
										<Entry
											event={reactedEvent}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{mutedHashTags}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											level={level + 1}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									{:else if ap !== null}
										{`nostr:${nip19.naddrEncode(ap)}`}
									{:else if eId !== undefined}
										{`nostr:${nip19.neventEncode({ id: eId })}`}
									{/if}
								{:else if event.kind === 8}
									{@const ps = new Set<string>(
										event.tags
											.filter((tag) => tag.length >= 2 && tag[0] === 'p')
											.map((tag) => tag[1])
									)}
									{@const aId = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1)}
									{@const asp = aId?.split(':')}
									{@const ap = aId === undefined ? null : getAddressPointerFromAId(aId)}
									{@const isValidAward =
										event.pubkey === asp?.at(1) && aId !== undefined && ap !== null}
									{#if isValidAward}
										{@const content = ap === null ? '' : `nostr:${nip19.naddrEncode(ap)}`}
										{#if loginPubkey !== undefined && ps.has(loginPubkey)}
											{@const profileBadgesEvent = getEventByAddressPointer({
												identifier: 'profile_badges',
												pubkey: loginPubkey,
												kind: 30008
											})}
											{@const badgeDefinitionEvent = getEventByAddressPointer(ap)}
											{@const aIds =
												profileBadgesEvent?.tags
													.filter((tag) => tag.length >= 2 && tag[0] === 'a')
													.map((tag) => tag[1]) ?? []}
											<div>
												{#if aIds.includes(aId)}
													<div
														title={$_('Entry.remove-from-favorites')}
														class="FavoriteButton FavoriteButton--active"
													>
														<!-- svelte-ignore a11y_click_events_have_key_events -->
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<span
															class="fa-fw fas fa-heart"
															onclick={() => {
																unbookmarkBadge(profileBadgesEvent, aId, event.id);
															}}
														></span>
													</div>
												{:else}
													<div title={$_('Entry.add-to-favorites')} class="FavoriteButton">
														<!-- svelte-ignore a11y_click_events_have_key_events -->
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<span
															class="fa-fw fas fa-heart"
															onclick={() => {
																const recommendedRelayETag = getSeenOn(event.id).at(0);
																const recommendedRelayATag = getSeenOn(
																	badgeDefinitionEvent?.id ?? ''
																).at(0);
																bookmarkBadge(
																	profileBadgesEvent,
																	aId,
																	recommendedRelayATag,
																	event.id,
																	recommendedRelayETag
																);
															}}
														></span>
													</div>
												{/if}
											</div>
										{/if}
										<p>
											<Content
												{content}
												tags={event.tags}
												{channelMap}
												{profileMap}
												{loginPubkey}
												{mutedPubkeys}
												{mutedChannelIds}
												{mutedWords}
												{followingPubkeys}
												{eventsTimeline}
												{eventsReaction}
												{eventsEmojiSet}
												{uploaderSelected}
												bind:channelToPost
												{currentChannelId}
												{isEnabledRelativeTime}
												{nowRealtime}
												{level}
												isPreview={false}
												{callInsertText}
												bind:baseEventToEdit
											/>
										</p>
									{:else}
										invalid award
									{/if}
								{:else if event.kind === 17}
									{@const r = event.tags
										.find((tag) => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1]))
										?.at(1)}
									{#if r === undefined}
										<p class="warning-message">url not found</p>
									{:else}
										<Content content={r} tags={[]} />
									{/if}
								{:else if event.kind === 20}
									{@const title = event.tags
										.find((tag) => tag.length >= 2 && tag[0] === 'title')
										?.at(1)}
									{@const imetaTags = event.tags.filter(
										(tag) => tag.length >= 2 && tag[0] === 'imeta'
									)}
									{@const urls = imetaTags
										.flat()
										.filter((s) => s.startsWith('url '))
										.map((s) => s.split(' ').at(1))
										.filter((s) => s !== undefined)
										.filter((s) => URL.canParse(s))}
									{#if title !== undefined}<p>{title}</p>{/if}
									<p>
										<Content
											content={event.content.length > 0
												? `${event.content}\n${urls.join(' ')}`
												: urls.join(' ')}
											tags={event.tags}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											{level}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									</p>
								{:else if event.kind === 40}
									{@const channel = channelMap.get(event.id)}
									{#if channel !== undefined}
										<ChannelMeta {channel} />
									{:else}
										unknown channel
									{/if}
								{:else if event.kind === 1018}
									{@const responses = event.tags
										.filter((tag) => tag.length >= 2 && tag[0] === 'response')
										.map((tag) => tag[1])}
									{@const eId = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1)}
									{@const event1068 = getEventById(eId ?? '')}
									<ul>
										{#each new Set<string>(responses) as response (response)}
											<li>{response}</li>
										{/each}
									</ul>
									{#if event1068 !== undefined}
										<Entry
											event={event1068}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{mutedHashTags}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											{channelToPost}
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											level={level + 1}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									{/if}
								{:else if event.kind === 1068}
									<p>
										<Content
											content={event.content}
											tags={event.tags}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											{level}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									</p>
									<Poll {event} {loginPubkey} {nowRealtime} />
								{:else if event.kind === 1111}
									{#if textAndUrlReplyTo !== undefined}
										<i class="fa-fw fas fa-arrow-alt-from-right"></i>
										<span class="Mention">
											<a href={textAndUrlReplyTo[1]} target="_blank" rel="noopener noreferrer"
												>{textAndUrlReplyTo[0]}</a
											>
										</span>
									{/if}
									<p>
										<Content
											content={event.content}
											tags={event.tags}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											{level}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									</p>
								{:else if event.kind === 9734}
									<Content content={event.content} tags={event.tags} />
									{@const eventIdZapped =
										event.tags.find((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1) ?? ''}
									{@const aIdZapped =
										event.tags.find((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1) ?? ''}
									{@const ap = getAddressPointerFromAId(aIdZapped)}
									{@const eventZappedByETag = getEventById(eventIdZapped)}
									{@const eventZappedByATag =
										ap === null ? undefined : getEventByAddressPointer(ap)}
									{@const eventZapped = eventZappedByETag ?? eventZappedByATag}
									{#if eventZapped !== undefined}
										<Entry
											event={eventZapped}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{mutedHashTags}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											{channelToPost}
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											level={level + 1}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									{/if}
								{:else if event.kind === 9735}
									{@const event9734 = getEvent9734(event)}
									{#if event9734 !== null}
										<Entry
											event={event9734}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{mutedHashTags}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											{channelToPost}
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											level={level + 1}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									{:else}
										invalid kind:9735 event
									{/if}
								{:else if event.kind === 10000}
									{@const { pPub, ePub, wPub, tPub } = splitNip51ListPublic(event)}
									<MuteList
										{loginPubkey}
										{profileMap}
										{channelMap}
										mutedPubkeys={pPub}
										mutedChannelIds={ePub}
										mutedWords={wPub}
										mutedHashTags={tPub}
										isAuthor={false}
									/>
								{:else if event.kind === 10001}
									{@const es = event.tags
										.filter((tag) => tag.length >= 2 && tag[0] === 'e')
										.map((tag) => tag[1])}
									{@const content = es
										.map((e) => `nostr:${nip19.neventEncode({ id: e })}`)
										.join('\n')}
									<p>
										<Content
											{content}
											tags={event.tags}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											{level}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									</p>
								{:else if event.kind === 10002}
									<RelayList relaysToUse={getRelaysToUseFromKind10002Event(event)} />
								{:else if [10003, 30003].includes(event.kind)}
									{#if event.kind === 30003}
										{@const dTagName =
											event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}
										<p>{dTagName}</p>
									{/if}
									{#each event.tags as tag, i (i)}
										{#if i < 10}
											{#if tag[0] === 'e' && tag[1] !== undefined}
												{@const nevent = nip19.neventEncode({ id: tag[1] })}
												{#if getEventById(tag[1]) === undefined}
													<p><a href={`/entry/${nevent}`}>nostr:{nevent}</a></p>
												{:else}
													<p>
														<Content
															content={`nostr:${nevent}`}
															tags={event.tags}
															{channelMap}
															{profileMap}
															{loginPubkey}
															{mutedPubkeys}
															{mutedChannelIds}
															{mutedWords}
															{followingPubkeys}
															{eventsTimeline}
															{eventsReaction}
															{eventsEmojiSet}
															{uploaderSelected}
															bind:channelToPost
															{currentChannelId}
															{isEnabledRelativeTime}
															{nowRealtime}
															{level}
															isPreview={false}
															{callInsertText}
															bind:baseEventToEdit
														/>
													</p>
												{/if}
											{:else if tag[0] === 'a' && tag[1] !== undefined}
												{@const ap = getAddressPointerFromAId(tag[1])}
												{#if ap === null}
													invalid a tag: {tag[0]}, {tag[1]}
												{:else if getEventByAddressPointer(ap) === undefined}
													<p>
														<a href={`/entry/${nip19.naddrEncode(ap)}`}
															>nostr:{nip19.naddrEncode(ap)}</a
														>
													</p>
												{:else}
													<p>
														<Content
															content={`nostr:${nip19.naddrEncode(ap)}`}
															tags={event.tags}
															{channelMap}
															{profileMap}
															{loginPubkey}
															{mutedPubkeys}
															{mutedChannelIds}
															{mutedWords}
															{followingPubkeys}
															{eventsTimeline}
															{eventsReaction}
															{eventsEmojiSet}
															{uploaderSelected}
															bind:channelToPost
															{currentChannelId}
															{isEnabledRelativeTime}
															{nowRealtime}
															{level}
															isPreview={false}
															{callInsertText}
															bind:baseEventToEdit
														/>
													</p>
												{/if}
											{:else if tag[0] === 't' && tag[1] !== undefined}
												<p><Content content={`#${tag[1]}`} tags={[]} /></p>
											{:else if tag[0] === 'r' && URL.canParse(tag[1])}
												<p><Content content={tag[1]} tags={[]} /></p>
											{:else if !['d', 'client'].includes(tag[0])}
												<p>unsupported tag: {tag[0]}, {tag[1]}</p>
											{/if}
										{:else if i === 10}
											<p>...</p>
										{/if}
									{/each}
								{:else if event.kind === 10005}
									{@const channelBookmarkMap = getChannelBookmarkMap()}
									{@const channelBookmarkIds = channelBookmarkMap.get(event.pubkey)}
									{#if channelBookmarkIds !== undefined}
										<ChannelList
											channelIds={channelBookmarkIds}
											{loginPubkey}
											{channelMap}
											bind:channelToPost
											bind:baseEventToEdit
										/>
									{/if}
								{:else if event.kind === 10030}
									{@const aIds = event.tags
										.filter((tag) => tag.length >= 2 && tag[0] === 'a')
										.map((tag) => tag[1])}
									{#each new Set<string>(aIds) as aId, i (aId)}
										{@const newline = '\n'}
										{#if i > 0}{newline}{/if}
										{@const ap = getAddressPointerFromAId(aId)}
										{@const ev = ap === null ? undefined : getEventByAddressPointer(ap)}
										{#if ev === undefined}
											{#if ap !== null}
												{`nostr:${nip19.naddrEncode(ap)}`}
											{/if}
										{:else}
											<Entry
												event={ev}
												{channelMap}
												{profileMap}
												{loginPubkey}
												{mutedPubkeys}
												{mutedChannelIds}
												{mutedWords}
												{mutedHashTags}
												{followingPubkeys}
												{eventsTimeline}
												{eventsReaction}
												{eventsEmojiSet}
												{uploaderSelected}
												{channelToPost}
												{currentChannelId}
												{isEnabledRelativeTime}
												{nowRealtime}
												level={level + 1}
												isPreview={false}
												{callInsertText}
												bind:baseEventToEdit
											/>
										{/if}
									{/each}
								{:else if event.kind === 30008}
									{@const badgeEvent = getEventByAddressPointer({
										identifier: 'profile_badges',
										pubkey: event.pubkey,
										kind: event.kind
									})}
									<Badges currentPubkey={event.pubkey} {badgeEvent} />
								{:else if event.kind === 30009}
									{@const tagMap = new Map<string, string>(
										event.tags.map((tag) => [tag[0], tag[1]])
									)}
									{#if tagMap.get('name') !== undefined}<p class="name">
											{tagMap.get('name')}
										</p>{/if}
									{#if tagMap.get('description') !== undefined}<p class="description">
											{tagMap.get('description')}
										</p>{/if}
									{#if URL.canParse(tagMap.get('image') ?? '')}<p class="image">
											<img
												alt={tagMap.get('name') ?? ''}
												title={tagMap.get('name') ?? ''}
												src={tagMap.get('image')}
												class="badge"
											/>
										</p>{/if}
								{:else if event.kind === 30023}
									{@const title =
										event.tags.find((tag) => tag.length >= 2 && tag[0] === 'title')?.at(1) ?? ''}
									<h2 class="title">{title}</h2>
									<p>
										<Content
											content={event.content}
											tags={event.tags}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											{level}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									</p>
								{:else if event.kind === 30030}
									{@const dTagName =
										event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}
									{@const emojiTags = event.tags.filter(
										(tag) =>
											tag.length >= 3 &&
											tag[0] === 'emoji' &&
											/^\w+$/.test(tag[1]) &&
											URL.canParse(tag[2])
									)}
									{@const aTagStrs = eventsEmojiSet.map(
										(ev) =>
											`${ev.kind}:${ev.pubkey}:${ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`
									)}
									{@const aTagStr = `${event.kind}:${event.pubkey}:${dTagName}`}
									<div class="emoji-set">
										{#if loginPubkey !== undefined}
											<div>
												{#if aTagStrs.includes(aTagStr)}
													<div
														title={$_('Entry.remove-from-favorites')}
														class="FavoriteButton FavoriteButton--active"
													>
														<!-- svelte-ignore a11y_click_events_have_key_events -->
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<span
															class="fa-fw fas fa-heart"
															onclick={() => {
																unbookmarkEmojiSets(aTagStr);
															}}
														></span>
													</div>
												{:else}
													<div title={$_('Entry.add-to-favorites')} class="FavoriteButton">
														<!-- svelte-ignore a11y_click_events_have_key_events -->
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<span
															class="fa-fw fas fa-heart"
															onclick={() => {
																const recommendedRelay = getSeenOn(event.id).at(0);
																bookmarkEmojiSets(aTagStr, recommendedRelay);
															}}
														></span>
													</div>
												{/if}
											</div>
										{/if}
										<p>{dTagName}</p>
										{#each new Map<string, string>(emojiTags.map( (tag) => [tag[1], tag[2]] )) as [shortcode, url] (shortcode)}
											<img
												class="emoji"
												src={url}
												alt={`:${shortcode}:`}
												title={`:${shortcode}:`}
											/>
										{/each}
									</div>
								{:else if event.kind === 31990}
									{@const obj = getHandlerInformation(event.content)}
									{#if obj === null}
										{event.content}
									{:else}
										{@const name = obj.name ?? obj.display_name ?? 'unknown'}
										<div class="handler-information">
											{#if URL.canParse(obj.banner ?? '')}
												<img src={obj.banner} alt="banner" class="banner" />
											{/if}
											<p>
												{#if URL.canParse(obj.website ?? '')}
													<a href={obj.website} target="_blank" rel="noopener noreferrer">
														{#if URL.canParse(obj.picture ?? '')}
															<!-- svelte-ignore a11y_img_redundant_alt -->
															<img src={obj.picture} alt="picture" class="picture" />
														{/if}
														{name}
													</a>
												{:else}
													{#if URL.canParse(obj.picture ?? '')}
														<!-- svelte-ignore a11y_img_redundant_alt -->
														<img src={obj.picture} alt="picture" class="picture" />
													{/if}
													{name}
												{/if}
											</p>
											<p>{obj.about}</p>
										</div>
									{/if}
								{:else}
									<p>
										<Content
											content={event.content}
											tags={event.tags}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{followingPubkeys}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											{level}
											isPreview={false}
											{callInsertText}
											bind:baseEventToEdit
										/>
									</p>
								{/if}
								{#if contentWarningReason !== null}
									<button
										class="Button toggle-cw"
										onclick={() => {
											showCW = false;
										}}><span>{$_('Entry.hide-cw')}</span></button
									>
								{/if}
								{#if isMutedPubkey}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedPubkey = false;
										}}><span>{$_('Entry.hide-muted-account')}</span></button
									>
								{/if}
								{#if isMutedChannel}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedChannel = false;
										}}><span>{$_('Entry.hide-muted-channel')}</span></button
									>
								{/if}
								{#if isMutedContent}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedContent = false;
										}}><span>{$_('Entry.hide-muted-word')}</span></button
									>
								{/if}
								{#if isMutedHashTag}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedHashTag = false;
										}}><span>{$_('Entry.hide-muted-hashtag')}</span></button
									>
								{/if}
							{:else}
								<p class="warning-message">
									⚠️Content Warning⚠️
									{#if contentWarningReason.length > 0}{`\n(${$_('Entry.reason')}: ${contentWarningReason})`}{/if}
								</p>
								<button
									class="Button toggle-cw"
									onclick={() => {
										showCW = true;
									}}><span>{$_('Entry.show-cw')}</span></button
								>
							{/if}
						</div>
						<dvi class="via">
							{#if urlViaAP !== undefined}
								<span class="proxy"
									>via <a href={urlViaAP} target="_blank" rel="noopener noreferrer"
										><img src="/ActivityPub-logo-symbol.svg" alt="ActivityPub" /></a
									></span
								>
							{/if}
							{#if urlViaRSS !== undefined}
								<span class="proxy"
									>via <a href={urlViaRSS} target="_blank" rel="noopener noreferrer"
										><img src="/Rss_Shiny_Icon.svg" alt="RSS" /></a
									></span
								>
							{/if}
							{#if urlViaWeb !== undefined}
								<span class="proxy"
									>via <a
										href={urlViaWeb}
										target="_blank"
										rel="noopener noreferrer"
										aria-label="web"
										><svg
											xmlns="http://www.w3.org/2000/svg"
											width="24"
											height="24"
											viewBox="0 0 24 24"
										>
											<path
												fill-rule="evenodd"
												d="M14,9 L14,7 L18,7 C20.7614237,7 23,9.23857625 23,12 C23,14.7614237 20.7614237,17 18,17 L14,17 L14,15 L18,15 C19.6568542,15 21,13.6568542 21,12 C21,10.3431458 19.6568542,9 18,9 L14,9 Z M10,15 L10,17 L6,17 C3.23857625,17 1,14.7614237 1,12 C1,9.23857625 3.23857625,7 6,7 L10,7 L10,9 L6,9 C4.34314575,9 3,10.3431458 3,12 C3,13.6568542 4.34314575,15 6,15 L10,15 Z M7,13 L7,11 L17,11 L17,13 L7,13 Z"
											/>
										</svg>
									</a></span
								>
							{/if}
							{#if urlViaATP !== undefined}
								<span class="proxy"
									>via <a href={urlViaATP} target="_blank" rel="noopener noreferrer"
										><img src="/Bluesky_butterfly-logo.svg" alt="Bluesky" /></a
									></span
								>
							{/if}
							{#if clientInfo !== undefined}
								<span class="via"
									>via <a href={clientInfo.url} target="_blank" rel="noopener noreferrer"
										>{clientInfo.name}</a
									></span
								>
							{/if}
						</dvi>
					</div>
					<div class="Entry__foot">
						{#if !isPreview}
							<div class="EntryMeta">
								<span class="User">
									<a href="/{nip19.npubEncode(event.pubkey)}">
										<img
											src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(event.pubkey))}
											alt={getProfileName(event.pubkey)}
											class="Avatar"
										/>
										<Content
											content={getProfileName(event.pubkey)}
											tags={prof?.event.tags ?? []}
											isAbout={true}
										/>
									</a>
								</span>
								<span class="Separator">·</span>
								<span class="Time">
									<a href={`/entry/${getEncode(event)}`}>
										<time
											datetime={new Date(1000 * event.created_at).toISOString()}
											title={new Date(1000 * event.created_at).toLocaleString()}
											class="NoticeItem__time"
											>{isEnabledRelativeTime
												? getRelativeTime(nowRealtime, event.created_at)
												: getAbsoluteTime(event.created_at)}</time
										>
									</a>
								</span>
								{#if loginPubkey !== undefined}
									{#if loginPubkey === event.pubkey}
										{#if ![5, 62].includes(event.kind)}
											<span class="Separator">·</span>
											<!-- svelte-ignore a11y_click_events_have_key_events -->
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												class="DeleteButton"
												title={$_('Entry.delete')}
												onclick={() => {
													if (confirm($_('Entry.confirm-delete'))) {
														sendDeletion(event);
													}
												}}><i class="far fa-times-circle"></i></span
											>
										{/if}
										{#if [10001].includes(event.kind)}
											<span class="Separator">·</span>
											<span class="edit">
												<button
													aria-label="Edit Button"
													class="edit"
													title={$_('Entry.edit')}
													onclick={() => {
														channelToPost = undefined;
														baseEventToEdit = event;
													}}
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="24"
														height="24"
														viewBox="0 0 24 24"
													>
														<path
															fill-rule="evenodd"
															d="M14.8024118,6.44526791 L8.69610276,12.549589 C8.29095108,12.9079238 8.04030835,13.4092335 8,13.8678295 L8,16.0029438 L10.0639829,16.004826 C10.5982069,15.9670062 11.0954869,15.7183782 11.4947932,15.2616227 L17.556693,9.19972295 L14.8024118,6.44526791 Z M16.2168556,5.0312846 L18.9709065,7.78550938 L19.8647941,6.89162181 C19.9513987,6.80501747 20.0000526,6.68755666 20.0000526,6.56507948 C20.0000526,6.4426023 19.9513987,6.32514149 19.8647932,6.23853626 L17.7611243,4.13485646 C17.6754884,4.04854589 17.5589355,4 17.43735,4 C17.3157645,4 17.1992116,4.04854589 17.1135757,4.13485646 L16.2168556,5.0312846 Z M22,13 L22,20 C22,21.1045695 21.1045695,22 20,22 L4,22 C2.8954305,22 2,21.1045695 2,20 L2,4 C2,2.8954305 2.8954305,2 4,2 L11,2 L11,4 L4,4 L4,20 L20,20 L20,13 L22,13 Z M17.43735,2 C18.0920882,2 18.7197259,2.26141978 19.1781068,2.7234227 L21.2790059,4.82432181 C21.7406843,5.28599904 22.0000526,5.91216845 22.0000526,6.56507948 C22.0000526,7.21799052 21.7406843,7.84415992 21.2790068,8.30583626 L12.9575072,16.6237545 C12.2590245,17.4294925 11.2689,17.9245308 10.1346,18.0023295 L6,18.0023295 L6,17.0023295 L6.00324765,13.7873015 C6.08843822,12.7328366 6.57866679,11.7523321 7.32649633,11.0934196 L15.6953877,2.72462818 C16.1563921,2.2608295 16.7833514,2 17.43735,2 Z"
														/>
													</svg>
												</button>
											</span>
										{/if}
									{/if}
									<span class="Separator">·</span>
									<div class="repost-container">
										<span class="repost">
											<button
												aria-label="Repost Button"
												class="repost"
												title={$_('Entry.repost')}
												onclick={() => {
													showRepost = !showRepost;
												}}
											>
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="24"
													height="24"
													viewBox="0 0 24 24"
												>
													<path
														fill-rule="evenodd"
														d="M17.8069373,7 C16.4464601,5.07869636 14.3936238,4 12,4 C7.581722,4 4,7.581722 4,12 L2,12 C2,6.4771525 6.4771525,2 12,2 C14.8042336,2 17.274893,3.18251178 19,5.27034886 L19,2 L21,2 L21,9 L14,9 L14,7 L17.8069373,7 Z M6.19306266,17 C7.55353989,18.9213036 9.60637619,20 12,20 C16.418278,20 20,16.418278 20,12 L22,12 C22,17.5228475 17.5228475,22 12,22 C9.19576641,22 6.72510698,20.8174882 5,18.7296511 L5,22 L3,22 L3,15 L10,15 L10,17 L6.19306266,17 Z"
													/>
												</svg>
											</button>
										</span>
										{#if showRepost}
											<ul class="select-repost">
												<li>
													<span class="repost">
														<button
															class="repost"
															onclick={() => {
																sendRepost(event);
																showRepost = false;
															}}>{$_('Entry.repost')}</button
														>
													</span>
												</li>
												<li>
													<span class="quote">
														<button
															class="quote"
															onclick={() => {
																callInsertText(`nostr:${getEncode(event, getSeenOn(event.id))}`);
																showRepost = false;
															}}>{$_('Entry.quote')}</button
														>
													</span>
												</li>
											</ul>
										{/if}
									</div>
									{#if (profileMap.get(event.pubkey)?.lud16 ?? profileMap.get(event.pubkey)?.lud06) !== undefined}
										<span class="Separator">·</span>
										<span class="zap">
											<button
												aria-label="Zap Button"
												class="zap"
												title="Zap"
												onclick={() => {
													const relaysToWrite: string[] = Object.entries(getRelaysToUse())
														.filter((v) => v[1].write)
														.map((v) => v[0]);
													zap(
														nip19.npubEncode(event.pubkey),
														isAddressableKind(event.kind) || isReplaceableKind(event.kind)
															? undefined
															: nip19.noteEncode(event.id),
														isAddressableKind(event.kind) || isReplaceableKind(event.kind)
															? getEncode(event)
															: undefined,
														relaysToWrite,
														zapWindowContainer
													);
												}}
											>
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="24"
													height="24"
													viewBox="0 0 24 24"
												>
													<path
														fill-rule="evenodd"
														d="M9,15 L3.91937515,15 L15,1.14921894 L15,9 L20.0806248,9 L9,22.8507811 L9,15 Z M8.08062485,13 L11,13 L11,17.1492189 L15.9193752,11 L13,11 L13,6.85078106 L8.08062485,13 Z"
													/>
												</svg>
											</button>
										</span>
										<div class="zap-window-container" bind:this={zapWindowContainer}></div>
									{/if}
								{/if}
								{#if !event.tags.some((tag) => tag[0] === '-') || event.pubkey === loginPubkey}
									<span class="Separator">·</span>
									<span class="broadcast">
										<button
											aria-label="Broadcast Button"
											class="broadcast"
											title={$_('Entry.broadcast')}
											onclick={() => {
												const relaysToWrite: string[] = Object.entries(getRelaysToUse())
													.filter((v) => v[1].write)
													.map((v) => v[0]);
												const message = [$_('Entry.confirm-broadcast'), '', ...relaysToWrite].join(
													'\n'
												);
												if (confirm(message)) {
													const options = { on: { relays: relaysToWrite } };
													sendEvent(event, options);
												}
											}}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												width="24"
												height="24"
												viewBox="0 0 24 24"
											>
												<path
													fill-rule="evenodd"
													d="M9.38742589,20 L8.72075922,22 L6.61257411,22 L9.89881747,12.1412699 C9.34410225,11.5968755 9,10.8386225 9,10 C9,8.34314575 10.3431458,7 12,7 C13.6568542,7 15,8.34314575 15,10 C15,10.8386225 14.6558977,11.5968755 14.1011825,12.1412699 L17.3874259,22 L15.2792408,22 L14.6125741,20 L9.38742589,20 Z M10.7207592,16 L10.0540926,18 L13.9459074,18 L13.2792408,16 L10.7207592,16 Z M11.3874259,14 L12.6125741,14 L12.2750928,12.987556 C12.1844984,12.9957918 12.0927406,13 12,13 C11.9072594,13 11.8155016,12.9957918 11.7249072,12.987556 L11.3874259,14 Z M12,11 C12.5522847,11 13,10.5522847 13,10 C13,9.44771525 12.5522847,9 12,9 C11.4477153,9 11,9.44771525 11,10 C11,10.5522847 11.4477153,11 12,11 Z M20.108743,2.56698557 C21.9041909,4.52460368 23,7.13433188 23,10 C23,12.8656681 21.9041909,15.4753963 20.108743,17.4330144 L18.6344261,16.0815573 C20.103429,14.4798697 21,12.3446376 21,10 C21,7.65536245 20.103429,5.52013028 18.6344261,3.91844274 L20.108743,2.56698557 Z M17.1601092,5.26989991 C18.302667,6.51565689 19,8.17639301 19,10 C19,11.823607 18.302667,13.4843431 17.1601092,14.7301001 L15.6857923,13.3786429 C16.501905,12.4888165 17,11.3025764 17,10 C17,8.69742358 16.501905,7.51118349 15.6857923,6.62135708 L17.1601092,5.26989991 Z M3.89125699,2.56665655 L5.3655739,3.91811372 C3.89657104,5.51980126 3,7.65503343 3,9.99967098 C3,12.3443085 3.89657104,14.4795407 5.3655739,16.0812282 L3.89125699,17.4326854 C2.09580905,15.4750673 1,12.8653391 1,9.99967098 C1,7.13400286 2.09580905,4.52427466 3.89125699,2.56665655 Z M6.83989081,5.26957089 L8.31420772,6.62102806 C7.49809502,7.51085447 7,8.69709456 7,9.99967098 C7,11.3022474 7.49809502,12.4884875 8.31420772,13.3783139 L6.83989081,14.7297711 C5.69733303,13.4840141 5,11.823278 5,9.99967098 C5,8.17606399 5.69733303,6.51532787 6.83989081,5.26957089 Z"
												/>
											</svg>
										</button>
									</span>
								{/if}
								<span class="Separator">·</span>
								<span class="show-json">
									<button
										aria-label="Show JSON"
										class="show-json"
										title={$_('Entry.show-json')}
										onclick={() => {
											showJson = !showJson;
										}}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="24"
											height="24"
											viewBox="0 0 24 24"
										>
											<path
												fill-rule="evenodd"
												d="M5,14 C3.8954305,14 3,13.1045695 3,12 C3,10.8954305 3.8954305,10 5,10 C6.1045695,10 7,10.8954305 7,12 C7,13.1045695 6.1045695,14 5,14 Z M12,14 C10.8954305,14 10,13.1045695 10,12 C10,10.8954305 10.8954305,10 12,10 C13.1045695,10 14,10.8954305 14,12 C14,13.1045695 13.1045695,14 12,14 Z M19,14 C17.8954305,14 17,13.1045695 17,12 C17,10.8954305 17.8954305,10 19,10 C20.1045695,10 21,10.8954305 21,12 C21,13.1045695 20.1045695,14 19,14 Z"
											/>
										</svg>
									</button>
								</span>
								{#if loginPubkey !== undefined}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span
										class="Entry__reply"
										onclick={() => {
											showForm = !showForm;
										}}><i class="fal fa-comment-lines"></i> {$_('Entry.reply')}</span
									>
								{/if}
							</div>
						{/if}
					</div>
					{#if eventsReplying.length > 0 && !showReplies}
						<div class="Entry__replyline">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								title={$_('Entry.show-replies')}
								class="ReplyAvatars noselect"
								onclick={() => {
									showReplies = true;
								}}
							>
								<span>↳</span>
								{#each eventsReplying as ev (ev.id)}
									{@const prof = profileMap.get(ev.pubkey)}
									<img
										src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(ev.pubkey))}
										alt={getProfileName(ev.pubkey)}
										class="Avatar"
									/>
								{/each}
							</div>
						</div>
					{/if}
					<div class="Entry__MobileActions">
						<div class="TabList">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								title={$_('Entry.reply')}
								class="Action Action--reply"
								onclick={() => {
									showForm = !showForm;
								}}
							>
								<i class="fal fa-comment-lines"></i>
							</span>
							{#if eventsReplying.length > 0 && !showReplies}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									title={$_('Entry.show-replies')}
									class="Action Action--replies noselect"
									onclick={() => {
										showReplies = true;
									}}
								>
									<i class="far fa-comment-alt-lines"></i>
									{#each eventsReplying as ev (ev.id)}
										{@const prof = profileMap.get(ev.pubkey)}
										{@const picture = URL.canParse(prof?.picture ?? '') ? prof?.picture : undefined}
										{#if picture !== undefined}
											<img alt="" loading="lazy" src={picture} class="Avatar" />
										{/if}
									{/each}
								</span>
							{/if}
						</div>
					</div>
				</div>
			</div>
			{#if showJson || showForm || showReplies}
				<div class="Extra">
					{#if showJson}
						{@const channel = channelMap.get(event.id)}
						{@const events =
							event.kind === 40 && channel?.eventkind41 !== undefined
								? [channel.eventkind41, event]
								: [event]}
						<aside class="Entry__json">
							{#each events as event, i (event.id)}
								{#if i > 0}<hr />{/if}
								<dl class="details">
									<dt>User ID</dt>
									<dd><code>{nip19.npubEncode(event.pubkey)}</code></dd>
									<dt>Event ID</dt>
									<dd><code>{getEncode(event)}</code></dd>
									<dt>Event JSON</dt>
									<dd>
										<pre class="json-view"><code>{JSON.stringify(event, undefined, 2)}</code></pre>
									</dd>
									<dt>Relays seen on</dt>
									<dd>
										<ul>
											{#each getSeenOn(event.id) as relay (relay)}
												<li>{relay}</li>
											{/each}
										</ul>
									</dd>
									<dt>Event ID with relay hints</dt>
									<dd><code>{getEncode(event, getSeenOn(event.id))}</code></dd>
								</dl>
							{/each}
						</aside>
					{/if}
					<div class="Entry__composeReply">
						{#if showForm}
							<CreateEntry
								{loginPubkey}
								currentChannelId={undefined}
								eventToReply={event}
								isTopPage={false}
								{profileMap}
								{uploaderSelected}
								{eventsEmojiSet}
								channelToPost={undefined}
								bind:showForm
								bind:previewEvent
								callInsertText={() => {}}
								baseEventToEdit={undefined}
							/>
						{/if}
					</div>
					<div class="Entry__replies">
						{#if previewEvent}
							<Entry
								event={{ ...previewEvent, id: getEventHash(previewEvent), sig: '' }}
								{channelMap}
								{profileMap}
								{loginPubkey}
								{mutedPubkeys}
								{mutedChannelIds}
								{mutedWords}
								{mutedHashTags}
								{followingPubkeys}
								{eventsTimeline}
								{eventsReaction}
								{eventsEmojiSet}
								{uploaderSelected}
								{channelToPost}
								{currentChannelId}
								{isEnabledRelativeTime}
								{nowRealtime}
								level={level + 1}
								isPreview={true}
								callInsertText={() => {}}
								baseEventToEdit={undefined}
							/>
						{/if}
						{#if showReplies}
							{#each eventsReplying as ev (ev.id)}
								<Entry
									event={ev}
									{channelMap}
									{profileMap}
									{loginPubkey}
									{mutedPubkeys}
									{mutedChannelIds}
									{mutedWords}
									{mutedHashTags}
									{followingPubkeys}
									{eventsTimeline}
									{eventsReaction}
									{eventsEmojiSet}
									{uploaderSelected}
									{channelToPost}
									{currentChannelId}
									{isEnabledRelativeTime}
									{nowRealtime}
									level={level + 1}
									isPreview={false}
									{callInsertText}
									bind:baseEventToEdit
								/>
							{/each}
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	{:else}
		<div class="Entry__main muted">
			<div class="Post">
				<div class="Entry__body">
					<div class="Entry__content">
						{#if isMutedPubkey && !showMutedPubkey}
							<p class="muted-message">{$_('Entry.muted-account')}</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedPubkey = true;
								}}><span>{$_('Entry.show-muted-account')}</span></button
							>
						{/if}
						{#if isMutedChannel && !showMutedChannel}
							<p class="muted-message">{$_('Entry.muted-channel')}</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedChannel = true;
								}}><span>{$_('Entry.show-muted-channel')}</span></button
							>
						{/if}
						{#if isMutedContent && !showMutedContent}
							<p class="muted-message">{$_('Entry.muted-word')}</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedContent = true;
								}}><span>{$_('Entry.show-muted-word')}</span></button
							>
						{/if}
						{#if isMutedHashTag && !showMutedHashTag}
							<p class="muted-message">{$_('Entry.muted-hashtag')}</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedHashTag = true;
								}}><span>{$_('Entry.show-muted-hashtag')}</span></button
							>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</article>

<style>
	.Entry__head {
		position: relative;
	}
	.Entry__content {
		padding: 3px 1px;
		max-height: 30em;
		overflow-y: auto;
	}
	/* ↑の overflow-y: auto の影響で引用内の絵文字ピッカーが隠れてしまうため 本当は overflow-y: visible にしたい… */
	.Quote .emoji-picker-opened .Entry__content {
		min-height: 435px;
	}
	/* スクロールは外側だけ */
	.Quote .Entry__content {
		max-height: unset;
	}
	.Entry__content > p,
	.Entry__content code {
		white-space: pre-wrap;
	}
	.Entry__content :not(p):not(code) {
		white-space: pre-line;
	}
	.Entry.Quote .Entry__profile img.Avatar {
		width: 36px;
		height: 36px;
		max-width: unset;
	}
	.Quote.Odd {
		background-color: rgba(255, 127, 127, 0.1);
	}
	.Quote.Even {
		background-color: rgba(127, 127, 255, 0.1);
	}
	.warning-message {
		background-color: rgba(255, 255, 127, 0.1);
	}
	.muted-message {
		background-color: rgba(255, 127, 255, 0.1);
	}
	.mentioning {
		background-color: rgba(255, 255, 0, 0.2);
	}
	.Entry__body {
		position: relative;
	}
	.via {
		position: absolute;
		bottom: -5px;
		right: 0px;
		width: 100%;
		text-align: right;
	}
	.proxy img,
	.proxy svg {
		width: 16px;
		height: 16px;
		fill: var(--secondary-text-color);
		vertical-align: top;
	}
	.Post span {
		font-size: 12px;
		margin-right: 3px;
		word-break: break-all;
	}
	.Post .FavoriteButton > span {
		font-size: 16px;
		margin-right: unset;
	}
	.Post span > button {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
		vertical-align: bottom;
	}
	.Post span > button:disabled {
		cursor: not-allowed;
	}
	.Post span > button > svg {
		width: 16px;
		height: 16px;
		fill: var(--secondary-text-color);
	}
	.Post span > button:active > svg {
		fill: yellow;
	}
	.emoji {
		height: 32px;
		vertical-align: top;
	}
	.badge {
		width: 200px;
		height: 200px;
	}
	.title {
		font-size: 1.5em;
	}
	.handler-information img.banner {
		max-height: 100px;
	}
	.handler-information img.picture {
		max-height: 32px;
	}
	.Entry__json {
		background-color: var(--entry-nested-bg);
		overflow-x: auto;
		max-width: 60em;
		padding: 3px 1em;
		margin-top: 3px;
	}
	.Entry__json dl * {
		font-size: small;
	}
	.Entry__json code {
		font-size: x-small;
	}
	.Entry__json dl dd {
		padding-left: 1em;
	}
	.Entry.future {
		display: none;
	}
	.repost-container {
		position: relative;
	}
	.select-repost {
		position: absolute;
		bottom: 1.5em;
		left: 0;
		background-color: var(--settings-button-inactive-bg);
		border-radius: 10%;
		box-shadow:
			0 2px 6px -2px #00000080,
			0 6px 12px -2px #0003;
		z-index: 1;
		padding: 0 3px;
	}
	.select-repost > li {
		padding: 3px;
		min-width: 60px;
		list-style: none;
	}
	.select-repost > li:hover {
		background-color: var(--settings-button-active-bg);
	}
	.select-repost > li > span.repost {
		line-height: 1em;
		white-space: nowrap;
	}
	article {
		animation: show 2s backwards;
	}
	@keyframes show {
		0% {
			max-height: 1em;
			opacity: 0.2;
		}
		50% {
			max-height: 30em;
			opacity: 1;
		}
		100% {
			max-height: 60em;
			opacity: 1;
		}
	}
</style>
