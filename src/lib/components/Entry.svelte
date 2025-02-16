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
		getProfileName,
		getRelaysToUse,
		getSeenOn,
		sendDeletion,
		sendRepost,
		unbookmarkBadge,
		unbookmarkEmojiSets
	} from '$lib/resource.svelte';
	import Profile from '$lib/components/kinds/Profile.svelte';
	import Reaction from '$lib/components/kinds/Reaction.svelte';
	import ChannelMeta from '$lib/components/kinds/ChannelMeta.svelte';
	import MuteList from '$lib/components/kinds/MuteList.svelte';
	import RelayList from '$lib/components/kinds/RelayList.svelte';
	import ChannelList from '$lib/components/kinds/ChannelList.svelte';
	import Badges from '$lib/components/kinds/Badges.svelte';
	import AddStar from '$lib/components/AddStar.svelte';
	import Content from '$lib/components/Content.svelte';
	import Entry from '$lib/components/Entry.svelte';
	import CreateEntry from '$lib/components/CreateEntry.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { isParameterizedReplaceableKind, isReplaceableKind } from 'nostr-tools/kinds';
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
		level
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
	} = $props();

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
		event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1])
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
		if (nowRealtime / 1000 < event.created_at - 5) {
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

	let showForm: boolean = $state(false);
	let showJson: boolean = $state(false);

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

	const getEncode = (event: NostrEvent): string => {
		const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
		return isReplaceableKind(event.kind) || isParameterizedReplaceableKind(event.kind)
			? nip19.naddrEncode({ identifier: d, pubkey: event.pubkey, kind: event.kind })
			: nip19.neventEncode({ ...event, author: event.pubkey });
	};

	const eventsReplying = $derived(getEventsReplying(event));

	let isEmojiPickerOpened: boolean = $state(false);
</script>

<article
	class={classNames.join(' ')}
	data-nevent={nip19.neventEncode({ ...event, author: event.pubkey })}
	data-npub={nip19.npubEncode(event.pubkey)}
>
	{#if (!isMutedPubkey || showMutedPubkey) && (!isMutedChannel || showMutedChannel) && (!isMutedContent || showMutedContent) && (!isMutedHashTag || showMutedHashTag)}
		{#if event.kind === 42 && (channelId === undefined || channel === undefined || channel.name === undefined)}
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
								alt={getProfileName(prof)}
								class="Avatar"
							/>
						</a>
					</div>
				</div>
				<div class={isEmojiPickerOpened ? 'Post emoji-picker-opened' : 'Post'}>
					<div class="Entry__head">
						<h3 class="Entry__keyword">
							{#if event.kind === 42 && channel !== undefined}
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
							{:else if event.kind === 0}
								User Metadata
							{:else if event.kind === 1}
								<a href="/{nip19.npubEncode(event.pubkey)}">id:{prof?.name ?? 'none'}</a>
							{:else if [6, 16].includes(event.kind)}
								<span title={`kind:${event.kind} repost`}>🔁</span>
								{#if event.kind === 6}
									<a href="/{nip19.npubEncode(event.pubkey)}">id:{prof?.name ?? 'none'}</a>
								{:else if event.kind === 16 && event.tags.some((tag) => tag.length >= 2 && tag[0] === 'k' && tag[1] === '42')}
									{@const channelIdReposted = getRootId(repostedEvent)}
									{@const repostedChannel = channelMap.get(channelIdReposted ?? '')}
									{#if channelIdReposted === undefined}
										{'invalid channel'}
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
							{:else if event.kind === 8}
								Badge Award
							{:else if event.kind === 20}
								Picture
							{:else if event.kind === 40}
								Channel
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
							{:else if event.kind === 10005}
								Public chats list
							{:else if event.kind === 10030}
								User emoji list
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
						</h3>
						<AddStar
							{event}
							{loginPubkey}
							{profileMap}
							{eventsReactionToTheEvent}
							{mutedWords}
							bind:isEmojiPickerOpened
						/>
					</div>
					<div class="Entry__body">
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
												alt={getProfileName(profReplyTo)}
												class="Avatar Avatar--sm"
											/>
											<Content
												content={getProfileName(profReplyTo)}
												tags={profReplyTo?.event.tags ?? []}
												isAbout={true}
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
								{:else if event.kind === 7}
									{@const reactedEventId = event.tags
										.findLast((tag) => tag.length >= 2 && tag[0] === 'e')
										?.at(1)}
									{@const reactedEvent = getEventById(reactedEventId ?? '')}
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
										/>
									{:else if reactedEventId !== undefined}
										{`nostr:${nip19.neventEncode({ id: reactedEventId })}`}
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
										{#each ps as p}
											{@const profAwarded = profileMap.get(p)}
											<div class="Entry__parentmarker">
												<a href="/{nip19.npubEncode(p)}">
													<i class="fa-fw fas fa-arrow-alt-from-right"></i>
													<span class="Mention">
														<img
															src={profAwarded?.picture ?? getRoboHashURL(nip19.npubEncode(p))}
															alt={getProfileName(profAwarded)}
															class="Avatar Avatar--sm"
														/>
														<Content
															content={getProfileName(profAwarded)}
															tags={profAwarded?.event.tags ?? []}
															isAbout={true}
														/>
													</span>
												</a>
											</div>
										{/each}
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
										/>
									</p>
								{:else if event.kind === 40}
									{@const channel = channelMap.get(event.id)}
									{#if channel !== undefined}
										<ChannelMeta {channel} />
									{:else}
										unknown channel
									{/if}
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
										/>
									</p>
								{:else if event.kind === 9734}
									{@const pubkeyZapped = event.tags
										.find((tag) => tag.length >= 2 && tag[0] === 'p')
										?.at(1)}
									{#if pubkeyZapped !== undefined}
										{@const profZapped = profileMap.get(pubkeyZapped)}
										<div class="Entry__parentmarker">
											<a href="/{nip19.npubEncode(pubkeyZapped)}">
												<i class="fa-fw fas fa-arrow-alt-from-right"></i>
												<span class="Mention">
													<img
														src={profZapped?.picture ??
															getRoboHashURL(nip19.npubEncode(pubkeyZapped))}
														alt={getProfileName(profZapped)}
														class="Avatar Avatar--sm"
													/>
													<Content
														content={getProfileName(profZapped)}
														tags={profZapped?.event.tags ?? []}
														isAbout={true}
													/>
												</span>
											</a>
										</div>
									{/if}
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
										/>
									</p>
								{:else if event.kind === 10002}
									<RelayList relaysToUse={getRelaysToUseFromKind10002Event(event)} />
								{:else if event.kind === 10005}
									{@const channelBookmarkMap = getChannelBookmarkMap()}
									{@const channelBookmarkIds = channelBookmarkMap.get(event.pubkey)}
									{#if channelBookmarkIds !== undefined}
										<ChannelList
											channelIds={channelBookmarkIds}
											{loginPubkey}
											{channelMap}
											bind:channelToPost
										/>
									{/if}
								{:else if event.kind === 10030}
									{@const aIds = event.tags
										.filter((tag) => tag.length >= 2 && tag[0] === 'a')
										.map((tag) => tag[1])}
									{#each new Set<string>(aIds) as aId, i (aId)}
										{#if i > 0}{'\n'}{/if}
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
										{#each emojiTags as emojiTag (emojiTag[1])}
											<img
												class="emoji"
												src={emojiTag[2]}
												alt={`:${emojiTag[1]}:`}
												title={`:${emojiTag[1]}:`}
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
									{#if contentWarningReason.length > 0}{'\n'}({$_('Entry.reason')}: {contentWarningReason}){/if}
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
						<div class="EntryMeta">
							<span class="User">
								<a href="/{nip19.npubEncode(event.pubkey)}">
									<img
										src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(event.pubkey))}
										alt={getProfileName(prof)}
										class="Avatar"
									/>
									<Content
										content={getProfileName(prof)}
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
											? getRelativeTime(nowRealtime, 1000 * event.created_at)
											: getAbsoluteTime(1000 * event.created_at)}</time
									>
								</a>
							</span>
							{#if loginPubkey !== undefined}
								{#if loginPubkey === event.pubkey}
									<span class="Separator">·</span>
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span
										class="DeleteButton"
										onclick={() => {
											if (confirm($_('Entry.confirm-delete'))) {
												sendDeletion(event);
											}
										}}><i class="far fa-times-circle"></i></span
									>
								{/if}
								<span class="Separator">·</span>
								<span class="repost">
									<button
										aria-label="Repost Button"
										class="repost"
										title="repost"
										onclick={() => {
											sendRepost(event);
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
								{#if (profileMap.get(event.pubkey)?.lud16 ?? profileMap.get(event.pubkey)?.lud06) !== undefined}
									<span class="Separator">·</span>
									<span class="zap">
										<button
											aria-label="Zap Button"
											class="zap"
											title="zap"
											onclick={() => {
												const relaysToWrite: string[] = Object.entries(getRelaysToUse())
													.filter((v) => v[1].write)
													.map((v) => v[0]);
												zap(
													nip19.npubEncode(event.pubkey),
													nip19.noteEncode(event.id),
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
							<span class="Separator">·</span>
							<span class="show-json">
								<button
									aria-label="Show JSON"
									class="show-json"
									title="Show JSON"
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
										alt={getProfileName(prof)}
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
								channelToPost={undefined}
								bind:showForm
							/>
						{/if}
					</div>
					<div class="Entry__replies">
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
